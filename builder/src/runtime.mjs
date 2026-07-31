import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { createDatabase } from "./db.mjs";
import { seedEnvironment } from "./seed.mjs";

function safeErrorCode(error) {
  return String(error?.code || error?.name || "database_connection_error").slice(0, 80);
}

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
    if (!config.previewMemoryMode || config.requirePersistentDatabase || config.databaseMode !== "postgres") {
      throw error;
    }
    const errorCode = safeErrorCode(error);
    console.warn(
      `PostgreSQL demo preview connection failed (${errorCode}); using the isolated in-memory database.`
    );
    config.databaseMode = "memory";
    config.databaseUrl = "";
    config.databaseSource = "none";
    config.databaseFallbackReason = `connection_failed:${errorCode}`;
    db = await createDatabase(config);
  }

  if (seed) await seedEnvironment(db, config);
  const databaseStatus = await db.status();
  return { config, db, databaseStatus };
}
