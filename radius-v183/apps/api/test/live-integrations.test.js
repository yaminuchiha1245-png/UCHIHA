import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const overlay = fs.readFileSync(path.join(root, "apps/provider-v183-runtime/live-integrations.js"), "utf8");
function harness(input = {}) {
  const dialog = [];
  const listeners = [];
  const state = {
    me: { role: "owner", canWrite: true, tenantId: "ten_test" },
    overview: { agentConnected: false, credentialConfigured: true,
      last24Hours: { accepted: 0 }, onlineDevices: 0 },
    devices: [
      { id: "dev_a", status: "pending" },
      { id: "dev_b", status: "pending" }
    ],
    integrations: [],
    secondaryFailures: [],
    ...input
  };
  const escape = v => String(v ?? "").replace(/[&<>"']/g, char =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const ctx = vm.createContext({
    state, providerPages: {}, showIntegration() {},
    lang: "ar", t(ar) { return ar; }, esc: escape,
    art(name) { return "<i>" + name + "</i>"; },
    workspaceDialog(...args) { dialog.push(args); },
    workspaceLine(k, v) { return "<div>" + k + ": " + v + "</div>"; },
    v183CanCreate(current) { return current.me?.role === "owner" && current.me?.canWrite; },
    document: { addEventListener(...args) { listeners.push(args); } }
  });
  vm.runInContext(overlay + "\ninstallV183LiveIntegrations(state);", ctx);
  const render = () => vm.runInContext("providerPages.integrations()", ctx);
  const detail = id => vm.runInContext("showIntegration(" + JSON.stringify(id) + ")", ctx);
  return { state, render, detail, dialog, listeners };
}

test("two saved NAS devices with zero verified probes are not called connected", () => {
  const ui = harness();
  const html = ui.render();
  assert.match(html, /0 \/ 2 NAS/);
  assert.match(html, /لم ينجح فحص أيّ راوتر/);
  assert.match(html, /class="green num">0</);
  assert.doesNotMatch(html, /radius-primary\.atlas\.example|sample NAS|3 sample sites/);
  ui.detail("INT-MIKROTIK");
  assert.match(ui.dialog.at(-1)[1], /0 \/ 2 NAS|المتصلة فعليًا: 0/);
});

test("signed agent alone does not prove AAA or router management is connected", () => {
  const ui = harness({
    overview: { agentConnected: true, credentialConfigured: true,
      onlineDevices: 0, last24Hours: { accepted: 0 } }
  });
  const html = ui.render();
  assert.match(html, /الوكيل متصل؛ مصادقة المشتركين غير مثبتة/);
  assert.match(html, /0 \/ 2 NAS/);
  assert.match(html, /class="green num">0</);
});

test("only verified in-scope routers and successful notification delivery count as connected", () => {
  const ui = harness({
    overview: { agentConnected: true, credentialConfigured: true,
      onlineDevices: 2, last24Hours: { accepted: 4 } },
    devices: [{ id: "dev_a", status: "online" }, { id: "dev_b", status: "online" }],
    integrations: [
      { type: "telegram", status: "active", lastSeenAt: null, config: { chatLabel: "Test" } }
    ]
  });
  const pending = ui.render();
  assert.match(pending, /2 \/ 2 NAS/);
  assert.match(pending, /class="green num">2</);
  assert.match(pending, /تمّ الإعداد؛ لم يثبت إرسال تنبيه ناجح/);
  ui.state.integrations[0].lastSeenAt = "2026-09-24T12:00:00.000Z";
  const confirmed = ui.render();
  assert.match(confirmed, /class="green num">3</);
  assert.match(confirmed, /إرسال تنبيه ناجح/);
});

test("overview counts all tenant routers even when device list is paginated", () => {
  const ui = harness({
    overview: { agentConnected: false, credentialConfigured: true,
      devices: 12, onlineDevices: 3, last24Hours: { accepted: 0 } }
  });
  assert.match(ui.render(), /3 \/ 12 NAS/);
  assert.match(ui.render(), /اتصال جزئي/);
});

test("untrusted notification labels and error text are escaped in cards and details", () => {
  const ui = harness({
    integrations: [{ type: "telegram", status: "active", lastSeenAt: null,
      lastError: "<img src=x onerror=alert(1)>",
      config: { chatLabel: "<script>alert(1)</script>" } }]
  });
  const html = ui.render();
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|<img/);
  ui.detail("INT-TELEGRAM");
  assert.match(ui.dialog.at(-1)[1], /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(ui.dialog.at(-1)[1], /<img/);
});

test("missing scoped API data displays unavailable instead of false zero or success", () => {
  const ui = harness({ overview: null, devices: null, integrations: null,
    secondaryFailures: ["/radius/overview", "/integrations", "/devices"] });
  const html = ui.render();
  assert.match(html, /تعذّر التحقق من اتصال الأجهزة/);
  assert.match(html, /غير متاح/);
  assert.doesNotMatch(html, /0 \/ 2 NAS|sample NAS|atlas\.example/);
  assert.equal(ui.listeners.length, 1);
});
