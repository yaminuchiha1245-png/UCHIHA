import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors.js";
import { API_ERROR_CODES } from "@uchiha-radius/contracts";

const fail = () => new AppError(401, API_ERROR_CODES.INVALID_CREDENTIAL, "جلسة تيليغرام غير صالحة. افتح التطبيق من البوت مرة أخرى.");

/**
 * Validate Telegram Mini App initData with Telegram's bot-token HMAC.
 * Never accept initDataUnsafe, caller-supplied user IDs, or the bot's /start
 * parameter as proof of identity. URLs and WebViews are not trusted sources.
 */
export function verifyTelegramInitData(initData, botToken, { now = Date.now(), maxAgeSeconds = 600 } = {}) {
  if (typeof botToken !== "string" || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) throw fail();
  if (typeof initData !== "string" || initData.length < 20 || initData.length > 4096) throw fail();
  const parsed = new URLSearchParams(initData);
  const fields = new Map();
  for (const [key, value] of parsed) {
    if (!/^[a-z][a-z0-9_]*$/i.test(key) || fields.has(key)) throw fail();
    fields.set(key, value);
  }
  const suppliedHash = fields.get("hash");
  if (!/^[a-f0-9]{64}$/i.test(suppliedHash || "")) throw fail();
  fields.delete("hash");
  const stamp = fields.get("auth_date") || "";
  if (!/^\d{10}$/.test(stamp)) throw fail();
  const ageSeconds = Math.floor(now / 1000) - Number(stamp);
  if (!Number.isSafeInteger(ageSeconds) || ageSeconds < -60 || ageSeconds > maxAgeSeconds) throw fail();
  const checkString = [...fields.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => key + "=" + value).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secret).update(checkString).digest();
  const receivedHash = Buffer.from(suppliedHash, "hex");
  if (receivedHash.length !== expectedHash.length || !timingSafeEqual(receivedHash, expectedHash)) throw fail();
  let user;
  try { user = JSON.parse(fields.get("user") || ""); } catch { throw fail(); }
  if (!user || typeof user !== "object" || !/^[1-9]\d{3,16}$/.test(String(user.id ?? ""))) throw fail();
  const userId = String(user.id);
  if (!Number.isSafeInteger(Number(userId))) throw fail();
  return { id: userId, displayName: [user.first_name, user.last_name].filter(s => typeof s === "string").join(" ").slice(0, 120) };
}
