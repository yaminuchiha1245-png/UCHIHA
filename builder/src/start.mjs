import { buildApp } from "./app.mjs";
import { installHttpHardening } from "./http-hardening.mjs";
import { installLaunchAssetInjection } from "./launch-assets.mjs";
import { installLaunchSubscriptionAdminRoutes } from "./launch-subscription-admin.mjs";
import { installLaunchSubscriptionRoutes } from "./launch-subscriptions.mjs";
import { installPlatformAccountCore } from "./platform-account-core.mjs";
import { createRuntime } from "./runtime.mjs";
import { ensureProductionShowcase } from "./showcase.mjs";

const { config, db, databaseStatus } = await createRuntime({ seed: configSeedRequested() });
const showcase = await ensureProductionShowcase(db, config);
const app = await buildApp({ db, config, logger: true, startWorkers: true });
installLaunchSubscriptionRoutes(app, { db, config });
installLaunchSubscriptionAdminRoutes(app, { db, config });
installPlatformAccountCore(app, { db, config });
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
    demoStorePath: `/store/${showcase.slug}`,
    demoStoreHostname: showcase.hostname,
    deployment: config.deployment
  },
  "UCHIHA Builder is ready"
);
