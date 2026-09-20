import assert from "node:assert/strict";
import test from "node:test";
import { installSupportChatDownloadHardening } from "../src/support-chat-download-hardening.mjs";

function fakeReply(initial = {}) {
  const headers = new Map(Object.entries(initial).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    header(name, value) { headers.set(String(name).toLowerCase(), value); return this; },
    headers
  };
}

test("support document downloads are forced to attachment while images remain inline-capable", async () => {
  let hook;
  const app = {
    addHook(name, handler) {
      assert.equal(name, "onSend");
      hook = handler;
    }
  };

  assert.equal(installSupportChatDownloadHardening(app), true);
  assert.equal(installSupportChatDownloadHardening(app), false);
  assert.equal(typeof hook, "function");

  const pdfReply = fakeReply({
    "content-type": "application/pdf",
    "content-disposition": "inline; filename*=UTF-8''invoice.pdf"
  });
  const payload = Buffer.from("%PDF-test");
  assert.equal(await hook({ raw: { url: "/api/stores/s/support-v2/attachments/a" } }, pdfReply, payload), payload);
  assert.match(String(pdfReply.getHeader("content-disposition")), /^attachment;/);
  assert.equal(pdfReply.getHeader("x-content-type-options"), "nosniff");
  assert.equal(pdfReply.getHeader("cache-control"), "private, no-store");

  const textReply = fakeReply({
    "content-type": "text/plain; charset=utf-8",
    "content-disposition": "inline; filename*=UTF-8''note.txt"
  });
  await hook({ raw: { url: "/api/public/stores/demo/support-v2/attachments/b" } }, textReply, "hello");
  assert.match(String(textReply.getHeader("content-disposition")), /^attachment;/);

  const imageReply = fakeReply({
    "content-type": "image/png",
    "content-disposition": "inline; filename*=UTF-8''photo.png"
  });
  await hook({ raw: { url: "/api/public/stores/demo/support-v2/attachments/c" } }, imageReply, Buffer.alloc(1));
  assert.match(String(imageReply.getHeader("content-disposition")), /^inline;/);
});

test("hardening leaves unrelated responses untouched", async () => {
  let hook;
  const app = { addHook(_name, handler) { hook = handler; } };
  installSupportChatDownloadHardening(app);
  const reply = fakeReply({ "content-type": "application/pdf", "content-disposition": "inline" });
  await hook({ raw: { url: "/documents/report.pdf" } }, reply, "pdf");
  assert.equal(reply.getHeader("content-disposition"), "inline");
});
