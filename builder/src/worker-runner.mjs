import { createRuntime } from "./runtime.mjs";
import { startSubscriptionExpiryLoop } from "./subscription-expiry.mjs";
import { startWorkerLoop } from "./worker.mjs";

const { config, db } = await createRuntime();
const stopWorker = startWorkerLoop(db, config, console, 750);
const stopSubscriptionExpiry = startSubscriptionExpiryLoop(db, console, 60_000);

async function shutdown() {
  stopSubscriptionExpiry();
  stopWorker();
  await db.close();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
console.log("UCHIHA Builder worker is running");
