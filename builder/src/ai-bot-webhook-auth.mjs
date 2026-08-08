import { timingSafeEqual } from "node:crypto";
import { sha256 } from "./security.mjs";

function requestPath(request) {
  return String(request.raw?.url || request.url || "").split("?")[0];
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function installAiBotWebhookAuthentication(app, { db }) {
  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;
    const match = /^\/webhooks\/ai-bots\/([0-9a-f-]+)$/i.exec(requestPath(request));
    if (!match) return;

    const secret = String(request.headers["x-telegram-bot-api-secret-token"] || "").trim();
    if (!secret) {
      return reply.code(403).send({ error: "invalid_webhook_secret", message: "Webhook secret غير صالح" });
    }
    const instance = (
      await db.query(
        `SELECT webhook_secret_hash
         FROM ai_bot_instances
         WHERE id=$1 AND status='active' AND token_ciphertext IS NOT NULL`,
        [match[1]]
      )
    ).rows[0];
    if (!instance?.webhook_secret_hash || !secureEqual(sha256(secret), instance.webhook_secret_hash)) {
      return reply.code(403).send({ error: "invalid_webhook_secret", message: "Webhook secret غير صالح" });
    }
    request.uchihaAiWebhookAuthenticated = true;
  });
}