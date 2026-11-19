import { decryptSecret, safeText, sha256 } from "./security.mjs";
import { TelegramGateway } from "./telegram.mjs";

const PREFIX = "adm8:";
const SESSION_MINUTES = 15;

function objectValue(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function button(text, callbackData, style = undefined) {
  const item = { text, callback_data: callbackData };
  if (style) item.style = style;
  return item;
}

function keyboard(rows) {
  return { inline_keyboard: rows };
}

function homeRow() {
  return [button("↩️ القائمة الرئيسية", "adm:home")];
}

function payload(update, text, rows = null) {
  const result = { text };
  if (rows) result.reply_markup = keyboard(rows);
  if (update?.callback_query?.id) result.callbackQueryId = update.callback_query.id;
  return result;
}

function factor(currency) {
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    return 10 ** digits;
  } catch {
    return 100;
  }
}

function amountText(minor, currency) {
  try {
    return new Intl.NumberFormat("ar", { style: "currency", currency }).format(Number(minor || 0) / factor(currency));
  } catch {
    return `${Number(minor || 0) / factor(currency)} ${currency || ""}`.trim();
  }
}

function orderStatus(status) {
  return ({
    new: "جديد",
    awaiting_payment: "بانتظار الدفع",
    paid: "مدفوع",
    processing: "قيد التنفيذ",
    completed: "مكتمل",
    partial: "جزئي",
    failed: "فشل",
    cancelled: "ملغي",
    requires_review: "يحتاج مراجعة"
  })[status] || status || "—";
}

async function storeRow(db, connection) {
  return (
    await db.query(
      "SELECT id, tenant_id, name, currency, contact_data FROM stores WHERE id=$1 AND tenant_id=$2",
      [connection.store_id, connection.tenant_id]
    )
  ).rows[0];
}

async function sessionGet(db, connection, chatId) {
  return db.transaction(async (client) => {
    const row = (
      await client.query(
        `SELECT * FROM admin_bot_sessions
         WHERE connection_id=$1 AND tenant_id=$2 AND store_id=$3 AND chat_id=$4`,
        [connection.id, connection.tenant_id, connection.store_id, String(chatId)]
      )
    ).rows[0];
    if (!row) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await client.query("DELETE FROM admin_bot_sessions WHERE connection_id=$1 AND chat_id=$2", [connection.id, String(chatId)]);
      return null;
    }
    return { key: row.state_key, data: objectValue(row.state_data, {}) };
  }, connection.tenant_id);
}

async function sessionSet(db, connection, chatId, key, data = {}) {
  const expiresAt = new Date(Date.now() + SESSION_MINUTES * 60_000);
  await db.transaction(async (client) => {
    await client.query(
      `INSERT INTO admin_bot_sessions (
         connection_id, tenant_id, store_id, chat_id, state_key, state_data, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (connection_id, chat_id) DO UPDATE SET
         state_key=EXCLUDED.state_key,
         state_data=EXCLUDED.state_data,
         expires_at=EXCLUDED.expires_at,
         updated_at=NOW()`,
      [connection.id, connection.tenant_id, connection.store_id, String(chatId), key, JSON.stringify(data), expiresAt]
    );
  }, connection.tenant_id);
}

async function sessionClear(db, connection, chatId) {
  await db.transaction(async (client) => {
    await client.query("DELETE FROM admin_bot_sessions WHERE connection_id=$1 AND chat_id=$2", [connection.id, String(chatId)]);
  }, connection.tenant_id);
}

async function orderRows(db, connection, mode = "all", query = "") {
  const values = [connection.tenant_id, connection.store_id];
  const filters = [];
  if (mode === "attention") filters.push("o.status IN ('new','awaiting_payment','requires_review')");
  if (mode === "processing") filters.push("o.status='processing'");
  if (mode === "completed") filters.push("o.status='completed'");
  if (mode === "paid") filters.push("o.payment_status='paid'");
  if (query) {
    values.push(`%${query.toLocaleLowerCase("ar")}%`);
    const index = values.length;
    filters.push(
      `(LOWER(o.order_number) LIKE $${index} OR LOWER(COALESCE(o.customer_name,'')) LIKE $${index} OR LOWER(COALESCE(o.customer_email,'')) LIKE $${index})`
    );
  }
  const where = filters.length ? ` AND ${filters.join(" AND ")}` : "";
  return (
    await db.query(
      `SELECT o.id, o.order_number, o.customer_name, o.customer_email,
              o.status, o.payment_status, o.total_minor, o.currency, o.created_at,
              COUNT(oi.id)::int AS item_count
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id=o.id AND oi.tenant_id=o.tenant_id
       WHERE o.tenant_id=$1 AND o.store_id=$2${where}
       GROUP BY o.id, o.order_number, o.customer_name, o.customer_email,
                o.status, o.payment_status, o.total_minor, o.currency, o.created_at
       ORDER BY o.created_at DESC LIMIT 15`,
      values
    )
  ).rows;
}

