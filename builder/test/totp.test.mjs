import assert from "node:assert/strict";
import test from "node:test";
import { decodeBase32, encodeBase32, hotp, verifyTotp } from "../src/totp.mjs";

test("base32 round-trip preserves bytes", () => {
  const input = Buffer.from("UCHIHA Builder security");
  const encoded = encodeBase32(input);
  assert.deepEqual(decodeBase32(encoded), input);
});

test("HOTP matches RFC 4226 counter zero", () => {
  const secret = encodeBase32(Buffer.from("12345678901234567890"));
  assert.equal(hotp(secret, 0), "755224");
});

test("TOTP accepts current code and rejects malformed values", () => {
  const secret = encodeBase32(Buffer.from("12345678901234567890"));
  const timestamp = 59_000;
  const code = hotp(secret, Math.floor(timestamp / 1000 / 30));
  assert.equal(verifyTotp(secret, code, timestamp, 0), true);
  assert.equal(verifyTotp(secret, "abcdef", timestamp, 0), false);
  assert.equal(verifyTotp(secret, "123", timestamp, 0), false);
});
