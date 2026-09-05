const { randomCode, isExpired } = require("./devicePair");

const ACTIVATION_MINUTES = 5;

function normalizeActivationCode(value) {
  const compact = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length !== 8) return "";
  return `${compact.slice(0,4)}-${compact.slice(4)}`;
}

function createActivationRecord({ id, telegramId, at = Date.now() } = {}) {
  if (!id || !telegramId) throw new Error("activation_identity_required");
  const code = normalizeActivationCode(randomCode(8));
  return {
    id,
    mode: "android_activation",
    code,
    status: "issued",
    telegramId: String(telegramId),
    createdAt: new Date(at).toISOString(),
    expiresAt: new Date(at + ACTIVATION_MINUTES * 60000).toISOString(),
    approvedAt: null,
    consumedAt: null
  };
}

function consumeActivation(records, code, at = Date.now()) {
  const normalized = normalizeActivationCode(code);
  if (!normalized) return { ok:false, error:"activation_invalid" };
  const pair = (records || []).find(x => x.mode === "android_activation" && normalizeActivationCode(x.code) === normalized && x.status === "issued");
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

module.exports = { ACTIVATION_MINUTES, normalizeActivationCode, createActivationRecord, consumeActivation };
