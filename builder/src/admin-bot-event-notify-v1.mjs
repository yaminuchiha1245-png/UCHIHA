import { decryptSecret } from "./security.mjs";
import { TelegramGateway } from "./telegram.mjs";

const EVENT_KEY = Symbol("uchiha.admin-bot-event-notify-v1");

const ROUTES = Object.freeze({
  customerRegistered: /^\/api\/public\/stores\/([^/]+)\/customers\/register\/?$/,
  supportCreated: /^\/api\/public\/stores\/([^/]+)\/support\/?$/,
  supportMessage: /^\/api\/public\/stores\/([^/]+)\/support\/([^/]+)\/messages\/?$/,
  walletOrder: /^\/api\/public\/stores\/([^/]+)\/orders\/wallet\/?$/
});

function jsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object" && !Array.isArray(value) && !Buffer.isBuffer(value)) return value;
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : String(value || "");
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function jsonBody(payload) {
  if (Buffer.isBuffer(payload)) return jsonObject(payload, null);
  if (typeof payload === "string") return jsonObject(payload, null);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload;
  return null;
}

function currencyFactor(currency) {
  try {
    const digits = new Intl.NumberFormat("en", {
      style: "currency",
      currency: currency || "USD"
    }).resolvedOptions().maximumFractionDigits;
    return 10 ** digits;
  } catch {
    return 100;
  }
}

function amountText(minor, currency) {
  const factor = currencyFactor(currency);
  try {
    return new Intl.NumberFormat("ar", { style: "currency", currency }).format(Number(minor || 0) / factor);
  } catch {
    return `${Number(minor || 0) / factor} ${currency || ""}`.trim();
  }
}

function clip(value, maximum = 500) {
  const text = String(value || "").trim();
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(1, maximum - 1))}…`;
}

function button(text, callbackData, style = undefined) {
  const item = { text, callback_data: callbackData };
  if (style) item.style = style;
  return item;
}

function keyboard(rows) {
  return { inline_keyboard: rows };
}

function requestPath(request) {
  return String(request.raw?.url || request.url || "").split("?")[0];
}

function captureEvent(request, reply, responsePayload) {
  if (request.method !== "POST" || Number(reply.statusCode || 200) >= 400) return null;
  const path = requestPath(request);
  const body = jsonBody(responsePayload);
  if (!body) return null;

  let match = ROUTES.customerRegistered.exec(path);
  if (match && body.customer?.id) {
    return {
      kind: "customer_registered",
      slug: decodeSegment(match[1]),
      customer: {
        id: String(body.customer.id),
        displayName: clip(body.customer.displayName || "عميل جديد", 120),
        email: clip(body.customer.email || "", 200),
        phone: clip(body.customer.phone || "", 40)
      }
    };
  }

  match = ROUTES.supportMessage.exec(path);
  if (match && body.message?.id) {
    return {
      kind: "support_message",
      slug: decodeSegment(match[1]),
      threadId: String(body.message.threadId || decodeSegment(match[2])),
      message: clip(body.message.message || "", 700)
    };
  }

  match = ROUTES.supportCreated.exec(path);
  if (match && body.thread?.id) {
    return {
      kind: "support_created",
      slug: decodeSegment(match[1]),
      thread: {
        id: String(body.thread.id),
        subject: clip(body.thread.subject || "طلب دعم", 160),
        priority: body.thread.priority === "urgent" ? "urgent" : "normal"
      }
    };
  }

  match = ROUTES.walletOrder.exec(path);
  if (match && body.order?.id && body.duplicate !== true) {
    return {
      kind: "wallet_order_paid",
      slug: decodeSegment(match[1]),
      order: {
        id: String(body.order.id),
        orderNumber: clip(body.order.orderNumber || "", 120),
        totalMinor: Number(body.order.totalMinor || 0),
        currency: clip(body.order.currency || "", 12),
        status: clip(body.order.status || "", 30),
        paymentStatus: clip(body.order.paymentStatus || "", 30)
      }
    };
  }

  return null;
}

async function adminTarget(db, config, slug) {
  const store = (
    await db.query(
      `SELECT id, tenant_id, name, slug, currency, contact_data
       FROM stores WHERE slug=$1 LIMIT 1`,
      [String(slug || "").toLowerCase()]
    )
  ).rows[0];
  if (!store) return null;
  const ownerTelegramId = jsonObject(store.contact_data, {}).telegramOwnerId;
  if (!ownerTelegramId) return null;
  const connection = (
    await db.query(
      `SELECT id, token_ciphertext
       FROM bot_connections
       WHERE tenant_id=$1 AND store_id=$2 AND purpose='admin' AND status='active'
       ORDER BY updated_at DESC LIMIT 1`,
      [store.tenant_id, store.id]
    )
  ).rows[0];
  if (!connection) return null;
  const token = decryptSecret(connection.token_ciphertext, config.encryptionKey);
  return { store, ownerTelegramId: String(ownerTelegramId), token };
}

async function customerMessage(event, db, target) {
  const customer = (
    await db.query(
      `SELECT id, display_name, email, phone
       FROM store_customers
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      [event.customer.id, target.store.tenant_id, target.store.id]
    )
  ).rows[0];
  if (!customer) return null;
  return {
    text:
      `👤 عميل جديد في ${target.store.name}\n\n` +
      `الاسم: ${customer.display_name}\n` +
      `البريد: ${customer.email}\n` +
      `الهاتف: ${customer.phone || "—"}\n\n` +
      `يمكنك فتح ملف العميل وإدارة حالته ورصيده مباشرة من البوت.`,
    reply_markup: keyboard([
      [button("👤 فتح العميل", `adm4:customer:${customer.id}`, "primary")],
      [button("👥 كل العملاء", "adm:customers")]
    ])
  };
}

