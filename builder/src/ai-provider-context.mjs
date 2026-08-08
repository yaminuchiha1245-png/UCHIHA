import { AsyncLocalStorage } from "node:async_hooks";
import { timingSafeEqual } from "node:crypto";
import { decryptSecret, sha256 } from "./security.mjs";

const requestContext = new AsyncLocalStorage();

function requestPath(request) {
  return String(request.raw?.url || request.url || "").split("?")[0];
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function createPerBotAiConfig(baseConfig, { db, encryptionKey }) {
  const config = { ...baseConfig };
  const centralKey = String(baseConfig.openAiApiKey || "").trim();

  Object.defineProperty(config, "openAiApiKey", {
    enumerable: true,
    configurable: false,
    get() {
      const context = requestContext.getStore();
      if (context?.isBotWebhook) return context.openAiApiKey || "";
      if (context?.purchaseOnly) return centralKey || "purchase-does-not-require-openai";
      return centralKey;
    }
  });

  function install(app) {
    app.addHook("onRequest", (request, _reply, done) => {
      const path = requestPath(request);
      requestContext.run(
        {
          path,
          isBotWebhook: /^\/webhooks\/ai-bots\/[0-9a-f-]+$/i.test(path),
          purchaseOnly: request.method === "POST" && path === "/api/platform/ai-bots/purchase",
          openAiApiKey: ""
        },
        done
      );
    });

    app.addHook("preHandler", async (request) => {
      const context = requestContext.getStore();
      if (!context?.isBotWebhook) return;
      const match = /^\/webhooks\/ai-bots\/([0-9a-f-]+)$/i.exec(context.path);
      if (!match) return;
      const row = (
        await db.query(
          `SELECT openai_api_key_ciphertext, webhook_secret_hash
           FROM ai_bot_instances
           WHERE id=$1 AND status='active'`,
          [match[1]]
        )
      ).rows[0];
      const incoming = String(request.headers["x-telegram-bot-api-secret-token"] || "");
      if (!row?.webhook_secret_hash || !secureEqual(sha256(incoming), row.webhook_secret_hash)) return;
      if (!row.openai_api_key_ciphertext) return;
      context.openAiApiKey = decryptSecret(row.openai_api_key_ciphertext, encryptionKey);
    });
  }

  return { config, install };
}
