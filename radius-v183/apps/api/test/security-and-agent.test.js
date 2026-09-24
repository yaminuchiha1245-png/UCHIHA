import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { Readable } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GoogleIdTokenVerifier, decryptSecret, encryptSecret, signPayload, verifySignedPayload } from "../src/security.js";
import { validateConfig } from "../src/config.js";
import { createSpool, loadAgentConfig, normalizeAccounting } from "../../radius-agent/src/index.js";
import { RadiusDirectory, normalizeAuthentication, normalizeAuthorization, radiusAuthorizeReply, radiusReply } from "../../radius-agent/src/directory.js";
import { encodeLength, encodeSentence, RouterOsCommandExecutor, SentenceReader, routerProbeErrorCode } from "../../radius-agent/src/routeros.js";

test("secret encryption round-trips and detects tampering", () => {
  const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const encrypted = encryptSecret("router-secret", key);
  assert.notEqual(encrypted, "router-secret");
  assert.equal(decryptSecret(encrypted, key), "router-secret");
  const parts = encrypted.split(".");
  const bytes = Buffer.from(parts[3], "base64url");
  bytes[0] ^= 1;
  parts[3] = bytes.toString("base64url");
  assert.throws(() => decryptSecret(parts.join("."), key));
});

test("HMAC validation enforces timestamp freshness", () => {
  const secret = "a".repeat(32); const raw = '{"ok":true}'; const now = Date.now(); const timestamp = String(Math.floor(now / 1000));
  const signature = signPayload(secret, timestamp, raw);
  assert.equal(verifySignedPayload({ secret, timestamp, rawBody: raw, signature, now }), true);
  assert.equal(verifySignedPayload({ secret, timestamp, rawBody: raw, signature, now: now + 301_000 }), false);
});

test("production configuration requires trusted proxy, HTTPS origins and paired external credentials", () => {
  const safe = {
    nodeEnv: "production",
    databaseDriver: "postgres",
    databaseUrl: "postgresql://runtime@db/radius",
    platformDatabaseUrl: "postgresql://platform@db/radius",
    migrationDatabaseUrl: "postgresql://migrator@db/radius",
    port: 8787,
    sessionTtlHours: 12,
    publicBaseUrl: "https://radius.example.test",
    allowDevAuth: false,
    requireInstallationBinding: true,
    googleClientId: "google-client.apps.googleusercontent.com",
    trustProxy: true,
    corsOrigins: ["https://radius.example.test", "https://localhost"],
    encryptionKey: "a".repeat(64),
    connectorSigningSecret: "",
    billingWebhookSecret: "b".repeat(32),
    billingCheckoutEndpoint: "",
    billingCheckoutToken: "",
    billingCheckoutAllowedHosts: [],
    telegramBotToken: "",
    telegramWebhookSecret: "",
    metricsToken: "m".repeat(24)
  };
  assert.doesNotThrow(() => validateConfig(safe));
  assert.throws(() => validateConfig({ ...safe, trustProxy: false }), /TRUST_PROXY/);
  assert.throws(() => validateConfig({ ...safe, requireInstallationBinding: false }), /REQUIRE_INSTALLATION_BINDING/);
  assert.throws(() => validateConfig({ ...safe, corsOrigins: ["*"] }), /explicit origins/);
  assert.throws(() => validateConfig({ ...safe, billingCheckoutEndpoint: "https://billing.example.test", billingCheckoutToken: "" }), /configured together/);
  assert.throws(() => validateConfig({ ...safe, billingCheckoutEndpoint: "https://billing.example.test", billingCheckoutToken: "b".repeat(24) }), /BILLING_CHECKOUT_ALLOWED_HOSTS/);
  assert.doesNotThrow(() => validateConfig({ ...safe, billingCheckoutEndpoint: "https://billing.example.test", billingCheckoutToken: "b".repeat(24), billingCheckoutAllowedHosts: ["pay.example.test"] }));
  assert.throws(() => validateConfig({ ...safe, telegramBotToken: "123456:abcdefghijklmnopqrstuvwxyz", telegramWebhookSecret: "" }), /configured together/);
});

