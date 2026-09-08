import { decryptSecret, sha256 } from "./security.mjs";
import { TelegramGateway } from "./telegram.mjs";

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
  const result = { text, callback_data: callbackData };
  if (style) result.style = style;
  return result;
}

function keyboard(rows) {
  return { inline_keyboard: rows };
}

function callbackPayload(update, text, rows) {
  const result = { text, reply_markup: keyboard(rows) };
  if (update?.callback_query?.id) result.callbackQueryId = update.callback_query.id;
  return result;
}

function currencyFactor(currency) {
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    return 10 ** digits;
  } catch {
    return 100;
  }
}

function formatMinor(minor, currency) {
  try {
    return new Intl.NumberFormat("ar", { style: "currency", currency }).format(Number(minor || 0) / currencyFactor(currency));
  } catch {
    return `${Number(minor || 0) / currencyFactor(currency)} ${currency || ""}`.trim();
  }
}

async function resolveContext(db, request) {
  const path = String(request.raw?.url || request.url || "").split("?")[0];
  const match = /^\/webhooks\/telegram-admin\/([0-9a-f-]{36})$/i.exec(path);
  if (!match) return null;
  const connection = (
    await db.query(
      `SELECT * FROM bot_connections
       WHERE id=$1 AND purpose='admin' AND status='active'`,
      [match[1]]
    )
  ).rows[0];
  if (!connection) return null;
  const secret = request.headers["x-telegram-bot-api-secret-token"];
  if (!secret || sha256(secret) !== connection.webhook_secret_hash) return null;
  const store = (
    await db.query(
      `SELECT id, tenant_id, name, currency, contact_data
       FROM stores WHERE id=$1 AND tenant_id=$2`,
      [connection.store_id, connection.tenant_id]
    )
  ).rows[0];
  if (!store) return null;
  const incoming = request.body?.message || request.body?.callback_query?.message;
  const chatId = incoming?.chat?.id;
  const ownerTelegramId = objectValue(store.contact_data, {}).telegramOwnerId;
  if (!chatId || !ownerTelegramId || String(chatId) !== String(ownerTelegramId)) return null;
  if (incoming?.chat?.type && incoming.chat.type !== "private") return null;
  return { connection, store, chatId };
}

