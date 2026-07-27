import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { createDatabase } from "./db.mjs";
import { seedEnvironment } from "./seed.mjs";

export async function createRuntime({ seed = false } = {}) {
  const config = loadConfig();
  if (seed) {
    const seedPath = fileURLToPath(new URL("./demo-seed.json", import.meta.url));
    const demoSeed = JSON.parse(await readFile(seedPath, "utf8"));
    const configuredOffer = Object.fromEntries(
      Object.entries(config.offerSeed).filter(([, value]) => value !== null && value !== undefined)
    );
    config.offerSeed = {
      ...demoSeed.offer,
      ...configuredOffer
    };
    if (!process.env.UCHIHA_API_1_MODE) config.providerMode = demoSeed.providerMode;
  }
  let db;
  try {
    db = await createDatabase(config);
  } catch (error) {
    if (!config.demoSeed || config.databaseMode !== "postgres") throw error;
    console.warn("PostgreSQL preview connection failed; using the isolated in-memory demo database.");
    config.databaseMode = "memory";
    config.databaseUrl = "";
    db = await createDatabase(config);
  }
  if (seed) await seedEnvironment(db, config);
  return { config, db };
}
