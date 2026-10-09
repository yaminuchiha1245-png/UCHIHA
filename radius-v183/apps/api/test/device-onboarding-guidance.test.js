import test from "node:test";
import assert from "node:assert/strict";
import { connectionDiagnostics } from "../src/device-diagnostics.js";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const recent = new Date(NOW - 10_000).toISOString();
function router(overrides = {}) {
  return {
    id: "dev_owner_router", name: "Provider MikroTik", site_id: "site_owner",
    host: "192.168.88.1", api_port: 8729, connection_method: "api",
    status: "pending", last_seen_at: null, ...overrides
  };
}
function assess(device, options = {}) {
  return connectionDiagnostics({
    devices: [device], sites: [{ id: "site_owner", name: "Owner site" }],
    agents: options.agents ?? [], now: NOW, config: {}
  }).items[0];
}

test("registered router is not claimed online without authenticated live verification", () => {
  const result = assess(router());
  assert.equal(result.verifiedOnline, false);
  assert.equal(result.lastVerifiedAt, null);
  assert.equal(result.onboarding.code, "verify-router");
  assert.match(result.onboarding.message.ar, /لم يُثبت/);
});

test("verified management is explicitly NOT proof of RADIUS subscriber access", () => {
  const result = assess(router({ status: "online", last_seen_at: recent }));
  assert.equal(result.verifiedOnline, true);
  assert.equal(result.onboarding.stage, "management-only");
  assert.match(result.onboarding.message.ar, /دخول المشتركين/);
  assert.match(result.onboarding.message.en, /accounting/);
});

test("offline Site Agent cannot make an old router status appear online", () => {
  const result = assess(router({
    connection_method: "agent", api_port: 8728,
    status: "online", last_seen_at: recent
  }));
  assert.equal(result.verifiedOnline, false);
  assert.equal(result.agentOnline, false);
  assert.equal(result.onboarding.code, "connect-site");
  // A protected site tunnel's legacy RouterOS API port is not a direct public API-SSL path.
  assert.equal(result.issues.includes("API_SSL_PORT"), false);
  assert.equal(result.issues.includes("PRIVATE_LEGACY_PORT"), true);
});

test("an unassigned agent heartbeat alone never verifies a pending router", () => {
  const result = assess(router({
    connection_method: "agent", site_id: null, status: "pending", last_seen_at: null
  }), { agents: [{ site_id: null, status: "healthy", last_seen_at: recent }] });
  assert.equal(result.agentOnline, true);
  assert.equal(result.verifiedOnline, false);
  assert.equal(result.onboarding.code, "verify-router");
});

test("an authorized single-LAN site can show its individually verified device", () => {
  const result = assess(router({
    connection_method: "agent", site_id: null, status: "online", last_seen_at: recent
  }), { agents: [{ site_id: null, status: "healthy", last_seen_at: recent }] });
  assert.equal(result.agentOnline, true);
  assert.equal(result.verifiedOnline, true);
  assert.equal(result.onboarding.stage, "management-only");
});

test("Site Agent may confirm management only when bound to a live matching site", () => {
  const result = assess(router({
    connection_method: "agent", api_port: 8728,
    status: "online", last_seen_at: recent
  }), { agents: [{ site_id: "site_owner", status: "healthy", last_seen_at: recent }] });
  assert.equal(result.agentOnline, true);
  assert.equal(result.verifiedOnline, true);
  assert.equal(result.onboarding.stage, "management-only");
});

test("questionable saved router address gets an actionable warning", () => {
  const result = assess(router({ host: "11.5.5.0" }));
  assert.equal(result.onboarding.code, "review-address");
  assert.equal(result.onboarding.stage, "action-required");
  assert.ok(result.issues.includes("CHECK_ROUTER_IP"));
});

test("untrusted direct API port has a security-specific next step", () => {
  const result = assess(router({ api_port: 8728 }));
  assert.equal(result.onboarding.code, "secure-api");
  assert.ok(result.onboarding.message.en.includes("8729"));
});

test("stale online timestamp never counts as fresh verification", () => {
  const result = assess(router({
    status: "online", last_seen_at: new Date(NOW - 120_000).toISOString()
  }));
  assert.equal(result.verifiedOnline, false);
  assert.equal(result.lastVerifiedAt, null);
  assert.equal(result.onboarding.code, "verify-router");
});
