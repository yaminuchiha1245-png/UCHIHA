export function readinessSnapshot(config, databaseStatus, timestamp = new Date().toISOString()) {
  const persistent = databaseStatus?.mode === "postgres";
  const preview = Boolean(config.previewMemoryMode);

  if (persistent) {
    return {
      statusCode: 200,
      payload: {
        status: "ready",
        service: "uchiha-builder",
        database: "postgresql",
        persistent: true,
        preview,
        migrationCount: Number(databaseStatus?.migrationCount || 0),
        latencyMs: Number(databaseStatus?.latencyMs || 0),
        commit: config.deployment?.commitSha ? config.deployment.commitSha.slice(0, 12) : null,
        timestamp
      }
    };
  }

  if (preview && !config.requirePersistentDatabase) {
    return {
      statusCode: 200,
      payload: {
        status: "demo-ready",
        service: "uchiha-builder",
        database: "memory-demo",
        persistent: false,
        preview: true,
        ephemeral: true,
        migrationCount: Number(databaseStatus?.migrationCount || 0),
        latencyMs: Number(databaseStatus?.latencyMs || 0),
        fallbackReason: config.databaseFallbackReason || "preview_memory_mode",
        commit: config.deployment?.commitSha ? config.deployment.commitSha.slice(0, 12) : null,
        timestamp
      }
    };
  }

  return {
    statusCode: 503,
    payload: {
      status: "degraded",
      service: "uchiha-builder",
      database: "memory-demo",
      persistent: false,
      preview,
      ephemeral: true,
      migrationCount: Number(databaseStatus?.migrationCount || 0),
      latencyMs: Number(databaseStatus?.latencyMs || 0),
      fallbackReason: config.databaseFallbackReason || null,
      commit: config.deployment?.commitSha ? config.deployment.commitSha.slice(0, 12) : null,
      timestamp
    }
  };
}
