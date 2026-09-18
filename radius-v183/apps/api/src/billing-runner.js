import { loadConfig } from "./config.js";
import { createDatabase, createDatabaseForUrl } from "./database.js";
import { generateTenantInvoices } from "./billing-service.js";

const config = loadConfig();
const db = config.databaseDriver === "postgres"
  ? createDatabaseForUrl(config, config.platformDatabaseUrl)
  : createDatabase(config);

const dueDays = Number.parseInt(process.env.BILLING_DUE_DAYS ?? "7", 10);
if (!Number.isInteger(dueDays) || dueDays < 1 || dueDays > 90) {
  throw new Error("BILLING_DUE_DAYS must be between 1 and 90");
}
const asOf = process.env.BILLING_AS_OF ?? new Date().toISOString();
if (Number.isNaN(new Date(asOf).getTime())) throw new Error("BILLING_AS_OF must be an ISO date-time");

try {
  const tenants = await db.withContext({ tenantId: "" }, () => db.all("SELECT id FROM tenants WHERE status='active' ORDER BY id"));
  const totals = { tenants: tenants.length, created: 0, skipped: 0, failures: [] };
  for (const tenant of tenants) {
    try {
      const result = await db.withContext({ tenantId: tenant.id }, () => db.transaction((tx) =>
        generateTenantInvoices(tx, tenant.id, { asOf, dueDays, reason: "تشغيل الفوترة الدوري" })));
      totals.created += result.created;
      totals.skipped += result.skipped;
    } catch (error) {
      totals.failures.push({ tenantId: tenant.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  process.stdout.write(`${JSON.stringify({ event: "billing_run_complete", asOf, dueDays, ...totals })}\n`);
  if (totals.failures.length) process.exitCode = 1;
} finally {
  await db.close();
}
