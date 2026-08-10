import { randomUUID } from "node:crypto";
import { decryptSecret, sha256 } from "./security.mjs";
import { TelegramGateway } from "./telegram.mjs";

const SESSION_MINUTES = 15;
const PREFIX = "adm4:";

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

function button(text, callbackData, style = undefined) {
  const item = { text, callback_data: callbackData };
  if (style) item.style = style;
  return item;
}

function keyboard(rows) {
  return { inline_keyboard: rows };
}

function withCallback(update, payload) {
  if (update?.callback_query?.id) payload.callbackQueryId = update.callback_query.id;
  return payload;
}

function backHomeRow() {
  return [button("↩️ القائمة الرئيسية", "adm:home")];
}

function currencyFactor(currency) {
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
  const minor = Math.round(major * currencyFactor(currency));
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > 1_000_000_000_000) return null;
  return minor;
}

function formatMinor(minor, currency) {
  try {
    return new Intl.NumberFormat("ar", { style: "currency", currency }).format(Number(minor || 0) / currencyFactor(currency));
  } catch {
    return `${Number(minor || 0) / currencyFactor(currency)} ${currency || ""}`.trim();
  }
}

async function ownerUserId(db, connection) {
  return (
    await db.query(
      `SELECT user_id FROM tenant_memberships
       WHERE tenant_id=$1 AND status='active' AND role_key='owner'
       ORDER BY created_at LIMIT 1`,
      [connection.tenant_id]
    )
  ).rows[0]?.user_id || null;
}

async function getSession(db, connection, chatId) {
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
    return { key: row.state_key, data: jsonObject(row.state_data, {}) };
  }, connection.tenant_id);
}

