import { randomUUID } from "node:crypto";
import { decryptSecret, safeText, sha256 } from "./security.mjs";
import { handleTelegramUpdate, TelegramGateway } from "./telegram.mjs";

const SESSION_MINUTES = 20;

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

function callbackId(update) {
  return update?.callback_query?.id || null;
}

function response(update, chatId, text, rows = null) {
  const payload = { text };
  if (rows) payload.reply_markup = keyboard(rows);
  if (callbackId(update)) payload.callbackQueryId = callbackId(update);
  return { chatId, text: payload };
}

function backHome() {
  return [button("↩️ القائمة الرئيسية", "adm:home")];
}

function homeKeyboard() {
  return keyboard([
    [button("📊 نظرة عامة", "adm:overview", "primary")],
    [button("🧾 الطلبات", "adm:orders"), button("💳 إثباتات الدفع", "adm:proofs", "success")],
    [button("👥 العملاء", "adm:customers"), button("📦 المنتجات", "adm:products")],
    [button("🗂 الأقسام", "adm:categories"), button("💰 طرق الدفع", "adm:payments")],
    [button("🔔 الإشعارات", "adm:notifications"), button("⚙️ الإعدادات", "adm:settings")]
  ]);
}

function formatMinorAmount(minor, currency) {
  let factor = 100;
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    factor = 10 ** digits;
  } catch {
    // Store currencies are validated elsewhere; two digits are a safe display fallback.
  }
  try {
    return new Intl.NumberFormat("ar", { style: "currency", currency }).format(Number(minor || 0) / factor);
  } catch {
    return `${Number(minor || 0) / factor} ${currency || ""}`.trim();
  }
}

