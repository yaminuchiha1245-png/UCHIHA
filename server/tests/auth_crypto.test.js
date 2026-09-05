const test = require("node:test");
const assert = require("node:assert/strict");

test("admin session signs and verifies", () => {
  process.env.ADMIN_SESSION_SECRET = "test-admin-secret-that-is-long-enough";
  delete require.cache[require.resolve("../lib/adminAuth")];
  const { signAdminToken, verifyAdminToken } = require("../lib/adminAuth");
  const token = signAdminToken({ subject:"admin", hours:1, version:7, role:"owner" });
  const result = verifyAdminToken(token);
  assert.equal(result.ok, true);
  assert.equal(result.payload.sub, "admin");
  assert.equal(result.payload.ver, 7);
  assert.equal(result.payload.role, "owner");
  assert.match(result.payload.jti,/^[a-f0-9]{16}$/);
});

test("user session signs and verifies telegram id", () => {
  process.env.USER_SESSION_SECRET = "test-user-secret-that-is-different";
  delete require.cache[require.resolve("../lib/userAuth")];
  const { signUserToken, verifyUserToken } = require("../lib/userAuth");
  const token = signUserToken("123456789", 1, 4);
  const result = verifyUserToken(token);
  assert.equal(result.ok, true);
  assert.equal(result.payload.sub, "123456789");
  assert.equal(result.payload.ver,4);
  assert.match(result.payload.jti,/^[a-f0-9]{16}$/);
});

test("inventory AES-GCM encryption round trip", () => {
  process.env.INVENTORY_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  delete require.cache[require.resolve("../lib/inventoryCrypto")];
  const { encryptValue, decryptValue, maskValue, fingerprintValue } = require("../lib/inventoryCrypto");
  const encrypted = encryptValue("GZ-SECRET-CODE-123");
  assert.equal(encrypted.encrypted, true);
  assert.notEqual(encrypted.valueEnc, "GZ-SECRET-CODE-123");
  assert.equal(decryptValue(encrypted), "GZ-SECRET-CODE-123");
  assert.match(maskValue("GZ-SECRET-CODE-123"), /^GZ-/);
  assert.equal(fingerprintValue("GZ-SECRET-CODE-123"), fingerprintValue("GZ-SECRET-CODE-123"));
  assert.notEqual(fingerprintValue("GZ-SECRET-CODE-123"), fingerprintValue("GZ-OTHER-CODE"));
});
