import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { createDatabase } from "./db.mjs";
import { seedEnvironment } from "./seed.mjs";

export async function createRuntime({ seed = false } = {}) {
  const config = loadConfig();
  if (seed && config.databaseMode === "memory") {
    const seedPath = fileURLToPath(new URL("./demo-seed.json", import.meta.url));
    const demoSeed = JSON.parse(await readFile(seedPath, "utf8"));
    config.offerSeed = {
      ...config.offerSeed,
      ...demoSeed.offer
    };
    config.providerMode = demoSeed.providerMode;
  }
  const db = await createDatabase(config);
  if (seed) await seedEnvironment(db, config);
  return { config, db };
}

