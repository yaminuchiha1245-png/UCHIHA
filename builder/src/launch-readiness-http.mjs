function requestPath(request) {
  return String(request.raw?.url || request.url || "").split("?")[0];
}

export function installLaunchReadinessHttp(app, { db, config }) {
  app.addHook("preSerialization", async (request, reply, payload) => {
    if (request.method !== "GET" || requestPath(request) !== "/ready") return payload;
    const status = await db.status();
    const persistent = config.databaseMode === "postgres" && !config.previewMemoryMode;
    const migrationReady = persistent ? status.latestMigrationApplied === true : true;
    const releaseSha = String(config.deployment?.commitSha || "").trim() || null;

    if (config.nodeEnv === "production" && persistent && !migrationReady) {
      reply.code(503);
      return {
        status: "degraded",
        database: status.mode,
        persistent,
        migrationCount: status.migrationCount,
        latestMigrationVersion: status.latestMigrationVersion,
        latestMigrationApplied: false,
        releaseSha,
        error: "database_schema_outdated"
      };
    }

    return {
      ...(payload && typeof payload === "object" ? payload : {}),
      database: status.mode,
      persistent,
      migrationCount: status.migrationCount,
      latestMigrationVersion: status.latestMigrationVersion,
      latestMigrationApplied: status.latestMigrationApplied,
      dbLatencyMs: status.latencyMs,
      releaseSha
    };
  });
}
