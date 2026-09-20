import assert from "node:assert/strict";
import test from "node:test";
import { installAiPurchaseConsent } from "../src/ai-purchase-consent.mjs";
import { sha256 } from "../src/security.mjs";

function collector() {
  const hooks = {};
  return {
    hooks,
    app: { addHook(name, fn) { hooks[name] = fn; } }
  };
}

function reply() {
  return {
    statusCode: 200,
    payload: null,
    code(value) { this.statusCode = value; return this; },
    send(value) { this.payload = value; return this; }
  };
}

function validSessionDb(audit = []) {
  return {
    async query(sql, params = []) {
      const source = String(sql);
      if (source.includes("FROM sessions")) {
        return { rows: [{ csrf_hash: sha256("csrf-ok") }] };
      }
      if (source.includes("UPDATE platform_catalog_orders")) {
        audit.push({ sql: source, params });
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${source}`);
    }
  };
}

function request(body) {
  return {
    method: "POST",
    raw: { url: "/api/platform/ai-bots/purchase" },
    cookies: { uchiha_builder_session: "session-token" },
    headers: { "x-csrf-token": "csrf-ok" },
    body
  };
}

test("AI purchase rejects a valid authenticated buyer who did not accept separate OpenAI API cost", async () => {
  const { app, hooks } = collector();
  installAiPurchaseConsent(app, { db: validSessionDb() });
  const response = reply();
  await hooks.preHandler(request({ displayName: "UCHIHA AI" }), response);
  assert.equal(response.statusCode, 422);
  assert.equal(response.payload?.error, "openai_cost_consent_required");
});

test("AI purchase consent passes when explicitly true and is audited on the created order", async () => {
  const audit = [];
  const { app, hooks } = collector();
  installAiPurchaseConsent(app, { db: validSessionDb(audit) });
  const req = request({ displayName: "UCHIHA AI", openAiCostAccepted: true });
  const response = reply();
  const preResult = await hooks.preHandler(req, response);
  assert.equal(preResult, undefined);
  assert.equal(response.statusCode, 200);

  const payload = await hooks.preSerialization(req, {}, { orderId: "order-123", instanceId: "instance-123" });
  assert.equal(payload.orderId, "order-123");
  assert.equal(audit.length, 1);
  assert.match(audit[0].sql, /'openAiCostAccepted', TRUE/);
  assert.match(audit[0].sql, /'openAiCostAcceptedAt', NOW\(\)/);
  assert.deepEqual(audit[0].params, ["order-123"]);
});

test("consent audit failure never turns an already committed purchase into a misleading client failure", async () => {
  const errors = [];
  const db = {
    async query(sql) {
      const source = String(sql);
      if (source.includes("FROM sessions")) return { rows: [{ csrf_hash: sha256("csrf-ok") }] };
      if (source.includes("UPDATE platform_catalog_orders")) throw new Error("audit unavailable");
      throw new Error(`unexpected query: ${source}`);
    }
  };
  const { app, hooks } = collector();
  installAiPurchaseConsent(app, { db });
  const req = request({ displayName: "UCHIHA AI", openAiCostAccepted: true });
  req.log = { error(value, message) { errors.push({ value, message }); } };
  const payload = await hooks.preSerialization(req, {}, { orderId: "order-committed", instanceId: "instance-1" });
  assert.equal(payload.orderId, "order-committed");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].value.orderId, "order-committed");
});

test("consent middleware does not replace canonical auth or CSRF errors", async () => {
  const { app, hooks } = collector();
  const db = { async query() { return { rows: [] }; } };
  installAiPurchaseConsent(app, { db });
  const req = request({ displayName: "UCHIHA AI" });
  const response = reply();
  const result = await hooks.preHandler(req, response);
  assert.equal(result, undefined);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload, null);
});
