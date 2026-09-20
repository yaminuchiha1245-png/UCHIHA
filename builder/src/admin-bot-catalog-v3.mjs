import { randomUUID } from "node:crypto";
import { decryptSecret, normalizeSlug, safeText, sha256 } from "./security.mjs";
import { analyzeProductInputSchema } from "./product-intelligence.mjs";
import { TelegramGateway } from "./telegram.mjs";

const PREFIX = "adm6:";
const SESSION_MINUTES = 20;
const PRODUCT_TYPES = new Set([
  "digital",
  "physical",
  "service",
  "subscription",
  "code",
  "account",
  "game_topup",
  "programming_service"
]);
const DELIVERY_MODES = new Set(["manual", "automatic"]);
const PRODUCT_MEDIA = Object.freeze({
  "digital-card": "/assets/catalog-assets/digital-card.svg",
  "game-topup": "/assets/catalog-assets/game-topup.svg",
  "mobile-credit": "/assets/catalog-assets/mobile-credit.svg",
  subscription: "/assets/catalog-assets/subscription.svg",
  software: "/assets/catalog-assets/software.svg",
  "social-service": "/assets/catalog-assets/social-service.svg",
  programming: "/assets/catalog-assets/programming.svg"
});

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

function currencyFactor(currency) {
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    return 10 ** digits;
  } catch {
    return 100;
  }
}

function amountText(minor, currency) {
  try {
    return new Intl.NumberFormat("ar", { style: "currency", currency }).format(Number(minor || 0) / currencyFactor(currency));
  } catch {
    return `${Number(minor || 0) / currencyFactor(currency)} ${currency || ""}`.trim();
  }
}

