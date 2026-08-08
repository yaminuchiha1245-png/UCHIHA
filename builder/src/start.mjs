import { buildApp } from "./app.mjs";
import { loadAiProductConfig } from "./ai-config.mjs";
import { installAiBotModelAdminRoutes } from "./ai-bot-model-admin.mjs";
import { installAiBotProductIntegration } from "./ai-bot-product-integration.mjs";
import { installAiBotProductRoutes } from "./ai-bot-product.mjs";
import { installAiBotUsageLimitRoutes } from "./ai-bot-usage-limits.mjs";
import { installHttpHardening } from "./http-hardening.mjs";
import { installLaunchAssetInjection } from "./launch-assets.mjs";
import { installLaunchSubscriptionAdminRoutes } from "./launch-subscription-admin.mjs";
import { installLaunchSubscriptionRoutes } from "./launch-subscriptions.mjs";
import { installPlatformAccountCore } from "./platform-account-core.mjs";
import { createRuntime } from "./runtime.mjs";
import { ensureProductionShowcase } from "./showcase.mjs";

const { config, db, databaseStatus } = await createRuntime({ seed: configSeedRequested() });
const providerAiConfig = loadAiProductConfig();
const aiConfig = {
  ...config,
  ...providerAiConfig,
  // Merchant bot admins return to their UCHIHA management page. Only the
  // platform-admin response is rewritten to the real OpenAI billing URL.
  openAiBillingUrl: `${config.appBaseUrl}/products/ai-chatbot`
};
const showcase = await ensureProductionShowcase(db, config);
const app = await buildApp({ db, config, logger: true, startWorkers: true });
installLaunchSubscriptionRoutes(app, { db, config });
installLaunchSubscriptionAdminRoutes(app, { db, config });
installPlatformAccountCore(app, { db, config });
installAiBotProductRoutes(app, { db, config: aiConfig });
installAiBotModelAdminRoutes(app, { db, config: aiConfig });
installAiBotProductIntegration(app, {
  db,
  config: { ...aiConfig, platformOpenAiBillingUrl: providerAiConfig.openAiBillingUrl }
});
// Install spend guards after the webhook idempotency hook so limited Telegram
// updates are also claimed exactly once and never retried into duplicate notices.
installAiBotUsageLimitRoutes(app, { db, config: aiConfig });
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
    openAiConfigured: Boolean(providerAiConfig.openAiApiKey),
    aiPlatformDailyRequestLimit: providerAiConfig.aiPlatformDailyRequestLimit,
    demoStorePath: `/store/${showcase.slug}`,
    demoStoreHostname: showcase.hostname,
    deployment: config.deployment
  },
  "UCHIHA Builder is ready"
);