function destinationText(value) {
  const data = jsonObject(value, {});
  const keys = [
    "value",
    "address",
    "walletAddress",
    "wallet_address",
    "account",
    "accountNumber",
    "account_number",
    "payId",
    "pay_id",
    "wallet",
    "number",
    "phone",
    "iban"
  ];
  for (const key of keys) {
    const candidate = String(data[key] || "").trim();
    if (candidate) return candidate;
  }
  return "غير مضبوط";
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

async function audit(db, connection, action, entityType, entityId, beforeData = null, afterData = null) {
  const actorUserId = await ownerUserId(db, connection);
  await db.query(
    `INSERT INTO audit_logs (
       id, tenant_id, actor_user_id, action, entity_type, entity_id,
       before_data, after_data
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      randomUUID(),
      connection.tenant_id,
      actorUserId,
      action,
      entityType,
      entityId,
      beforeData === null ? null : JSON.stringify(beforeData),
      afterData === null ? null : JSON.stringify(afterData)
    ]
  );
}

async function getSession(db, connection, chatId) {
  const row = (
    await db.query(
      `SELECT * FROM admin_bot_sessions
       WHERE connection_id=$1 AND tenant_id=$2 AND store_id=$3 AND chat_id=$4`,
      [connection.id, connection.tenant_id, connection.store_id, String(chatId)]
    )
  ).rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await clearSession(db, connection, chatId);
    return null;
  }
  return { key: row.state_key, data: jsonObject(row.state_data, {}) };
}

async function setSession(db, connection, chatId, key, data = {}) {
  const expiresAt = new Date(Date.now() + SESSION_MINUTES * 60_000);
  await db.query(
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
}

async function clearSession(db, connection, chatId) {
  await db.query(
    "DELETE FROM admin_bot_sessions WHERE connection_id=$1 AND chat_id=$2",
    [connection.id, String(chatId)]
  );
}

async function customersScreen(db, connection, update, chatId) {
  const rows = (
    await db.query(
      `SELECT c.id, c.display_name, c.email, c.status,
              w.balance_minor, w.currency,
              (SELECT COUNT(*)::int FROM orders o
               WHERE o.tenant_id=c.tenant_id AND o.store_id=c.store_id AND o.customer_id=c.id) AS orders_count
       FROM store_customers c
       LEFT JOIN customer_wallets w ON w.customer_id=c.id
       WHERE c.tenant_id=$1 AND c.store_id=$2
       ORDER BY c.created_at DESC LIMIT 12`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows;
  const lines = rows.length
    ? rows.map((row) =>
        `• ${row.display_name} — ${row.status === "active" ? "نشط" : "محظور"}\n` +
        `  ${row.email}\n` +
        `  ${formatMinorAmount(row.balance_minor || 0, row.currency || "USD")} • ${row.orders_count || 0} طلب`
      ).join("\n\n")
    : "لا يوجد عملاء بعد.";
  const buttons = rows.map((row) => [
    button(`${row.status === "active" ? "👤" : "🚫"} ${String(row.display_name || row.email).slice(0, 28)}`, `adm2:customer:${row.id}`)
  ]);
  buttons.push(backHome());
  return response(update, chatId, `👥 العملاء\n\n${lines}`, buttons);
}

async function customerDetail(db, connection, update, chatId, customerId) {
  const row = (
    await db.query(
      `SELECT c.id, c.display_name, c.email, c.phone, c.status, c.created_at,
              w.balance_minor, w.currency,
              (SELECT COUNT(*)::int FROM orders o
               WHERE o.tenant_id=c.tenant_id AND o.store_id=c.store_id AND o.customer_id=c.id) AS orders_count,
              (SELECT COUNT(*)::int FROM wallet_topup_proofs p
               WHERE p.tenant_id=c.tenant_id AND p.store_id=c.store_id AND p.customer_id=c.id AND p.status='pending') AS pending_proofs
       FROM store_customers c
       LEFT JOIN customer_wallets w ON w.customer_id=c.id
       WHERE c.id=$1 AND c.tenant_id=$2 AND c.store_id=$3`,
      [customerId, connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  if (!row) return response(update, chatId, "العميل غير موجود.", [backHome()]);
  const toggleText = row.status === "active" ? "🚫 حظر العميل" : "✅ إلغاء الحظر";
  return response(
    update,
    chatId,
    `👤 ${row.display_name}\n\n` +
      `البريد: ${row.email}\n` +
      `الهاتف: ${row.phone || "—"}\n` +
      `الحالة: ${row.status === "active" ? "نشط" : "محظور"}\n` +
      `المحفظة: ${formatMinorAmount(row.balance_minor || 0, row.currency || "USD")}\n` +
      `الطلبات: ${row.orders_count || 0}\n` +
      `إثباتات بانتظار المراجعة: ${row.pending_proofs || 0}`,
    [
      [button(toggleText, `adm2:customer:toggle:${row.id}`, row.status === "active" ? "danger" : "success")],
      [button("↩️ العملاء", "adm:customers")],
      backHome()
    ]
  );
}

async function toggleCustomer(db, connection, update, chatId, customerId) {
  const customer = (
    await db.query(
      `SELECT id, display_name, status FROM store_customers
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      [customerId, connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  if (!customer) return response(update, chatId, "العميل غير موجود.", [backHome()]);
  const nextStatus = customer.status === "active" ? "blocked" : "active";
  await db.transaction(async (client) => {
    await client.query(
      `UPDATE store_customers SET status=$1, updated_at=NOW()
       WHERE id=$2 AND tenant_id=$3 AND store_id=$4`,
      [nextStatus, customer.id, connection.tenant_id, connection.store_id]
    );
    if (nextStatus === "blocked") {
      await client.query(
        "UPDATE customer_sessions SET revoked_at=COALESCE(revoked_at,NOW()) WHERE customer_id=$1",
        [customer.id]
      );
    }
  }, connection.tenant_id);
  await audit(
    db,
    connection,
    nextStatus === "blocked" ? "customer.blocked_from_admin_bot" : "customer.unblocked_from_admin_bot",
    "store_customer",
    customer.id,
    { status: customer.status },
    { status: nextStatus }
  );
  return customerDetail(db, connection, update, chatId, customer.id);
}

async function categoriesScreen(db, connection, update, chatId) {
  const rows = (
    await db.query(
      `SELECT c.id, c.name, c.status, c.parent_id,
              parent.name AS parent_name,
              (SELECT COUNT(*)::int FROM products p
               WHERE p.tenant_id=c.tenant_id AND p.store_id=c.store_id AND p.category_id=c.id) AS products_count
       FROM categories c
       LEFT JOIN categories parent ON parent.id=c.parent_id
       WHERE c.tenant_id=$1 AND c.store_id=$2
       ORDER BY CASE WHEN c.parent_id IS NULL THEN 0 ELSE 1 END, c.sort_order, c.created_at
       LIMIT 24`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows;
  const lines = rows.length
    ? rows.map((row) =>
        `• ${row.parent_name ? `${row.parent_name} / ` : ""}${row.name} — ${row.products_count || 0} منتج • ${row.status === "active" ? "ظاهر" : "مخفي"}`
      ).join("\n")
    : "لا توجد أقسام بعد.";
  const buttons = rows.slice(0, 12).map((row) => [
    button(`🗂 ${String(row.name).slice(0, 28)}`, `adm2:category:${row.id}`)
  ]);
  buttons.push(backHome());
  return response(update, chatId, `🗂 الأقسام\n\n${lines}`, buttons);
}

async function categoryDetail(db, connection, update, chatId, categoryId) {
  const row = (
    await db.query(
      `SELECT c.id, c.name, c.status, c.parent_id, c.sort_order,
              parent.name AS parent_name,
              (SELECT COUNT(*)::int FROM products p
               WHERE p.tenant_id=c.tenant_id AND p.store_id=c.store_id AND p.category_id=c.id) AS products_count
       FROM categories c
       LEFT JOIN categories parent ON parent.id=c.parent_id
       WHERE c.id=$1 AND c.tenant_id=$2 AND c.store_id=$3`,
      [categoryId, connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  if (!row) return response(update, chatId, "القسم غير موجود.", [backHome()]);
  const toggleText = row.status === "active" ? "🙈 إخفاء القسم" : "👁 إظهار القسم";
  return response(
    update,
    chatId,
    `🗂 ${row.name}\n\n` +
      `القسم الأب: ${row.parent_name || "قسم رئيسي"}\n` +
      `المنتجات: ${row.products_count || 0}\n` +
      `الترتيب: ${row.sort_order || 0}\n` +
      `الحالة: ${row.status === "active" ? "ظاهر" : "مخفي"}`,
    [
      [button("✏️ تعديل الاسم", `adm2:category:name:${row.id}`, "primary"), button(toggleText, `adm2:category:toggle:${row.id}`)],
      [button("↩️ الأقسام", "adm:categories")],
      backHome()
    ]
  );
}

async function toggleCategory(db, connection, update, chatId, categoryId) {
  const row = (
    await db.query(
      `SELECT id, name, status FROM categories
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      [categoryId, connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  if (!row) return response(update, chatId, "القسم غير موجود.", [backHome()]);
  const nextStatus = row.status === "active" ? "hidden" : "active";
  await db.query(
    `UPDATE categories SET status=$1, updated_at=NOW()
     WHERE id=$2 AND tenant_id=$3 AND store_id=$4`,
    [nextStatus, row.id, connection.tenant_id, connection.store_id]
  );
  await audit(db, connection, "category.visibility_changed_from_admin_bot", "category", row.id, { status: row.status }, { status: nextStatus });
  return categoryDetail(db, connection, update, chatId, row.id);
}

async function paymentsScreen(db, connection, update, chatId) {
  const rows = (
    await db.query(
      `SELECT id, name, method_type, status, customer_visible, destination_data, network
       FROM payment_methods
       WHERE tenant_id=$1 AND store_id=$2
       ORDER BY sort_order, created_at`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows;
  const lines = rows.length
    ? rows.map((row) =>
        `• ${row.name} — ${row.customer_visible && row.status === "active" ? "ظاهر" : "مخفي"}\n` +
        `  ${row.network || row.method_type} • ${destinationText(row.destination_data)}`
      ).join("\n\n")
    : "لا توجد طرق دفع بعد.";
  const buttons = rows.slice(0, 10).map((row) => [
    button(`💰 ${String(row.name).slice(0, 28)}`, `adm2:payment:${row.id}`)
  ]);
  buttons.push([button("➕ إضافة طريقة دفع", "adm:payment:add", "success")]);
  buttons.push(backHome());
  return response(update, chatId, `💰 طرق الدفع\n\n${lines}`, buttons);
}

async function paymentDetail(db, connection, update, chatId, paymentId) {
  const row = (
    await db.query(
      `SELECT id, name, method_type, status, customer_visible, destination_data, network, instructions, currency
       FROM payment_methods
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      [paymentId, connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  if (!row) return response(update, chatId, "طريقة الدفع غير موجودة.", [backHome()]);
  const visible = row.customer_visible && row.status === "active";
  return response(
    update,
    chatId,
    `💰 ${row.name}\n\n` +
      `النوع: ${row.method_type}\n` +
      `الشبكة: ${row.network || "—"}\n` +
      `العملة: ${row.currency || "—"}\n` +
      `بيانات التحويل: ${destinationText(row.destination_data)}\n` +
      `الحالة للعميل: ${visible ? "ظاهر" : "مخفي"}\n\n` +
      `${String(row.instructions || "").slice(0, 400)}`,
    [
      [button("✏️ تعديل الاسم", `adm2:payment:name:${row.id}`), button("📋 تعديل بيانات التحويل", `adm2:payment:destination:${row.id}`, "primary")],
      [button(visible ? "🙈 إخفاء" : "👁 إظهار", `adm2:payment:toggle:${row.id}`, visible ? "danger" : "success")],
      [button("↩️ طرق الدفع", "adm:payments")],
      backHome()
    ]
  );
}

async function togglePayment(db, connection, update, chatId, paymentId) {
  const row = (
    await db.query(
      `SELECT id, customer_visible, status FROM payment_methods
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      [paymentId, connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  if (!row) return response(update, chatId, "طريقة الدفع غير موجودة.", [backHome()]);
  const nextVisible = !(row.customer_visible && row.status === "active");
  await db.query(
    `UPDATE payment_methods
     SET customer_visible=$1,
         status=CASE WHEN $1 THEN 'active' ELSE status END,
         updated_at=NOW()
     WHERE id=$2 AND tenant_id=$3 AND store_id=$4`,
    [nextVisible, row.id, connection.tenant_id, connection.store_id]
  );
  await audit(
    db,
    connection,
    "payment_method.visibility_changed_from_admin_bot",
    "payment_method",
    row.id,
    { customerVisible: Boolean(row.customer_visible), status: row.status },
    { customerVisible: nextVisible }
  );
  return paymentDetail(db, connection, update, chatId, row.id);
}

async function processAdvancedSession(db, connection, store, update, chatId, text, session) {
  if (!session?.key?.startsWith("advanced_")) return null;

  if (session.key === "advanced_category_name") {
    const name = safeText(text, 120);
    if (!name || name.length < 2) {
      return response(update, chatId, "أرسل اسم قسم واضحًا، أو /cancel للإلغاء.");
    }
    const row = (
      await db.query(
        `SELECT id, name FROM categories
         WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
        [session.data.categoryId, connection.tenant_id, connection.store_id]
      )
    ).rows[0];
    if (!row) {
      await clearSession(db, connection, chatId);
      return response(update, chatId, "القسم غير موجود.", [backHome()]);
    }
    await db.query(
      `UPDATE categories SET name=$1, updated_at=NOW()
       WHERE id=$2 AND tenant_id=$3 AND store_id=$4`,
      [name, row.id, connection.tenant_id, connection.store_id]
    );
    await audit(db, connection, "category.renamed_from_admin_bot", "category", row.id, { name: row.name }, { name });
    await clearSession(db, connection, chatId);
    return categoryDetail(db, connection, update, chatId, row.id);
  }

  if (session.key === "advanced_payment_name") {
    const name = safeText(text, 120);
    if (!name || name.length < 2) {
      return response(update, chatId, "أرسل اسمًا واضحًا لطريقة الدفع، أو /cancel للإلغاء.");
    }
    const row = (
      await db.query(
        `SELECT id, name FROM payment_methods
         WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
        [session.data.paymentId, connection.tenant_id, connection.store_id]
      )
    ).rows[0];
    if (!row) {
      await clearSession(db, connection, chatId);
      return response(update, chatId, "طريقة الدفع غير موجودة.", [backHome()]);
    }
    await db.query(
      `UPDATE payment_methods SET name=$1, updated_at=NOW()
       WHERE id=$2 AND tenant_id=$3 AND store_id=$4`,
      [name, row.id, connection.tenant_id, connection.store_id]
    );
    await audit(db, connection, "payment_method.renamed_from_admin_bot", "payment_method", row.id, { name: row.name }, { name });
    await clearSession(db, connection, chatId);
    return paymentDetail(db, connection, update, chatId, row.id);
  }

  if (session.key === "advanced_payment_destination") {
    const destination = safeText(text, 500);
    if (!destination || destination.length < 2) {
      return response(update, chatId, "أرسل رقم الحساب أو عنوان المحفظة، أو /cancel للإلغاء.");
    }
    const row = (
      await db.query(
        `SELECT id, destination_data FROM payment_methods
         WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
        [session.data.paymentId, connection.tenant_id, connection.store_id]
      )
    ).rows[0];
    if (!row) {
      await clearSession(db, connection, chatId);
      return response(update, chatId, "طريقة الدفع غير موجودة.", [backHome()]);
    }
    const before = jsonObject(row.destination_data, {});
    const after = { ...before, value: destination };
    await db.query(
      `UPDATE payment_methods SET destination_data=$1, updated_at=NOW()
       WHERE id=$2 AND tenant_id=$3 AND store_id=$4`,
      [JSON.stringify(after), row.id, connection.tenant_id, connection.store_id]
    );
    await audit(db, connection, "payment_method.destination_changed_from_admin_bot", "payment_method", row.id, { destinationConfigured: destinationText(before) !== "غير مضبوط" }, { destinationConfigured: true });
    await clearSession(db, connection, chatId);
    return paymentDetail(db, connection, update, chatId, row.id);
  }

  return null;
}

async function advancedUpdate(db, connection, store, update) {
  const message = update?.message || update?.callback_query?.message;
  const chatId = message?.chat?.id;
  if (!chatId) return null;
  const ownerId = jsonObject(store.contact_data, {}).telegramOwnerId;
  if (!ownerId || String(ownerId) !== String(chatId) || (message?.chat?.type && message.chat.type !== "private")) {
    return handleTelegramUpdate(db, connection, update);
  }

  const text = String(update?.message?.text || "").trim();
  const data = String(update?.callback_query?.data || "").trim();

  if (text === "/cancel") {
    await clearSession(db, connection, chatId);
    return response(update, chatId, "تم إلغاء العملية الحالية.", [backHome()]);
  }

  if (text.startsWith("/start") || text === "/admin" || text === "/menu" || data === "adm:home" || data === "adm2:home") {
    await clearSession(db, connection, chatId);
    const result = response(update, chatId, `لوحة إدارة ${store.name}\n\nاختر القسم الذي تريد إدارته. جميع العمليات مرتبطة مباشرة بقاعدة بيانات المتجر.`);
    result.text.reply_markup = homeKeyboard();
    return result;
  }

  if (data === "adm:customers") {
    await clearSession(db, connection, chatId);
    return customersScreen(db, connection, update, chatId);
  }
  if (data.startsWith("adm2:customer:toggle:")) {
    return toggleCustomer(db, connection, update, chatId, data.slice("adm2:customer:toggle:".length));
  }
  if (data.startsWith("adm2:customer:")) {
    return customerDetail(db, connection, update, chatId, data.slice("adm2:customer:".length));
  }

  if (data === "adm:categories") {
    await clearSession(db, connection, chatId);
    return categoriesScreen(db, connection, update, chatId);
  }
  if (data.startsWith("adm2:category:toggle:")) {
    return toggleCategory(db, connection, update, chatId, data.slice("adm2:category:toggle:".length));
  }
  if (data.startsWith("adm2:category:name:")) {
    const categoryId = data.slice("adm2:category:name:".length);
    await setSession(db, connection, chatId, "advanced_category_name", { categoryId });
    return response(update, chatId, "✏️ أرسل الاسم الجديد للقسم.\n\nأرسل /cancel للإلغاء.");
  }
  if (data.startsWith("adm2:category:")) {
    return categoryDetail(db, connection, update, chatId, data.slice("adm2:category:".length));
  }

  if (data === "adm:payments") {
    await clearSession(db, connection, chatId);
    return paymentsScreen(db, connection, update, chatId);
  }
  if (data.startsWith("adm2:payment:toggle:")) {
    return togglePayment(db, connection, update, chatId, data.slice("adm2:payment:toggle:".length));
  }
  if (data.startsWith("adm2:payment:name:")) {
    const paymentId = data.slice("adm2:payment:name:".length);
    await setSession(db, connection, chatId, "advanced_payment_name", { paymentId });
    return response(update, chatId, "✏️ أرسل الاسم الجديد لطريقة الدفع.\n\nأرسل /cancel للإلغاء.");
  }
  if (data.startsWith("adm2:payment:destination:")) {
    const paymentId = data.slice("adm2:payment:destination:".length);
    await setSession(db, connection, chatId, "advanced_payment_destination", { paymentId });
    return response(update, chatId, "📋 أرسل رقم الحساب أو عنوان المحفظة الجديد كما تريد أن يظهر للعميل.\n\nأرسل /cancel للإلغاء.");
  }
  if (data.startsWith("adm2:payment:")) {
    return paymentDetail(db, connection, update, chatId, data.slice("adm2:payment:".length));
  }

  if (text && !text.startsWith("/")) {
    const session = await getSession(db, connection, chatId);
    const handled = await processAdvancedSession(db, connection, store, update, chatId, text, session);
    if (handled) return handled;
  }

  return handleTelegramUpdate(db, connection, update);
}

export function installAdvancedAdminBotWebhook(app, { db, config }) {
  app.post("/webhooks/telegram-admin/:connectionId", async (request, reply) => {
    const connection = (
      await db.query(
        `SELECT * FROM bot_connections
         WHERE id=$1 AND purpose='admin' AND status='active'`,
        [request.params.connectionId]
      )
    ).rows[0];
    if (!connection) {
      reply.code(404);
      return { error: "bot_connection_not_found" };
    }

    const providedSecret = request.headers["x-telegram-bot-api-secret-token"];
    if (!providedSecret || sha256(providedSecret) !== connection.webhook_secret_hash) {
      reply.code(403);
      return { error: "invalid_webhook_secret" };
    }

    const store = (
      await db.query(
        `SELECT id, tenant_id, name, slug, status, currency, contact_data
         FROM stores WHERE id=$1 AND tenant_id=$2`,
        [connection.store_id, connection.tenant_id]
      )
    ).rows[0];
    if (!store) {
      reply.code(404);
      return { error: "store_not_found" };
    }

    const result = await advancedUpdate(db, connection, store, request.body || {});
    if (result) {
      const gateway = new TelegramGateway(config, request.log);
      const token = decryptSecret(connection.token_ciphertext, config.encryptionKey);
      await gateway.sendMessage(token, result.chatId, result.text);
    }

    reply.code(204);
    return null;
  });
}
