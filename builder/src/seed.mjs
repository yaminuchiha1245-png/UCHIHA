import { randomUUID } from "node:crypto";
import { encryptSecret, hashPassword, normalizeEmail } from "./security.mjs";
import { syncProvider, UCHIHA_API_1_ALIAS } from "./providers.mjs";

const programmingServiceNames = [
  "إنشاء متجر إلكتروني",
  "إنشاء بوت متجر",
  "إنشاء بوت خدمات",
  "إنشاء بوت مخصص",
  "إنشاء موقع إلكتروني",
  "إنشاء تطبيق Android",
  "إنشاء تطبيق iOS",
  "إنشاء لوحة إدارة",
  "ربط API",
  "تطوير ميزة خاصة",
  "تصميم واجهة",
  "صيانة مشروع",
  "استضافة ونشر",
  "ربط دومين",
  "إعداد متجر موجود",
  "تعديل متجر",
  "استشارة تقنية"
];

export async function ensureSubscriptionOffer(db, offer) {
  const existing = await db.query("SELECT * FROM subscription_offers ORDER BY created_at LIMIT 1");
  if (existing.rows[0]) return existing.rows[0];
  const required = [
    offer?.priceMinor,
    offer?.renewalPriceMinor,
    offer?.durationCount,
    offer?.durationUnit
  ];
  if (required.some((value) => value === null || value === undefined || value === "")) {
    throw new Error("Subscription seed requires configurable price, renewal price, duration unit and duration count");
  }
  const id = randomUUID();
  await db.query(
    `INSERT INTO subscription_offers (
       id, name, price_minor, renewal_price_minor, currency, duration_unit,
       duration_count, trial_days, discount_percent, sale_enabled, renewal_enabled
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, TRUE, TRUE)`,
    [
      id,
      offer.name || "UCHIHA Full",
      offer.priceMinor,
      offer.renewalPriceMinor,
      offer.currency,
      offer.durationUnit,
      offer.durationCount,
      offer.trialDays || 0
    ]
  );
  return (await db.query("SELECT * FROM subscription_offers WHERE id = $1", [id])).rows[0];
}

export async function ensurePlatformAdmin(db, email, password) {
  if (!email || !password) return null;
  const normalized = normalizeEmail(email);
  const existing = await db.query("SELECT * FROM platform_users WHERE email = $1", [normalized]);
  if (existing.rows[0]) {
    if (!existing.rows[0].is_platform_admin) {
      await db.query("UPDATE platform_users SET is_platform_admin = TRUE, updated_at = NOW() WHERE id = $1", [
        existing.rows[0].id
      ]);
    }
    return existing.rows[0];
  }
  const id = randomUUID();
  await db.query(
    `INSERT INTO platform_users (
       id, email, display_name, password_hash, is_platform_admin
     ) VALUES ($1, $2, 'UCHIHA Platform Admin', $3, TRUE)`,
    [id, normalized, await hashPassword(password)]
  );
  return (await db.query("SELECT * FROM platform_users WHERE id = $1", [id])).rows[0];
}

export async function ensureUchihaApi1(db, config) {
  const existing = await db.query("SELECT * FROM api_providers WHERE public_alias = $1", [UCHIHA_API_1_ALIAS]);
  if (existing.rows[0]) return existing.rows[0];
  const id = randomUUID();
  const testMode = config.providerMode !== "live";
  const credential = config.providerToken || (testMode ? "test-mode-no-external-request" : "");
  if (!credential) throw new Error("UCHIHA API 1 live mode requires a provider token");
  await db.query(
    `INSERT INTO api_providers (
       id, internal_name, public_alias, adapter_key, base_url, currency,
       test_mode, connection_status, credentials_ciphertext, sync_settings, retry_settings
     ) VALUES (
       $1, 'JAS4CARD', $2, 'jas4card', 'https://api.js4card.com/client/api',
       'USD', $3, 'unknown', $4, $5, $6
     )`,
    [
      id,
      UCHIHA_API_1_ALIAS,
      testMode,
      encryptSecret(credential, config.encryptionKey),
      { intervalMinutes: 60, syncPrices: true, syncAvailability: true },
      { maxAttempts: 5, baseDelaySeconds: 10 }
    ]
  );
  return (await db.query("SELECT * FROM api_providers WHERE id = $1", [id])).rows[0];
}

export async function seedProgrammingServices(db, currency = "USD") {
  for (const name of programmingServiceNames) {
    await db.query(
      `INSERT INTO programming_services (
         id, name, description, starting_price_minor, currency,
         estimated_duration, fields, options, resale_enabled, status
       ) VALUES ($1, $2, $3, 0, $4, NULL, $5, '[]', TRUE, 'active')
       ON CONFLICT (name) DO NOTHING`,
      [
        randomUUID(),
        name,
        `خدمة ${name} تُدار من منصة UCHIHA ويمكن تعديل وصفها وسعرها وحقولها من لوحة مدير المنصة.`,
        currency,
        [
          { key: "requirements", label: "تفاصيل الطلب", type: "textarea", required: true },
          { key: "attachments", label: "مرفقات", type: "file", required: false }
        ]
      ]
    );
  }
}

export async function seedEnvironment(db, config) {
  const offer = await ensureSubscriptionOffer(db, config.offerSeed);
  const admin = await ensurePlatformAdmin(db, config.platformAdminEmail, config.platformAdminPassword);
  const provider = await ensureUchihaApi1(db, config);
  await seedProgrammingServices(db, offer.currency);
  const sync = await syncProvider(db, provider.id, config);
  return { offer, admin, provider, sync };
}

export { programmingServiceNames };

