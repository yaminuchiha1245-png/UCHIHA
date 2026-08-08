import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { createDatabase } from "./db.mjs";

function present(value) {
  const text = String(value ?? "").trim();
  return Boolean(text && !/^\$\{\{[^}]+\}\}$/.test(text));
}

function publicHttps(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (/^(?:127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false;
    const private172 = /^172\.(\d{1,3})\./.exec(host);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    if (host === "::1" || host === "[::1]") return false;
    return true;
  } catch {
    return false;
  }
}

export async function evaluateAiLaunchReadiness({ config, db, env = process.env }) {
  const blockers = [];
  const warnings = [];
  const block = (code, message) => blockers.push({ code, message });

  if (config.nodeEnv !== "production") {
    block("production_env_required", "NODE_ENV يجب أن يكون production قبل فتح البيع الحقيقي");
  }
  if (config.databaseMode !== "postgres" || !config.databaseUrl) {
    block("postgres_required", "بوتات AI تحتاج PostgreSQL دائم في الإنتاج");
  }
  if (!config.requirePersistentDatabase) {
    block("persistent_database_required", "REQUIRE_PERSISTENT_DATABASE يجب أن يكون مفعّلًا");
  }
  if (!publicHttps(config.appBaseUrl)) {
    block("public_https_required", "APP_BASE_URL يجب أن يكون رابط HTTPS عامًا يمكن لـTelegram الوصول إليه");
  }
  if (!config.cookieSecure) {
    block("secure_cookie_required", "COOKIE_SECURE يجب أن يكون مفعّلًا لحماية جلسات الشراء");
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
  if (config.previewMemoryMode || config.demoSeed || config.allowDemoBilling) {
    block("demo_mode_disabled", "PREVIEW_MEMORY_MODE وDEMO_SEED وALLOW_DEMO_BILLING يجب أن تكون معطلة في الإطلاق الحقيقي");
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
    if (db?.close) await db.close().catch(() => undefined);
  }
}

const executedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (executedFile === fileURLToPath(import.meta.url)) await main();
