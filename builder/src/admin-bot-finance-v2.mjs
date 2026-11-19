import { randomUUID } from "node:crypto";
import { decryptSecret, sha256 } from "./security.mjs";
import { TelegramGateway } from "./telegram.mjs";

const PREFIX = "adm4:";
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

function majorToMinor(value, currency) {
  const normalized = String(value || "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,8})?$/.test(normalized)) return null;
  const major = Number(normalized);
  if (!Number.isFinite(major) || major <= 0) return null;
  const minor = Math.round(major * factor(currency));
  return Number.isSafeInteger(minor) && minor > 0 && minor <= 1_000_000_000_000 ? minor : null;
}

async function ownerId(db, connection) {
  return (
    await db.query(
      `SELECT user_id FROM tenant_memberships
       WHERE tenant_id=$1 AND status='active' AND role_key='owner'
       ORDER BY created_at LIMIT 1`,
      [connection.tenant_id]
    )
  ).rows[0]?.user_id || null;
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

async function sessionSet(db, connection, chatId, key, data) {
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

async function customerRows(db, connection) {
  return (
    await db.query(
      `SELECT c.id, c.display_name, c.email, c.phone, c.status,
              w.balance_minor, w.currency,
              (SELECT COUNT(*)::int FROM orders o
               WHERE o.tenant_id=c.tenant_id AND o.store_id=c.store_id AND o.customer_id=c.id) AS orders_count,
              (SELECT COUNT(*)::int FROM wallet_topup_proofs p
               WHERE p.tenant_id=c.tenant_id AND p.store_id=c.store_id AND p.customer_id=c.id AND p.status='pending') AS pending_proofs
       FROM store_customers c
       JOIN customer_wallets w ON w.customer_id=c.id
       WHERE c.tenant_id=$1 AND c.store_id=$2
       ORDER BY c.created_at DESC LIMIT 12`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows;
}

async function customersView(db, connection, update) {
  const rows = await customerRows(db, connection);
  const text = rows.length
    ? rows.map((row) => `• ${row.display_name} — ${amountText(row.balance_minor, row.currency)} • ${row.status === "active" ? "نشط" : "محظور"}`).join("\n")
    : "لا يوجد عملاء بعد.";
  const buttons = rows.map((row) => [button(`👤 ${String(row.display_name || row.email).slice(0, 28)}`, `${PREFIX}customer:${row.id}`)]);
  buttons.push(homeRow());
  return payload(update, `👥 العملاء\n\n${text}`, buttons);
}

async function customerView(db, connection, update, customerId) {
  const row = (await customerRows(db, connection)).find((item) => String(item.id) === String(customerId));
  if (!row) return payload(update, "العميل غير موجود.", [homeRow()]);
  return payload(
    update,
    `👤 ${row.display_name}\n\n` +
      `البريد: ${row.email}\n` +
      `الهاتف: ${row.phone || "—"}\n` +
      `الحالة: ${row.status === "active" ? "نشط" : "محظور"}\n` +
      `الرصيد: ${amountText(row.balance_minor, row.currency)}\n` +
      `الطلبات: ${row.orders_count || 0}\n` +
      `إثباتات معلقة: ${row.pending_proofs || 0}`,
    [
      [button("➕ إضافة رصيد", `${PREFIX}wallet:add:${row.id}`, "success"), button("➖ خصم رصيد", `${PREFIX}wallet:deduct:${row.id}`, "danger")],
      [button(row.status === "active" ? "🚫 حظر العميل" : "✅ إلغاء الحظر", `adm2:customer:toggle:${row.id}`)],
      [button("↩️ العملاء", "adm:customers")],
      homeRow()
    ]
  );
}

async function adjustmentStart(db, connection, update, chatId, customerId, direction) {
  const row = (await customerRows(db, connection)).find((item) => String(item.id) === String(customerId));
  if (!row) return payload(update, "العميل غير موجود.", [homeRow()]);
  await sessionSet(db, connection, chatId, "fin2_amount", {
    customerId: row.id,
    direction: direction > 0 ? 1 : -1,
    currency: row.currency
  });
  return payload(
    update,
    `${direction > 0 ? "➕ إضافة" : "➖ خصم"} رصيد للعميل ${row.display_name}\n\n` +
      `الرصيد الحالي: ${amountText(row.balance_minor, row.currency)}\n` +
      `أرسل المبلغ كرقم فقط بعملة ${row.currency}. مثال: 25.50\n\nأرسل /cancel للإلغاء.`
  );
}

async function amountReceived(db, connection, update, chatId, text, session) {
  if (session?.key !== "fin2_amount") return null;
  const customer = (await customerRows(db, connection)).find((item) => String(item.id) === String(session.data.customerId));
  if (!customer) {
    await sessionClear(db, connection, chatId);
    return payload(update, "العميل غير موجود.", [homeRow()]);
  }
  const minor = majorToMinor(text, customer.currency);
  if (!minor) return payload(update, `أرسل مبلغًا صحيحًا أكبر من صفر بعملة ${customer.currency}. مثال: 25.50\nأرسل /cancel للإلغاء.`);
  const direction = Number(session.data.direction) > 0 ? 1 : -1;
  if (direction < 0 && Number(customer.balance_minor) < minor) {
    return payload(update, `لا يمكن الخصم؛ الرصيد الحالي ${amountText(customer.balance_minor, customer.currency)} أقل من المبلغ المطلوب.`);
  }
  const operationId = randomUUID();
  await sessionSet(db, connection, chatId, "fin2_confirm", {
    customerId: customer.id,
    direction,
    amountMinor: minor,
    currency: customer.currency,
    operationId
  });
  return payload(
    update,
    `⚠️ تأكيد تعديل الرصيد\n\n` +
      `العميل: ${customer.display_name}\n` +
      `العملية: ${direction > 0 ? "إضافة" : "خصم"}\n` +
      `المبلغ: ${amountText(minor, customer.currency)}\n` +
      `الرصيد الحالي: ${amountText(customer.balance_minor, customer.currency)}\n\n` +
      `لن يتغير الرصيد قبل الضغط على تأكيد العملية.`,
    [[button("✅ تأكيد العملية", `${PREFIX}wallet:confirm:${operationId}`, "success")], [button("❌ إلغاء", `${PREFIX}wallet:cancel`, "danger")]]
  );
}

async function adjustmentConfirm(db, connection, update, chatId, operationId) {
  const session = await sessionGet(db, connection, chatId);
  if (session?.key !== "fin2_confirm" || session.data.operationId !== operationId) {
    return payload(update, "انتهت جلسة التأكيد أو تغيرت. افتح العميل وابدأ من جديد.", [[button("👥 العملاء", "adm:customers")], homeRow()]);
  }
  const actorUserId = await ownerId(db, connection);
  const amountMinor = Number(session.data.amountMinor);
  const direction = Number(session.data.direction) > 0 ? 1 : -1;
  let result;

  await db.transaction(async (client) => {
    // Lock the wallet first. A duplicate callback must wait for the first
    // transaction, then re-check the ledger reference after that commit.
    const wallet = (
      await client.query(
        `SELECT w.customer_id, w.balance_minor, w.currency, c.display_name
         FROM customer_wallets w
         JOIN store_customers c ON c.id=w.customer_id
         WHERE w.customer_id=$1 AND w.tenant_id=$2 AND w.store_id=$3
         FOR UPDATE OF w`,
        [session.data.customerId, connection.tenant_id, connection.store_id]
      )
    ).rows[0];
    if (!wallet) throw new Error("wallet_not_found");
    if (wallet.currency !== session.data.currency) throw new Error("wallet_currency_changed");

    const replay = (
      await client.query(
        `SELECT balance_after_minor, currency
         FROM wallet_ledger
         WHERE tenant_id=$1 AND store_id=$2
           AND reference_type='telegram_wallet_adjustment'
           AND reference_id=$3 AND entry_type='adjustment'`,
        [connection.tenant_id, connection.store_id, operationId]
      )
    ).rows[0];
    if (replay) {
      result = {
        customerId: wallet.customer_id,
        displayName: wallet.display_name,
        balanceAfter: Number(replay.balance_after_minor),
        currency: replay.currency,
        replay: true
      };
      return;
    }

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
       ) VALUES ($1,$2,$3,$4,'adjustment','admin_adjustment',$5,$6,$7,0,$8,'telegram_wallet_adjustment',$9,$10)`,
      [
        randomUUID(), connection.tenant_id, connection.store_id, wallet.customer_id,
        delta, before, after, wallet.currency, operationId,
        direction > 0 ? "إضافة رصيد مؤكدة من بوت الإدارة" : "خصم رصيد مؤكد من بوت الإدارة"
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
          ? `تمت إضافة ${amountText(amountMinor, wallet.currency)} إلى محفظتك بواسطة إدارة المتجر.`
          : `تم خصم ${amountText(amountMinor, wallet.currency)} من محفظتك بواسطة إدارة المتجر.`,
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
    result = {
      customerId: wallet.customer_id,
      displayName: wallet.display_name,
      balanceAfter: after,
      currency: wallet.currency,
      replay: false
    };
  }, connection.tenant_id);

  await sessionClear(db, connection, chatId);
  return payload(
    update,
    `✅ تم ${direction > 0 ? "إضافة" : "خصم"} ${amountText(amountMinor, result.currency)} ${direction > 0 ? "إلى" : "من"} محفظة ${result.displayName}.\n` +
      `الرصيد الحالي: ${amountText(result.balanceAfter, result.currency)}` +
      `${result.replay ? "\n\nتم التعرف على إعادة الإرسال ولم تُنفذ العملية مرتين." : ""}`,
    [[button("👤 فتح العميل", `${PREFIX}customer:${result.customerId}`)], [button("👥 العملاء", "adm:customers")], homeRow()]
  );
}

async function authorizedContext(db, request) {
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
  const ownerTelegramId = objectValue(store.contact_data, {}).telegramOwnerId;
  if (!chatId || !ownerTelegramId || String(chatId) !== String(ownerTelegramId)) return null;
  if (message?.chat?.type && message.chat.type !== "private") return null;
  return { connection, chatId };
}

async function send(config, request, reply, connection, chatId, messagePayload) {
  const gateway = new TelegramGateway(config, request.log);
  const token = decryptSecret(connection.token_ciphertext, config.encryptionKey);
  await gateway.sendMessage(token, chatId, messagePayload);
  reply.code(204).send();
  return reply;
}

export function installAdminBotFinanceV2(app, { db, config }) {
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
    let result = null;

    if (text === "/cancel") {
      const session = await sessionGet(db, connection, chatId);
      if (!session?.key?.startsWith("fin2_")) return;
      await sessionClear(db, connection, chatId);
      result = payload(update, "تم إلغاء تعديل الرصيد.", [[button("👥 العملاء", "adm:customers")], homeRow()]);
    } else if (data === "adm:customers") {
      await sessionClear(db, connection, chatId);
      result = await customersView(db, connection, update);
    } else if (data.startsWith(`${PREFIX}customer:`)) {
      result = await customerView(db, connection, update, data.slice(`${PREFIX}customer:`.length));
    } else if (data.startsWith(`${PREFIX}wallet:add:`)) {
      result = await adjustmentStart(db, connection, update, chatId, data.slice(`${PREFIX}wallet:add:`.length), 1);
    } else if (data.startsWith(`${PREFIX}wallet:deduct:`)) {
      result = await adjustmentStart(db, connection, update, chatId, data.slice(`${PREFIX}wallet:deduct:`.length), -1);
    } else if (data === `${PREFIX}wallet:cancel`) {
      await sessionClear(db, connection, chatId);
      result = payload(update, "تم إلغاء تعديل الرصيد.", [[button("👥 العملاء", "adm:customers")], homeRow()]);
    } else if (data.startsWith(`${PREFIX}wallet:confirm:`)) {
      result = await adjustmentConfirm(db, connection, update, chatId, data.slice(`${PREFIX}wallet:confirm:`.length));
    } else if (text && !text.startsWith("/")) {
      result = await amountReceived(db, connection, update, chatId, text, await sessionGet(db, connection, chatId));
    }

    if (!result) return;
    return send(config, request, reply, connection, chatId, result);
  });
}
