import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/security.mjs";

test("invalid password lengths fail with a client-safe 422 error", async () => {
  for (const password of ["short", "x".repeat(257)]) {
    await assert.rejects(
      () => hashPassword(password),
      (error) => {
        assert.equal(error.statusCode, 422);
        assert.equal(error.code, "invalid_password");
        assert.match(error.message, /10.*256/);
        return true;
      }
    );
  }
});

test("valid passwords keep using scrypt and verify correctly", async () => {
  const password = "launch-ready-password";
  const encoded = await hashPassword(password);
  assert.match(encoded, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword("wrong-password", encoded), false);
});