test("Google ID token verifier checks signature, issuer, audience and claims", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }); jwk.kid = "test-key"; jwk.alg = "RS256"; jwk.use = "sig";
  const now = 1_800_000_000_000; const nowSeconds = Math.floor(now / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", kid: "test-key" });
  const payload = encode({ iss: "https://accounts.google.com", aud: "client-123", exp: nowSeconds + 300, iat: nowSeconds - 2, sub: "google-user", email: "User@Example.com", email_verified: true, name: "Test User" });
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  const verifier = new GoogleIdTokenVerifier({ clientId: "client-123", now: () => now, fetchImpl: async () => ({ ok: true, headers: new Headers({ "cache-control": "max-age=600" }), json: async () => ({ keys: [jwk] }) }) });
  const result = await verifier.verify(`${header}.${payload}.${signature}`);
  assert.equal(result.email, "user@example.com");
  await assert.rejects(() => new GoogleIdTokenVerifier({ clientId: "wrong", now: () => now, fetchImpl: verifier.fetchImpl }).verify(`${header}.${payload}.${signature}`));
  const baseClaims = JSON.parse(Buffer.from(payload, "base64url").toString());
  for (const changes of [{ exp: undefined }, { iat: undefined }, { exp: "not-a-number" }, { exp: String(nowSeconds + 300) }, { iat: nowSeconds + 500 }, { sub: {} }, { email: ["user@example.com"] }, { azp: "another-client" }]) {
    const invalidPayload = encode({ ...baseClaims, ...changes });
    const invalidSignature = sign("RSA-SHA256", Buffer.from(`${header}.${invalidPayload}`), privateKey).toString("base64url");
    await assert.rejects(() => verifier.verify(`${header}.${invalidPayload}.${invalidSignature}`), (error) => error.status === 401 || error.statusCode === 401);
  }
  for (const invalidPart of [null, [], true]) {
    await assert.rejects(() => verifier.verify(`${encode(invalidPart)}.${payload}.${signature}`));
  }
});

test("FreeRADIUS attributes normalize into the signed connector contract", () => {
  const event = normalizeAccounting({ "Acct-Status-Type": "Interim-Update", "Acct-Session-Id": "abc-123", "User-Name": "subscriber-1", "NAS-IP-Address": "192.0.2.5", "Framed-IP-Address": "10.0.0.5", "Acct-Session-Time": "42", "Acct-Input-Octets": "100", "Acct-Input-Gigawords": "1", "Acct-Output-Octets": "200" }, "2026-09-09T10:00:00.000Z");
  assert.equal(event.statusType, "interim");
  assert.equal(event.sessionId, "abc-123");
  assert.equal(event.inputBytes, 4_294_967_396);
  assert.match(event.eventId, /^rae_[a-f0-9]{40}$/);
  assert.ok(event.nonce.length >= 16);
});

test("RouterOS sentence codec handles compact and multi-byte words", async () => {
  assert.deepEqual([...encodeLength(0x7f)], [0x7f]);
  assert.deepEqual([...encodeLength(0x80)], [0x80, 0x80]);
  assert.deepEqual([...encodeLength(0x4000)], [0xc0, 0x40, 0x00]);
  const encoded = encodeSentence(["!re", "=.id=*A", `=name=${"x".repeat(140)}`]);
  const fragments = [];
  for (let index = 0; index < encoded.length; index += 7) fragments.push(encoded.subarray(index, index + 7));
  const reader = new SentenceReader(Readable.from(fragments));
  assert.deepEqual(await reader.readSentence(), ["!re", "=.id=*A", `=name=${"x".repeat(140)}`]);
});

test("RouterOS executor toggles PPP secrets and disconnects only an unambiguous session", async () => {
  const calls = [];
  const fakeClient = {
    async connect() { calls.push(["connect"]); },
    close() { calls.push(["close"]); },
    async talk(words) {
      calls.push(words);
      if (words[0] === "/ppp/secret/print") return [{ ".id": "*1", name: "ahmad-101", disabled: "no" }];
      if (words[0] === "/ppp/active/print") return [{ ".id": "*9", name: "ahmad-101", address: "10.10.0.21", "session-id": "rad-demo-active" }];
      return [];
    }
  };
  const executor = new RouterOsCommandExecutor({ routers: [{ id: "dev_demo_core", nasIps: ["192.0.2.10"] }], clientFactory: () => fakeClient });
  const sync = await executor.execute({ topic: "radius.subscriber.sync", payload: { username: "ahmad-101", status: "suspended" } });
  assert.equal(sync[0].disabled, true);
  assert.ok(calls.some((words) => words[0] === "/ppp/secret/set" && words.includes("=disabled=yes")));
  const disconnected = await executor.execute({ topic: "radius.session.disconnect", payload: { deviceId: "dev_demo_core", username: "ahmad-101", externalSessionId: "rad-demo-active", framedIp: "10.10.0.21" } });
  assert.equal(disconnected[0].disconnected, true);
  assert.ok(calls.some((words) => words[0] === "/ppp/active/remove" && words.includes("=.id=*9")));
});

