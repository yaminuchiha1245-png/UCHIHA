const test = require("node:test");
const assert = require("node:assert/strict");
const { createPairRecord, isExpired, publicPair } = require("../lib/devicePair");

test("device pair produces safe code and secret", () => {
  const pair = createPairRecord({ id:"pair_test", minutes:10 });
  assert.equal(pair.id, "pair_test");
  assert.match(pair.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.ok(pair.secret.length >= 20);
  assert.equal(pair.status, "pending");
  assert.equal(isExpired(pair), false);
  assert.equal(publicPair(pair).secret, undefined);
});

test("expired pair is recognized", () => {
  const pair = createPairRecord({ id:"pair_expired", minutes:2 });
  pair.expiresAt = new Date(Date.now()-1000).toISOString();
  assert.equal(isExpired(pair), true);
});
