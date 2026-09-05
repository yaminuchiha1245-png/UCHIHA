const { randomCode, isExpired } = require("./devicePair");

const ACTIVATION_MINUTES = 10;

function createActivationRecord({ id, telegramId, at = Date.now() } = {}) {
  if (!id || !telegramId) throw new Error("activation_identity_required");
  return {
    id,
    mode: "android_activation",
    code: randomCode(6),
    status: "issued",
    telegramId: String(telegramId),
    createdAt: new Date(at).toISOString(),
    expiresAt: new Date(at + ACTIVATION_MINUTES * 60000).toISOString(),
    approvedAt: null,
    consumedAt: null
  };
}

function consumeActivation(records, code, at = Date.now()) {
  const normalized = String(code || "").trim().toUpperCase();
  const pair = (records || []).find(x => x.mode === "android_activation" && x.code === normalized && x.status === "issued");
  if (!pair) return { ok:false, error:"activation_invalid" };
  if (isExpired(pair, at)) {
    pair.status = "expired";
    return { ok:false, error:"activation_expired", pair };
  }
  pair.status = "consumed";
  pair.consumedAt = new Date(at).toISOString();
  pair.approvedAt = pair.consumedAt;
  return { ok:true, pair };
}

module.exports = { ACTIVATION_MINUTES, createActivationRecord, consumeActivation };
