const crypto = require("crypto");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length = 6) {
  let out = "";
  for (let i=0;i<length;i++) out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  return out;
}
function randomSecret(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}
function hashSecret(secret) {
  return crypto.createHash("sha256").update(String(secret||"")).digest("base64url");
}
function createPairRecord({ id, minutes = 10 } = {}) {
  const createdAt = new Date();
  const secret = randomSecret();
  return {
    id,
    code: randomCode(6),
    secret,
    secretHash: hashSecret(secret),
    status: "pending",
    telegramId: null,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + Math.max(2, Number(minutes||10))*60000).toISOString(),
    approvedAt: null,
    consumedAt: null
  };
}
function isExpired(pair, at = Date.now()) {
  return !pair?.expiresAt || new Date(pair.expiresAt).getTime() <= at;
}
function publicPair(pair) {
  return {
    id: pair.id, code: pair.code, status: pair.status,
    createdAt: pair.createdAt, expiresAt: pair.expiresAt,
    approvedAt: pair.approvedAt || null
  };
}
module.exports = { createPairRecord, isExpired, publicPair, randomCode, randomSecret, hashSecret };
