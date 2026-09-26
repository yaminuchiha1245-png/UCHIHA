import assert from "node:assert/strict";
import test from "node:test";
import { RouterOsCommandExecutor } from "../../radius-agent/src/routeros.js";

const router = { id: "dev_primary", host: "10.11.0.2", port: 8729, nasIps: ["10.11.0.1"] };
const secondRouter = { id: "dev_secondary", host: "10.12.0.2", port: 8729, nasIps: ["10.12.0.1"] };

function fakeExecutor(activeRows, routers = [router]) {
  const commands = [];
  const executor = new RouterOsCommandExecutor({
    routers,
    clientFactory: () => ({
      async connect() { commands.push("connect"); },
      async talk(words) {
        commands.push(words[0]);
        if (words[0] === "/ppp/active/print") return activeRows;
        if (words[0] === "/ppp/active/remove") return [];
        throw new Error("Unexpected RouterOS test command");
      },
      close() { commands.push("close"); }
    })
  });
  return { executor, commands };
}

test("an explicit but missing device or NAS cannot fall back to another router", async () => {
  const single = fakeExecutor([{ ".id": "*1", name: "shared-user" }]);
  assert.throws(() => single.executor.routersFor("radius.session.disconnect", {
    deviceId: "dev_not_registered", nasIp: router.nasIps[0]
  }), /معرّف الجهاز/);
  assert.throws(() => single.executor.routersFor("radius.session.disconnect", {
    nasIp: "10.99.0.1"
  }), /عنوان NAS/);
  assert.deepEqual(single.commands, [], "a rejected routing decision must not open a connection");
  assert.deepEqual(single.executor.routersFor("radius.session.disconnect", {
    deviceId: router.id
  }), [router]);
  assert.deepEqual(single.executor.routersFor("radius.session.disconnect", {
    nasIp: router.nasIps[0]
  }), [router]);
  assert.deepEqual(single.executor.routersFor("radius.session.disconnect", {
    nasIp: router.host
  }), [router]);
  assert.deepEqual(single.executor.routersFor("radius.session.disconnect", {}), [router],
    "one router is a safe fallback only when no device or NAS selector was supplied");
});

test("ambiguous NAS addresses must not select multiple routers", () => {
  const overlapping = { ...secondRouter, nasIps: [...router.nasIps] };
  const { executor, commands } = fakeExecutor([], [router, overlapping]);
  assert.throws(() => executor.routersFor("radius.session.disconnect", {
    nasIp: router.nasIps[0]
  }), /عنوان NAS/);
  assert.throws(() => executor.routersFor("radius.session.disconnect", {}), /مطابق/);
  assert.deepEqual(commands, []);
});

test("stale PPP session ID cannot disconnect a different session with the same username", async () => {
  const { executor, commands } = fakeExecutor([{
    ".id": "*NEW", name: "shared-user", "session-id": "current-session", address: "10.0.0.20"
  }]);
  await assert.rejects(executor.execute({
    topic: "radius.session.disconnect",
    payload: { deviceId: router.id, username: "shared-user", externalSessionId: "ended-session" }
  }), /تعذر تحديد جلسة PPP/);
  assert.equal(commands.includes("/ppp/active/remove"), false);
});

test("mismatched framed IP cannot disconnect another session even when username and ID match", async () => {
  const { executor, commands } = fakeExecutor([{
    ".id": "*CURRENT", name: "shared-user", "session-id": "same-session", address: "10.0.0.30"
  }]);
  await assert.rejects(executor.execute({
    topic: "radius.session.disconnect",
    payload: {
      deviceId: router.id, username: "shared-user",
      externalSessionId: "same-session", framedIp: "10.0.0.99"
    }
  }), /تعذر تحديد جلسة PPP/);
  assert.equal(commands.includes("/ppp/active/remove"), false);
});

test("an exact session ID and framed IP disconnect only the selected PPP session", async () => {
  const { executor, commands } = fakeExecutor([
    { ".id": "*OTHER", name: "shared-user", "session-id": "other", address: "10.0.0.31" },
    { ".id": "*TARGET", name: "shared-user", "session-id": "target", address: "10.0.0.32" }
  ]);
  const result = await executor.execute({
    topic: "radius.session.disconnect",
    payload: {
      deviceId: router.id, username: "shared-user",
      externalSessionId: "target", framedIp: "10.0.0.32"
    }
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].routerId, router.id);
  assert.equal(result[0].disconnected, true);
  assert.deepEqual(commands, ["connect", "/ppp/active/print", "/ppp/active/remove", "close"]);
});

test("an ambiguous same-username PPP lookup cannot remove any active session", async () => {
  const { executor, commands } = fakeExecutor([
    { ".id": "*ONE", name: "shared-user", address: "10.0.0.41" },
    { ".id": "*TWO", name: "shared-user", address: "10.0.0.42" }
  ]);
  await assert.rejects(executor.execute({
    topic: "radius.session.disconnect",
    payload: { deviceId: router.id, username: "shared-user" }
  }), /تعذر تحديد جلسة PPP/);
  assert.equal(commands.includes("/ppp/active/remove"), false);
});
