import { buildApp } from "./app.mjs";
import { installHttpHardening } from "./http-hardening.mjs";
import { createRuntime } from "./runtime.mjs";

const { config, db, databaseStatus } = await createRuntime({ seed: configSeedRequested() });
const app = await buildApp({ db, config, logger: true, startWorkers: true });
installHttpHardening(app, config);

function configSeedRequested() {
  return ["1", "true", "yes", "on"].includes(String(process.env.DEMO_SEED || "").toLowerCase());
}

app.get("/ready", async (_request, reply) => {
  try {
    const status = await db.status();
    const persistent = status.mode === "postgres";
    return reply.code(persistent ? 200 : 503).send({
      status: persistent ? "ready" : "degraded",
      service: "uchiha-builder",
      database: persistent ? "postgresql" : "memory-demo",
      persistent,
      migrationCount: status.migrationCount,
      latencyMs: status.latencyMs,
      fallbackReason: config.databaseFallbackReason || null,
      commit: config.deployment.commitSha ? config.deployment.commitSha.slice(0, 12) : null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    app.log.error({ error }, "Readiness database probe failed");
    return reply.code(503).send({
      status: "unavailable",
      service: "uchiha-builder",
      database: "unavailable",
      persistent: false,
      timestamp: new Date().toISOString()
    });
  }
});

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
    migrationCount: databaseStatus.migrationCount,
    databaseLatencyMs: databaseStatus.latencyMs,
    telegramMode: config.telegramMode,
    providerMode: config.providerMode,
    deployment: config.deployment
  },
  "UCHIHA Builder is ready"
);