async function ordersView(db, connection, update, mode = "all", query = "", notice = "") {
  const rows = await orderRows(db, connection, mode, query);
  const modeName = ({ all: "الأخيرة", attention: "تحتاج متابعة", processing: "قيد التنفيذ", completed: "المكتملة", paid: "المدفوعة" })[mode] || "الطلبات";
  const lines = rows.length
    ? rows.map((row) =>
        `• ${row.order_number} — ${row.customer_name}\n` +
        `  ${amountText(row.total_minor, row.currency)} • ${orderStatus(row.status)} • ${row.payment_status === "paid" ? "مدفوع" : row.payment_status} • ${row.item_count || 0} عنصر`
      ).join("\n\n")
    : query ? `لا توجد نتائج للبحث: ${query}` : "لا توجد طلبات ضمن هذا الفلتر.";
  const buttons = rows.slice(0, 10).map((row) => [button(`🧾 ${row.order_number}`, `adm:order:${row.id}`)]);
  buttons.push([button("🔎 بحث", `${PREFIX}orders:search`, "primary")]);
  buttons.push([
    button("⚠️ متابعة", `${PREFIX}orders:attention`),
    button("⚙️ تنفيذ", `${PREFIX}orders:processing`),
    button("✅ مكتملة", `${PREFIX}orders:completed`)
  ]);
  buttons.push([button("💳 مدفوعة", `${PREFIX}orders:paid`), button("🕘 الأخيرة", "adm:orders")]);
  buttons.push(homeRow());
  return payload(update, `${notice ? `${notice}\n\n` : ""}🧾 الطلبات — ${modeName}${query ? `\nبحث: ${query}` : ""}\n\n${lines}`, buttons);
}

async function customerRows(db, connection, query = "") {
  const values = [connection.tenant_id, connection.store_id];
  let filter = "";
  if (query) {
    values.push(`%${query.toLocaleLowerCase("ar")}%`);
    filter = ` AND (LOWER(c.display_name) LIKE $3 OR LOWER(c.email) LIKE $3 OR LOWER(COALESCE(c.phone,'')) LIKE $3)`;
  }
  return (
    await db.query(
      `SELECT c.id, c.display_name, c.email, c.phone, c.status,
              w.balance_minor, w.currency,
              (SELECT COUNT(*)::int FROM orders o
               WHERE o.tenant_id=c.tenant_id AND o.store_id=c.store_id AND o.customer_id=c.id) AS orders_count
       FROM store_customers c
       JOIN customer_wallets w ON w.customer_id=c.id
       WHERE c.tenant_id=$1 AND c.store_id=$2${filter}
       ORDER BY c.created_at DESC LIMIT 15`,
      values
    )
  ).rows;
}

async function customersView(db, connection, update, query = "", notice = "") {
  const rows = await customerRows(db, connection, query);
  const lines = rows.length
    ? rows.map((row) =>
        `• ${row.display_name} — ${row.status === "active" ? "نشط" : "محظور"}\n` +
        `  ${row.email}\n` +
        `  ${amountText(row.balance_minor, row.currency)} • ${row.orders_count || 0} طلب`
      ).join("\n\n")
    : query ? `لا يوجد عميل يطابق: ${query}` : "لا يوجد عملاء بعد.";
  const buttons = rows.slice(0, 12).map((row) => [button(`👤 ${String(row.display_name || row.email).slice(0, 28)}`, `adm4:customer:${row.id}`)]);
  buttons.push([button("🔎 بحث عن عميل", `${PREFIX}customers:search`, "primary")]);
  if (query) buttons.push([button("🕘 أحدث العملاء", "adm:customers")]);
  buttons.push(homeRow());
  return payload(update, `${notice ? `${notice}\n\n` : ""}👥 العملاء${query ? `\nبحث: ${query}` : ""}\n\n${lines}`, buttons);
}

