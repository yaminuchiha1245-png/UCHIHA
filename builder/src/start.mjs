import { buildApp } from "./app.mjs";
import { installPaymentRoutes } from "./payments.mjs";
import { createRuntime } from "./runtime.mjs";

const { config, db } = await createRuntime({ seed: configSeedRequested() });
const app = await buildApp({ db, config, logger: true, startWorkers: true });
installPaymentRoutes(app, { db, config });

function configSeedRequested() {
  return ["1", "true", "yes", "on"].includes(String(process.env.DEMO_SEED || "").toLowerCase());
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
    databaseMode: config.databaseMode,
    telegramMode: config.telegramMode
  },
  "UCHIHA Builder is ready"
);
