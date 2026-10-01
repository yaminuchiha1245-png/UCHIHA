import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const app = fs.readFileSync(path.join(root, "apps/provider-web/src/app.js"), "utf8");

test("MikroTik add form defaults to secure API-SSL 8729", () => {
  assert.match(app, /name="port"[^>]*min="443"[^>]*value="8729"/);
  assert.doesNotMatch(app, /name="port"[^>]*value="8728"/);
  assert.match(app, /RouterOS API-SSL/);
});

test("agent mode explains local management addressing instead of demanding a public IP", () => {
  assert.match(app, /عنوان إدارة MikroTik/);
  assert.match(app, /مع Agent استخدم عنوان الراوتر داخل شبكة الموقع/);
  assert.doesNotMatch(app, /<label>Public IP أو اسم المضيف<\/label>/);
});

test("dotted-zero IPv4 requires explicit human confirmation before save", () => {
  assert.match(app, /function isDottedZeroIpv4\(value\)/);
  assert.match(app, /parts\[3\] === "0"/);
  assert.match(app, /window\.confirm\("هذا العنوان ينتهي بـ \.0/);
  assert.match(app, /تم إلغاء الحفظ حتى تراجع عنوان إدارة MikroTik/);
});
