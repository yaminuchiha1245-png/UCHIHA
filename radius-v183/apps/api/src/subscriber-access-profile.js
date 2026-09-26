/* Optional per-subscriber access/pricing overrides. Never derive exchange rates. */
import { validationError } from "./errors.js";
import { nowIso, parseJson } from "./utils.js";
const UNIT_BYTES = Object.freeze({ MB: 1_000_000, GB: 1_000_000_000 });
const CURRENCIES = ["USD", "SYP", "TRY"];
const AMOUNT = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
export function accessProfileView(row) {
  if (!row) return null;
  const bytes = row.daily_quota_bytes === null ? null : Number(row.daily_quota_bytes);
  const unit = row.daily_quota_unit;
  return {
    speedDownMbps: Number(row.speed_down_mbps),
    speedUpMbps: Number(row.speed_up_mbps),
    dailyQuota: bytes === null ? null : { amount: bytes / UNIT_BYTES[unit], unit },
    dailyQuotaBytes: bytes,
    priceCurrency: row.price_currency,
    prices: parseJson(row.prices_json, {}),
    automaticExchange: false,
    updatedAt: row.updated_at
  };
}
export async function readAccessProfile(db, tenantId, subscriberId) {
  const row = await db.get("SELECT * FROM subscriber_access_profiles WHERE tenant_id=? AND subscriber_id=?",
    [tenantId, subscriberId]);
  return accessProfileView(row);
}
export async function saveAccessProfile(db, tenantId, subscriberId, input, plan = null) {
  if (input === undefined) return undefined;
  if (input === null) {
    await db.run("DELETE FROM subscriber_access_profiles WHERE tenant_id=? AND subscriber_id=?",
      [tenantId, subscriberId]);
    return null;
  }
  const { speedDownMbps, priceCurrency } = input;
  const speedUpMbps = input.speedUpMbps ?? plan?.speed_up_mbps ?? speedDownMbps;
  if (!CURRENCIES.includes(priceCurrency)) throw validationError("العملة المختارة غير مدعومة");
  const prices = {};
  for (const currency of CURRENCIES) {
    const amount = input.prices[currency];
    if (amount !== null && amount !== undefined) {
      if (typeof amount !== "string" || !AMOUNT.test(amount))
        throw validationError("أدخل مبلغًا دقيقًا لكل عملة دون تحويل تلقائي");
      prices[currency] = amount;
    }
  }
  if (!Object.hasOwn(prices, priceCurrency))
    throw validationError("يجب تحديد سعر مستقل للعملة المختارة");
  const quota = input.dailyQuota ?? null;
  const unit = quota?.unit ?? null;
  const bytes = quota ? quota.amount * UNIT_BYTES[unit] : null;
  if (quota && (!UNIT_BYTES[unit] || !Number.isSafeInteger(bytes) || bytes <= 0))
    throw validationError("حد الاستهلاك اليومي غير صالح");
  const now = nowIso();
  await db.run(`INSERT INTO subscriber_access_profiles
    (tenant_id,subscriber_id,speed_down_mbps,speed_up_mbps,daily_quota_bytes,daily_quota_unit,
      price_currency,prices_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT (tenant_id,subscriber_id) DO UPDATE SET
      speed_down_mbps=excluded.speed_down_mbps,speed_up_mbps=excluded.speed_up_mbps,
      daily_quota_bytes=excluded.daily_quota_bytes,daily_quota_unit=excluded.daily_quota_unit,
      price_currency=excluded.price_currency,prices_json=excluded.prices_json,updated_at=excluded.updated_at`,
    [tenantId,subscriberId,speedDownMbps,speedUpMbps,bytes,unit,priceCurrency,JSON.stringify(prices),now,now]);
  return readAccessProfile(db,tenantId,subscriberId);
}
