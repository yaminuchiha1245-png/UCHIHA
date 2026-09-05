import { sha256 } from "./security.mjs";

const SESSION_COOKIE = "uchiha_builder_session";

function pathOf(request) {
  return String(request.raw?.url || request.url || "")
    .split("?")[0]
    .replace(/\/+$/, "") || "/";
}

async function releaseLock(request) {
  const lock = request.uchihaAiPurchaseLock;
  if (!lock?.client) return;
  request.uchihaAiPurchaseLock = null;
  try {
    await lock.client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lock.key]);
  } catch {
    // Closing/releasing the PostgreSQL session releases an advisory lock too.
  } finally {
    lock.client.release();
  }
}

export function installAiPurchaseIdempotencyLock(app, { db, config }) {
  app.addHook("preHandler", async (request) => {
    if (
      String(request.method || "").toUpperCase() !== "POST" ||
      pathOf(request) !== "/api/platform/ai-bots/purchase" ||
      config.databaseMode !== "postgres"
    ) return;

    const idempotencyKey = String(request.headers["idempotency-key"] || "").trim().slice(0, 160);
    const sessionToken = request.cookies?.[SESSION_COOKIE];
    const csrf = String(request.headers["x-csrf-token"] || "");
    if (!idempotencyKey || !sessionToken || !csrf) return;

    const session = (
      await db.query(
        `SELECT u.id, s.csrf_hash
         FROM sessions s
         JOIN platform_users u ON u.id=s.user_id
         WHERE s.token_hash=$1 AND s.revoked_at IS NULL
           AND s.expires_at>NOW() AND u.status='active'`,
        [sha256(sessionToken)]
      )
    ).rows[0];
    if (!session?.id || !session.csrf_hash || sha256(csrf) !== session.csrf_hash) return;

    const client = await db.pool.connect();
    const key = `ai-purchase:${session.id}:${idempotencyKey}`;
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [key]);
      request.uchihaAiPurchaseLock = { client, key };
    } catch (error) {
      client.release();
      throw error;
    }
  });

  app.addHook("onResponse", async (request) => releaseLock(request));
  app.addHook("onError", async (request) => releaseLock(request));
}
