import { buildApp } from "./app.mjs";
import { loadAiProductConfig } from "./ai-config.mjs";
import { installAiBotModelAdminRoutes } from "./ai-bot-model-admin.mjs";
import { installAiBotProductIntegration } from "./ai-bot-product-integration.mjs";
import { installAiBotProductRoutes } from "./ai-bot-product.mjs";
import { installAiBotProvisioningGuard } from "./ai-bot-provisioning-guard.mjs";
import { installAiBotUsageLimitRoutes } from "./ai-bot-usage-limits.mjs";
import { createPerBotAiConfig } from "./ai-provider-context.mjs";
import { installAiTelegramAdmin } from "./ai-telegram-admin.mjs";
import { installAiTelegramModelCreate } from "./ai-telegram-model-create.mjs";
import { installAiTelegramOpenAiHealth } from "./ai-telegram-openai-health.mjs";
import { installAiTelegramSecretInput } from "./ai-telegram-secret-input.mjs";
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

perBotProvider.install(app);
installLaunchSubscriptionRoutes(app, { db, config });
installLaunchSubscriptionAdminRoutes(app, { db, config });
installPlatformAccountCore(app, { db, config });

installAiBotProductIntegration(app, {
  db,
  config: { ...baseAiConfig, platformOpenAiBillingUrl: providerAiConfig.openAiBillingUrl }
});
installAiBotProvisioningGuard(app, { db });
// Specialized Telegram admin handlers run before the general admin hook so
// model creation, secret capture and live OpenAI checks stay inside the bot.
installAiTelegramModelCreate(app, { db, config: aiConfig });
installAiTelegramOpenAiHealth(app, { db, config: aiConfig });
installAiTelegramSecretInput(app, { db, config: aiConfig });
installAiTelegramAdmin(app, { db, config: aiConfig });
installAiBotUsageLimitRoutes(app, { db, config: aiConfig });
installAiBotProductRoutes(app, { db, config: aiConfig });
installAiBotModelAdminRoutes(app, { db, config: aiConfig });
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
    demoStorePath: `/store/${showcase.slug}`,
    demoStoreHostname: showcase.hostname,
    deployment: config.deployment
  },
  "UCHIHA Builder is ready"
);