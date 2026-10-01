import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = fs.readFileSync(path.join(root, "apps/provider-web/src/app.js"), "utf8");

test("legacy provider add-device form defaults to secure API-SSL 8729", () => {
  const start = source.indexOf("function addDevice()");
  const end = source.indexOf("function configureTelegram()", start);
  assert(start > 0 && end > start, "addDevice block must exist");
  const block = source.slice(start, end);

  assert.match(block, /<label>عنوان إدارة MikroTik<\/label>/);
  assert.match(block, /<label>منفذ API-SSL<\/label>/);
  assert.match(block, /value="8729"/);
  assert.doesNotMatch(block, /value="8728"/);
  assert.match(block, /RouterOS API-SSL/);
  assert.match(block, /UCHIHA Agent استخدم عنوان الراوتر داخل شبكة الموقع/);
});

test("dotted-zero MikroTik addresses require explicit operator confirmation", () => {
  assert.match(source, /function isDottedZeroIpv4\(value\)/);
  assert.match(source, /parts\[3\] === "0"/);
  const start = source.indexOf("function addDevice()");
  const end = source.indexOf("function configureTelegram()", start);
  const block = source.slice(start, end);
  assert.match(block, /isDottedZeroIpv4\(host\)/);
  assert.match(block, /window\.confirm\("هذا العنوان ينتهي بـ \.0/);
});
