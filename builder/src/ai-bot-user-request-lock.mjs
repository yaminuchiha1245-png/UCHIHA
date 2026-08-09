function pathOf(request) {
  return String(request.raw?.url || request.url || "")
    .split("?")[0]
    .replace(/\/+$/, "") || "/";
}

function promptIdentity(request) {
  if (String(request.method || "").toUpperCase() !== "POST") return null;
  const match = /^\/webhooks\/ai-bots\/([0-9a-f-]+)$/i.exec(pathOf(request));
  if (!match) return null;
  const message = request.body?.message;
  const prompt = String(message?.text || "").trim();
  const telegramUserId = message?.from?.id ? String(message.from.id) : "";
  if (!prompt || prompt.startsWith("/") || !/^\d{1,20}$/.test(telegramUserId)) return null;
  return { instanceId: match[1], telegramUserId };
}

async function releaseRequestLock(request) {
  const lock = request.uchihaAiUserRequestLock;
  if (!lock) return;
  request.uchihaAiUserRequestLock = null;
  try {
    await lock.client.query("SELECT pg_advisory_unlock(hashtext($1))", [lock.key]);
  } catch {
    // Releasing the connection lets pg discard it if it has become unusable.
  } finally {
    lock.client.release();
  }
}

export function installAiBotUserRequestLock(app, { db, config }) {
  app.addHook("preHandler", async (request) => {
    if (config.databaseMode !== "postgres" || !db.pool) return;
    const identity = promptIdentity(request);
    if (!identity) return;

    const client = await db.pool.connect();
    const key = `ai-user-prompt:${identity.instanceId}:${identity.telegramUserId}`;
    try {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [key]);
      request.uchihaAiUserRequestLock = { client, key };
    } catch (error) {
      client.release();
      throw error;
    }
  });

  app.addHook("onResponse", async (request) => releaseRequestLock(request));
  app.addHook("onError", async (request) => releaseRequestLock(request));
}

export { promptIdentity, releaseRequestLock };