test("RADIUS agent rejects invalid numeric and identity configuration", () => {
  const base = {
    RADIUS_AGENT_LOCAL_SECRET: "l".repeat(24),
    RADIUS_AGENT_CACHE_KEY: "c".repeat(64),
    RADIUS_AGENT_SIGNING_SECRET: "s".repeat(32),
    UCHIHA_API_URL: "https://radius.example.test",
    UCHIHA_TENANT_SLUG: "tenant-one"
  };
  assert.throws(() => loadAgentConfig({ ...base, RADIUS_COMMAND_POLL_MS: "not-a-number" }), /must be a number/);
  assert.throws(() => loadAgentConfig({ ...base, RADIUS_AGENT_PORT: "70000" }), /between 1 and 65535/);
  assert.throws(() => loadAgentConfig({ ...base, RADIUS_AGENT_ID: "bad id" }), /ID is invalid/);
});

test("RADIUS directory authenticates from encrypted offline cache without retaining plaintext", () => {
  const db = createSpool(":memory:");
  const directory = new RadiusDirectory(db, "c".repeat(64));
  directory.replace([{ principalType: "subscriber", principalId: "cus_one", username: "user-one", password: "very-secret-1",
    credentialVersion: 3, status: "active", expiresAt: "2030-01-01T00:00:00.000Z",
    attributes: { simultaneousUse: 1, rateLimitDownMbps: 50, rateLimitUpMbps: 10, interimIntervalSeconds: 300 } }], "2026-09-09T12:00:00.000Z");
  const stored = db.prepare("SELECT secret_ciphertext FROM radius_directory WHERE username='user-one'").get();
  assert.equal(stored.secret_ciphertext.includes("very-secret-1"), false);
  const input = normalizeAuthentication({ "User-Name": "user-one", "User-Password": "very-secret-1", "NAS-IP-Address": "192.0.2.10" });
  const accepted = directory.authenticate(input, new Date("2026-09-10T00:00:00.000Z"));
  assert.equal(accepted.result, "accept");
  assert.equal(directory.authenticate({ ...input, password: "wrong-password" }, new Date("2026-09-10T00:00:00.000Z")).result, "reject");
  assert.equal(radiusReply(accepted.attributes)["reply:Mikrotik-Rate-Limit"].value[0], "10M/50M");
  const chap = directory.authorize(normalizeAuthorization({ "User-Name": "user-one", "CHAP-Password": "0x1234" }), new Date("2026-09-10T00:00:00.000Z"));
  assert.equal(chap.result, "ok");
  assert.equal(radiusAuthorizeReply(chap.password, chap.attributes)["control:Cleartext-Password"].value[0], "very-secret-1");
  db.close();
});

test("RADIUS directory enforces the configured authentication methods", () => {
  const db = createSpool(":memory:");
  const directory = new RadiusDirectory(db, "d".repeat(64));
  directory.replace([{ principalType: "subscriber", principalId: "cus_pap", username: "pap-only", password: "safe-password",
    credentialVersion: 1, status: "active", expiresAt: null, attributes: { authMethods: ["pap"] } }], "2026-09-09T12:00:00.000Z");
  const result = directory.authorize(normalizeAuthorization({ "User-Name": "pap-only", "CHAP-Password": "0x1234" }));
  assert.equal(result.result, "reject");
  assert.equal(result.reason, "auth_method_not_allowed");
  db.close();
});

