import { loadConfig } from "./config.js";
import { createDatabase, createDatabaseForUrl } from "./database.js";
import { maintenanceOptionsFromEnv, runMaintenance } from "./maintenance-service.js";

const config = loadConfig();
const db = config.databaseDriver === "postgres"
  ? createDatabaseForUrl(config, config.platformDatabaseUrl)
  : createDatabase(config);

try {
  const options = maintenanceOptionsFromEnv();
  const result = await db.withContext({ tenantId: "", platformAccess: true }, () => runMaintenance(db, options));
  process.stdout.write(`${JSON.stringify({ event: "maintenance_run_complete", ...result })}\n`);
} finally {
  await db.close();
}
