function configured(value) {
  const result = String(value ?? "").trim();
  if (!result || result === "<empty string>" || /^\$\{\{[^}]+\}\}$/.test(result)) return "";
  return result;
}

function cleanHttpsUrl(value, fallback, field) {
  const raw = configured(value) || fallback;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${field} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${field} must be a clean HTTPS URL`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function positiveInteger(value, fallback, { minimum = 1, maximum = 10_000_000 } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function telegramUsername(value) {
  return configured(value).replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "");
}

export function loadAiProductConfig(env = process.env) {
  return {
    // OPENAI_API_KEY is optional platform fallback only. Purchased bots are configured
    // from /admin and use their own encrypted OpenAI key at runtime.
    openAiApiKey: configured(env.OPENAI_API_KEY),
    openAiBaseUrl: cleanHttpsUrl(
      env.OPENAI_API_BASE_URL,
      "https://api.openai.com/v1",
      "OPENAI_API_BASE_URL"
    ),
    openAiBillingUrl: cleanHttpsUrl(
      env.OPENAI_BILLING_URL,
      "https://platform.openai.com/settings/organization/billing/overview",
      "OPENAI_BILLING_URL"
    ),
    openAiFreeModel: configured(env.OPENAI_FREE_MODEL) || "gpt-5.6-luna",
    openAiProModel: configured(env.OPENAI_PRO_MODEL) || "gpt-5.6-sol",
    openAiImageModel: configured(env.OPENAI_IMAGE_MODEL) || "gpt-image-2",
    aiSetupBotToken: configured(env.UCHIHA_AI_SETUP_BOT_TOKEN),
    aiSetupBotUsername: telegramUsername(env.UCHIHA_AI_SETUP_BOT_USERNAME),
    aiPlatformDailyRequestLimit: positiveInteger(env.AI_PLATFORM_DAILY_REQUEST_LIMIT, 50_000, {
      minimum: 100,
      maximum: 10_000_000
    })
  };
}