test("RADIUS agent recovers in-flight local spool records after a restart", (t) => {
  const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "uchiha-radius-spool-"));
  t.after(() => fs.rmSync(directoryPath, { recursive: true, force: true }));
  const databasePath = path.join(directoryPath, "spool.sqlite");
  const first = createSpool(databasePath);
  const now = new Date().toISOString();
  first.prepare(`INSERT INTO accounting_spool (id,payload_json,status,attempts,available_at,last_error,created_at,updated_at)
    VALUES ('recover-accounting','{}','sending',1,?,NULL,?,?)`).run(now, now, now);
  first.prepare(`INSERT INTO auth_spool (id,payload_json,status,attempts,available_at,last_error,created_at,updated_at)
    VALUES ('recover-auth','{}','sending',1,?,NULL,?,?)`).run(now, now, now);
  first.close();
  const reopened = createSpool(databasePath);
  assert.equal(reopened.prepare("SELECT status FROM accounting_spool WHERE id='recover-accounting'").get().status, "failed");
  assert.equal(reopened.prepare("SELECT status FROM auth_spool WHERE id='recover-auth'").get().status, "failed");
  reopened.close();
});

test("RouterOS sync attempts every configured router before reporting a partial failure", async () => {
  const calls = [];
  const routers = [{ id: "core-a", nasIps: ["192.0.2.10"] }, { id: "core-b", nasIps: ["192.0.2.11"] }];
  const executor = new RouterOsCommandExecutor({
    routers,
    clientFactory(router) {
      return {
        async connect() {
          calls.push(`connect:${router.id}`);
          if (router.id === "core-a") throw new Error("temporarily offline");
        },
        close() { calls.push(`close:${router.id}`); },
        async talk(words) {
          calls.push(`${router.id}:${words[0]}`);
          if (words[0] === "/ppp/secret/print") return [{ ".id": "*2", name: "test-user", disabled: "yes" }];
          return [];
        }
      };
    }
  });
  await assert.rejects(
    () => executor.execute({ topic: "radius.subscriber.sync", payload: { username: "test-user", status: "active" } }),
    /core-a: temporarily offline/
  );
  assert.ok(calls.includes("connect:core-b"));
  assert.ok(calls.includes("core-b:/ppp/secret/set"));
});

test("RouterOS probe marks online only after verified login plus identity command", async () => {
  const events = [];
  const executor = new RouterOsCommandExecutor({
    routers: [{ id: "dev_real_12345678", host: "192.168.88.1", port: 8729 },
              { id: "dev_down_12345678", host: "192.168.88.2", port: 8729 }],
    clientFactory: router => ({
      async connect() {
        events.push("connect:" + router.id);
        if (router.id.includes("down")) throw new Error("TLS verification failed");
      },
      async talk(words) { events.push(words[0]); return [{ name: "MikroTik RouterOS" }]; },
      close() { events.push("close:" + router.id); }
    })
  });
  assert.deepEqual(await executor.probeRouters(), [
    { deviceId: "dev_real_12345678", host: "192.168.88.1", port: 8729, status: "online" },
    { deviceId: "dev_down_12345678", host: "192.168.88.2", port: 8729, status: "offline" }
  ]);
  assert.equal(events.filter(item => item === "/system/identity/print").length, 1);
  assert.equal(events.filter(item => item.startsWith("close:")).length, 2);
});

test("local RouterOS probe reports only safe failure codes, not credentials or raw errors",async()=>{
 assert.equal(routerProbeErrorCode({code:"ECONNREFUSED"}),"API_SSL_UNAVAILABLE");
 assert.equal(routerProbeErrorCode({code:"ETIMEDOUT"}),"CONNECT_TIMEOUT");
 assert.equal(routerProbeErrorCode({code:"ERR_TLS_CERT_ALTNAME_INVALID"}),"TLS_CERTIFICATE_FAILED");
 assert.equal(routerProbeErrorCode({message:"RouterOS rejected the command: wrong password"}),
   "ROUTEROS_LOGIN_OR_PERMISSION");
 const executor=new RouterOsCommandExecutor({
  routers:[{id:"dev_safe_probe_1234",host:"192.168.77.1",port:8729}],
  clientFactory:()=>({async connect(){
    const error=new Error("private router password should never leave local probe");
    error.code="ECONNREFUSED";throw error;
   },close(){}})
 });
 assert.deepEqual(await executor.probeRouters(),[
  {deviceId:"dev_safe_probe_1234",host:"192.168.77.1",port:8729,status:"offline"}
 ]);
 const details=await executor.probeRouters({diagnostics:true});
 assert.equal(details[0].errorCode,"API_SSL_UNAVAILABLE");
 assert.ok(!JSON.stringify(details).includes("private router password"));
});
