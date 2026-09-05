import { randomUUID } from "node:crypto";
import { decryptSecret, safeText, sha256 } from "./security.mjs";
import { TelegramGateway } from "./telegram.mjs";

const SESSION_MINUTES = 20;
const CALLBACK_PREFIX = "adm3:";

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

function backHomeRow() {
  return [button("↩️ القائمة الرئيسية", "adm:home")];
}

function withCallback(update, payload) {
  if (update?.callback_query?.id) payload.callbackQueryId = update.callback_query.id;
  return payload;
}

function formatMinorAmount(minor, currency) {
  let factor = 100;
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    factor = 10 ** digits;
  } catch {
    // Keep a two-decimal display fallback.
  }
  try {
    return new Intl.NumberFormat("ar", { style: "currency", currency }).format(Number(minor || 0) / factor);
  } catch {
    return `${Number(minor || 0) / factor} ${currency || ""}`.trim();
  }
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

function slugBase(value) {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ar")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return normalized || `category-${Date.now().toString(36)}`;
}

async function uniqueCategorySlug(client, connection, name) {
  const base = slugBase(name);
  for (let index = 1; index <= 12; index += 1) {
    const slug = index === 1 ? base : `${base}-${index}`.slice(0, 80);
    const exists = (
      await client.query(
        "SELECT 1 FROM categories WHERE tenant_id=$1 AND slug=$2 LIMIT 1",
        [connection.tenant_id, slug]
      )
    ).rows[0];
    if (!exists) return slug;
  }
  return `${base}-${randomUUID().slice(0, 8)}`.slice(0, 80);
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

async function writeAudit(client, connection, actorUserId, action, entityType, entityId, beforeData = null, afterData = null) {
  await client.query(
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
      await client.query(
        "DELETE FROM admin_bot_sessions WHERE connection_id=$1 AND chat_id=$2",
        [connection.id, String(chatId)]
      );
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
    await client.query(
      "DELETE FROM admin_bot_sessions WHERE connection_id=$1 AND chat_id=$2",
      [connection.id, String(chatId)]
    );
  }, connection.tenant_id);
}

