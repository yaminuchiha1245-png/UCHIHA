import { loadConfig } from "../../api/src/config.js";
import { createDatabaseForUrl } from "../../api/src/database.js";
import { OutboxWorker } from "../../api/src/outbox-worker.js";

const config = loadConfig();
const db = createDatabaseForUrl(config, config.platformDatabaseUrl);
const worker = new OutboxWorker({ db, config });
await worker.start();

console.log("UCHIHA RADIUS Telegram/outbox worker is running");

let shuttingDown = false;
async function shutdown(signal, requestedExitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  let exitCode = requestedExitCode;
  try {
    await worker.stop();
    await db.close();
  } catch (error) {
    exitCode = 1;
    console.error("Worker shutdown failed", { signal, message: error?.message });
  }
  process.exit(exitCode);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("uncaughtException", (error) => {
  console.error("Worker uncaught exception", { message: error?.message });
  void shutdown("uncaughtException", 1);
});
process.once("unhandledRejection", (error) => {
  console.error("Worker unhandled rejection", { message: error instanceof Error ? error.message : String(error) });
  void shutdown("unhandledRejection", 1);
});