async function processSession(db, connection, update, chatId, text, session) {
  if (!session?.key?.startsWith("search1_")) return null;
  const query = safeText(text, 120);
  if (!query || query.length < 2) return payload(update, "أرسل كلمتين على الأقل للبحث، أو /cancel للإلغاء.");
  await sessionClear(db, connection, chatId);
  if (session.key === "search1_orders") return ordersView(db, connection, update, "all", query);
  if (session.key === "search1_customers") return customersView(db, connection, update, query);
  return null;
}

async function handleCallback(db, connection, update, chatId, data) {
  if (data === "adm:orders") {
    await sessionClear(db, connection, chatId);
    return ordersView(db, connection, update);
  }
  if (data === "adm:customers") {
    await sessionClear(db, connection, chatId);
    return customersView(db, connection, update);
  }
  if (data === `${PREFIX}orders:search`) {
    await sessionSet(db, connection, chatId, "search1_orders", {});
    return payload(update, "🔎 أرسل رقم الطلب أو اسم العميل أو بريده الإلكتروني.\n\nأرسل /cancel للإلغاء.");
  }
  if (data === `${PREFIX}customers:search`) {
    await sessionSet(db, connection, chatId, "search1_customers", {});
    return payload(update, "🔎 أرسل اسم العميل أو بريده أو رقم هاتفه.\n\nأرسل /cancel للإلغاء.");
  }
  if (data.startsWith(`${PREFIX}orders:`)) {
    const mode = data.slice(`${PREFIX}orders:`.length);
    if (!["attention", "processing", "completed", "paid"].includes(mode)) return null;
    await sessionClear(db, connection, chatId);
    return ordersView(db, connection, update, mode);
  }
  return null;
}

async function authorizedContext(db, request) {
  const path = String(request.raw?.url || request.url || "").split("?")[0];
  const match = /^\/webhooks\/telegram-admin\/([0-9a-f-]{36})$/i.exec(path);
  if (!match) return null;
  const connection = (
    await db.query(
      "SELECT * FROM bot_connections WHERE id=$1 AND purpose='admin' AND status='active'",
      [match[1]]
    )
  ).rows[0];
  if (!connection) return null;
  const secret = request.headers["x-telegram-bot-api-secret-token"];
  if (!secret || sha256(secret) !== connection.webhook_secret_hash) return null;
  const store = await storeRow(db, connection);
  if (!store) return null;
  const incoming = request.body?.message || request.body?.callback_query?.message;
  const chatId = incoming?.chat?.id;
  const ownerTelegramId = objectValue(store.contact_data, {}).telegramOwnerId;
  if (!chatId || !ownerTelegramId || String(chatId) !== String(ownerTelegramId)) return null;
  if (incoming?.chat?.type && incoming.chat.type !== "private") return null;
  return { connection, chatId };
}

async function send(config, request, reply, connection, chatId, outgoing) {
  const gateway = new TelegramGateway(config, request.log);
  const token = decryptSecret(connection.token_ciphertext, config.encryptionKey);
  await gateway.sendMessage(token, chatId, outgoing);
  reply.code(204).send();
  return reply;
}

export function installAdminBotSearchV1(app, { db, config }) {
  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;
    const path = String(request.raw?.url || request.url || "").split("?")[0];
    if (!path.startsWith("/webhooks/telegram-admin/")) return;
    const context = await authorizedContext(db, request);
    if (!context) return;
    const { connection, chatId } = context;
    const update = request.body || {};
    const data = String(update?.callback_query?.data || "").trim();
    const text = String(update?.message?.text || "").trim();
    let outgoing = null;

    if (text === "/cancel") {
      const session = await sessionGet(db, connection, chatId);
      if (!session?.key?.startsWith("search1_")) return;
      await sessionClear(db, connection, chatId);
      outgoing = payload(update, "تم إلغاء البحث.", [homeRow()]);
    } else if (data === "adm:orders" || data === "adm:customers" || data.startsWith(PREFIX)) {
      outgoing = await handleCallback(db, connection, update, chatId, data);
    } else if (text && !text.startsWith("/")) {
      outgoing = await processSession(db, connection, update, chatId, text, await sessionGet(db, connection, chatId));
    }

    if (!outgoing) return;
    return send(config, request, reply, connection, chatId, outgoing);
  });
}
