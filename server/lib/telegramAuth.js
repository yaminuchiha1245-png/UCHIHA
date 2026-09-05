const crypto = require("crypto");

function verifyTelegramInitData(initData, botToken, maxAgeSeconds = 86400) {
  if (!initData || !botToken) return { ok: false, reason: "missing_init_data_or_token" };

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) return { ok: false, reason: "missing_hash" };
  params.delete("hash");

  const authDate = Number(params.get("auth_date") || 0);
  const now = Date.now() / 1000;
  if (!authDate || (now - authDate) > maxAgeSeconds) {
    return { ok: false, reason: "expired" };
  }
  if ((authDate - now) > 60) {
    return { ok: false, reason: "auth_date_in_future" };
  }

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const a = Buffer.from(calculatedHash, "hex");
  const b = Buffer.from(receivedHash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid_hash" };
  }

  let user = null;
  try { user = JSON.parse(params.get("user") || "null"); } catch {}
  return { ok: true, user, authDate };
}

module.exports = { verifyTelegramInitData };