async function setSession(db, connection, chatId, key, data = {}) {
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

async function clearSession(db, connection, chatId) {
  await db.transaction(async (client) => {
    await client.query("DELETE FROM admin_bot_sessions WHERE connection_id=$1 AND chat_id=$2", [connection.id, String(chatId)]);
  }, connection.tenant_id);
}

async function customersScreen(db, connection, update) {
  const rows = (
    await db.query(
      `SELECT c.id, c.display_name, c.email, c.status, w.balance_minor, w.currency
       FROM store_customers c
       JOIN customer_wallets w ON w.customer_id=c.id
       WHERE c.tenant_id=$1 AND c.store_id=$2
       ORDER BY c.created_at DESC LIMIT 12`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows;
  const lines = rows.length
    ? rows.map((row) => `• ${row.display_name} — ${formatMinor(row.balance_minor, row.currency)} • ${row.status === "active" ? "نشط" : "محظور"}`).join("\n")
    : "لا يوجد عملاء بعد.";
  const buttons = rows.map((row) => [button(`👤 ${String(row.display_name || row.email).slice(0, 28)}`, `${PREFIX}customer:${row.id}`)]);
  buttons.push(backHomeRow());
  return withCallback(update, { text: `👥 العملاء\n\n${lines}`, reply_markup: keyboard(buttons) });
}

async function customerDetail(db, connection, update, customerId) {
  const row = (
    await db.query(
      `SELECT c.id, c.display_name, c.email, c.phone, c.status,
              w.balance_minor, w.currency,
              (SELECT COUNT(*)::int FROM orders o
               WHERE o.tenant_id=c.tenant_id AND o.store_id=c.store_id AND o.customer_id=c.id) AS orders_count,
              (SELECT COUNT(*)::int FROM wallet_topup_proofs p
               WHERE p.tenant_id=c.tenant_id AND p.store_id=c.store_id AND p.customer_id=c.id AND p.status='pending') AS pending_proofs
       FROM store_customers c
       JOIN customer_wallets w ON w.customer_id=c.id
       WHERE c.id=$1 AND c.tenant_id=$2 AND c.store_id=$3`,
      [customerId, connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  if (!row) return withCallback(update, { text: "العميل غير موجود.", reply_markup: keyboard([backHomeRow()]) });
  return withCallback(update, {
    text:
      `👤 ${row.display_name}\n\n` +
      `البريد: ${row.email}\n` +
      `الهاتف: ${row.phone || "—"}\n` +
      `الحالة: ${row.status === "active" ? "نشط" : "محظور"}\n` +
      `الرصيد: ${formatMinor(row.balance_minor, row.currency)}\n` +
      `الطلبات: ${row.orders_count || 0}\n` +
      `إثباتات معلقة: ${row.pending_proofs || 0}`,
    reply_markup: keyboard([
      [button("➕ إضافة رصيد", `${PREFIX}wallet:add:${row.id}`, "success"), button("➖ خصم رصيد", `${PREFIX}wallet:deduct:${row.id}`, "danger")],
      [button(row.status === "active" ? "🚫 حظر العميل" : "✅ إلغاء الحظر", `adm2:customer:toggle:${row.id}`)],
      [button("↩️ العملاء", "adm:customers")],
      backHomeRow()
    ])
  });
}

async function beginAdjustment(db, connection, update, chatId, customerId, direction) {
  const row = (
    await db.query(
      `SELECT c.id, c.display_name, w.currency, w.balance_minor
       FROM store_customers c JOIN customer_wallets w ON w.customer_id=c.id
       WHERE c.id=$1 AND c.tenant_id=$2 AND c.store_id=$3`,
      [customerId, connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  if (!row) return withCallback(update, { text: "العميل غير موجود.", reply_markup: keyboard([backHomeRow()]) });
  await setSession(db, connection, chatId, "fin_wallet_amount", { customerId: row.id, direction, currency: row.currency });
  return withCallback(update, {
    text:
      `${direction > 0 ? "➕ إضافة" : "➖ خصم"} رصيد للعميل ${row.display_name}\n\n` +
      `الرصيد الحالي: ${formatMinor(row.balance_minor, row.currency)}\n` +
      `أرسل المبلغ كرقم فقط بعملة ${row.currency}.\nمثال: 25.50\n\nأرسل /cancel للإلغاء.`
  });
}

async function prepareConfirmation(db, connection, update, chatId, text, session) {
  if (session?.key !== "fin_wallet_amount") return null;
  const amountMinor = parseMajorAmount(text, session.data.currency);
  if (!amountMinor) {
    return withCallback(update, { text: `أرسل مبلغًا صحيحًا أكبر من صفر بعملة ${session.data.currency}. مثال: 25.50\nأرسل /cancel للإلغاء.` });
  }
  const customer = (
    await db.query(
      `SELECT c.id, c.display_name, w.balance_minor, w.currency
       FROM store_customers c JOIN customer_wallets w ON w.customer_id=c.id
       WHERE c.id=$1 AND c.tenant_id=$2 AND c.store_id=$3`,
      [session.data.customerId, connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  if (!customer) {
    await clearSession(db, connection, chatId);
    return withCallback(update, { text: "العميل غير موجود.", reply_markup: keyboard([backHomeRow()]) });
  }
  const direction = Number(session.data.direction) >= 0 ? 1 : -1;
  if (direction < 0 && Number(customer.balance_minor) < amountMinor) {
    return withCallback(update, { text: `لا يمكن الخصم: رصيد العميل الحالي ${formatMinor(customer.balance_minor, customer.currency)} أقل من المبلغ المطلوب.` });
  }
  const operationId = randomUUID();
  await setSession(db, connection, chatId, "fin_wallet_confirm", {
    customerId: customer.id,
    direction,
    amountMinor,
    currency: customer.currency,
    operationId
  });
  return withCallback(update, {
    text:
      `⚠️ تأكيد تعديل الرصيد\n\n` +
      `العميل: ${customer.display_name}\n` +
      `العملية: ${direction > 0 ? "إضافة" : "خصم"}\n` +
      `المبلغ: ${formatMinor(amountMinor, customer.currency)}\n` +
      `الرصيد الحالي: ${formatMinor(customer.balance_minor, customer.currency)}\n\n` +
      `لن يتم تنفيذ أي تغيير قبل الضغط على تأكيد.`,
    reply_markup: keyboard([
      [button("✅ تأكيد العملية", `${PREFIX}wallet:confirm:${operationId}`, "success")],
      [button("❌ إلغاء", `${PREFIX}wallet:cancel`, "danger")]
    ])
  });
}

async function confirmAdjustment(db, connection, update, chatId, operationId) {
  const session = await getSession(db, connection, chatId);
  if (session?.key !== "fin_wallet_confirm" || session.data.operationId !== operationId) {
    return withCallback(update, { text: "انتهت جلسة التأكيد أو تغيرت. افتح العميل وابدأ العملية من جديد.", reply_markup: keyboard([[button("👥 العملاء", "adm:customers")], backHomeRow()]) });
  }
  const actorUserId = await ownerUserId(db, connection);
  const direction = Number(session.data.direction) >= 0 ? 1 : -1;
  const amountMinor = Number(session.data.amountMinor);
  let result;

  await db.transaction(async (client) => {
    const existing = (
      await client.query(
        `SELECT wl.balance_after_minor, wl.currency, c.display_name
         FROM wallet_ledger wl JOIN store_customers c ON c.id=wl.customer_id
         WHERE wl.tenant_id=$1 AND wl.store_id=$2
           AND wl.reference_type='telegram_wallet_adjustment'
           AND wl.reference_id=$3 AND wl.entry_type='adjustment'`,
        [connection.tenant_id, connection.store_id, operationId]
      )
    ).rows[0];
    if (existing) {
      result = { displayName: existing.display_name, balanceAfter: Number(existing.balance_after_minor), currency: existing.currency, replay: true };
      return;
    }

    const wallet = (
      await client.query(
        `SELECT w.customer_id, w.balance_minor, w.currency, c.display_name
         FROM customer_wallets w JOIN store_customers c ON c.id=w.customer_id
         WHERE w.customer_id=$1 AND w.tenant_id=$2 AND w.store_id=$3
         FOR UPDATE OF w`,
        [session.data.customerId, connection.tenant_id, connection.store_id]
      )
    ).rows[0];
    if (!wallet) throw new Error("wallet_not_found");
    if (wallet.currency !== session.data.currency) throw new Error("wallet_currency_changed");
    const before = Number(wallet.balance_minor);
    const delta = direction * amountMinor;
    const after = before + delta;
    if (!Number.isSafeInteger(after) || after < 0) throw new Error("insufficient_wallet_balance");

    await client.query(
      `UPDATE customer_wallets SET balance_minor=$1, updated_at=NOW()
       WHERE customer_id=$2 AND tenant_id=$3 AND store_id=$4`,
      [after, wallet.customer_id, connection.tenant_id, connection.store_id]
    );
    await client.query(
      `INSERT INTO wallet_ledger (
         id, tenant_id, store_id, customer_id, entry_type, operation_type,
         amount_minor, balance_before_minor, balance_after_minor, fee_minor,
         currency, reference_type, reference_id, note
       ) VALUES ($1,$2,$3,$4,'adjustment','adjustment',$5,$6,$7,0,$8,'telegram_wallet_adjustment',$9,$10)`,
      [
        randomUUID(), connection.tenant_id, connection.store_id, wallet.customer_id,
        delta, before, after, wallet.currency, operationId,
        direction > 0 ? "إضافة رصيد من بوت الإدارة" : "خصم رصيد من بوت الإدارة"
      ]
    );
    await client.query(
      `INSERT INTO customer_notifications (
         id, tenant_id, store_id, customer_id, notification_type, title, message,
         reference_type, reference_id
       ) VALUES ($1,$2,$3,$4,'wallet_adjusted',$5,$6,'telegram_wallet_adjustment',$7)`,
      [
        randomUUID(), connection.tenant_id, connection.store_id, wallet.customer_id,
        "تم تعديل رصيد محفظتك",
        direction > 0
          ? `تمت إضافة ${formatMinor(amountMinor, wallet.currency)} إلى محفظتك بواسطة إدارة المتجر.`
          : `تم خصم ${formatMinor(amountMinor, wallet.currency)} من محفظتك بواسطة إدارة المتجر.`,
        operationId
      ]
    );
    await client.query(
      `INSERT INTO audit_logs (
         id, tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data
       ) VALUES ($1,$2,$3,'wallet.adjusted_from_admin_bot','customer_wallet',$4,$5,$6)`,
      [
        randomUUID(), connection.tenant_id, actorUserId, wallet.customer_id,
        JSON.stringify({ balanceMinor: before, currency: wallet.currency }),
        JSON.stringify({ balanceMinor: after, deltaMinor: delta, currency: wallet.currency, operationId })
      ]
    );
    result = { displayName: wallet.display_name, balanceAfter: after, currency: wallet.currency, replay: false };
  }, connection.tenant_id);

  await clearSession(db, connection, chatId);
  return withCallback(update, {
    text:
      `✅ تم ${direction > 0 ? "إضافة" : "خصم"} ${formatMinor(amountMinor, result.currency)} ${direction > 0 ? "إلى" : "من"} محفظة ${result.displayName}.\n` +
      `الرصيد الحالي: ${formatMinor(result.balanceAfter, result.currency)}${result.replay ? "\n\nتم التعرف على العملية كإعادة إرسال ولم تُنفذ مرتين." : ""}`,
    reply_markup: keyboard([[button("👤 فتح العميل", `${PREFIX}customer:${session.data.customerId}`)], [button("👥 العملاء", "adm:customers")], backHomeRow()])
  });
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
      "SELECT id, tenant_id, contact_data FROM stores WHERE id=$1 AND tenant_id=$2",
      [connection.store_id, connection.tenant_id]
    )
  ).rows[0];
  if (!store) return null;
  const message = request.body?.message || request.body?.callback_query?.message;
  const chatId = message?.chat?.id;
  const ownerId = jsonObject(store.contact_data, {}).telegramOwnerId;
  if (!chatId || !ownerId || String(chatId) !== String(ownerId)) return null;
  if (message?.chat?.type && message.chat.type !== "private") return null;
  return { connection, chatId };
}

async function send(config, request, reply, connection, chatId, payload) {
  const gateway = new TelegramGateway(config, request.log);
  const token = decryptSecret(connection.token_ciphertext, config.encryptionKey);
  await gateway.sendMessage(token, chatId, payload);
  reply.code(204).send();
  return reply;
}

export function installAdminBotFinanceV1(app, { db, config }) {
  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;
    const path = String(request.raw?.url || request.url || "").split("?")[0];
    if (!path.startsWith("/webhooks/telegram-admin/")) return;
    const context = await resolveContext(db, request);
    if (!context) return;
    const { connection, chatId } = context;
    const update = request.body || {};
    const data = String(update?.callback_query?.data || "").trim();
    const text = String(update?.message?.text || "").trim();
    let payload = null;

    if (text === "/cancel") {
      const session = await getSession(db, connection, chatId);
      if (!session?.key?.startsWith("fin_")) return;
      await clearSession(db, connection, chatId);
      payload = withCallback(update, { text: "تم إلغاء تعديل الرصيد.", reply_markup: keyboard([[button("👥 العملاء", "adm:customers")], backHomeRow()]) });
    } else if (data === "adm:customers") {
      await clearSession(db, connection, chatId);
      payload = await customersScreen(db, connection, update);
    } else if (data.startsWith(`${PREFIX}customer:`)) {
      payload = await customerDetail(db, connection, update, data.slice(`${PREFIX}customer:`.length));
    } else if (data.startsWith(`${PREFIX}wallet:add:`)) {
      payload = await beginAdjustment(db, connection, update, chatId, data.slice(`${PREFIX}wallet:add:`.length), 1);
    } else if (data.startsWith(`${PREFIX}wallet:deduct:`)) {
      payload = await beginAdjustment(db, connection, update, chatId, data.slice(`${PREFIX}wallet:deduct:`.length), -1);
    } else if (data === `${PREFIX}wallet:cancel`) {
      await clearSession(db, connection, chatId);
      payload = withCallback(update, { text: "تم إلغاء تعديل الرصيد.", reply_markup: keyboard([[button("👥 العملاء", "adm:customers")], backHomeRow()]) });
    } else if (data.startsWith(`${PREFIX}wallet:confirm:`)) {
      payload = await confirmAdjustment(db, connection, update, chatId, data.slice(`${PREFIX}wallet:confirm:`.length));
    } else if (text && !text.startsWith("/")) {
      const session = await getSession(db, connection, chatId);
      payload = await prepareConfirmation(db, connection, update, chatId, text, session);
    }

    if (!payload) return;
    return send(config, request, reply, connection, chatId, payload);
  });
}
