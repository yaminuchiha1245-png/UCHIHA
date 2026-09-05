import { randomUUID } from "node:crypto";
import { decryptSecret } from "./security.mjs";
import { reviewWalletTopupProof } from "./wallet-proof-admin.mjs";

const FAKE_TOKEN_PATTERN = /^(\d{6,12}):([A-Za-z0-9_-]{20,})$/;
const ADMIN_SESSION_MINUTES = 20;

function formatMinorAmount(minor, currency) {
  let factor = 100;
  try {
    const digits = new Intl.NumberFormat("en", {
      style: "currency",
      currency
    }).resolvedOptions().maximumFractionDigits;
    factor = 10 ** digits;
  } catch {
    // Provider/store currencies are validated elsewhere; keep a two-digit fallback.
  }
  return new Intl.NumberFormat("ar", {
    style: "currency",
    currency
  }).format(Number(minor || 0) / factor);
}

function currencyMinorFactor(currency) {
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    return 10 ** digits;
  } catch {
    return 100;
  }
}

function parseMajorAmount(value, currency) {
  const normalized = String(value || "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,8})?$/.test(normalized)) return null;
  const major = Number(normalized);
  if (!Number.isFinite(major) || major <= 0) return null;
  const minor = Math.round(major * currencyMinorFactor(currency));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

function jsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function shortId(value) {
  return String(value || "").slice(0, 8);
}

function orderStatusLabel(status) {
  return ({
    new: "جديد",
    awaiting_payment: "بانتظار الدفع",
    paid: "مدفوع",
    processing: "قيد التنفيذ",
    completed: "مكتمل",
    partial: "مكتمل جزئيًا",
    failed: "فشل",
    cancelled: "ملغي",
    requires_review: "يحتاج مراجعة"
  })[status] || status || "—";
}

function proofStatusLabel(status) {
  return ({ pending: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض", cancelled: "ملغي" })[status] || status || "—";
}

function styleAiKeyboard(payload) {
  const rows = payload?.reply_markup?.inline_keyboard;
  if (!Array.isArray(rows)) return payload;
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const button of row) {
      if (!button || typeof button !== "object" || button.style) continue;
      const callback = String(button.callback_data || "");
      const label = String(button.text || "");
      const isAiButton = callback.startsWith("ai:") || callback.startsWith("aiadm:") || /UCHIHA AI|PRO|النموذج/.test(label);
      if (!isAiButton) continue;

      // Telegram supports primary/success/danger button styles. PRO keeps its
      // star marker while free V1 uses the native primary treatment.
      if (label.startsWith("🔵") || (callback.startsWith("ai:model:") && label.includes("مجاني"))) {
        button.style = "primary";
      } else if (label.startsWith("⭐") && label.includes("PRO") && !label.startsWith("⭐ PRO")) {
        button.style = "success";
      } else if (/اشترك|تفعيل|حفظ/.test(label)) {
        button.style = "success";
      } else if (/حظر|حذف|إيقاف/.test(label)) {
        button.style = "danger";
      } else if (/البرمجة/.test(label)) {
        button.style = "primary";
      }
    }
  }
  return payload;
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
      const requestPayload = styleAiKeyboard(payload);
      const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestPayload),
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

  async requestMultipart(token, method, formData) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        body: formData,
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.description || `Telegram HTTP ${response.status}`);
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
    const structured = text && typeof text === "object" && !Array.isArray(text) ? { ...text } : null;
    const callbackQueryId = structured?.callbackQueryId || null;
    if (callbackQueryId && this.mode !== "fake") {
      try {
        await this.request(token, "answerCallbackQuery", { callback_query_id: callbackQueryId });
      } catch (error) {
        this.logger?.warn?.({ error }, "Telegram callback acknowledgement failed");
      }
    }

    if (structured?.photoDataUrl) {
      const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(structured.photoDataUrl);
      if (match) {
        const caption = String(structured.caption || structured.text || "").slice(0, 1000);
        if (this.mode === "fake") {
          return { message_id: 1, chat: { id: chatId }, caption, simulated: true, photo: true };
        }
        const bytes = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
        const extension = match[1].endsWith("png") ? "png" : match[1].endsWith("webp") ? "webp" : "jpg";
        const form = new FormData();
        form.append("chat_id", String(chatId));
        form.append("caption", caption);
        if (structured.reply_markup) form.append("reply_markup", JSON.stringify(structured.reply_markup));
        form.append("photo", new Blob([bytes], { type: match[1] }), `proof.${extension}`);
        return this.requestMultipart(token, "sendPhoto", form);
      }
    }

    const messageText = structured ? String(structured.text || "") : String(text || "");
    const messageExtra = structured ? { ...structured, ...extra } : extra;
    delete messageExtra.text;
    delete messageExtra.caption;
    delete messageExtra.photoDataUrl;
    delete messageExtra.callbackQueryId;
    if (this.mode === "fake") {
      return { message_id: 1, chat: { id: chatId }, text: messageText, simulated: true };
    }
    return this.request(token, "sendMessage", {
      chat_id: chatId,
      text: messageText,
      ...messageExtra
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

function adminButton(text, callbackData, style = undefined) {
  const result = { text, callback_data: callbackData };
  if (style) result.style = style;
  return result;
}

function adminKeyboard(rows) {
  return { inline_keyboard: rows };
}

function withCallback(update, payload) {
  if (!update?.callback_query?.id) return payload;
  return { ...payload, callbackQueryId: update.callback_query.id };
}

function adminHomeKeyboard() {
  return adminKeyboard([
    [adminButton("📊 نظرة عامة", "adm:overview", "primary")],
    [adminButton("🧾 الطلبات", "adm:orders"), adminButton("💳 إثباتات الدفع", "adm:proofs", "success")],
    [adminButton("👥 العملاء", "adm:customers"), adminButton("📦 المنتجات", "adm:products")],
    [adminButton("🗂 الأقسام", "adm:categories"), adminButton("💰 طرق الدفع", "adm:payments")],
    [adminButton("🔔 الإشعارات", "adm:notifications"), adminButton("⚙️ الإعدادات", "adm:settings")]
  ]);
}

function backHomeRow() {
  return [adminButton("↩️ القائمة الرئيسية", "adm:home")];
}

async function setAdminSession(db, connection, chatId, stateKey, stateData = {}, minutes = ADMIN_SESSION_MINUTES) {
  const expiresAt = new Date(Date.now() + minutes * 60_000);
  await db.transaction(async (client) => {
    await client.query(
      `INSERT INTO admin_bot_sessions (
         connection_id, tenant_id, store_id, chat_id, state_key, state_data, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (connection_id, chat_id) DO UPDATE SET
         state_key=EXCLUDED.state_key, state_data=EXCLUDED.state_data,
         expires_at=EXCLUDED.expires_at, updated_at=NOW()`,
      [connection.id, connection.tenant_id, connection.store_id, String(chatId), stateKey, JSON.stringify(stateData), expiresAt]
    );
  }, connection.tenant_id);
}

async function getAdminSession(db, connection, chatId) {
  return db.transaction(async (client) => {
    const row = (await client.query(
      `SELECT * FROM admin_bot_sessions
       WHERE connection_id=$1 AND tenant_id=$2 AND store_id=$3 AND chat_id=$4`,
      [connection.id, connection.tenant_id, connection.store_id, String(chatId)]
    )).rows[0];
    if (!row) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await client.query("DELETE FROM admin_bot_sessions WHERE connection_id=$1 AND chat_id=$2", [connection.id, String(chatId)]);
      return null;
    }
    return { key: row.state_key, data: jsonObject(row.state_data, {}) };
  }, connection.tenant_id);
}

async function clearAdminSession(db, connection, chatId) {
  await db.transaction(async (client) => {
    await client.query("DELETE FROM admin_bot_sessions WHERE connection_id=$1 AND chat_id=$2", [connection.id, String(chatId)]);
  }, connection.tenant_id);
}

async function adminStore(db, connection) {
  return (await db.query(
    "SELECT id, tenant_id, name, slug, status, currency, contact_data FROM stores WHERE id=$1 AND tenant_id=$2",
    [connection.store_id, connection.tenant_id]
  )).rows[0];
}

function adminOwnerAllowed(store, message) {
  const ownerId = jsonObject(store?.contact_data, {}).telegramOwnerId;
  if (!ownerId) return { ok: false, reason: "لم يتم ربط معرف مالك المتجر بعد. افتح لوحة الويب > بوتات تيليجرام وأدخل معرف المالك." };
  if (String(ownerId) !== String(message?.chat?.id || "")) return { ok: false, reason: "هذا البوت مخصص لمالك المتجر فقط." };
  if (message?.chat?.type && message.chat.type !== "private") return { ok: false, reason: "استخدم بوت الإدارة في محادثة خاصة فقط." };
  return { ok: true };
}

async function adminOverview(db, connection, store, update) {
  const counts = (await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM products WHERE tenant_id=$1 AND store_id=$2) AS products,
       (SELECT COUNT(*)::int FROM categories WHERE tenant_id=$1 AND store_id=$2) AS categories,
       (SELECT COUNT(*)::int FROM orders WHERE tenant_id=$1 AND store_id=$2) AS orders,
       (SELECT COUNT(*)::int FROM orders WHERE tenant_id=$1 AND store_id=$2 AND status IN ('new','awaiting_payment','requires_review')) AS attention_orders,
       (SELECT COUNT(*)::int FROM store_customers WHERE tenant_id=$1 AND store_id=$2 AND status='active') AS customers,
       (SELECT COUNT(*)::int FROM payment_methods WHERE tenant_id=$1 AND store_id=$2 AND status='active') AS payment_methods,
       (SELECT COUNT(*)::int FROM wallet_topup_proofs WHERE tenant_id=$1 AND store_id=$2 AND status='pending') AS pending_proofs,
       (SELECT COUNT(*)::int FROM store_admin_notifications WHERE tenant_id=$1 AND store_id=$2 AND read_at IS NULL) AS unread_notifications`,
    [connection.tenant_id, connection.store_id]
  )).rows[0];
  return withCallback(update, {
    text: `📊 لوحة إدارة ${store.name}\n\n` +
      `📦 المنتجات: ${counts.products}\n` +
      `🗂 الأقسام: ${counts.categories}\n` +
      `🧾 الطلبات: ${counts.orders}\n` +
      `⚠️ تحتاج متابعة: ${counts.attention_orders}\n` +
      `👥 العملاء: ${counts.customers}\n` +
      `💳 إثباتات بانتظارك: ${counts.pending_proofs}\n` +
      `💰 طرق الدفع النشطة: ${counts.payment_methods}\n` +
      `🔔 إشعارات غير مقروءة: ${counts.unread_notifications}\n\n` +
      `الحالة: ${store.status}`,
    reply_markup: adminHomeKeyboard()
  });
}

async function adminOrders(db, connection, update) {
  const rows = (await db.query(
    `SELECT id, order_number, customer_name, status, payment_status, total_minor, currency, created_at
     FROM orders WHERE tenant_id=$1 AND store_id=$2
     ORDER BY created_at DESC LIMIT 8`,
    [connection.tenant_id, connection.store_id]
  )).rows;
  const lines = rows.length ? rows.map((row) =>
    `• ${row.order_number} — ${row.customer_name}\n  ${formatMinorAmount(row.total_minor, row.currency)} • ${orderStatusLabel(row.status)}`
  ).join("\n\n") : "لا توجد طلبات حتى الآن.";
  const buttons = rows.slice(0, 6).map((row) => [adminButton(`فتح ${row.order_number}`, `adm:order:${row.id}`)]);
  buttons.push(backHomeRow());
  return withCallback(update, { text: `🧾 آخر الطلبات\n\n${lines}`, reply_markup: adminKeyboard(buttons) });
}

async function adminOrderDetail(db, connection, orderId, update) {
  const row = (await db.query(
    `SELECT o.*, c.display_name AS account_name, c.email AS account_email
     FROM orders o LEFT JOIN store_customers c ON c.id=o.customer_id
     WHERE o.id=$1 AND o.tenant_id=$2 AND o.store_id=$3`,
    [orderId, connection.tenant_id, connection.store_id]
  )).rows[0];
  if (!row) return withCallback(update, { text: "الطلب غير موجود.", reply_markup: adminKeyboard([backHomeRow()]) });
  return withCallback(update, {
    text: `🧾 تفاصيل الطلب\n\n` +
      `الرقم: ${row.order_number}\n` +
      `العميل: ${row.customer_name}\n` +
      `الحساب: ${row.account_email || "—"}\n` +
      `المبلغ: ${formatMinorAmount(row.total_minor, row.currency)}\n` +
      `الحالة: ${orderStatusLabel(row.status)}\n` +
      `الدفع: ${row.payment_status}\n` +
      `القناة: ${row.channel}\n\n` +
      `تغيير الحالات المالية الحساسة يبقى عبر مسار الإدارة الموثق حتى لا يتم تجاوز تنفيذ المزود أو الاسترداد.`,
    reply_markup: adminKeyboard([[adminButton("↩️ الطلبات", "adm:orders")], backHomeRow()])
  });
}

async function proofRows(db, connection, status = "pending", limit = 8) {
  return db.transaction(async (client) => {
    return (await client.query(
      `SELECT p.*, pm.name AS method_name, pm.method_type,
              c.display_name AS customer_name, c.email AS customer_email
       FROM wallet_topup_proofs p
       JOIN payment_methods pm ON pm.id=p.payment_method_id
       JOIN store_customers c ON c.id=p.customer_id
       WHERE p.tenant_id=$1 AND p.store_id=$2 AND p.status=$3
       ORDER BY p.created_at DESC LIMIT $4`,
      [connection.tenant_id, connection.store_id, status, limit]
    )).rows;
  }, connection.tenant_id);
}

async function adminProofs(db, connection, update) {
  const rows = await proofRows(db, connection);
  const lines = rows.length ? rows.map((row) =>
    `• #${shortId(row.id)} — ${row.customer_name}\n  ${row.method_name} • ${row.reference_text ? `مرجع: ${row.reference_text}` : "صورة إيصال"}`
  ).join("\n\n") : "لا توجد إثباتات بانتظار المراجعة.";
  const buttons = rows.map((row) => [adminButton(`💳 ${shortId(row.id)} • ${row.customer_name}`, `adm:proof:${row.id}`)]);
  buttons.push([adminButton("✅ المقبولة", "adm:proofs:approved"), adminButton("❌ المرفوضة", "adm:proofs:rejected")]);
  buttons.push(backHomeRow());
  return withCallback(update, { text: `💳 إثباتات التحويل\n\n${lines}`, reply_markup: adminKeyboard(buttons) });
}

async function adminProofHistory(db, connection, status, update) {
  const rows = await proofRows(db, connection, status, 10);
  const lines = rows.length ? rows.map((row) =>
    `• #${shortId(row.id)} — ${row.customer_name} • ${proofStatusLabel(row.status)}${row.credited_amount_minor ? ` • ${formatMinorAmount(row.credited_amount_minor, row.currency)}` : ""}`
  ).join("\n") : "لا توجد نتائج.";
  return withCallback(update, {
    text: `${status === "approved" ? "✅ الإثباتات المقبولة" : "❌ الإثباتات المرفوضة"}\n\n${lines}`,
    reply_markup: adminKeyboard([[adminButton("↩️ إثباتات الدفع", "adm:proofs")], backHomeRow()])
  });
}

async function adminProofDetail(db, connection, proofId, update) {
  const row = await db.transaction(async (client) => (await client.query(
    `SELECT p.*, pm.name AS method_name, pm.method_type,
            c.display_name AS customer_name, c.email AS customer_email
     FROM wallet_topup_proofs p
     JOIN payment_methods pm ON pm.id=p.payment_method_id
     JOIN store_customers c ON c.id=p.customer_id
     WHERE p.id=$1 AND p.tenant_id=$2 AND p.store_id=$3`,
    [proofId, connection.tenant_id, connection.store_id]
  )).rows[0], connection.tenant_id);
  if (!row) return withCallback(update, { text: "إثبات التحويل غير موجود.", reply_markup: adminKeyboard([backHomeRow()]) });
  const detail = `💳 إثبات #${shortId(row.id)}\n\n` +
    `العميل: ${row.customer_name}\n` +
    `البريد: ${row.customer_email}\n` +
    `الطريقة: ${row.method_name}\n` +
    `المرجع: ${row.reference_text || "—"}\n` +
    `الصورة: ${row.proof_data ? "مرفقة" : "غير مرفقة"}\n` +
    `الحالة: ${proofStatusLabel(row.status)}\n` +
    `${row.credited_amount_minor ? `المبلغ المعتمد: ${formatMinorAmount(row.credited_amount_minor, row.currency)}\n` : ""}`;
  const rows = [];
  if (row.status === "pending") {
    rows.push([
      adminButton("✅ اعتماد وإدخال المبلغ", `adm:proof:approve:${row.id}`, "success"),
      adminButton("❌ رفض", `adm:proof:reject:${row.id}`, "danger")
    ]);
  }
  rows.push([adminButton("↩️ إثباتات الدفع", "adm:proofs")]);
  rows.push(backHomeRow());
  const payload = withCallback(update, { text: detail, reply_markup: adminKeyboard(rows) });
  if (row.proof_data && row.proof_mime) {
    payload.photoDataUrl = `data:${row.proof_mime};base64,${row.proof_data}`;
    payload.caption = detail;
  }
  return payload;
}

async function adminCustomers(db, connection, update) {
  const rows = (await db.query(
    `SELECT c.id, c.display_name, c.email, c.status, w.balance_minor, w.currency
     FROM store_customers c JOIN customer_wallets w ON w.customer_id=c.id
     WHERE c.tenant_id=$1 AND c.store_id=$2
     ORDER BY c.created_at DESC LIMIT 10`,
    [connection.tenant_id, connection.store_id]
  )).rows;
  const lines = rows.length ? rows.map((row) =>
    `• ${row.display_name}\n  ${row.email}\n  ${formatMinorAmount(row.balance_minor, row.currency)} • ${row.status}`
  ).join("\n\n") : "لا يوجد عملاء بعد.";
  return withCallback(update, { text: `👥 العملاء\n\n${lines}`, reply_markup: adminKeyboard([backHomeRow()]) });
}

async function adminProducts(db, connection, update) {
  const rows = (await db.query(
    `SELECT id, name, price_minor, currency, status
     FROM products WHERE tenant_id=$1 AND store_id=$2
     ORDER BY updated_at DESC, created_at DESC LIMIT 10`,
    [connection.tenant_id, connection.store_id]
  )).rows;
  const lines = rows.length ? rows.map((row) =>
    `• ${row.name} — ${formatMinorAmount(row.price_minor, row.currency)} • ${row.status}`
  ).join("\n") : "لا توجد منتجات بعد.";
  const buttons = rows.slice(0, 8).map((row) => [adminButton(`📦 ${row.name.slice(0, 28)}`, `adm:product:${row.id}`)]);
  buttons.push(backHomeRow());
  return withCallback(update, { text: `📦 المنتجات\n\n${lines}`, reply_markup: adminKeyboard(buttons) });
}

async function adminProductDetail(db, connection, productId, update) {
  const row = (await db.query(
    `SELECT id, name, description, product_type, price_minor, currency, status, stock_quantity
     FROM products WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
    [productId, connection.tenant_id, connection.store_id]
  )).rows[0];
  if (!row) return withCallback(update, { text: "المنتج غير موجود.", reply_markup: adminKeyboard([backHomeRow()]) });
  const toggleLabel = row.status === "active" ? "🙈 إخفاء المنتج" : "👁 إظهار المنتج";
  return withCallback(update, {
    text: `📦 ${row.name}\n\n` +
      `السعر: ${formatMinorAmount(row.price_minor, row.currency)}\n` +
      `النوع: ${row.product_type}\n` +
      `الحالة: ${row.status}\n` +
      `المخزون: ${row.stock_quantity ?? "غير محدود"}\n\n` +
      `${String(row.description || "").slice(0, 500)}`,
    reply_markup: adminKeyboard([
      [adminButton("💵 تعديل السعر", `adm:product:price:${row.id}`, "primary"), adminButton(toggleLabel, `adm:product:toggle:${row.id}`)],
      [adminButton("↩️ المنتجات", "adm:products")],
      backHomeRow()
    ])
  });
}

async function adminCategories(db, connection, update) {
  const rows = (await db.query(
    `SELECT c.id, c.name, c.status, c.parent_id,
            (SELECT COUNT(*)::int FROM products p WHERE p.tenant_id=c.tenant_id AND p.store_id=c.store_id AND p.category_id=c.id) AS products
     FROM categories c WHERE c.tenant_id=$1 AND c.store_id=$2
     ORDER BY c.parent_id NULLS FIRST, c.sort_order, c.created_at LIMIT 30`,
    [connection.tenant_id, connection.store_id]
  )).rows;
  const byId = new Map(rows.map((row) => [row.id, row.name]));
  const lines = rows.length ? rows.map((row) =>
    `• ${row.parent_id ? `${byId.get(row.parent_id) || "قسم"} / ` : ""}${row.name} — ${row.products} منتج • ${row.status}`
  ).join("\n") : "لا توجد أقسام بعد.";
  return withCallback(update, { text: `🗂 الأقسام\n\n${lines}`, reply_markup: adminKeyboard([backHomeRow()]) });
}

function paymentTypeLabel(type) {
  return ({
    sham_cash: "شام كاش",
    binance_pay: "Binance Pay",
    usdt_trc20: "USDT",
    bank_transfer: "تحويل بنكي",
    manual: "طريقة يدوية"
  })[type] || type;
}

function paymentLogo(type) {
  return ({
    sham_cash: "/assets/payment-assets/sham-cash.svg",
    binance_pay: "/assets/payment-assets/binance-pay.svg",
    usdt_trc20: "/assets/payment-assets/usdt.svg",
    bank_transfer: "/assets/payment-assets/bank-transfer.svg",
    manual: "/assets/payment-assets/manual-payment.svg"
  })[type] || "/assets/payment-assets/manual-payment.svg";
}

function paymentNetwork(type) {
  return ({ sham_cash: "Sham Cash", binance_pay: "Binance Pay", usdt_trc20: "TRC20" })[type] || null;
}

async function adminPayments(db, connection, update) {
  const rows = (await db.query(
    `SELECT id, name, method_type, status, customer_visible, network
     FROM payment_methods WHERE tenant_id=$1 AND store_id=$2
     ORDER BY sort_order, created_at`,
    [connection.tenant_id, connection.store_id]
  )).rows;
  const lines = rows.length ? rows.map((row) =>
    `• ${row.name} — ${paymentTypeLabel(row.method_type)} • ${row.customer_visible && row.status === "active" ? "ظاهر" : "مخفي"}`
  ).join("\n") : "لا توجد طرق دفع بعد.";
  const buttons = rows.slice(0, 10).map((row) => [
    adminButton(`${row.customer_visible ? "🙈 إخفاء" : "👁 إظهار"} ${row.name.slice(0, 22)}`, `adm:payment:toggle:${row.id}`)
  ]);
  buttons.push([adminButton("➕ إضافة طريقة دفع", "adm:payment:add", "success")]);
  buttons.push(backHomeRow());
  return withCallback(update, { text: `💰 طرق الدفع\n\n${lines}`, reply_markup: adminKeyboard(buttons) });
}

async function adminNotifications(db, connection, update) {
  const rows = (await db.query(
    `SELECT id, title, message, notification_type, read_at, created_at
     FROM store_admin_notifications
     WHERE tenant_id=$1 AND store_id=$2
     ORDER BY created_at DESC LIMIT 10`,
    [connection.tenant_id, connection.store_id]
  )).rows;
  const lines = rows.length ? rows.map((row) =>
    `${row.read_at ? "▫️" : "🔴"} ${row.title}\n${String(row.message || "").slice(0, 180)}`
  ).join("\n\n") : "لا توجد إشعارات بعد.";
  return withCallback(update, {
    text: `🔔 الإشعارات\n\n${lines}`,
    reply_markup: adminKeyboard([[adminButton("✓ تعليم الكل كمقروء", "adm:notifications:read", "success")], backHomeRow()])
  });
}

async function adminSettings(db, connection, store, update) {
  const bots = (await db.query(
    `SELECT purpose, username, status FROM bot_connections
     WHERE tenant_id=$1 AND store_id=$2 ORDER BY purpose`,
    [connection.tenant_id, connection.store_id]
  )).rows;
  return withCallback(update, {
    text: `⚙️ إعدادات المتجر\n\n` +
      `الاسم: ${store.name}\n` +
      `الرابط: ${store.slug}\n` +
      `العملة: ${store.currency}\n` +
      `الحالة: ${store.status}\n\n` +
      `${bots.map((bot) => `${bot.purpose === "admin" ? "بوت الإدارة" : "بوت المتجر"}: @${bot.username} • ${bot.status}`).join("\n")}`,
    reply_markup: adminKeyboard([backHomeRow()])
  });
}

async function processAdminSession(db, connection, store, chatId, text, session, update) {
  if (session.key === "proof_credit") {
    const proof = await db.transaction(async (client) => (await client.query(
      `SELECT id, currency FROM wallet_topup_proofs
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3 AND status='pending'`,
      [session.data.proofId, connection.tenant_id, connection.store_id]
    )).rows[0], connection.tenant_id);
    if (!proof) {
      await clearAdminSession(db, connection, chatId);
      return withCallback(update, { text: "الإثبات لم يعد بانتظار المراجعة.", reply_markup: adminHomeKeyboard() });
    }
    const amountMinor = parseMajorAmount(text, proof.currency || store.currency);
    if (!amountMinor) {
      return withCallback(update, { text: `أرسل المبلغ كرقم فقط. مثال: 25.50\nالعملة: ${proof.currency || store.currency}\n\nأرسل /cancel للإلغاء.` });
    }
    const owner = (await db.query(
      `SELECT user_id FROM tenant_memberships
       WHERE tenant_id=$1 AND status='active' AND role_key='owner' ORDER BY created_at LIMIT 1`,
      [connection.tenant_id]
    )).rows[0];
    const result = await reviewWalletTopupProof(db, {
      storeId: connection.store_id,
      tenantId: connection.tenant_id,
      proofId: proof.id,
      decision: "approve",
      creditAmountMinor: amountMinor,
      actorUserId: owner?.user_id || null,
      actorLabel: `telegram:${chatId}`
    });
    await clearAdminSession(db, connection, chatId);
    return withCallback(update, {
      text: `✅ تم اعتماد الإثبات #${shortId(result.id)} وإضافة ${formatMinorAmount(amountMinor, proof.currency || store.currency)} إلى محفظة العميل.`,
      reply_markup: adminKeyboard([[adminButton("💳 الإثباتات", "adm:proofs")], backHomeRow()])
    });
  }

  if (session.key === "product_price") {
    const product = (await db.query(
      `SELECT id, name, currency FROM products
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      [session.data.productId, connection.tenant_id, connection.store_id]
    )).rows[0];
    if (!product) {
      await clearAdminSession(db, connection, chatId);
      return { text: "المنتج غير موجود.", reply_markup: adminHomeKeyboard() };
    }
    const amountMinor = parseMajorAmount(text, product.currency);
    if (!amountMinor) return { text: `أرسل السعر كرقم فقط بعملة ${product.currency}. مثال: 12.50\nأرسل /cancel للإلغاء.` };
    await db.query(
      `UPDATE products SET price_minor=$1, updated_at=NOW()
       WHERE id=$2 AND tenant_id=$3 AND store_id=$4`,
      [amountMinor, product.id, connection.tenant_id, connection.store_id]
    );
    await clearAdminSession(db, connection, chatId);
    return {
      text: `✅ تم تحديث سعر ${product.name} إلى ${formatMinorAmount(amountMinor, product.currency)}.`,
      reply_markup: adminKeyboard([[adminButton("📦 المنتجات", "adm:products")], backHomeRow()])
    };
  }

  if (session.key === "payment_method_name") {
    const name = String(text || "").trim().slice(0, 120);
    if (name.length < 2) return { text: "أرسل اسمًا واضحًا لطريقة الدفع، أو /cancel للإلغاء." };
    await setAdminSession(db, connection, chatId, "payment_method_destination", { type: session.data.type, name });
    return { text: `الاسم: ${name}\n\nالآن أرسل عنوان التحويل أو رقم الحساب/المحفظة كما تريد أن يراه العميل.\nأرسل /cancel للإلغاء.` };
  }

  if (session.key === "payment_method_destination") {
    const destination = String(text || "").trim().slice(0, 500);
    if (destination.length < 2) return { text: "أرسل عنوانًا أو رقم حساب صالحًا، أو /cancel للإلغاء." };
    const type = session.data.type;
    const name = session.data.name;
    const id = randomUUID();
    await db.query(
      `INSERT INTO payment_methods (
         id, tenant_id, store_id, name, method_type, instructions, destination_data,
         commission_bps, fixed_fee_minor, minimum_amount_minor, maximum_amount_minor,
         sort_order, status, currency, logo_url, network, customer_visible
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,0,NULL,100,'active',$8,$9,$10,TRUE)`,
      [
        id, connection.tenant_id, connection.store_id, name, type,
        "حوّل إلى البيانات الموضحة ثم أرسل رقم العملية أو صورة الإيصال.",
        JSON.stringify({ value: destination }), store.currency, paymentLogo(type), paymentNetwork(type)
      ]
    );
    await clearAdminSession(db, connection, chatId);
    return {
      text: `✅ تمت إضافة ${name} وأصبحت ظاهرة للعملاء.\nيمكنك إخفاؤها أو إظهارها من قائمة طرق الدفع في أي وقت.`,
      reply_markup: adminKeyboard([[adminButton("💰 طرق الدفع", "adm:payments")], backHomeRow()])
    };
  }

  return null;
}

async function handleAdminCallback(db, connection, store, chatId, data, update) {
  if (data === "adm:home") return withCallback(update, { text: `لوحة إدارة ${store.name}\nاختر القسم الذي تريد إدارته.`, reply_markup: adminHomeKeyboard() });
  if (data === "adm:overview") return adminOverview(db, connection, store, update);
  if (data === "adm:orders") return adminOrders(db, connection, update);
  if (data.startsWith("adm:order:")) return adminOrderDetail(db, connection, data.slice("adm:order:".length), update);
  if (data === "adm:proofs") return adminProofs(db, connection, update);
  if (data === "adm:proofs:approved") return adminProofHistory(db, connection, "approved", update);
  if (data === "adm:proofs:rejected") return adminProofHistory(db, connection, "rejected", update);
  if (data.startsWith("adm:proof:approve:")) {
    const proofId = data.slice("adm:proof:approve:".length);
    await setAdminSession(db, connection, chatId, "proof_credit", { proofId });
    return withCallback(update, {
      text: `✅ اعتماد الإثبات #${shortId(proofId)}\n\nأرسل الآن المبلغ الذي وصل إليك فعليًا كرقم فقط، وسيتم إضافته إلى محفظة العميل بعد هذه الرسالة.\nمثال: 25.50\n\nأرسل /cancel للإلغاء.`,
      reply_markup: adminKeyboard([[adminButton("إلغاء", "adm:proofs", "danger")]])
    });
  }
  if (data.startsWith("adm:proof:reject:")) {
    const proofId = data.slice("adm:proof:reject:".length);
    const owner = (await db.query(
      `SELECT user_id FROM tenant_memberships
       WHERE tenant_id=$1 AND status='active' AND role_key='owner' ORDER BY created_at LIMIT 1`,
      [connection.tenant_id]
    )).rows[0];
    const result = await reviewWalletTopupProof(db, {
      storeId: connection.store_id,
      tenantId: connection.tenant_id,
      proofId,
      decision: "reject",
      reason: "مرفوض من بوت الإدارة",
      actorUserId: owner?.user_id || null,
      actorLabel: `telegram:${chatId}`
    });
    return withCallback(update, {
      text: `❌ تم رفض الإثبات #${shortId(result.id)} ولم تتم إضافة أي رصيد.`,
      reply_markup: adminKeyboard([[adminButton("💳 الإثباتات", "adm:proofs")], backHomeRow()])
    });
  }
  if (data.startsWith("adm:proof:")) return adminProofDetail(db, connection, data.slice("adm:proof:".length), update);
  if (data === "adm:customers") return adminCustomers(db, connection, update);
  if (data === "adm:products") return adminProducts(db, connection, update);
  if (data.startsWith("adm:product:price:")) {
    const productId = data.slice("adm:product:price:".length);
    const product = (await db.query(
      `SELECT name, currency FROM products WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      [productId, connection.tenant_id, connection.store_id]
    )).rows[0];
    if (!product) return withCallback(update, { text: "المنتج غير موجود.", reply_markup: adminHomeKeyboard() });
    await setAdminSession(db, connection, chatId, "product_price", { productId });
    return withCallback(update, { text: `💵 تعديل سعر ${product.name}\n\nأرسل السعر الجديد كرقم فقط بعملة ${product.currency}.\nمثال: 12.50\n\nأرسل /cancel للإلغاء.` });
  }
  if (data.startsWith("adm:product:toggle:")) {
    const productId = data.slice("adm:product:toggle:".length);
    const product = (await db.query(
      `SELECT id, name, status FROM products WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      [productId, connection.tenant_id, connection.store_id]
    )).rows[0];
    if (!product) return withCallback(update, { text: "المنتج غير موجود.", reply_markup: adminHomeKeyboard() });
    const nextStatus = product.status === "active" ? "hidden" : "active";
    await db.query(
      "UPDATE products SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND store_id=$4",
      [nextStatus, product.id, connection.tenant_id, connection.store_id]
    );
    return adminProductDetail(db, connection, product.id, update);
  }
  if (data.startsWith("adm:product:")) return adminProductDetail(db, connection, data.slice("adm:product:".length), update);
  if (data === "adm:categories") return adminCategories(db, connection, update);
  if (data === "adm:payments") return adminPayments(db, connection, update);
  if (data === "adm:payment:add") {
    return withCallback(update, {
      text: "➕ اختر نوع طريقة الدفع التي تريد إضافتها:",
      reply_markup: adminKeyboard([
        [adminButton("شام كاش", "adm:payment:type:sham_cash"), adminButton("Binance Pay", "adm:payment:type:binance_pay")],
        [adminButton("USDT TRC20", "adm:payment:type:usdt_trc20"), adminButton("تحويل بنكي", "adm:payment:type:bank_transfer")],
        [adminButton("طريقة يدوية", "adm:payment:type:manual")],
        [adminButton("↩️ طرق الدفع", "adm:payments")]
      ])
    });
  }
  if (data.startsWith("adm:payment:type:")) {
    const type = data.slice("adm:payment:type:".length);
    if (!["sham_cash", "binance_pay", "usdt_trc20", "bank_transfer", "manual"].includes(type)) {
      return withCallback(update, { text: "نوع طريقة الدفع غير صالح.", reply_markup: adminHomeKeyboard() });
    }
    await setAdminSession(db, connection, chatId, "payment_method_name", { type });
    return withCallback(update, { text: `النوع: ${paymentTypeLabel(type)}\n\nأرسل الآن اسم طريقة الدفع كما تريد أن يظهر للعميل.\nأرسل /cancel للإلغاء.` });
  }
  if (data.startsWith("adm:payment:toggle:")) {
    const id = data.slice("adm:payment:toggle:".length);
    const method = (await db.query(
      `SELECT id, customer_visible FROM payment_methods
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      [id, connection.tenant_id, connection.store_id]
    )).rows[0];
    if (!method) return withCallback(update, { text: "طريقة الدفع غير موجودة.", reply_markup: adminHomeKeyboard() });
    await db.query(
      `UPDATE payment_methods SET customer_visible=$1, status=CASE WHEN $1 THEN 'active' ELSE status END, updated_at=NOW()
       WHERE id=$2 AND tenant_id=$3 AND store_id=$4`,
      [!method.customer_visible, method.id, connection.tenant_id, connection.store_id]
    );
    return adminPayments(db, connection, update);
  }
  if (data === "adm:notifications") return adminNotifications(db, connection, update);
  if (data === "adm:notifications:read") {
    await db.query(
      `UPDATE store_admin_notifications SET read_at=COALESCE(read_at,NOW())
       WHERE tenant_id=$1 AND store_id=$2`,
      [connection.tenant_id, connection.store_id]
    );
    return adminNotifications(db, connection, update);
  }
  if (data === "adm:settings") return adminSettings(db, connection, store, update);
  return withCallback(update, { text: "هذا الخيار غير متاح حاليًا.", reply_markup: adminHomeKeyboard() });
}

export async function handleTelegramUpdate(db, connection, update) {
  const message = update?.message || update?.callback_query?.message;
  const chatId = message?.chat?.id;
  const text = String(update?.message?.text || "").trim();
  const callbackData = String(update?.callback_query?.data || "").trim();
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

  const store = await adminStore(db, connection);
  if (!store) return null;
  const access = adminOwnerAllowed(store, message);
  if (!access.ok) {
    return { chatId, text: withCallback(update, { text: access.reason }) };
  }

  if (text === "/cancel") {
    await clearAdminSession(db, connection, chatId);
    return { chatId, text: { text: "تم إلغاء العملية الحالية.", reply_markup: adminHomeKeyboard() } };
  }

  if (callbackData) {
    if (callbackData === "adm:proofs" || callbackData === "adm:payments" || callbackData === "adm:products" || callbackData === "adm:home") {
      await clearAdminSession(db, connection, chatId);
    }
    const payload = await handleAdminCallback(db, connection, store, chatId, callbackData, update);
    return { chatId, text: payload };
  }

  const session = await getAdminSession(db, connection, chatId);
  if (session && text && !text.startsWith("/")) {
    const payload = await processAdminSession(db, connection, store, chatId, text, session, update);
    if (payload) return { chatId, text: payload };
  }

  if (text.startsWith("/start") || text === "/admin" || text === "/menu" || !text) {
    return {
      chatId,
      text: {
        text: `لوحة إدارة ${store.name}\n\nكل العمليات هنا مرتبطة بنفس قاعدة بيانات المتجر. اختر القسم الذي تريد إدارته:`,
        reply_markup: adminHomeKeyboard()
      }
    };
  }

  return {
    chatId,
    text: {
      text: "استخدم القائمة لإدارة المتجر، أو أرسل /admin لإظهارها من جديد.",
      reply_markup: adminHomeKeyboard()
    }
  };
}