async function overview(db, connection, store, update) {
  const totals = (
    await db.query(
      `SELECT
         COUNT(*)::int AS all_orders,
         COUNT(*) FILTER (WHERE payment_status='paid')::int AS paid_orders,
         COUNT(*) FILTER (WHERE status IN ('new','awaiting_payment','requires_review'))::int AS attention_orders,
         COUNT(*) FILTER (WHERE status='processing')::int AS processing_orders,
         COUNT(*) FILTER (WHERE status='completed')::int AS completed_orders,
         COALESCE(SUM(total_minor) FILTER (WHERE payment_status='paid'),0)::bigint AS paid_total,
         COALESCE(SUM(total_minor) FILTER (WHERE payment_status='paid' AND created_at>=NOW()-INTERVAL '24 hours'),0)::bigint AS paid_24h,
         COALESCE(SUM(total_minor) FILTER (WHERE payment_status='paid' AND created_at>=NOW()-INTERVAL '7 days'),0)::bigint AS paid_7d,
         COALESCE(SUM(total_minor) FILTER (WHERE payment_status='paid' AND created_at>=NOW()-INTERVAL '30 days'),0)::bigint AS paid_30d
       FROM orders
       WHERE tenant_id=$1 AND store_id=$2 AND currency=$3`,
      [connection.tenant_id, connection.store_id, store.currency]
    )
  ).rows[0];

  const operations = (
    await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM products WHERE tenant_id=$1 AND store_id=$2 AND status='active') AS active_products,
         (SELECT COUNT(*)::int FROM store_customers WHERE tenant_id=$1 AND store_id=$2 AND status='active') AS active_customers,
         (SELECT COUNT(*)::int FROM wallet_topup_proofs WHERE tenant_id=$1 AND store_id=$2 AND status='pending') AS pending_proofs,
         (SELECT COUNT(*)::int FROM support_threads WHERE tenant_id=$1 AND store_id=$2 AND status IN ('open','waiting_customer')) AS support_open,
         (SELECT COALESCE(SUM(balance_minor),0)::bigint FROM customer_wallets WHERE tenant_id=$1 AND store_id=$2 AND currency=$3) AS wallet_liability,
         (SELECT COUNT(*)::int FROM store_admin_notifications WHERE tenant_id=$1 AND store_id=$2 AND read_at IS NULL) AS unread_notifications`,
      [connection.tenant_id, connection.store_id, store.currency]
    )
  ).rows[0];

  const topProducts = (
    await db.query(
      `SELECT oi.product_name_snapshot AS name,
              COALESCE(SUM(oi.quantity),0)::bigint AS quantity,
              COALESCE(SUM(oi.total_minor),0)::bigint AS total_minor
       FROM order_items oi
       JOIN orders o ON o.id=oi.order_id AND o.tenant_id=oi.tenant_id
       WHERE o.tenant_id=$1 AND o.store_id=$2 AND o.payment_status='paid' AND o.currency=$3
       GROUP BY oi.product_name_snapshot
       ORDER BY total_minor DESC, quantity DESC
       LIMIT 3`,
      [connection.tenant_id, connection.store_id, store.currency]
    )
  ).rows;

  const topLines = topProducts.length
    ? topProducts.map((row, index) => `${index + 1}. ${String(row.name).slice(0, 45)} — ${row.quantity} × • ${formatMinor(row.total_minor, store.currency)}`).join("\n")
    : "لا توجد مبيعات مدفوعة كافية بعد.";

  return callbackPayload(
    update,
    `📊 نظرة عامة — ${store.name}\n\n` +
      `💵 المبيعات المدفوعة\n` +
      `آخر 24 ساعة: ${formatMinor(totals.paid_24h, store.currency)}\n` +
      `آخر 7 أيام: ${formatMinor(totals.paid_7d, store.currency)}\n` +
      `آخر 30 يومًا: ${formatMinor(totals.paid_30d, store.currency)}\n` +
      `الإجمالي المسجل: ${formatMinor(totals.paid_total, store.currency)}\n\n` +
      `🧾 الطلبات\n` +
      `الكل: ${totals.all_orders || 0} • مدفوعة: ${totals.paid_orders || 0}\n` +
      `تحتاج متابعة: ${totals.attention_orders || 0} • قيد التنفيذ: ${totals.processing_orders || 0} • مكتملة: ${totals.completed_orders || 0}\n\n` +
      `🏪 التشغيل\n` +
      `عملاء نشطون: ${operations.active_customers || 0}\n` +
      `منتجات ظاهرة: ${operations.active_products || 0}\n` +
      `إثباتات دفع معلقة: ${operations.pending_proofs || 0}\n` +
      `تذاكر دعم مفتوحة: ${operations.support_open || 0}\n` +
      `إشعارات غير مقروءة: ${operations.unread_notifications || 0}\n` +
      `إجمالي أرصدة العملاء: ${formatMinor(operations.wallet_liability, store.currency)}\n\n` +
      `🏆 أعلى المنتجات المدفوعة\n${topLines}\n\n` +
      `ملاحظة: هذه أرقام تشغيل ومبيعات مسجلة، وليست صافي الربح المحاسبي.`,
    [
      [button("🧾 الطلبات", "adm:orders"), button("💳 إثباتات الدفع", "adm:proofs")],
      [button("👥 العملاء", "adm:customers"), button("📦 المنتجات", "adm:products")],
      [button("🎫 الدعم", "adm5:threads"), button("⚙️ الإعدادات", "adm:settings")],
      [button("↩️ القائمة الرئيسية", "adm:home")]
    ]
  );
}

async function send(config, request, reply, connection, chatId, outgoing) {
  const gateway = new TelegramGateway(config, request.log);
  const token = decryptSecret(connection.token_ciphertext, config.encryptionKey);
  await gateway.sendMessage(token, chatId, outgoing);
  reply.code(204).send();
  return reply;
}

export function installAdminBotReportingV1(app, { db, config }) {
  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;
    const path = String(request.raw?.url || request.url || "").split("?")[0];
    if (!path.startsWith("/webhooks/telegram-admin/")) return;
    const update = request.body || {};
    if (String(update?.callback_query?.data || "").trim() !== "adm:overview") return;
    const context = await resolveContext(db, request);
    if (!context) return;
    const outgoing = await overview(db, context.connection, context.store, update);
    return send(config, request, reply, context.connection, context.chatId, outgoing);
  });
}