function majorToMinor(value, currency) {
  const normalized = String(value || "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,8})?$/.test(normalized)) return null;
  const major = Number(normalized);
  if (!Number.isFinite(major) || major < 0) return null;
  const minor = Math.round(major * currencyFactor(currency));
  return Number.isSafeInteger(minor) && minor >= 0 && minor <= 1_000_000_000_000 ? minor : null;
}

function productTypeLabel(type) {
  return ({
    digital: "منتج رقمي",
    physical: "منتج مادي",
    service: "خدمة",
    subscription: "اشتراك",
    code: "كود / بطاقة",
    account: "حساب",
    game_topup: "شحن ألعاب",
    programming_service: "خدمة برمجية"
  })[type] || type;
}

function statusLabel(status) {
  return ({ active: "ظاهر", hidden: "مخفي", unavailable: "غير متاح" })[status] || status || "—";
}

function inferProductMediaKey(productType, name = "") {
  const searchable = String(name).toLowerCase();
  if (productType === "programming_service" || /برمج|موقع|تطبيق|تطوير|واجهة|api/.test(searchable)) return "programming";
  if (productType === "game_topup" || /لعب|game|ببجي|pubg|فري فاير|free fire/.test(searchable)) return "game-topup";
  if (/رصيد|اتصال|هاتف|موبايل|mobile|telecom/.test(searchable)) return "mobile-credit";
  if (productType === "subscription" || /اشتراك|مشاهدة|netflix|stream/.test(searchable)) return "subscription";
  if (/تواصل|اجتماع|متابع|مشاهد|social|telegram|instagram|youtube/.test(searchable)) return "social-service";
  if (/برنامج|تصميم|software|windows|android|ios|أداة/.test(searchable)) return "software";
  return "digital-card";
}

function defaultMedia(productType, name) {
  const key = inferProductMediaKey(productType, name);
  return {
    imageUrl: PRODUCT_MEDIA[key] || PRODUCT_MEDIA["digital-card"],
    metadata: { media: { source: "platform", key, locked: false } }
  };
}

function safeHttpsUrl(value) {
  const text = String(value || "").trim();
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  return url.toString().slice(0, 1000);
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

async function storeRow(db, connection) {
  return (
    await db.query(
      `SELECT id, tenant_id, name, slug, currency, contact_data
       FROM stores WHERE id=$1 AND tenant_id=$2`,
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

async function writeAudit(client, connection, actorUserId, action, entityId, beforeData = null, afterData = null) {
  await client.query(
    `INSERT INTO audit_logs (
       id, tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data
     ) VALUES ($1,$2,$3,$4,'product',$5,$6,$7)`,
    [
      randomUUID(), connection.tenant_id, actorUserId, action, entityId,
      beforeData === null ? null : JSON.stringify(beforeData),
      afterData === null ? null : JSON.stringify(afterData)
    ]
  );
}

async function uniqueProductSlug(client, connection, name) {
  const base = normalizeSlug(name) || `item-${randomUUID().slice(0, 8)}`;
  let candidate = base.slice(0, 80);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const exists = (
      await client.query(
        "SELECT 1 FROM products WHERE tenant_id=$1 AND slug=$2 LIMIT 1",
        [connection.tenant_id, candidate]
      )
    ).rows[0];
    if (!exists) return candidate;
    candidate = `${base}-${attempt + 2}`.slice(0, 80);
  }
  return `${base}-${randomUUID().slice(0, 8)}`.slice(0, 80);
}

async function productsView(db, connection, update, notice = "") {
  const rows = (
    await db.query(
      `SELECT p.id, p.name, p.product_type, p.price_minor, p.currency, p.status,
              p.stock_quantity, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.id=p.category_id
       WHERE p.tenant_id=$1 AND p.store_id=$2
       ORDER BY p.updated_at DESC, p.created_at DESC LIMIT 12`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows;
  const lines = rows.length
    ? rows.map((row) =>
        `• ${row.name}\n  ${amountText(row.price_minor, row.currency)} • ${productTypeLabel(row.product_type)} • ${statusLabel(row.status)}${row.category_name ? ` • ${row.category_name}` : ""}`
      ).join("\n\n")
    : "لا توجد منتجات بعد.";
  const buttons = rows.slice(0, 10).map((row) => [button(`📦 ${String(row.name).slice(0, 28)}`, `${PREFIX}view:${row.id}`)]);
  buttons.push([button("➕ إضافة منتج", `${PREFIX}create`, "success"), button("🔎 بحث", `${PREFIX}search`, "primary")]);
  buttons.push(homeRow());
  return payload(update, `${notice ? `${notice}\n\n` : ""}📦 المنتجات\n\n${lines}`, buttons);
}

async function productView(db, connection, update, productId) {
  const row = (
    await db.query(
      `SELECT p.*, c.name AS category_name
       FROM products p LEFT JOIN categories c ON c.id=p.category_id
       WHERE p.id=$1 AND p.tenant_id=$2 AND p.store_id=$3`,
      [productId, connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  if (!row) return payload(update, "المنتج غير موجود.", [[button("📦 المنتجات", "adm:products")], homeRow()]);
  const sourceNote = row.source_kind === "local" ? "محلي" : row.source_kind === "uchiha_api" ? "UCHIHA API" : "خدمات البرمجة";
  return payload(
    update,
    `📦 ${row.name}\n\n` +
      `السعر: ${amountText(row.price_minor, row.currency)}\n` +
      `النوع: ${productTypeLabel(row.product_type)}\n` +
      `القسم: ${row.category_name || "بدون قسم"}\n` +
      `المخزون: ${row.stock_quantity === null ? "غير محدود" : row.stock_quantity}\n` +
      `التنفيذ: ${row.delivery_mode}\n` +
      `المصدر: ${sourceNote}\n` +
      `الحالة: ${statusLabel(row.status)}\n` +
      `الصورة: ${row.image_url || "افتراضية"}\n\n` +
      `${String(row.description || "لا يوجد وصف.").slice(0, 500)}`,
    [
      [button("✏️ الاسم", `adm3:product:name:${row.id}`), button("💵 السعر", `adm:product:price:${row.id}`, "primary")],
      [button("📝 الوصف", `${PREFIX}description:${row.id}`), button("🖼 الصورة", `${PREFIX}image:${row.id}`)],
      [button("📦 المخزون", `adm3:product:stock:${row.id}`), button("🗂 القسم", `adm3:product:category:${row.id}`)],
      [button(row.status === "active" ? "🙈 إخفاء" : "👁 إظهار", `adm3:product:toggle:${row.id}`, row.status === "active" ? "danger" : "success")],
      [button("↩️ المنتجات", "adm:products")],
      homeRow()
    ]
  );
}

async function searchResults(db, connection, update, query) {
  const like = `%${query.toLocaleLowerCase("ar")}%`;
  const rows = (
    await db.query(
      `SELECT id, name, price_minor, currency, status
       FROM products
       WHERE tenant_id=$1 AND store_id=$2
         AND (LOWER(name) LIKE $3 OR LOWER(COALESCE(description,'')) LIKE $3)
       ORDER BY updated_at DESC, created_at DESC LIMIT 15`,
      [connection.tenant_id, connection.store_id, like]
    )
  ).rows;
  if (!rows.length) {
    return payload(update, `🔎 لم أجد نتائج لـ: ${query}`, [[button("🔎 بحث جديد", `${PREFIX}search`)], [button("📦 المنتجات", "adm:products")], homeRow()]);
  }
  const buttons = rows.map((row) => [button(`📦 ${String(row.name).slice(0, 30)}`, `${PREFIX}view:${row.id}`)]);
  buttons.push([button("🔎 بحث جديد", `${PREFIX}search`), button("📦 المنتجات", "adm:products")]);
  buttons.push(homeRow());
  return payload(
    update,
    `🔎 نتائج البحث عن: ${query}\n\n${rows.map((row) => `• ${row.name} — ${amountText(row.price_minor, row.currency)} • ${statusLabel(row.status)}`).join("\n")}`,
    buttons
  );
}

async function categoryPicker(db, connection, update) {
  const rows = (
    await db.query(
      `SELECT c.id, c.name, c.parent_id, p.name AS parent_name
       FROM categories c
       LEFT JOIN categories p ON p.id=c.parent_id
       WHERE c.tenant_id=$1 AND c.store_id=$2 AND c.status='active'
       ORDER BY c.parent_id NULLS FIRST, c.sort_order, c.created_at LIMIT 20`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows;
  const buttons = [[button("بدون قسم", `${PREFIX}create:category:none`)]];
  for (const row of rows) {
    const label = row.parent_name ? `${row.parent_name} / ${row.name}` : row.name;
    buttons.push([button(`🗂 ${String(label).slice(0, 32)}`, `${PREFIX}create:category:${row.id}`)]);
  }
  buttons.push([button("❌ إلغاء", `${PREFIX}create:cancel`, "danger")]);
  return payload(update, "🗂 اختر القسم الذي سيظهر فيه المنتج:", buttons);
}

async function createConfirmation(db, connection, update, session) {
  const store = await storeRow(db, connection);
  if (!store) return payload(update, "المتجر غير موجود.", [homeRow()]);
  let categoryName = "بدون قسم";
  if (session.data.categoryId) {
    const category = (
      await db.query(
        "SELECT name FROM categories WHERE id=$1 AND tenant_id=$2 AND store_id=$3",
        [session.data.categoryId, connection.tenant_id, connection.store_id]
      )
    ).rows[0];
    if (!category) return payload(update, "القسم المختار لم يعد موجودًا. ابدأ إضافة المنتج من جديد.", [[button("➕ إضافة منتج", `${PREFIX}create`)], homeRow()]);
    categoryName = category.name;
  }
  return payload(
    update,
    `✅ مراجعة المنتج قبل الحفظ\n\n` +
      `الاسم: ${session.data.name}\n` +
      `النوع: ${productTypeLabel(session.data.productType)}\n` +
      `القسم: ${categoryName}\n` +
      `السعر: ${amountText(session.data.priceMinor, store.currency)}\n` +
      `المخزون: ${session.data.stockQuantity === null ? "غير محدود" : session.data.stockQuantity}\n` +
      `التنفيذ: ${session.data.deliveryMode === "automatic" ? "تلقائي محلي" : "يدوي"}\n` +
      `الوصف: ${session.data.description || "—"}\n\n` +
      `لن يتم إنشاء المنتج قبل الضغط على تأكيد.`,
    [[button("✅ إنشاء المنتج", `${PREFIX}create:confirm:${session.data.operationId}`, "success")], [button("❌ إلغاء", `${PREFIX}create:cancel`, "danger")]]
  );
}

async function createProduct(db, connection, update, chatId, operationId) {
  const session = await sessionGet(db, connection, chatId);
  if (session?.key !== "cat3_create_confirm" || session.data.operationId !== operationId) {
    return payload(update, "انتهت جلسة إنشاء المنتج أو تغيرت. ابدأ من جديد.", [[button("➕ إضافة منتج", `${PREFIX}create`)], [button("📦 المنتجات", "adm:products")], homeRow()]);
  }
  const store = await storeRow(db, connection);
  if (!store) return payload(update, "المتجر غير موجود.", [homeRow()]);
  const actorUserId = await ownerUserId(db, connection);
  if (!actorUserId) return payload(update, "تعذر تحديد مالك المتجر لإتمام العملية بأمان.", [homeRow()]);
  const data = session.data;
  if (!PRODUCT_TYPES.has(data.productType) || !DELIVERY_MODES.has(data.deliveryMode)) {
    return payload(update, "بيانات المنتج غير صالحة. ابدأ من جديد.", [[button("➕ إضافة منتج", `${PREFIX}create`)], homeRow()]);
  }
  const requestHash = sha256(JSON.stringify({
    productType: data.productType,
    name: data.name,
    description: data.description,
    categoryId: data.categoryId || null,
    priceMinor: data.priceMinor,
    stockQuantity: data.stockQuantity,
    deliveryMode: data.deliveryMode
  }));
  let productId;
  let duplicate = false;

  await db.transaction(async (client) => {
    await client.query(
      `INSERT INTO admin_idempotency_records (
         id, tenant_id, store_id, actor_user_id, scope, idempotency_key, request_hash
       ) VALUES ($1,$2,$3,$4,'telegram.product.create',$5,$6)
       ON CONFLICT (store_id, actor_user_id, scope, idempotency_key) DO NOTHING`,
      [randomUUID(), connection.tenant_id, connection.store_id, actorUserId, operationId, requestHash]
    );
    const idempotency = (
      await client.query(
        `SELECT * FROM admin_idempotency_records
         WHERE tenant_id=$1 AND store_id=$2 AND actor_user_id=$3
           AND scope='telegram.product.create' AND idempotency_key=$4
         FOR UPDATE`,
        [connection.tenant_id, connection.store_id, actorUserId, operationId]
      )
    ).rows[0];
    if (!idempotency || idempotency.request_hash !== requestHash) throw new Error("product_create_idempotency_conflict");
    if (idempotency.resource_id) {
      const existing = (
        await client.query(
          "SELECT id FROM products WHERE id=$1 AND tenant_id=$2 AND store_id=$3",
          [idempotency.resource_id, connection.tenant_id, connection.store_id]
        )
      ).rows[0];
      if (!existing) throw new Error("product_create_replay_missing_resource");
      productId = existing.id;
      duplicate = true;
      return;
    }

    if (data.categoryId) {
      const category = (
        await client.query(
          "SELECT id FROM categories WHERE id=$1 AND tenant_id=$2 AND store_id=$3",
          [data.categoryId, connection.tenant_id, connection.store_id]
        )
      ).rows[0];
      if (!category) throw new Error("product_category_not_found");
    }

    productId = randomUUID();
    const slug = await uniqueProductSlug(client, connection, data.name);
    const media = defaultMedia(data.productType, data.name);
    const analysis = analyzeProductInputSchema({
      productType: data.productType,
      name: data.name,
      description: data.description,
      fields: [],
      options: []
    });
    const fields = analysis.autoApply ? analysis.fields : [];
    const options = analysis.autoApply ? analysis.options : [];

    await client.query(
      `INSERT INTO products (
         id, tenant_id, store_id, category_id, product_type, name, slug,
         description, image_url, price_minor, currency, stock_quantity,
         min_quantity, max_quantity, delivery_mode, source_kind, fields,
         options, metadata, sort_order, status
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
         1,NULL,$13,'local',$14,$15,$16,0,'active'
       )`,
      [
        productId, connection.tenant_id, connection.store_id, data.categoryId || null,
        data.productType, data.name, slug, data.description || "", media.imageUrl,
        Number(data.priceMinor), store.currency, data.stockQuantity,
        data.deliveryMode, JSON.stringify(fields), JSON.stringify(options), JSON.stringify(media.metadata)
      ]
    );
    await client.query(
      `INSERT INTO product_input_analyses (
         id, tenant_id, store_id, product_id, analyzer_version, detected_kind,
         confidence, status, suggested_fields, suggested_options, signals
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (tenant_id, store_id, product_id) DO UPDATE SET
         analyzer_version=EXCLUDED.analyzer_version,
         detected_kind=EXCLUDED.detected_kind,
         confidence=EXCLUDED.confidence,
         status=EXCLUDED.status,
         suggested_fields=EXCLUDED.suggested_fields,
         suggested_options=EXCLUDED.suggested_options,
         signals=EXCLUDED.signals,
         updated_at=NOW()`,
      [
        randomUUID(), connection.tenant_id, connection.store_id, productId,
        analysis.analyzerVersion, analysis.detectedKind, analysis.confidence, analysis.status,
        JSON.stringify(analysis.fields), JSON.stringify(analysis.options), JSON.stringify(analysis.signals)
      ]
    );
    await client.query(
      `INSERT INTO outbox_events (
         id, tenant_id, aggregate_type, aggregate_id, event_type, payload
       ) VALUES ($1,$2,'product',$3,'product.created',$4)`,
      [randomUUID(), connection.tenant_id, productId, JSON.stringify({ storeId: connection.store_id, source: "telegram_admin", analysisStatus: analysis.status })]
    );
    await writeAudit(client, connection, actorUserId, "product.created_from_admin_bot", productId, null, {
      name: data.name,
      productType: data.productType,
      categoryId: data.categoryId || null,
      priceMinor: Number(data.priceMinor),
      currency: store.currency,
      stockQuantity: data.stockQuantity,
      deliveryMode: data.deliveryMode
    });
    await client.query(
      `UPDATE admin_idempotency_records
       SET resource_id=$1, response_data=$2, updated_at=NOW()
       WHERE id=$3`,
      [productId, JSON.stringify({ productId }), idempotency.id]
    );
  }, connection.tenant_id);

  await sessionClear(db, connection, chatId);
  const detail = await productView(db, connection, update, productId);
  detail.text = `${duplicate ? "ℹ️ تم التعرف على إعادة الإرسال ولم يُنشأ المنتج مرتين." : "✅ تم إنشاء المنتج بنجاح."}\n\n${detail.text}`;
  return detail;
}

async function processTextSession(db, connection, store, update, chatId, text, session) {
  if (!session?.key?.startsWith("cat3_")) return null;

  if (session.key === "cat3_search") {
    const query = safeText(text, 120);
    if (!query) return payload(update, "أرسل كلمة بحث، أو /cancel للإلغاء.");
    await sessionClear(db, connection, chatId);
    return searchResults(db, connection, update, query);
  }

  if (session.key === "cat3_create_name") {
    const name = safeText(text, 160);
    if (!name || name.length < 2) return payload(update, "أرسل اسمًا واضحًا للمنتج، أو /cancel للإلغاء.");
    await sessionSet(db, connection, chatId, "cat3_create_description", { ...session.data, name });
    return payload(update, `الاسم: ${name}\n\nأرسل وصف المنتج. إذا لا تريد وصفًا أرسل: -\nأرسل /cancel للإلغاء.`);
  }

  if (session.key === "cat3_create_description") {
    const raw = String(text || "").trim();
    const description = raw === "-" ? "" : safeText(raw, 4000);
    if (raw !== "-" && !description) return payload(update, "أرسل وصفًا صالحًا أو أرسل - بدون وصف.");
    await sessionSet(db, connection, chatId, "cat3_create_category", { ...session.data, description });
    return categoryPicker(db, connection, update);
  }

  if (session.key === "cat3_create_price") {
    const minor = majorToMinor(text, store.currency);
    if (minor === null) return payload(update, `أرسل سعرًا صحيحًا بعملة ${store.currency}. مثال: 12.50\nيمكن استخدام 0 للمنتج المجاني.\nأرسل /cancel للإلغاء.`);
    await sessionSet(db, connection, chatId, "cat3_create_stock", { ...session.data, priceMinor: minor });
    return payload(update, "📦 أرسل كمية المخزون كرقم، أو أرسل: غير محدود\n\nأرسل /cancel للإلغاء.");
  }

  if (session.key === "cat3_create_stock") {
    const raw = String(text || "").trim().toLocaleLowerCase("ar");
    let stockQuantity = null;
    if (!["غير محدود", "unlimited", "none", "-"].includes(raw)) {
      if (!/^\d{1,10}$/.test(raw)) return payload(update, "أرسل رقم مخزون صحيحًا، أو: غير محدود\nأرسل /cancel للإلغاء.");
      stockQuantity = Number.parseInt(raw, 10);
      if (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 1_000_000_000) {
        return payload(update, "المخزون يجب أن يكون بين 0 و1000000000، أو: غير محدود");
      }
    }
    await sessionSet(db, connection, chatId, "cat3_create_delivery", { ...session.data, stockQuantity });
    return payload(
      update,
      "⚙️ اختر طريقة تنفيذ المنتج:\n\n• يدوي: الإدارة تنفذ الطلب يدويًا.\n• تلقائي محلي: لمنتج لديك له تسليم تلقائي محلي جاهز.\n\nخدمات UCHIHA API لا تُنشأ من هذا المسار.",
      [[button("🛠 يدوي", `${PREFIX}create:delivery:manual`, "primary"), button("⚡ تلقائي محلي", `${PREFIX}create:delivery:automatic`)], [button("❌ إلغاء", `${PREFIX}create:cancel`, "danger")]]
    );
  }

  if (session.key === "cat3_description_edit") {
    const product = (
      await db.query(
        "SELECT id, description FROM products WHERE id=$1 AND tenant_id=$2 AND store_id=$3",
        [session.data.productId, connection.tenant_id, connection.store_id]
      )
    ).rows[0];
    if (!product) {
      await sessionClear(db, connection, chatId);
      return payload(update, "المنتج غير موجود.", [[button("📦 المنتجات", "adm:products")], homeRow()]);
    }
    const raw = String(text || "").trim();
    const description = raw === "-" ? "" : safeText(raw, 4000);
    if (raw !== "-" && !description) return payload(update, "أرسل وصفًا صالحًا، أو - لمسح الوصف.");
    const actorUserId = await ownerUserId(db, connection);
    await db.transaction(async (client) => {
      await client.query(
        "UPDATE products SET description=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND store_id=$4",
        [description, product.id, connection.tenant_id, connection.store_id]
      );
      await writeAudit(client, connection, actorUserId, "product.description_changed_from_admin_bot", product.id, { description: product.description || "" }, { description });
    }, connection.tenant_id);
    await sessionClear(db, connection, chatId);
    return productView(db, connection, update, product.id);
  }

  if (session.key === "cat3_image_edit") {
    const product = (
      await db.query(
        "SELECT id, name, product_type, image_url, metadata FROM products WHERE id=$1 AND tenant_id=$2 AND store_id=$3",
        [session.data.productId, connection.tenant_id, connection.store_id]
      )
    ).rows[0];
    if (!product) {
      await sessionClear(db, connection, chatId);
      return payload(update, "المنتج غير موجود.", [[button("📦 المنتجات", "adm:products")], homeRow()]);
    }
    const raw = String(text || "").trim();
    let imageUrl;
    let media;
    if (raw === "-") {
      const fallback = defaultMedia(product.product_type, product.name);
      imageUrl = fallback.imageUrl;
      media = fallback.metadata.media;
    } else {
      imageUrl = safeHttpsUrl(raw);
      if (!imageUrl) return payload(update, "الرابط غير صالح. أرسل رابط HTTPS مباشرًا للصورة، أو - للعودة للصورة الافتراضية.");
      media = { source: "merchant", key: null, locked: true };
    }
    const metadata = { ...objectValue(product.metadata, {}), media };
    const actorUserId = await ownerUserId(db, connection);
    await db.transaction(async (client) => {
      await client.query(
        "UPDATE products SET image_url=$1, metadata=$2, updated_at=NOW() WHERE id=$3 AND tenant_id=$4 AND store_id=$5",
        [imageUrl, JSON.stringify(metadata), product.id, connection.tenant_id, connection.store_id]
      );
      await writeAudit(client, connection, actorUserId, "product.media_changed_from_admin_bot", product.id, { imageUrl: product.image_url }, { imageUrl, media });
    }, connection.tenant_id);
    await sessionClear(db, connection, chatId);
    return productView(db, connection, update, product.id);
  }

  return null;
}

async function handleCallback(db, connection, store, update, chatId, data) {
  if (data === "adm:products") {
    await sessionClear(db, connection, chatId);
    return productsView(db, connection, update);
  }
  if (data === `${PREFIX}search`) {
    await sessionSet(db, connection, chatId, "cat3_search", {});
    return payload(update, "🔎 أرسل اسم المنتج أو كلمة من الوصف للبحث.\n\nأرسل /cancel للإلغاء.");
  }
  if (data.startsWith(`${PREFIX}view:`)) {
    return productView(db, connection, update, data.slice(`${PREFIX}view:`.length));
  }
  if (data === `${PREFIX}create`) {
    await sessionClear(db, connection, chatId);
    return payload(update, "➕ اختر نوع المنتج المحلي الذي تريد إنشاءه:", [
      [button("🎁 رقمي", `${PREFIX}create:type:digital`), button("🛍 مادي", `${PREFIX}create:type:physical`)],
      [button("🛠 خدمة", `${PREFIX}create:type:service`), button("🔁 اشتراك", `${PREFIX}create:type:subscription`)],
      [button("🎟 كود / بطاقة", `${PREFIX}create:type:code`), button("👤 حساب", `${PREFIX}create:type:account`)],
      [button("🎮 شحن ألعاب", `${PREFIX}create:type:game_topup`), button("💻 خدمة برمجية", `${PREFIX}create:type:programming_service`)],
      [button("❌ إلغاء", `${PREFIX}create:cancel`, "danger")]
    ]);
  }
  if (data.startsWith(`${PREFIX}create:type:`)) {
    const productType = data.slice(`${PREFIX}create:type:`.length);
    if (!PRODUCT_TYPES.has(productType)) return payload(update, "نوع المنتج غير صالح.", [[button("➕ إضافة منتج", `${PREFIX}create`)], homeRow()]);
    await sessionSet(db, connection, chatId, "cat3_create_name", { productType, operationId: randomUUID() });
    return payload(update, `النوع: ${productTypeLabel(productType)}\n\nأرسل اسم المنتج كما سيظهر للعميل.\nأرسل /cancel للإلغاء.`);
  }
  if (data.startsWith(`${PREFIX}create:category:`)) {
    const session = await sessionGet(db, connection, chatId);
    if (session?.key !== "cat3_create_category") return payload(update, "انتهت خطوة اختيار القسم. ابدأ إضافة المنتج من جديد.", [[button("➕ إضافة منتج", `${PREFIX}create`)], homeRow()]);
    const token = data.slice(`${PREFIX}create:category:`.length);
    const categoryId = token === "none" ? null : token;
    if (categoryId) {
      const category = (
        await db.query(
          "SELECT id FROM categories WHERE id=$1 AND tenant_id=$2 AND store_id=$3 AND status='active'",
          [categoryId, connection.tenant_id, connection.store_id]
        )
      ).rows[0];
      if (!category) return payload(update, "القسم غير صالح أو أصبح مخفيًا. اختر قسمًا آخر.", [[button("🗂 إعادة اختيار القسم", `${PREFIX}create:categories`)], [button("❌ إلغاء", `${PREFIX}create:cancel`, "danger")]]);
    }
    await sessionSet(db, connection, chatId, "cat3_create_price", { ...session.data, categoryId });
    return payload(update, `💵 أرسل سعر المنتج بعملة ${store.currency}.\nمثال: 12.50\nيمكن استخدام 0 للمنتج المجاني.\n\nأرسل /cancel للإلغاء.`);
  }
  if (data === `${PREFIX}create:categories`) {
    return categoryPicker(db, connection, update);
  }
  if (data.startsWith(`${PREFIX}create:delivery:`)) {
    const session = await sessionGet(db, connection, chatId);
    if (session?.key !== "cat3_create_delivery") return payload(update, "انتهت خطوة اختيار التنفيذ. ابدأ إضافة المنتج من جديد.", [[button("➕ إضافة منتج", `${PREFIX}create`)], homeRow()]);
    const deliveryMode = data.slice(`${PREFIX}create:delivery:`.length);
    if (!DELIVERY_MODES.has(deliveryMode)) return payload(update, "طريقة التنفيذ غير صالحة.", [homeRow()]);
    const next = { ...session.data, deliveryMode };
    await sessionSet(db, connection, chatId, "cat3_create_confirm", next);
    return createConfirmation(db, connection, update, { key: "cat3_create_confirm", data: next });
  }
  if (data.startsWith(`${PREFIX}create:confirm:`)) {
    try {
      return await createProduct(db, connection, update, chatId, data.slice(`${PREFIX}create:confirm:`.length));
    } catch (error) {
      const message = String(error?.message || error);
      const friendly = message.includes("product_category_not_found")
        ? "القسم المختار لم يعد موجودًا. ابدأ إنشاء المنتج من جديد."
        : message.includes("product_create_idempotency_conflict")
          ? "تم رفض إعادة الإرسال لأن بيانات العملية تغيرت. ابدأ إنشاء منتج جديد."
          : "تعذر إنشاء المنتج بأمان. لم يتم اعتماد العملية؛ أعد المحاولة.";
      return payload(update, friendly, [[button("➕ إضافة منتج", `${PREFIX}create`)], [button("📦 المنتجات", "adm:products")], homeRow()]);
    }
  }
  if (data === `${PREFIX}create:cancel`) {
    await sessionClear(db, connection, chatId);
    return productsView(db, connection, update, "تم إلغاء إنشاء المنتج.");
  }
  if (data.startsWith(`${PREFIX}description:`)) {
    const productId = data.slice(`${PREFIX}description:`.length);
    const exists = (
      await db.query("SELECT id FROM products WHERE id=$1 AND tenant_id=$2 AND store_id=$3", [productId, connection.tenant_id, connection.store_id])
    ).rows[0];
    if (!exists) return payload(update, "المنتج غير موجود.", [[button("📦 المنتجات", "adm:products")], homeRow()]);
    await sessionSet(db, connection, chatId, "cat3_description_edit", { productId });
    return payload(update, "📝 أرسل الوصف الجديد للمنتج.\nأرسل - لمسح الوصف.\nأرسل /cancel للإلغاء.");
  }
  if (data.startsWith(`${PREFIX}image:`)) {
    const productId = data.slice(`${PREFIX}image:`.length);
    const exists = (
      await db.query("SELECT id FROM products WHERE id=$1 AND tenant_id=$2 AND store_id=$3", [productId, connection.tenant_id, connection.store_id])
    ).rows[0];
    if (!exists) return payload(update, "المنتج غير موجود.", [[button("📦 المنتجات", "adm:products")], homeRow()]);
    await sessionSet(db, connection, chatId, "cat3_image_edit", { productId });
    return payload(update, "🖼 أرسل رابط HTTPS مباشرًا لصورة المنتج.\nأرسل - للعودة إلى الصورة الافتراضية المناسبة للمنتج.\nأرسل /cancel للإلغاء.");
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
  return { connection, store, chatId };
}

async function send(config, request, reply, connection, chatId, outgoing) {
  const gateway = new TelegramGateway(config, request.log);
  const token = decryptSecret(connection.token_ciphertext, config.encryptionKey);
  await gateway.sendMessage(token, chatId, outgoing);
  reply.code(204).send();
  return reply;
}

export function installAdminBotCatalogV3(app, { db, config }) {
  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;
    const path = String(request.raw?.url || request.url || "").split("?")[0];
    if (!path.startsWith("/webhooks/telegram-admin/")) return;
    const context = await authorizedContext(db, request);
    if (!context) return;
    const { connection, store, chatId } = context;
    const update = request.body || {};
    const data = String(update?.callback_query?.data || "").trim();
    const text = String(update?.message?.text || "").trim();
    let outgoing = null;

    if (text === "/cancel") {
      const session = await sessionGet(db, connection, chatId);
      if (!session?.key?.startsWith("cat3_")) return;
      await sessionClear(db, connection, chatId);
      outgoing = payload(update, "تم إلغاء عملية الكتالوج الحالية.", [[button("📦 المنتجات", "adm:products")], homeRow()]);
    } else if (data) {
      outgoing = await handleCallback(db, connection, store, update, chatId, data);
    } else if (text && !text.startsWith("/")) {
      outgoing = await processTextSession(db, connection, store, update, chatId, text, await sessionGet(db, connection, chatId));
    }

    if (!outgoing) return;
    return send(config, request, reply, connection, chatId, outgoing);
  });
}
