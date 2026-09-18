import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { randomUUID, webcrypto } from "node:crypto";
import { postgresEnvironment } from "../../../scripts/postgres-command.mjs";
import { seedDatabase } from "../src/seed.js";
import { setup } from "./helpers.js";

function frontendApi(name, fetchImpl, cryptoImpl = { randomUUID }) {
  const source = readFileSync(new URL(`../../${name}-web/src/api.js`, import.meta.url), "utf8").replace(/^export /gm, "");
  const context = vm.createContext({ document: { querySelector: () => null },
    sessionStorage: { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } },
    AbortController, setTimeout, clearTimeout, crypto: cryptoImpl, fetch: fetchImpl });
  return vm.runInContext(`${source}\n({ request, session, api })`, context);
}

for (const name of ["provider", "owner"]) {
  test(`${name}: local previews create write keys when randomUUID is unavailable`, async () => {
    const keys = [];
    const { request } = frontendApi(name, async (_url, options) => {
      keys.push(options.headers["idempotency-key"]);
      return { ok: true, status: 200, json: async () => ({ data: {} }) };
    }, { getRandomValues: (bytes) => webcrypto.getRandomValues(bytes) });
    await request("/write", { method: "POST", body: {}, idempotent: true });
    await request("/write", { method: "POST", body: {}, idempotent: true });
    assert.match(keys[0], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(keys[0], keys[1]);
  });

  test(`${name}: blocked browser storage still supports repeated sign-in/out`, () => {
    const { session } = frontendApi(name, async () => {});
    for (const token of ["demo-one", "demo-two"]) {
      session.token = token; assert.equal(session.token, token);
      session.clear(); assert.equal(session.token, null);
    }
  });

  test(`${name}: timeout remains effective with a caller-provided abort signal`, async () => {
    const { request } = frontendApi(name, async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    await assert.rejects(request("/slow", { timeout: 15, signal: new AbortController().signal }), (error) => error.code === "TIMEOUT");
  });

  test(`${name}: an uncertain write reuses its key, a confirmed next write gets a new key`, async () => {
    const keys = [];
    const { request } = frontendApi(name, async (_url, options) => {
      keys.push(options.headers["idempotency-key"]);
      if (keys.length === 1) throw new TypeError("Connection lost after sending");
      return { ok: true, status: 200, json: async () => ({ data: { accepted: true } }) };
    });
    const options = { method: "POST", body: { amountMinor: 500 }, idempotent: true };
    await assert.rejects(request("/invoices/test/payments", options));
    await request("/invoices/test/payments", options);
    await request("/invoices/test/payments", options);
    assert.equal(keys[0], keys[1]); assert.notEqual(keys[1], keys[2]);
  });

  test(`${name}: logout cancels old data requests without canceling server revocation`, async () => {
    const pending = new Map();
    const client = frontendApi(name, async (url, { signal }) => new Promise((resolve, reject) => {
      pending.set(url, { signal, resolve });
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    client.session.token = "token";
    const data = client.request("/data");
    const rejected = assert.rejects(data);
    const revoke = client.api.logout();
    client.session.clear();
    assert.equal(pending.get("/api/v1/data").signal.aborted, true);
    assert.equal(pending.get("/api/v1/auth/logout").signal.aborted, false);
    pending.get("/api/v1/auth/logout").resolve({ ok: true, json: async () => ({ data: {} }) });
    await Promise.all([revoke, rejected]);
  });

  test(`${name}: invalidated or logged-out loads cannot repopulate the view cache`, async () => {
    const source = readFileSync(new URL(`../../${name}-web/src/app.js`, import.meta.url), "utf8");
    const functions = source.slice(source.indexOf("function cachedView("), source.indexOf("function prefetchView("));
    const state = { me: {}, cache: new Map(), warming: new Map() };
    const resolvers = [];
    const context = vm.createContext({ state, loaders: { dashboard: () => new Promise((resolve) => resolvers.push(resolve)) } });
    const cache = vm.runInContext(`${functions}\n({loadAndCache, cachedView})`, context);
    const old = cache.loadAndCache("dashboard");
    state.warming.delete("dashboard");
    const fresh = cache.loadAndCache("dashboard");
    resolvers[0]("old-data"); await old;
    assert.equal(state.cache.size, 0); assert.equal(state.warming.size, 1);
    resolvers[1]("new-data"); await fresh;
    assert.equal(cache.cachedView("dashboard"), "new-data");
    state.cache.get("dashboard").expiresAt = 0;
    assert.equal(cache.cachedView("dashboard"), null);
    const beforeLogout = cache.loadAndCache("dashboard");
    state.me = null; state.warming.clear(); state.cache.clear();
    resolvers[2]("private-data"); await beforeLogout;
    assert.equal(state.cache.size, 0);
  });
}

test("PostgreSQL CLI configuration separates encoded credentials from connection arguments", () => {
  const env = postgresEnvironment("postgresql://backup:p%40ss%3Aword@[::1]:5433/radius?sslmode=verify-full&sslrootcert=%2Fcerts%2Froot.pem", { PATH: "/usr/bin", PGSERVICE: "unwanted" });
  assert.equal(env.PGHOST, "::1"); assert.equal(env.PGDATABASE, "radius"); assert.equal(env.PGPORT, "5433");
  assert.equal(env.PGPASSWORD, "p@ss:word"); assert.equal(env.PGSSLMODE, "verify-full");
  assert.equal(env.PGSSLROOTCERT, "/certs/root.pem"); assert.equal(env.PGSERVICE, undefined);
  assert.throws(() => postgresEnvironment("postgresql://db/radius?ssl=false"), /Unsupported/);
  assert.throws(() => postgresEnvironment("https://db/radius"));
});

test("development seed may run twice without duplicate data or an aborted transaction", async (t) => {
  const env = await setup(); t.after(() => env.close());
  const before = await env.db.get("SELECT COUNT(*) AS total FROM subscribers");
  await seedDatabase(env.db);
  assert.deepEqual(await env.db.get("SELECT COUNT(*) AS total FROM subscribers"), before);
});
