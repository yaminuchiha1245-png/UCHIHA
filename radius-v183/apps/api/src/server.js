import { loadConfig } from "./config.js";
import { createDatabase, createDatabaseForUrl } from "./database.js";
import { seedDatabase } from "./seed.js";
import { buildApp } from "./app.js";
import { OutboxWorker } from "./outbox-worker.js";
import { DirectRouterMonitor } from "./direct-router-monitor.js";

const config = loadConfig();
const db = createDatabase(config);
const platformDb = config.databaseDriver === "postgres" ? createDatabaseForUrl(config, config.platformDatabaseUrl) : db;
// Never install sample subscribers in a non-production staging deployment.
if (config.nodeEnv !== "production" && config.allowDevAuth) await seedDatabase(db);
const app = await buildApp({ config, db, platformDb, logger: true });
const worker = new OutboxWorker({ db: platformDb, config, logger: app.log });
const directMonitor = new DirectRouterMonitor({ db: platformDb, config, logger: app.log });

await app.listen({ host: config.host, port: config.port });
if (config.outboxWorkerEnabled) await worker.start();
await directMonitor.start();

let shuttingDown = false;
async function shutdown(signal, requestedExitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  const forceExit = setTimeout(() => {
    app.log.error({ signal }, "forced shutdown after timeout");
    process.exit(1);
  }, 18_000);
  forceExit.unref();
  let exitCode = requestedExitCode;
  try {
    const closeApp = app.close();
    await directMonitor.stop();
    await worker.stop();
    await closeApp;
    if (platformDb !== db) await platformDb.close();
    await db.close();
  } catch (error) {
    exitCode = 1;
    app.log.error({ err: error }, "shutdown failed");
  } finally {
    clearTimeout(forceExit);
    process.exit(exitCode);
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("uncaughtException", (error) => {
  app.log.fatal({ err: error }, "uncaught exception");
  void shutdown("uncaughtException", 1);
});
process.once("unhandledRejection", (error) => {
  app.log.fatal({ err: error }, "unhandled rejection");
  void shutdown("unhandledRejection", 1);
});
