import { decryptSecret } from "./security.mjs";

const FAKE_TOKEN_PATTERN = /^(\d{6,12}):([A-Za-z0-9_-]{20,})$/;

function formatMinorAmount(minor, currency) {
  let factor = 100;
  try {
    const digits = new Intl.NumberFormat("en", {
      style: "currency",
      currency
    }).resolvedOptions().maximumFractionDigits;
    factor = 10 ** digits;
  } catch {
    // Provider currencies are validated elsewhere; keep a safe two-digit fallback.
  }
  return new Intl.NumberFormat("ar", {
    style: "currency",
    currency
  }).format(Number(minor || 0) / factor);
}

export class TelegramGateway {
  constructor(config, logger = console) {
    this.config = config;
    this.logger = logger;
    this.mode = config.telegramMode;
  }

  async request(token, method, payload = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.description || `Telegram HTTP ${response.status}`);
      }
      return data.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async validateToken(token, purpose = "storefront") {
    if (this.mode === "fake") {
      const match = String(token).match(FAKE_TOKEN_PATTERN);
      if (!match) {
        throw new Error("Test token must match Telegram token shape");
      }
      return {
        id: match[1],
        isBot: true,
        username: purpose === "admin" ? `uchiha_admin_${match[1]}_bot` : `uchiha_store_${match[1]}_bot`,
        firstName: purpose === "admin" ? "UCHIHA Admin" : "UCHIHA Store"
      };
    }
    const result = await this.request(token, "getMe");
    if (!result?.is_bot || !result?.id || !result?.username) {
      throw new Error("Telegram token did not resolve to a valid bot");
    }
    return {
      id: String(result.id),
      isBot: Boolean(result.is_bot),
      username: result.username,
      firstName: result.first_name || ""
    };
  }

  async setWebhook(token, connectionId, secretToken) {
    if (this.mode === "fake") {
      return { ok: true, simulated: true };
    }
    const webhookUrl = `${this.config.appBaseUrl}/webhooks/telegram/${connectionId}`;
    await this.request(token, "setWebhook", {
      url: webhookUrl,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false
    });
    return { ok: true, url: webhookUrl };
  }

  async sendMessage(token, chatId, text, extra = {}) {
    if (this.mode === "fake") {
      return { message_id: 1, chat: { id: chatId }, text, simulated: true };
    }
    return this.request(token, "sendMessage", {
      chat_id: chatId,
      text,
      ...extra
    });
  }
}

export async function configureStoreWebhooks(db, storeId, config, logger = console) {
  const connections = await db.query(
    `SELECT * FROM bot_connections
     WHERE store_id = $1 AND purpose IN ('storefront', 'admin')
     ORDER BY purpose`,
    [storeId]
  );
  if (connections.rows.length !== 2) {
    throw new Error("Both storefront and admin bots are required");
  }
  const gateway = new TelegramGateway(config, logger);
  for (const connection of connections.rows) {
    const token = decryptSecret(connection.token_ciphertext, config.encryptionKey);
    const webhookSecret = decryptSecret(connection.webhook_secret_ciphertext, config.encryptionKey);
    await gateway.setWebhook(token, connection.id, webhookSecret);
    await db.query(
      `UPDATE bot_connections
       SET status = 'active', last_checked_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [connection.id]
    );
  }
  return connections.rows.map((connection) => ({
    id: connection.id,
    purpose: connection.purpose,
    username: connection.username
  }));
}

export async function handleTelegramUpdate(db, connection, update) {
  const message = update?.message || update?.callback_query?.message;
  const chatId = message?.chat?.id;
  const text = String(update?.message?.text || "").trim();
  if (!chatId) return null;

  if (connection.purpose === "storefront") {
    const storeResult = await db.query("SELECT name, slug, welcome_message FROM stores WHERE id = $1", [
      connection.store_id
    ]);
    const store = storeResult.rows[0];
    if (!store) return null;
    const products = await db.query(
      `SELECT name, price_minor, currency
       FROM products
       WHERE tenant_id = $1 AND store_id = $2 AND status = 'active'
       ORDER BY sort_order, created_at
       LIMIT 8`,
      [connection.tenant_id, connection.store_id]
    );
    if (text.startsWith("/start")) {
      return {
        chatId,
        text: `${store.welcome_message || `مرحبًا بك في ${store.name}`}\n\nلعرض المنتجات أرسل /catalog\nلفتح الموقع: ${store.slug}`
      };
    }
    const lines = products.rows.map(
      (product, index) =>
        `${index + 1}. ${product.name} — ${formatMinorAmount(product.price_minor, product.currency)}`
    );
    return {
      chatId,
      text: lines.length ? `منتجات ${store.name}:\n${lines.join("\n")}` : "لا توجد منتجات متاحة حاليًا."
    };
  }

  const stats = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM products WHERE tenant_id = $1 AND store_id = $2) AS products,
       (SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1 AND store_id = $2) AS orders,
       (SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1 AND store_id = $2 AND status = 'new') AS new_orders`,
    [connection.tenant_id, connection.store_id]
  );
  const row = stats.rows[0];
  return {
    chatId,
    text: `لوحة إدارة UCHIHA\nالمنتجات: ${row.products}\nالطلبات: ${row.orders}\nالطلبات الجديدة: ${row.new_orders}`
  };
}
