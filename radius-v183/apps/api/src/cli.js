import { loadConfig } from "./config.js";
import { createDatabase, createDatabaseForUrl } from "./database.js";
import { seedDatabase } from "./seed.js";
import { runMigrations } from "./migrate.js";
import path from "node:path";

const command = process.argv[2];
const config = loadConfig();
const db = command === "db:init" && config.databaseDriver === "postgres"
  ? createDatabaseForUrl(config, config.migrationDatabaseUrl)
  : createDatabase(config);

try {
  if (command === "db:init") {
    const result = await runMigrations(db, path.resolve(process.cwd()));
    console.log(`Database initialized using ${config.databaseDriver}${result.applied.length ? `; applied ${result.applied.join(", ")}` : ""}`);
  } else if (command === "db:seed") {
    if (config.nodeEnv === "production") throw new Error("Demo seed is disabled in production");
    await seedDatabase(db);
    console.log("Development data seeded");
  } else {
    console.error("Usage: node apps/api/src/cli.js db:init|db:seed");
    process.exitCode = 2;
  }
} finally {
  await db.close();
}
