// Transaction-scoped locks make the duplicate check reliable when requests race.
// The API's idempotent write handler and direct-connection service own transactions.
export async function lockDeviceEndpoint(db, tenantId, siteId, host, port) {
  if (db.driver !== "postgres") return;
  const key = JSON.stringify(["network-device-v1", tenantId, siteId ?? null,
    String(host).trim().toLowerCase(), Number(port)]);
  await db.get("SELECT pg_advisory_xact_lock(hashtextextended(?, 0)) AS locked", [key]);
}
