import { createRuntime } from "./runtime.mjs";
import { startWorkerLoop } from "./worker.mjs";

const { config, db } = await createRuntime();
const stop = startWorkerLoop(db, config, console, 750);

async function shutdown() {
  stop();
  await db.close();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
console.log("UCHIHA Builder worker is running");

