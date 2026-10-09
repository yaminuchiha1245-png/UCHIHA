import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Execute the original browser helper in isolation: no browser/fixtures, no
// simulated data injected into the real Telegram Mini App.
const source = readFileSync(new URL("../../provider-v183-runtime/live-views.js", import.meta.url), "utf8");
const onboarding = runInNewContext(source + "\nv183ProviderOnboarding;", {});

const owner = { role: "owner", canWrite: true };
const router = (id="dev_test_router", method="agent") =>
  ({ id, name: "Real router record", connection_method: method });
const diagnostic = (id="dev_test_router", verifiedOnline=false, code="connect-site") =>
  ({ id, verifiedOnline, onboarding: {
    code, message: {ar:"توجيه الشبكة من الخادم", en:"Authoritative server guidance"}
  }});
const state = (override={}) => ({
  me:owner, devices:[router()], diagnostics:{items:[diagnostic()]},
  secondaryFailures:[],...override
});

test("inactive SaaS entitlement takes priority without pretending the ISP network is off", () => {
  const result = onboarding(state({me:{role:"owner",canWrite:false}}));
  assert.equal(result.code,"subscription");
  assert.equal(result.action,"activation");
  assert.match(result.message[0],/لن نغيّر خدمة الإنترنت/);
});

test("missing devices starts at registration without marking any router connected", () => {
  const result = onboarding(state({devices:[],diagnostics:{items:[]}}));
  assert.equal(result.code,"register");
  assert.equal(result.action,"register");
});

test("unavailable diagnostics offer only a read-only refresh", () => {
  const result = onboarding(state({diagnostics:null}));
  assert.equal(result.code,"unknown");
  assert.equal(result.action,"refresh");
});

test("failed diagnostics are never replaced with saved online status", () => {
  const result = onboarding(state({secondaryFailures:["/devices/connection-diagnostics"]}));
  assert.equal(result.code,"unknown");
  assert.equal(result.action,"refresh");
});

test("server address warning routes to record review, never an unauthorized probe", () => {
  const result = onboarding(state({diagnostics:{items:[diagnostic("dev_test_router",false,"review-address")]}}));
  assert.equal(result.code,"connect");
  assert.equal(result.action,"edit");
  assert.equal(result.deviceId,"dev_test_router");
});

test("private on-site MikroTik offers the existing Site Agent path", () => {
  const result = onboarding(state());
  assert.equal(result.code,"connect");
  assert.equal(result.action,"agent");
});

test("direct verified TLS path uses current web pairing", () => {
  const result = onboarding(state({
    devices:[router("dev_test_router","api")],
    diagnostics:{items:[diagnostic("dev_test_router",false,"verify-router")]}
  }));
  assert.equal(result.action,"direct");
});

test("verified RouterOS administration still requires explicit real subscriber AAA testing", () => {
  const result = onboarding(state({diagnostics:{items:[diagnostic("dev_test_router",true,"management-verified")]}}));
  assert.equal(result.code,"aaa");
  assert.equal(result.action,"evidence");
  assert.match(result.message[0],/مصادقة مشترك حقيقي/);
});

test("one verified router never hides another unverified router", () => {
  const result = onboarding(state({
    devices:[router("first","api"),router("second")],
    diagnostics:{items:[diagnostic("first",true),diagnostic("second",false,"review-address")]}
  }));
  assert.equal(result.code,"connect");
  assert.equal(result.deviceId,"second");
  assert.equal(result.action,"edit");
});

test("read-only non-owner cannot receive device mutation buttons", () => {
  const result = onboarding(state({me:{role:"collector",canWrite:true}}));
  assert.equal(result.action,null);
});

test("a client record missing from diagnostic scope does not claim verification", () => {
  const result = onboarding(state({diagnostics:{items:[]}}));
  assert.equal(result.code,"unknown");
  assert.equal(result.action,"refresh");
});

test("network card uses authenticated endpoint and not Android-only setup", () => {
  assert.match(source,/data-v183-health-refresh/);
  assert.match(source,/data-v183-agent-template data-v183-device-id/);
  assert.match(source,/data-v183-direct-connect/);
});
