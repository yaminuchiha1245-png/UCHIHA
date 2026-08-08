import { randomBytes } from "node:crypto";
import { sha256 } from "./security.mjs";

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

export function installAiBotPurchaseHandoff(app, { db, setupBotUsername = "" }) {
  const username = cleanUsername(setupBotUsername);

  app.addHook("preSerialization", async (request, _reply, payload) => {
    if (
      request.method !== "POST" ||
      pathOf(request) !== "/api/platform/ai-bots/purchase" ||
      !payload?.instanceId
    ) return payload;

    const setup = await issueSetupCode(db, payload.instanceId);
    return {
      ...payload,
      setup: {
        code: setup.code,
        expiresAt: setup.expiresAt,
        telegramUrl: username ? `https://t.me/${username}?start=${encodeURIComponent(setup.code)}` : null,
        setupBotConfigured: Boolean(username)
      }
    };
  });
}

export { issueSetupCode };
