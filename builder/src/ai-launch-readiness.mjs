import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { createDatabase } from "./db.mjs";

function present(value) {
  const text = String(value ?? "").trim();
  return Boolean(text && !/^\$\{\{[^}]+\}\}$/.test(text));
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export async function evaluateAiLaunchReadiness({ config, db, env = process.env }) {
  const blockers = [];
  const warnings = [];
  const block = (code, message) => blockers.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });

  if (config.databaseMode !== "postgres" || !config.databaseUrl) {
    block("postgres_required", "بوتات AI تحتاج PostgreSQL دائم في الإنتاج");
  }
  if (!isHttpsUrl(config.appBaseUrl)) {
    block("https_required", "APP_BASE_URL يجب أن يكون HTTPS حتى تعمل Telegram Webhooks");
  }
  if (!present(env.APP_ENCRYPTION_KEY)) {
    block("encryption_key_required", "APP_ENCRYPTION_KEY مطلوب لتشفير Bot Token وOpenAI API Key");
  }
  if (config.telegramMode !== "live") {
    block("telegram_live_required", "TELEGRAM_MODE يجب أن يكون live قبل بيع البوتات");
  }
  if (!config.rateLimitEnabled) {
    block("rate_limit_required", "RATE_LIMIT_ENABLED يجب أن يكون مفعّلًا");
  }

  let databaseStatus = null;
  let product = null;
  try {
    databaseStatus = await db.status();
    if (Number(databaseStatus.migrationCount || 0) < 31) {
      block("ai_migrations_pending", `يجب تطبيق migrations حتى 031. المطبق حاليًا: ${Number(databaseStatus.migrationCount || 0)}`);
    }
    product = (
      await db.query(
        `SELECT service_key, starting_price_minor, currency, status, is_catalog_product
         FROM platform_services
         WHERE service_key='ai-chatbot' AND tenant_id IS NULL AND store_id IS NULL
         LIMIT 1`
      )
    ).rows[0] || null;
  } catch (error) {
    block("database_check_failed", `تعذر فحص قاعدة البيانات: ${error.message}`);
  }

  if (!product) {
    block("product_missing", "منتج ai-chatbot غير موجود في كتالوج المنصة");
  } else {
    if (!Number.isSafeInteger(Number(product.starting_price_minor)) || Number(product.starting_price_minor) <= 0) {
      block("price_required", "حدد سعر بيع بوت AI من إدارة المنصة قبل فتح الإطلاق");
    }
    if (product.status !== "active") {
      block("product_not_active", "حالة منتج بوت AI ليست active");
    }
    if (!product.is_catalog_product) {
      block("catalog_disabled", "منتج بوت AI غير مفعّل كمنتج في الكتالوج");
    }
    if (!/^[A-Z]{3}$/.test(String(product.currency || ""))) {
      block("currency_invalid", "عملة منتج بوت AI غير صالحة");
    }
  }

  if (config.nodeEnv !== "production") warn("node_env", "الفحص لا يعمل حاليًا تحت NODE_ENV=production");
  if (!config.cookieSecure) warn("secure_cookie", "COOKIE_SECURE غير مفعل");

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    product: product
      ? {
          key: product.service_key,
          priceMinor: Number(product.starting_price_minor || 0),
          currency: product.currency,
          status: product.status,
          catalogEnabled: Boolean(product.is_catalog_product)
        }
      : null,
    database: databaseStatus
      ? { mode: databaseStatus.mode, migrationCount: Number(databaseStatus.migrationCount || 0) }
      : null,
    architecture: {
      tokenProvisioning: "website",
      administration: "telegram:/admin",
      openAiCredential: "per-purchased-bot-encrypted"
    }
  };
}

async function main() {
  let db;
  try {
    const config = loadConfig();
    db = await createDatabase(config);
    const result = await evaluateAiLaunchReadiness({ config, db });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ready) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({
      ready: false,
      blockers: [{ code: "configuration_error", message: error.message }],
      warnings: []
    }, null, 2));
    process.exitCode = 1;
  } finally {
    await db?.close?.().catch(() => undefined);
  }
}

const executedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (executedFile === fileURLToPath(import.meta.url)) await main();