async function supportMessage(event, db, target) {
  const thread = (
    await db.query(
      `SELECT st.id, st.subject, st.priority, st.status,
              c.display_name AS customer_name, c.email AS customer_email
       FROM support_threads st
       JOIN store_customers c ON c.id=st.customer_id
       WHERE st.id=$1 AND st.tenant_id=$2 AND st.store_id=$3`,
      [event.kind === "support_created" ? event.thread.id : event.threadId, target.store.tenant_id, target.store.id]
    )
  ).rows[0];
  if (!thread) return null;
  const isNew = event.kind === "support_created";
  const body = isNew ? "" : `\n\nالرسالة:\n${clip(event.message, 600)}`;
  return {
    text:
      `${isNew ? "🎫 تذكرة دعم جديدة" : "💬 رسالة جديدة في الدعم"}\n\n` +
      `العميل: ${thread.customer_name}\n` +
      `الموضوع: ${thread.subject}\n` +
      `الأولوية: ${thread.priority === "urgent" ? "🔴 عاجلة" : "عادية"}\n` +
      `الحالة: ${thread.status}${body}\n\n` +
      `افتح التذكرة للرد على العميل من تيليجرام.`,
    reply_markup: keyboard([
      [button("🎫 فتح التذكرة", `adm5:thread:${thread.id}`, "primary")],
      [button("📨 كل التذاكر", "adm5:threads")]
    ])
  };
}

async function walletOrderMessage(event, db, target) {
  const order = (
    await db.query(
      `SELECT o.id, o.order_number, o.customer_name, o.customer_email,
              o.total_minor, o.currency, o.status, o.payment_status,
              COUNT(oi.id)::int AS item_count,
              MIN(oi.product_name_snapshot) AS first_product
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id=o.id AND oi.tenant_id=o.tenant_id
       WHERE o.id=$1 AND o.tenant_id=$2 AND o.store_id=$3
       GROUP BY o.id, o.order_number, o.customer_name, o.customer_email,
                o.total_minor, o.currency, o.status, o.payment_status`,
      [event.order.id, target.store.tenant_id, target.store.id]
    )
  ).rows[0];
  if (!order || order.payment_status !== "paid") return null;
  return {
    text:
      `🧾 طلب مدفوع جديد\n\n` +
      `الطلب: ${order.order_number}\n` +
      `العميل: ${order.customer_name}\n` +
      `المبلغ: ${amountText(order.total_minor, order.currency)}\n` +
      `العناصر: ${order.item_count || 0}${order.first_product ? ` • ${clip(order.first_product, 100)}` : ""}\n` +
      `الحالة: ${order.status}\n` +
      `الدفع: من المحفظة ✅\n\n` +
      `يمكنك فتح الطلب ومتابعة التنفيذ من البوت.`,
    reply_markup: keyboard([
      [button("🧾 فتح الطلب", `adm:order:${order.id}`, "primary")],
      [button("📋 كل الطلبات", "adm:orders")]
    ])
  };
}

async function notificationPayload(event, db, target) {
  if (event.kind === "customer_registered") return customerMessage(event, db, target);
  if (event.kind === "support_created" || event.kind === "support_message") return supportMessage(event, db, target);
  if (event.kind === "wallet_order_paid") return walletOrderMessage(event, db, target);
  return null;
}

async function dispatchEvent(event, { db, config, logger }) {
  const target = await adminTarget(db, config, event.slug);
  if (!target) return { sent: false, reason: "admin_bot_target_unavailable" };
  const outgoing = await notificationPayload(event, db, target);
  if (!outgoing) return { sent: false, reason: "event_context_unavailable" };
  const gateway = new TelegramGateway(config, logger);
  await gateway.sendMessage(target.token, target.ownerTelegramId, outgoing);
  return { sent: true };
}

export function installAdminBotEventNotifyV1(app, { db, config }) {
  app.addHook("onSend", async (request, reply, responsePayload) => {
    const event = captureEvent(request, reply, responsePayload);
    if (event) request[EVENT_KEY] = event;
    return responsePayload;
  });

  // Run Telegram I/O only after the HTTP response was sent. Notification failure
  // must never roll back customer registration, support, or a paid wallet order.
  app.addHook("onResponse", async (request) => {
    const event = request[EVENT_KEY];
    if (!event) return;
    try {
      await dispatchEvent(event, { db, config, logger: request.log });
    } catch (error) {
      request.log?.warn?.(
        {
          eventKind: event.kind,
          storeSlug: event.slug,
          message: String(error?.message || error)
        },
        "Telegram admin event notification failed after response"
      );
    }
  });
}
