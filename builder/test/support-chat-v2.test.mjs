import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { installSupportChatV2 } from "../src/support-chat-v2.mjs";

const migration = readFileSync(new URL("../migrations/048_support_chat_v2.sql", import.meta.url), "utf8");
const supportClient = readFileSync(new URL("../public/support.js", import.meta.url), "utf8");
const supportHtml = readFileSync(new URL("../public/support.html", import.meta.url), "utf8");
const supportAdminHtml = readFileSync(new URL("../public/support-admin.html", import.meta.url), "utf8");
const customerShell = readFileSync(new URL("../public/customer-shell-v1.js", import.meta.url), "utf8");
const startSource = readFileSync(new URL("../src/start.mjs", import.meta.url), "utf8");
const launchAudit = readFileSync(new URL("../scripts/launch-audit.sh", import.meta.url), "utf8");

test("support chat v2 registers isolated customer/admin routes once", () => {
  const routes = [];
  const app = {
    get(path, ...rest) { routes.push(["GET", path, rest.length]); },
    post(path, ...rest) { routes.push(["POST", path, rest.length]); },
    put(path, ...rest) { routes.push(["PUT", path, rest.length]); }
  };
  const deps = {
    db: {},
    config: { encryptionKey: Buffer.alloc(32) }
  };

  assert.equal(installSupportChatV2(app, deps), true);
  assert.equal(installSupportChatV2(app, deps), false);

  const registered = new Set(routes.map(([method, path]) => `${method} ${path}`));
  for (const route of [
    "GET /store/:slug/support-chat",
    "GET /admin/:storeId/support-chat",
    "GET /api/public/stores/:slug/support-v2",
    "POST /api/public/stores/:slug/support-v2",
    "GET /api/public/stores/:slug/support-v2/:threadId/messages",
    "POST /api/public/stores/:slug/support-v2/:threadId/messages",
    "GET /api/public/stores/:slug/support-v2/attachments/:attachmentId",
    "GET /api/stores/:storeId/support-v2",
    "POST /api/stores/:storeId/support-v2/:threadId/messages",
    "PUT /api/stores/:storeId/support-v2/:threadId/status",
    "GET /api/stores/:storeId/support-v2/attachments/:attachmentId"
  ]) {
    assert.equal(registered.has(route), true, `missing route: ${route}`);
  }
});

test("migration 048 adds encrypted attachment storage, unread state and tenant RLS", () => {
  assert.match(migration, /ALTER TABLE support_threads/);
  assert.match(migration, /customer_last_read_at TIMESTAMPTZ/);
  assert.match(migration, /staff_last_read_at TIMESTAMPTZ/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS support_attachments/);
  assert.match(migration, /content_ciphertext TEXT NOT NULL/);
  assert.match(migration, /size_bytes INTEGER NOT NULL CHECK \(size_bytes BETWEEN 1 AND 4000000\)/);
  assert.match(migration, /ALTER TABLE support_attachments ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /CREATE POLICY support_attachments_tenant_isolation/);
});

test("support UI uses v2 API, attachments and unread badges", () => {
  assert.match(supportClient, /support-v2/);
  assert.match(supportClient, /attachmentPayload/);
  assert.match(supportClient, /unreadCount/);
  assert.match(supportClient, /MAX_ATTACHMENT_BYTES = 4_000_000/);
  assert.match(supportHtml, /support-chat-v2\.css/);
  assert.match(supportHtml, /type="file"/);
  assert.match(supportHtml, /application\/pdf/);
  assert.match(supportAdminHtml, /type="file"/);
  assert.match(supportAdminHtml, /مركز المحادثات/);
  assert.match(customerShell, /\/support-chat/);
  assert.match(customerShell, /مركز المحادثة/);
});

test("production startup and launch audit keep support chat v2 release-gated", () => {
  assert.match(startSource, /import \{ installSupportChatV2 \} from "\.\/support-chat-v2\.mjs"/);
  assert.match(startSource, /installSupportChatV2\(app, \{ db, config \}\)/);
  assert.match(launchAudit, /support_attachment_table_count/);
  assert.match(launchAudit, /support_read_columns_count/);
  assert.match(launchAudit, /support_attachment_rls/);
  assert.match(launchAudit, /\/store\/demo\/support-chat/);
  assert.match(launchAudit, /\/api\/public\/stores\/demo\/support-v2/);
});