async function categoriesScreen(db, connection, update) {
  const rows = (
    await db.query(
      `SELECT c.id, c.name, c.status, c.parent_id,
              parent.name AS parent_name,
              (SELECT COUNT(*)::int FROM products p
               WHERE p.tenant_id=c.tenant_id AND p.store_id=c.store_id AND p.category_id=c.id) AS product_count
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
        `• ${row.parent_name ? `${row.parent_name} / ` : ""}${row.name} — ${row.product_count || 0} منتج • ${row.status === "active" ? "ظاهر" : "مخفي"}`
      ).join("\n")
    : "لا توجد أقسام بعد.";
  const buttons = rows.slice(0, 10).map((row) => [
    button(`🗂 ${String(row.name).slice(0, 28)}`, `adm2:category:${row.id}`)
  ]);
  buttons.push([
    button("➕ قسم رئيسي", `${CALLBACK_PREFIX}category:add-root`, "success"),
    button("➕ قسم فرعي", `${CALLBACK_PREFIX}category:add-child`, "primary")
  ]);
  buttons.push(backHomeRow());
  return withCallback(update, { text: `🗂 الأقسام\n\n${lines}`, reply_markup: keyboard(buttons) });
}

async function chooseParentCategory(db, connection, update) {
  const rows = (
    await db.query(
      `SELECT id, name, status FROM categories
       WHERE tenant_id=$1 AND store_id=$2 AND parent_id IS NULL
       ORDER BY sort_order, created_at LIMIT 20`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows;
  if (!rows.length) {
    return withCallback(update, {
      text: "لا يوجد قسم رئيسي بعد. أنشئ قسمًا رئيسيًا أولًا.",
      reply_markup: keyboard([[button("➕ إنشاء قسم رئيسي", `${CALLBACK_PREFIX}category:add-root`, "success")], backHomeRow()])
    });
  }
  const buttons = rows.map((row) => [button(`🗂 ${String(row.name).slice(0, 30)}`, `${CALLBACK_PREFIX}category:parent:${row.id}`)]);
  buttons.push([button("↩️ الأقسام", "adm:categories")]);
  return withCallback(update, { text: "اختر القسم الرئيسي الذي سيحتوي القسم الفرعي:", reply_markup: keyboard(buttons) });
}

async function productsScreen(db, connection, update) {
  const rows = (
    await db.query(
      `SELECT p.id, p.name, p.price_minor, p.currency, p.status, p.stock_quantity,
              c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.id=p.category_id
       WHERE p.tenant_id=$1 AND p.store_id=$2
       ORDER BY p.updated_at DESC, p.created_at DESC LIMIT 12`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows;
  const lines = rows.length
    ? rows.map((row) =>
        `• ${row.name}\n  ${formatMinorAmount(row.price_minor, row.currency)} • ${row.status} • ${row.category_name || "بدون قسم"} • مخزون: ${row.stock_quantity === null ? "غير محدود" : row.stock_quantity}`
      ).join("\n\n")
    : "لا توجد منتجات بعد.";
  const buttons = rows.slice(0, 10).map((row) => [
    button(`📦 ${String(row.name).slice(0, 28)}`, `${CALLBACK_PREFIX}product:${row.id}`)
  ]);
  buttons.push(backHomeRow());
  return withCallback(update, { text: `📦 المنتجات\n\n${lines}`, reply_markup: keyboard(buttons) });
}

async function productDetail(db, connection, update, productId) {
  const row = (
    await db.query(
      `SELECT p.id, p.name, p.description, p.product_type, p.price_minor, p.currency,
              p.status, p.stock_quantity, p.delivery_mode, p.source_kind, p.category_id,
              c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.id=p.category_id
       WHERE p.id=$1 AND p.tenant_id=$2 AND p.store_id=$3`,
      [productId, connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  if (!row) return withCallback(update, { text: "المنتج غير موجود.", reply_markup: keyboard([backHomeRow()]) });
  return withCallback(update, {
    text:
      `📦 ${row.name}\n\n` +
      `السعر: ${formatMinorAmount(row.price_minor, row.currency)}\n` +
      `القسم: ${row.category_name || "بدون قسم"}\n` +
      `النوع: ${row.product_type}\n` +
      `التنفيذ: ${row.delivery_mode}\n` +
      `المصدر: ${row.source_kind}\n` +
      `المخزون: ${row.stock_quantity === null ? "غير محدود" : row.stock_quantity}\n` +
      `الحالة: ${row.status}\n\n` +
      `${String(row.description || "").slice(0, 350)}`,
    reply_markup: keyboard([
      [button("✏️ الاسم", `${CALLBACK_PREFIX}product:name:${row.id}`), button("💵 السعر", `adm:product:price:${row.id}`, "primary")],
      [button("📦 المخزون", `${CALLBACK_PREFIX}product:stock:${row.id}`), button("🗂 القسم", `${CALLBACK_PREFIX}product:category:${row.id}`)],
      [button(row.status === "active" ? "🙈 إخفاء" : "👁 إظهار", `${CALLBACK_PREFIX}product:toggle:${row.id}`, row.status === "active" ? "danger" : "success")],
      [button("↩️ المنتجات", "adm:products")],
      backHomeRow()
    ])
  });
}

async function chooseProductCategory(db, connection, update, chatId, productId) {
  const product = (
    await db.query(
      "SELECT id, name FROM products WHERE id=$1 AND tenant_id=$2 AND store_id=$3",
      [productId, connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  if (!product) return withCallback(update, { text: "المنتج غير موجود.", reply_markup: keyboard([backHomeRow()]) });
  const rows = (
    await db.query(
      `SELECT id, name, parent_id FROM categories
       WHERE tenant_id=$1 AND store_id=$2 AND status='active'
       ORDER BY parent_id NULLS FIRST, sort_order, created_at LIMIT 20`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows;
  await setSession(db, connection, chatId, "ops_product_category", { productId: product.id });
  const buttons = [[button("بدون قسم", `${CALLBACK_PREFIX}pcat:none`)]];
  for (const row of rows) buttons.push([button(`🗂 ${String(row.name).slice(0, 30)}`, `${CALLBACK_PREFIX}pcat:${row.id}`)]);
  buttons.push([button("↩️ المنتج", `${CALLBACK_PREFIX}product:${product.id}`)]);
  return withCallback(update, { text: `اختر القسم الجديد للمنتج: ${product.name}`, reply_markup: keyboard(buttons) });
}

async function ordersScreen(db, connection, update) {
  const rows = (
    await db.query(
      `SELECT o.id, o.order_number, o.customer_name, o.status, o.payment_status,
              o.total_minor, o.currency,
              EXISTS(SELECT 1 FROM provider_orders po WHERE po.order_id=o.id) AS provider_linked
       FROM orders o
       WHERE o.tenant_id=$1 AND o.store_id=$2
       ORDER BY o.created_at DESC LIMIT 10`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows;
  const lines = rows.length
    ? rows.map((row) =>
        `• ${row.order_number} — ${row.customer_name}\n  ${formatMinorAmount(row.total_minor, row.currency)} • ${orderStatusLabel(row.status)}${row.provider_linked ? " • API" : ""}`
      ).join("\n\n")
    : "لا توجد طلبات حتى الآن.";
  const buttons = rows.slice(0, 8).map((row) => [button(`🧾 ${row.order_number}`, `${CALLBACK_PREFIX}order:${row.id}`)]);
  buttons.push(backHomeRow());
  return withCallback(update, { text: `🧾 الطلبات\n\n${lines}`, reply_markup: keyboard(buttons) });
}

async function orderDetail(db, connection, update, orderId) {
  const row = (
    await db.query(
      `SELECT o.*,
              EXISTS(SELECT 1 FROM provider_orders po WHERE po.order_id=o.id) AS provider_linked,
              (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id=o.id) AS item_count
       FROM orders o
       WHERE o.id=$1 AND o.tenant_id=$2 AND o.store_id=$3`,
      [orderId, connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  if (!row) return withCallback(update, { text: "الطلب غير موجود.", reply_markup: keyboard([backHomeRow()]) });
  const actions = [];
  if (!row.provider_linked && row.payment_status === "paid" && row.status === "paid") {
    actions.push([button("▶️ بدء التنفيذ", `${CALLBACK_PREFIX}order:processing:${row.id}`, "primary")]);
  }
  if (!row.provider_linked && row.payment_status === "paid" && row.status === "processing") {
    actions.push([button("✅ إكمال الطلب", `${CALLBACK_PREFIX}order:completed:${row.id}`, "success")]);
  }
  if (!row.provider_linked && ["unpaid", "pending"].includes(row.payment_status) && ["new", "awaiting_payment"].includes(row.status)) {
    actions.push([button("❌ إلغاء الطلب غير المدفوع", `${CALLBACK_PREFIX}order:cancelled:${row.id}`, "danger")]);
  }
  actions.push([button("↩️ الطلبات", "adm:orders")]);
  actions.push(backHomeRow());
  return withCallback(update, {
    text:
      `🧾 ${row.order_number}\n\n` +
      `العميل: ${row.customer_name}\n` +
      `البريد: ${row.customer_email || "—"}\n` +
      `المبلغ: ${formatMinorAmount(row.total_minor, row.currency)}\n` +
      `العناصر: ${row.item_count || 0}\n` +
      `الحالة: ${orderStatusLabel(row.status)}\n` +
      `الدفع: ${row.payment_status}\n` +
      `المصدر: ${row.channel}\n` +
      `تنفيذ API: ${row.provider_linked ? "مرتبط — الحالة تُدار من المزود" : "لا"}`,
    reply_markup: keyboard(actions)
  });
}

async function transitionManualOrder(db, connection, update, orderId, targetStatus) {
  const actorUserId = await ownerUserId(db, connection);
  let updated;
  await db.transaction(async (client) => {
    const row = (
      await client.query(
        `SELECT o.*,
                EXISTS(SELECT 1 FROM provider_orders po WHERE po.order_id=o.id) AS provider_linked
         FROM orders o
         WHERE o.id=$1 AND o.tenant_id=$2 AND o.store_id=$3
         FOR UPDATE OF o`,
        [orderId, connection.tenant_id, connection.store_id]
      )
    ).rows[0];
    if (!row) throw new Error("order_not_found");
    if (row.provider_linked) throw new Error("provider_order_managed");

    const allowed =
      (targetStatus === "processing" && row.status === "paid" && row.payment_status === "paid") ||
      (targetStatus === "completed" && row.status === "processing" && row.payment_status === "paid") ||
      (targetStatus === "cancelled" && ["new", "awaiting_payment"].includes(row.status) && ["unpaid", "pending"].includes(row.payment_status));
    if (!allowed) throw new Error("unsafe_order_transition");

    await client.query(
      "UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND store_id=$4",
      [targetStatus, row.id, connection.tenant_id, connection.store_id]
    );
    await writeAudit(
      client,
      connection,
      actorUserId,
      "order.status_changed_from_admin_bot",
      "order",
      row.id,
      { status: row.status, paymentStatus: row.payment_status },
      { status: targetStatus, paymentStatus: row.payment_status }
    );
    updated = row.id;
  }, connection.tenant_id);
  return orderDetail(db, connection, update, updated);
}

async function processTextSession(db, connection, update, chatId, text, session) {
  if (!session?.key?.startsWith("ops_")) return null;
  const actorUserId = await ownerUserId(db, connection);

  if (session.key === "ops_category_name") {
    const name = safeText(text, 120);
    if (!name || name.length < 2) {
      return withCallback(update, { text: "أرسل اسمًا واضحًا للقسم، أو /cancel للإلغاء." });
    }
    const parentId = session.data.parentId || null;
    let createdId;
    await db.transaction(async (client) => {
      if (parentId) {
        const parent = (
          await client.query(
            `SELECT id FROM categories
             WHERE id=$1 AND tenant_id=$2 AND store_id=$3 AND parent_id IS NULL`,
            [parentId, connection.tenant_id, connection.store_id]
          )
        ).rows[0];
        if (!parent) throw new Error("parent_category_not_found");
      }
      const slug = await uniqueCategorySlug(client, connection, name);
      const sortOrder = Number((
        await client.query(
          `SELECT COALESCE(MAX(sort_order),0)+10 AS next_order FROM categories
           WHERE tenant_id=$1 AND store_id=$2 AND (($3::uuid IS NULL AND parent_id IS NULL) OR parent_id=$3::uuid)`,
          [connection.tenant_id, connection.store_id, parentId]
        )
      ).rows[0]?.next_order || 10);
      createdId = randomUUID();
      await client.query(
        `INSERT INTO categories (
           id, tenant_id, store_id, parent_id, name, slug, sort_order, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`,
        [createdId, connection.tenant_id, connection.store_id, parentId, name, slug, sortOrder]
      );
      await writeAudit(client, connection, actorUserId, "category.created_from_admin_bot", "category", createdId, null, { name, slug, parentId });
    }, connection.tenant_id);
    await clearSession(db, connection, chatId);
    const screen = await categoriesScreen(db, connection, update);
    screen.text = `✅ تم إنشاء القسم: ${name}\n\n${screen.text}`;
    return screen;
  }

  if (session.key === "ops_product_name") {
    const name = safeText(text, 160);
    if (!name || name.length < 2) {
      return withCallback(update, { text: "أرسل اسمًا واضحًا للمنتج، أو /cancel للإلغاء." });
    }
    const product = (
      await db.query(
        "SELECT id, name FROM products WHERE id=$1 AND tenant_id=$2 AND store_id=$3",
        [session.data.productId, connection.tenant_id, connection.store_id]
      )
    ).rows[0];
    if (!product) {
      await clearSession(db, connection, chatId);
      return withCallback(update, { text: "المنتج غير موجود.", reply_markup: keyboard([backHomeRow()]) });
    }
    await db.transaction(async (client) => {
      await client.query(
        "UPDATE products SET name=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND store_id=$4",
        [name, product.id, connection.tenant_id, connection.store_id]
      );
      await writeAudit(client, connection, actorUserId, "product.renamed_from_admin_bot", "product", product.id, { name: product.name }, { name });
    }, connection.tenant_id);
    await clearSession(db, connection, chatId);
    return productDetail(db, connection, update, product.id);
  }

  if (session.key === "ops_product_stock") {
    const raw = String(text || "").trim().toLocaleLowerCase("ar");
    let stock = null;
    if (!["غير محدود", "unlimited", "none", "-"].includes(raw)) {
      if (!/^\d{1,10}$/.test(raw)) {
        return withCallback(update, { text: "أرسل رقم المخزون مثل 25، أو أرسل: غير محدود\nأرسل /cancel للإلغاء." });
      }
      stock = Number.parseInt(raw, 10);
      if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1_000_000_000) {
        return withCallback(update, { text: "قيمة المخزون غير صالحة. أرسل رقمًا من 0 إلى 1000000000، أو: غير محدود" });
      }
    }
    const product = (
      await db.query(
        "SELECT id, stock_quantity FROM products WHERE id=$1 AND tenant_id=$2 AND store_id=$3",
        [session.data.productId, connection.tenant_id, connection.store_id]
      )
    ).rows[0];
    if (!product) {
      await clearSession(db, connection, chatId);
      return withCallback(update, { text: "المنتج غير موجود.", reply_markup: keyboard([backHomeRow()]) });
    }
    await db.transaction(async (client) => {
      await client.query(
        "UPDATE products SET stock_quantity=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND store_id=$4",
        [stock, product.id, connection.tenant_id, connection.store_id]
      );
      await writeAudit(client, connection, actorUserId, "product.stock_changed_from_admin_bot", "product", product.id, { stockQuantity: product.stock_quantity }, { stockQuantity: stock });
    }, connection.tenant_id);
    await clearSession(db, connection, chatId);
    return productDetail(db, connection, update, product.id);
  }

  return null;
}

async function handleCallback(db, connection, update, chatId, data) {
  if (data === "adm:categories") {
    await clearSession(db, connection, chatId);
    return categoriesScreen(db, connection, update);
  }
  if (data === `${CALLBACK_PREFIX}category:add-root`) {
    await setSession(db, connection, chatId, "ops_category_name", { parentId: null });
    return withCallback(update, { text: "➕ أرسل اسم القسم الرئيسي الجديد.\n\nأرسل /cancel للإلغاء." });
  }
  if (data === `${CALLBACK_PREFIX}category:add-child`) {
    await clearSession(db, connection, chatId);
    return chooseParentCategory(db, connection, update);
  }
  if (data.startsWith(`${CALLBACK_PREFIX}category:parent:`)) {
    const parentId = data.slice(`${CALLBACK_PREFIX}category:parent:`.length);
    await setSession(db, connection, chatId, "ops_category_name", { parentId });
    return withCallback(update, { text: "➕ أرسل اسم القسم الفرعي الجديد.\n\nأرسل /cancel للإلغاء." });
  }

  if (data === "adm:products") {
    await clearSession(db, connection, chatId);
    return productsScreen(db, connection, update);
  }
  if (data.startsWith(`${CALLBACK_PREFIX}product:name:`)) {
    const productId = data.slice(`${CALLBACK_PREFIX}product:name:`.length);
    await setSession(db, connection, chatId, "ops_product_name", { productId });
    return withCallback(update, { text: "✏️ أرسل الاسم الجديد للمنتج.\n\nأرسل /cancel للإلغاء." });
  }
  if (data.startsWith(`${CALLBACK_PREFIX}product:stock:`)) {
    const productId = data.slice(`${CALLBACK_PREFIX}product:stock:`.length);
    await setSession(db, connection, chatId, "ops_product_stock", { productId });
    return withCallback(update, { text: "📦 أرسل كمية المخزون الجديدة كرقم.\nللمخزون غير المحدود أرسل: غير محدود\n\nأرسل /cancel للإلغاء." });
  }
  if (data.startsWith(`${CALLBACK_PREFIX}product:category:`)) {
    const productId = data.slice(`${CALLBACK_PREFIX}product:category:`.length);
    return chooseProductCategory(db, connection, update, chatId, productId);
  }
  if (data.startsWith(`${CALLBACK_PREFIX}pcat:`)) {
    const session = await getSession(db, connection, chatId);
    if (session?.key !== "ops_product_category" || !session.data.productId) {
      return withCallback(update, { text: "انتهت جلسة اختيار القسم. افتح المنتج وحاول من جديد.", reply_markup: keyboard([[button("📦 المنتجات", "adm:products")], backHomeRow()]) });
    }
    const categoryToken = data.slice(`${CALLBACK_PREFIX}pcat:`.length);
    const categoryId = categoryToken === "none" ? null : categoryToken;
    const actorUserId = await ownerUserId(db, connection);
    await db.transaction(async (client) => {
      const product = (
        await client.query(
          "SELECT id, category_id FROM products WHERE id=$1 AND tenant_id=$2 AND store_id=$3 FOR UPDATE",
          [session.data.productId, connection.tenant_id, connection.store_id]
        )
      ).rows[0];
      if (!product) throw new Error("product_not_found");
      if (categoryId) {
        const category = (
          await client.query(
            "SELECT id FROM categories WHERE id=$1 AND tenant_id=$2 AND store_id=$3",
            [categoryId, connection.tenant_id, connection.store_id]
          )
        ).rows[0];
        if (!category) throw new Error("category_not_found");
      }
      await client.query(
        "UPDATE products SET category_id=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND store_id=$4",
        [categoryId, product.id, connection.tenant_id, connection.store_id]
      );
      await writeAudit(client, connection, actorUserId, "product.category_changed_from_admin_bot", "product", product.id, { categoryId: product.category_id }, { categoryId });
    }, connection.tenant_id);
    const productId = session.data.productId;
    await clearSession(db, connection, chatId);
    return productDetail(db, connection, update, productId);
  }
  if (data.startsWith(`${CALLBACK_PREFIX}product:toggle:`)) {
    const productId = data.slice(`${CALLBACK_PREFIX}product:toggle:`.length);
    const actorUserId = await ownerUserId(db, connection);
    await db.transaction(async (client) => {
      const product = (
        await client.query(
          "SELECT id, status FROM products WHERE id=$1 AND tenant_id=$2 AND store_id=$3 FOR UPDATE",
          [productId, connection.tenant_id, connection.store_id]
        )
      ).rows[0];
      if (!product) throw new Error("product_not_found");
      const nextStatus = product.status === "active" ? "hidden" : "active";
      await client.query(
        "UPDATE products SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND store_id=$4",
        [nextStatus, product.id, connection.tenant_id, connection.store_id]
      );
      await writeAudit(client, connection, actorUserId, "product.visibility_changed_from_admin_bot", "product", product.id, { status: product.status }, { status: nextStatus });
    }, connection.tenant_id);
    return productDetail(db, connection, update, productId);
  }
  if (data.startsWith(`${CALLBACK_PREFIX}product:`)) {
    return productDetail(db, connection, update, data.slice(`${CALLBACK_PREFIX}product:`.length));
  }

  if (data === "adm:orders") {
    await clearSession(db, connection, chatId);
    return ordersScreen(db, connection, update);
  }
  for (const targetStatus of ["processing", "completed", "cancelled"]) {
    const prefix = `${CALLBACK_PREFIX}order:${targetStatus}:`;
    if (data.startsWith(prefix)) {
      try {
        return await transitionManualOrder(db, connection, update, data.slice(prefix.length), targetStatus);
      } catch (error) {
        const message = String(error?.message || error);
        const friendly = message.includes("provider_order_managed")
          ? "هذا الطلب مرتبط بمزود API؛ لا يمكن تجاوز حالة المزود من البوت."
          : message.includes("unsafe_order_transition")
            ? "تم رفض تغيير الحالة لأنه قد يتجاوز الدفع أو الاسترداد أو تسلسل التنفيذ."
            : "تعذر تغيير حالة الطلب بأمان.";
        return withCallback(update, { text: friendly, reply_markup: keyboard([[button("🧾 الطلبات", "adm:orders")], backHomeRow()]) });
      }
    }
  }
  if (data.startsWith(`${CALLBACK_PREFIX}order:`)) {
    return orderDetail(db, connection, update, data.slice(`${CALLBACK_PREFIX}order:`.length));
  }

  return null;
}

async function resolveAuthorizedContext(db, request) {
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
  const providedSecret = request.headers["x-telegram-bot-api-secret-token"];
  if (!providedSecret || sha256(providedSecret) !== connection.webhook_secret_hash) return null;
  const store = (
    await db.query(
      `SELECT id, tenant_id, name, slug, status, currency, contact_data
       FROM stores WHERE id=$1 AND tenant_id=$2`,
      [connection.store_id, connection.tenant_id]
    )
  ).rows[0];
  if (!store) return null;
  const message = request.body?.message || request.body?.callback_query?.message;
  const chatId = message?.chat?.id;
  const ownerId = jsonObject(store.contact_data, {}).telegramOwnerId;
  if (!chatId || !ownerId || String(ownerId) !== String(chatId)) return null;
  if (message?.chat?.type && message.chat.type !== "private") return null;
  return { connection, store, chatId };
}

async function sendHandledReply(config, request, reply, connection, chatId, payload) {
  const gateway = new TelegramGateway(config, request.log);
  const token = decryptSecret(connection.token_ciphertext, config.encryptionKey);
  await gateway.sendMessage(token, chatId, payload);
  reply.code(204).send();
  return reply;
}

export function installAdminBotOperationsV2(app, { db, config }) {
  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;
    const path = String(request.raw?.url || request.url || "").split("?")[0];
    if (!path.startsWith("/webhooks/telegram-admin/")) return;

    const context = await resolveAuthorizedContext(db, request);
    if (!context) return;
    const { connection, chatId } = context;
    const update = request.body || {};
    const data = String(update?.callback_query?.data || "").trim();
    const text = String(update?.message?.text || "").trim();

    if (text === "/cancel") {
      const session = await getSession(db, connection, chatId);
      if (!session?.key?.startsWith("ops_")) return;
      await clearSession(db, connection, chatId);
      return sendHandledReply(
        config,
        request,
        reply,
        connection,
        chatId,
        withCallback(update, { text: "تم إلغاء العملية الحالية.", reply_markup: keyboard([backHomeRow()]) })
      );
    }

    let payload = null;
    if (data) payload = await handleCallback(db, connection, update, chatId, data);
    if (!payload && text && !text.startsWith("/")) {
      const session = await getSession(db, connection, chatId);
      payload = await processTextSession(db, connection, update, chatId, text, session);
    }
    if (!payload) return;
    return sendHandledReply(config, request, reply, connection, chatId, payload);
  });
}
