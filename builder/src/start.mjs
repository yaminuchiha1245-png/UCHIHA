import { buildApp } from "./app.mjs";
import { loadAiProductConfig } from "./ai-config.mjs";
import { installAiBotOldWebhookCleanup } from "./ai-bot-old-webhook-cleanup.mjs";
import { installAiBotProductIntegration } from "./ai-bot-product-integration.mjs";
import { installAiBotProductRoutes } from "./ai-bot-product.mjs";
import { installAiBotProvisioningGuard } from "./ai-bot-provisioning-guard.mjs";
import { installAiBotTelegramOnlyAdminGuard } from "./ai-bot-telegram-only-admin-guard.mjs";
import { installAiBotTokenOwnershipGuard } from "./ai-bot-token-ownership-guard.mjs";
import { installAiBotUsageLimitRoutes } from "./ai-bot-usage-limits.mjs";
import { installAiBotWebhookAuthentication } from "./ai-bot-webhook-auth.mjs";
import { installAiProductActivationGuard } from "./ai-product-activation-guard.mjs";
import { createPerBotAiConfig } from "./ai-provider-context.mjs";
import { installAiPurchaseConsent } from "./ai-purchase-consent.mjs";
import { installAiPurchaseIdempotencyLock } from "./ai-purchase-idempotency-lock.mjs";
import { installAiTelegramAdmin } from "./ai-telegram-admin.mjs";
import { installAiTelegramModelCreate } from "./ai-telegram-model-create.mjs";
import { installAiTelegramOpenAiHealth } from "./ai-telegram-openai-health.mjs";
import { installAiTelegramSecretInput } from "./ai-telegram-secret-input.mjs";
import { installAiTelegramUserAdmin } from "./ai-telegram-user-admin.mjs";
import { installHttpHardening } from "./http-hardening.mjs";
import { installLaunchAssetInjection } from "./launch-assets.mjs";
import { installLaunchSubscriptionAdminRoutes } from "./launch-subscription-admin.mjs";
import { installLaunchSubscriptionRoutes } from "./launch-subscriptions.mjs";
import { installPlatformAccountCore } from "./platform-account-core.mjs";
import { createRuntime } from "./runtime.mjs";
import { ensureProductionShowcase } from "./showcase.mjs";

const { config, db, databaseStatus } = await createRuntime({ seed: configSeedRequested() });
const providerAiConfig = loadAiProductConfig();
const baseAiConfig = {
  ...config,
  ...providerAiConfig,
  openAiBillingUrl: providerAiConfig.openAiBillingUrl
};
const perBotProvider = createPerBotAiConfig(baseAiConfig, {
  db,
  encryptionKey: config.encryptionKey
});
const aiConfig = perBotProvider.config;
const showcase = await ensureProductionShowcase(db, config);
const app = await buildApp({ db, config, logger: true, startWorkers: true });

// Platform-owner-only product pricing UI. The page is static, while its API is
// authenticated and platform-admin protected by the AI product routes.
app.get("/platform-ai-product", async (_request, reply) => reply.sendFile("platform-ai-product.html"));
app.get("/platform-ai-product.html", async (_request, reply) => reply.sendFile("platform-ai-product.html"));

perBotProvider.install(app);
installLaunchSubscriptionRoutes(app, { db, config });
installLaunchSubscriptionAdminRoutes(app, { db, config });
installPlatformAccountCore(app, { db, config });

installAiBotProductIntegration(app, { db });
installAiBotProvisioningGuard(app, { db });
// Capture the previous Telegram identity before the reservation guard mutates it.
installAiBotOldWebhookCleanup(app, { db, config: aiConfig });
installAiBotTokenOwnershipGuard(app, { db, config: aiConfig });
installAiBotTelegramOnlyAdminGuard(app);
installAiBotWebhookAuthentication(app, { db });
installAiProductActivationGuard(app, { db, config });
installAiPurchaseIdempotencyLock(app, { db, config });
installAiPurchaseConsent(app, { db });
// Specialized Telegram admin handlers run before the general admin hook so
// model creation, user actions, secret capture and live OpenAI checks stay inside the bot.
installAiTelegramModelCreate(app, { db, config: aiConfig });
installAiTelegramOpenAiHealth(app, { db, config: aiConfig });
installAiTelegramSecretInput(app, { db, config: aiConfig });
installAiTelegramUserAdmin(app, { db, config: aiConfig });
installAiTelegramAdmin(app, { db, config: aiConfig });
installAiBotUsageLimitRoutes(app, { db, config: aiConfig });
installAiBotProductRoutes(app, { db, config: aiConfig });
installLaunchAssetInjection(app);
installHttpHardening(app, config);

function configSeedRequested() {
  const enabled = (value) => ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
  return enabled(process.env.PREVIEW_MEMORY_MODE) || enabled(process.env.DEMO_SEED);
}

async function shutdown(signal) {
  app.log.info({ signal }, "Stopping UCHIHA Builder");
  await app.close();
  await db.close();
  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

await app.listen({ port: config.port, host: config.host });
app.log.info(
  {
    url: config.appBaseUrl,
    appBaseUrlSource: config.appBaseUrlSource,
    databaseMode: config.databaseMode,
    databaseSource: config.databaseSource,
    databaseFallbackReason: config.databaseFallbackReason || null,
    previewMemoryMode: config.previewMemoryMode,
    requirePersistentDatabase: config.requirePersistentDatabase,
    migrationCount: databaseStatus.migrationCount,
    databaseLatencyMs: databaseStatus.latencyMs,
    telegramMode: config.telegramMode,
    providerMode: config.providerMode,
    aiPerBotOpenAi: true,
    aiBotTokenProvisioning: "purchase_site",
    aiCustomerAdministration: "telegram_only",
    aiPurchaseSafety: "fail_closed",
    demoStorePath: `/store/${showcase.slug}`,
    demoStoreHostname: showcase.hostname,
    deployment: config.deployment
  },
  "UCHIHA Builder is ready"
);