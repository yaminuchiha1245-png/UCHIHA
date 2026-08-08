import { randomBytes } from "node:crypto";
import { sha256 } from "./security.mjs";

const SESSION_COOKIE = "uchiha_builder_session";

function pathOf(request) {
  return String(request.raw?.url || request.url || "").split("?")[0];
}

function cleanUsername(value) {
  return String(value || "").trim().replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "");
}

async function issueSetupCode(db, instanceId) {
  const code = randomBytes(18).toString("base64url");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.query(
    `UPDATE ai_bot_instances
     SET setup_code_hash=$2, setup_code_expires_at=$3, updated_at=NOW()
     WHERE id=$1`,
    [instanceId, sha256(code), expiresAt]
  );
  return { code, expiresAt: expiresAt.toISOString() };
}

async function currentUser(db, request) {
  const session = request.cookies?.[SESSION_COOKIE];
  if (!session) return null;
  return (
    await db.query(
      `SELECT u.id, s.csrf_hash
       FROM sessions s JOIN platform_users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL
         AND s.expires_at>NOW() AND u.status='active'`,
      [sha256(session)]
    )
  ).rows[0] || null;
}

function setupPayload(username, setup) {
  return {
    code: setup.code,
    expiresAt: setup.expiresAt,
    telegramUrl: username ? `https://t.me/${username}?start=${encodeURIComponent(setup.code)}` : null,
    setupBotConfigured: Boolean(username)
  };
}

export function installAiBotPurchaseHandoff(app, { db, setupBotUsername = "" }) {
  const username = cleanUsername(setupBotUsername);

  app.post("/api/platform/ai-bots/:instanceId/setup-link", async (request, reply) => {
    const user = await currentUser(db, request);
    if (!user) return reply.code(401).send({ error: "authentication_required", message: "يجب تسجيل الدخول" });
    const csrf = String(request.headers["x-csrf-token"] || "");
    if (!csrf || sha256(csrf) !== user.csrf_hash) {
      return reply.code(403).send({ error: "csrf_failed", message: "تعذر التحقق من الطلب" });
    }
    const instance = (
      await db.query("SELECT id, setup_completed_at FROM ai_bot_instances WHERE id=$1 AND user_id=$2", [request.params.instanceId, user.id])
    ).rows[0];
    if (!instance) return reply.code(404).send({ error: "ai_bot_not_found", message: "البوت غير موجود" });
    if (instance.setup_completed_at) {
      return reply.code(409).send({ error: "already_setup", message: "تم إعداد هذا البوت مسبقًا. افتح البوت واستخدم /admin." });
    }
    const setup = await issueSetupCode(db, instance.id);
    return { setup: setupPayload(username, setup) };
  });

  app.addHook("preSerialization", async (request, _reply, payload) => {
    if (
      request.method !== "POST" ||
      pathOf(request) !== "/api/platform/ai-bots/purchase" ||
      !payload?.instanceId
    ) return payload;

    const setup = await issueSetupCode(db, payload.instanceId);
    return { ...payload, setup: setupPayload(username, setup) };
  });
}

export { issueSetupCode };
