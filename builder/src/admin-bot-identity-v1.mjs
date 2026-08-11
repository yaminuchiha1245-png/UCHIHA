import { randomUUID } from "node:crypto";
import { decryptSecret, safeText, sha256 } from "./security.mjs";
import { TelegramGateway } from "./telegram.mjs";

const PREFIX = "adm7:";
const SESSION_MINUTES = 20;
const FONTS = new Set(["Tajawal", "Cairo", "Noto Kufi Arabic", "system-ui"]);
const SUPPORTED_CURRENCIES = new Set(
  (typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("currency")
    : ["AED", "BHD", "EUR", "GBP", "IQD", "JOD", "KWD", "QAR", "SAR", "TRY", "USD"])
    .map((value) => String(value).toUpperCase())
);

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

function cleanOptionalText(value, maximum = 500) {
  const raw = String(value || "").trim();
  if (!raw || raw === "-" || raw.toLocaleLowerCase("en") === "none") return null;
  return safeText(raw, maximum) || null;
}

function validHex(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "").trim());
}

function safeHttpsUrl(value) {
  const raw = cleanOptionalText(value, 1000);
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  return url.toString().slice(0, 1000);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function currencyCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || !SUPPORTED_CURRENCIES.has(code)) return null;
  return code;
}

function currencyRate(value) {
  const normalized = String(value || "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,8})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000_000) return null;
  return Math.round(parsed * 100_000_000) / 100_000_000;
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
      `SELECT id, tenant_id, name, slug, status, currency, welcome_message, contact_data
       FROM stores WHERE id=$1 AND tenant_id=$2`,
      [connection.store_id, connection.tenant_id]
    )
  ).rows[0];
}

async function audit(client, connection, actorUserId, action, entityType, entityId, beforeData = null, afterData = null) {
  await client.query(
    `INSERT INTO audit_logs (
       id, tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      randomUUID(), connection.tenant_id, actorUserId, action, entityType, entityId,
      beforeData === null ? null : JSON.stringify(beforeData),
      afterData === null ? null : JSON.stringify(afterData)
    ]
  );
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

async function settingsHub(db, connection, update, notice = "") {
  const store = await storeRow(db, connection);
  if (!store) return payload(update, "المتجر غير موجود.", [homeRow()]);
  const stats = (
    await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM store_currency_settings WHERE tenant_id=$1 AND store_id=$2 AND is_enabled=TRUE) AS currencies,
         (SELECT COUNT(*)::int FROM store_support_channels WHERE tenant_id=$1 AND store_id=$2 AND status='active') AS support_channels,
         (SELECT COUNT(*)::int FROM store_banners WHERE tenant_id=$1 AND store_id=$2 AND status='active') AS banners,
         (SELECT COUNT(*)::int FROM support_threads WHERE tenant_id=$1 AND store_id=$2 AND status IN ('open','waiting_customer')) AS tickets`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  return payload(
    update,
    `${notice ? `${notice}\n\n` : ""}⚙️ إعدادات ${store.name}\n\n` +
      `الرابط: ${store.slug}\n` +
      `العملة الأساسية: ${store.currency}\n` +
      `حالة المتجر: ${store.status}\n` +
      `العملات المفعلة: ${stats.currencies || 0}\n` +
      `قنوات الدعم: ${stats.support_channels || 0}\n` +
      `البنرات: ${stats.banners || 0}\n` +
      `تذاكر تحتاج متابعة: ${stats.tickets || 0}\n\n` +
      `اختر الإعداد الذي تريد تغييره من تيليجرام:`,
    [
      [button("🎨 الهوية والمظهر", `${PREFIX}identity`, "primary"), button("📇 التواصل", `${PREFIX}contacts`)],
      [button("💱 العملات", `${PREFIX}currencies"`)],
      [button("💬 رسالة الترحيب", "adm5:welcome"), button("📞 قنوات الدعم", "adm5:support")],
      [button("🖼 البنرات", "adm5:banners"), button("🎫 تذاكر الدعم", "adm5:threads")],
      homeRow()
    ]
  );
}

async function identityView(db, connection, update, notice = "") {
  const row = (
    await db.query(
      `SELECT primary_color, secondary_color, background_color, surface_color,
              text_color, muted_text_color, font_family, border_radius,
              logo_url, cover_url
       FROM store_design_tokens
       WHERE tenant_id=$1 AND store_id=$2`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  if (!row) return payload(update, "إعدادات الهوية غير موجودة لهذا المتجر.", [[button("⚙️ الإعدادات", "adm:settings")], homeRow()]);
  return payload(
    update,
    `${notice ? `${notice}\n\n` : ""}🎨 الهوية والمظهر\n\n` +
      `اللون الأساسي: ${row.primary_color}\n` +
      `اللون الثانوي: ${row.secondary_color}\n` +
      `الخلفية: ${row.background_color}\n` +
      `السطح: ${row.surface_color}\n` +
      `الخط: ${row.font_family}\n` +
      `الزوايا: ${row.border_radius}\n` +
      `الشعار: ${row.logo_url || "غير مضبوط"}\n` +
      `الغلاف: ${row.cover_url || "غير مضبوط"}\n\n` +
      `تعديل اللون الأساسي أو الثانوي لا يغير بقية هوية المتجر.`,
    [
      [button("🎯 اللون الأساسي", `${PREFIX}identity:primary`), button("🎨 اللون الثانوي", `${PREFIX}identity:secondary`)],
      [button("🖼 الشعار", `${PREFIX}identity:logo`), button("🌄 الغلاف", `${PREFIX}identity:cover`)],
      [button("🔤 الخط", `${PREFIX}identity:font`, "primary")],
      [button("↩️ الإعدادات", "adm:settings")],
      homeRow()
    ]
  );
}

async function contactsView(db, connection, update, notice = "") {
  const store = await storeRow(db, connection);
  if (!store) return payload(update, "المتجر غير موجود.", [homeRow()]);
  const contacts = objectValue(store.contact_data, {});
  return payload(
    update,
    `${notice ? `${notice}\n\n` : ""}📇 بيانات التواصل\n\n` +
      `البريد: ${contacts.email || "—"}\n` +
      `الهاتف: ${contacts.phone || "—"}\n` +
      `واتساب: ${contacts.whatsapp || "—"}\n` +
      `تيليجرام: ${contacts.telegram || "—"}\n\n` +
      `Telegram ID الخاص بمالك بوت الإدارة يبقى محفوظًا منفصلًا ولا يتغير من هذه الشاشة.`,
    [
      [button("✉️ البريد", `${PREFIX}contact:email`), button("📞 الهاتف", `${PREFIX}contact:phone`)],
      [button("🟢 واتساب", `${PREFIX}contact:whatsapp`), button("✈️ تيليجرام", `${PREFIX}contact:telegram`)],
      [button("↩️ الإعدادات", "adm:settings")],
      homeRow()
    ]
  );
}

async function currenciesView(db, connection, update, notice = "") {
  const store = await storeRow(db, connection);
  if (!store) return payload(update, "المتجر غير موجود.", [homeRow()]);
  const rows = (
    await db.query(
      `SELECT id, currency, is_base, is_enabled, rate_to_base, rate_source, rate_updated_at
       FROM store_currency_settings
       WHERE tenant_id=$1 AND store_id=$2
       ORDER BY is_base DESC, currency`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows;
  const lines = rows.length
    ? rows.map((row) =>
        `• ${row.currency}${row.is_base ? " • أساسية" : ""} — ${row.is_enabled ? "مفعلة" : "مخفية"}` +
        `${row.is_base ? "" : ` • 1 ${row.currency} = ${Number(row.rate_to_base)} ${store.currency}`}`
      ).join("\n")
    : `• ${store.currency} • أساسية`;
  const buttons = rows.filter((row) => !row.is_base).slice(0, 12).map((row) => [
    button(`💱 ${row.currency} • ${row.is_enabled ? "مفعلة" : "مخفية"}`, `${PREFIX}currency:${row.currency}`)
  ]);
  buttons.push([button("➕ إضافة عملة", `${PREFIX}currency:add`, "success")]);
  buttons.push([button("↩️ الإعدادات", "adm:settings")]);
  buttons.push(homeRow());
  return payload(
    update,
    `${notice ? `${notice}\n\n` : ""}💱 العملات\n\n${lines}\n\n` +
      `السعر يعني: قيمة وحدة واحدة من العملة المعروضة بالعملة الأساسية ${store.currency}.`,
    buttons
  );
}

async function currencyDetail(db, connection, update, code, notice = "") {
  const store = await storeRow(db, connection);
  const row = (
    await db.query(
      `SELECT id, currency, is_base, is_enabled, rate_to_base, rate_source, rate_updated_at
       FROM store_currency_settings
       WHERE tenant_id=$1 AND store_id=$2 AND currency=$3`,
      [connection.tenant_id, connection.store_id, code]
    )
  ).rows[0];
  if (!store || !row) return payload(update, "العملة غير موجودة.", [[button("💱 العملات", `${PREFIX}currencies`)], homeRow()]);
  const buttons = [];
  if (!row.is_base) {
    buttons.push([button("✏️ تعديل السعر", `${PREFIX}currency:rate:${row.currency}`, "primary")]);
    buttons.push([
      button(
        row.is_enabled ? "🙈 إخفاء العملة" : "👁 تفعيل العملة",
        `${PREFIX}currency:${row.is_enabled ? "disable" : "enable"}:${row.currency}`,
        row.is_enabled ? "danger" : "success"
      )
    ]);
  }
  buttons.push([button("↩️ العملات", `${PREFIX}currencies`)]);
  buttons.push(homeRow());
  return payload(
    update,
    `${notice ? `${notice}\n\n` : ""}💱 ${row.currency}\n\n` +
      `النوع: ${row.is_base ? "العملة الأساسية" : "عملة عرض"}\n` +
      `الحالة: ${row.is_enabled ? "مفعلة" : "مخفية"}\n` +
      `السعر إلى ${store.currency}: ${Number(row.rate_to_base)}\n` +
      `المصدر: ${row.rate_source}\n` +
      `آخر تحديث: ${row.rate_updated_at || "—"}`,
    buttons
  );
}

async function updateDesignField(db, connection, update, field, value) {
  const columns = {
    primary: "primary_color",
    secondary: "secondary_color",
    logo: "logo_url",
    cover: "cover_url",
    font: "font_family"
  };
  const column = columns[field];
  if (!column) return payload(update, "إعداد الهوية غير صالح.", [[button("🎨 الهوية", `${PREFIX}identity`)], homeRow()]);
  const actorUserId = await ownerUserId(db, connection);
  const existing = (
    await db.query(
      `SELECT ${column} AS value FROM store_design_tokens WHERE tenant_id=$1 AND store_id=$2`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  if (!existing) return payload(update, "إعدادات الهوية غير موجودة.", [homeRow()]);
  await db.transaction(async (client) => {
    await client.query(
      `UPDATE store_design_tokens SET ${column}=$1, updated_at=NOW() WHERE tenant_id=$2 AND store_id=$3`,
      [value, connection.tenant_id, connection.store_id]
    );
    await audit(client, connection, actorUserId, "store_identity.changed_from_admin_bot", "store_design", connection.store_id, { field, value: existing.value }, { field, value });
  }, connection.tenant_id);
  return identityView(db, connection, update, "✅ تم تحديث الهوية.");
}

async function updateContact(db, connection, update, field, value) {
  const store = await storeRow(db, connection);
  if (!store) return payload(update, "المتجر غير موجود.", [homeRow()]);
  const before = objectValue(store.contact_data, {});
  const after = { ...before };
  if (value === null) delete after[field];
  else after[field] = value;
  const actorUserId = await ownerUserId(db, connection);
  await db.transaction(async (client) => {
    await client.query(
      "UPDATE stores SET contact_data=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3",
      [JSON.stringify(after), connection.store_id, connection.tenant_id]
    );
    await audit(
      client,
      connection,
      actorUserId,
      "store_contact.changed_from_admin_bot",
      "store",
      connection.store_id,
      { field, configured: Boolean(before[field]) },
      { field, configured: Boolean(value) }
    );
  }, connection.tenant_id);
  return contactsView(db, connection, update, "✅ تم تحديث بيانات التواصل.");
}

async function saveCurrency(db, connection, update, chatId, operationId) {
  const session = await sessionGet(db, connection, chatId);
  if (session?.key !== "id1_currency_confirm" || session.data.operationId !== operationId) {
    return payload(update, "انتهت جلسة تعديل العملة. ابدأ من جديد.", [[button("💱 العملات", `${PREFIX}currencies`)], homeRow()]);
  }
  const store = await storeRow(db, connection);
  const code = currencyCode(session.data.currency);
  const rate = currencyRate(session.data.rateToBase);
  if (!store || !code || code === store.currency || rate === null) {
    await sessionClear(db, connection, chatId);
    return payload(update, "بيانات العملة لم تعد صالحة. ابدأ من جديد.", [[button("💱 العملات", `${PREFIX}currencies`)], homeRow()]);
  }
  const actorUserId = await ownerUserId(db, connection);
  let rowId;
  await db.transaction(async (client) => {
    const existing = (
      await client.query(
        `SELECT id, is_enabled, rate_to_base FROM store_currency_settings
         WHERE tenant_id=$1 AND store_id=$2 AND currency=$3 FOR UPDATE`,
        [connection.tenant_id, connection.store_id, code]
      )
    ).rows[0];
    rowId = existing?.id || randomUUID();
    await client.query(
      `INSERT INTO store_currency_settings (
         id, tenant_id, store_id, currency, is_base, is_enabled,
         rate_to_base, rate_source, rate_updated_at
       ) VALUES ($1,$2,$3,$4,FALSE,TRUE,$5,'manual_telegram',NOW())
       ON CONFLICT (store_id, currency) DO UPDATE SET
         is_enabled=TRUE,
         rate_to_base=EXCLUDED.rate_to_base,
         rate_source=EXCLUDED.rate_source,
         rate_updated_at=NOW(),
         updated_at=NOW()`,
      [rowId, connection.tenant_id, connection.store_id, code, rate]
    );
    const saved = (
      await client.query(
        `SELECT id FROM store_currency_settings WHERE tenant_id=$1 AND store_id=$2 AND currency=$3`,
        [connection.tenant_id, connection.store_id, code]
      )
    ).rows[0];
    rowId = saved?.id || rowId;
    await audit(
      client,
      connection,
      actorUserId,
      existing ? "store_currency.rate_changed_from_admin_bot" : "store_currency.added_from_admin_bot",
      "store_currency",
      rowId,
      existing ? { currency: code, rateToBase: Number(existing.rate_to_base), enabled: Boolean(existing.is_enabled) } : null,
      { currency: code, rateToBase: rate, enabled: true }
    );
  }, connection.tenant_id);
  await sessionClear(db, connection, chatId);
  return currencyDetail(db, connection, update, code, "✅ تم حفظ العملة والسعر.");
}

async function setCurrencyEnabled(db, connection, update, code, enabled) {
  const store = await storeRow(db, connection);
  if (!store || code === store.currency) return payload(update, "لا يمكن إخفاء العملة الأساسية.", [[button("💱 العملات", `${PREFIX}currencies`)], homeRow()]);
  const existing = (
    await db.query(
      `SELECT id, is_base, is_enabled FROM store_currency_settings
       WHERE tenant_id=$1 AND store_id=$2 AND currency=$3`,
      [connection.tenant_id, connection.store_id, code]
    )
  ).rows[0];
  if (!existing || existing.is_base) return payload(update, "العملة غير موجودة أو أساسية.", [[button("💱 العملات", `${PREFIX}currencies`)], homeRow()]);
  const actorUserId = await ownerUserId(db, connection);
  await db.transaction(async (client) => {
    await client.query(
      `UPDATE store_currency_settings SET is_enabled=$1, updated_at=NOW()
       WHERE id=$2 AND tenant_id=$3 AND store_id=$4 AND is_base=FALSE`,
      [enabled, existing.id, connection.tenant_id, connection.store_id]
    );
    await audit(
      client,
      connection,
      actorUserId,
      "store_currency.visibility_changed_from_admin_bot",
      "store_currency",
      existing.id,
      { currency: code, enabled: Boolean(existing.is_enabled) },
      { currency: code, enabled }
    );
  }, connection.tenant_id);
  return currencyDetail(db, connection, update, code, enabled ? "✅ تم تفعيل العملة." : "✅ تم إخفاء العملة.");
}

async function processSession(db, connection, store, update, chatId, text, session) {
  if (!session?.key?.startsWith("id1_")) return null;

  if (session.key === "id1_design_color") {
    const value = String(text || "").trim().toUpperCase();
    if (!validHex(value)) return payload(update, "أرسل اللون بصيغة HEX مثل: #E11D48\nأرسل /cancel للإلغاء.");
    await sessionClear(db, connection, chatId);
    return updateDesignField(db, connection, update, session.data.field, value);
  }

  if (session.key === "id1_design_url") {
    const raw = String(text || "").trim();
    const value = safeHttpsUrl(raw);
    if (value === false) return payload(update, "أرسل رابط HTTPS صالحًا، أو - لمسح الصورة.\nأرسل /cancel للإلغاء.");
    await sessionClear(db, connection, chatId);
    return updateDesignField(db, connection, update, session.data.field, value);
  }

  if (session.key === "id1_contact") {
    const field = session.data.field;
    const raw = String(text || "").trim();
    let value = cleanOptionalText(raw, field === "email" ? 200 : 300);
    if (field === "email" && value && !validEmail(value)) {
      return payload(update, "أرسل بريدًا إلكترونيًا صالحًا، أو - لمسحه.\nأرسل /cancel للإلغاء.");
    }
    if (value && value.length < 2) return payload(update, "القيمة قصيرة جدًا. أرسل قيمة واضحة أو - للمسح.");
    await sessionClear(db, connection, chatId);
    return updateContact(db, connection, update, field, value);
  }

  if (session.key === "id1_currency_code") {
    const code = currencyCode(text);
    if (!code) return payload(update, "أرسل رمز عملة مدعومًا من 3 أحرف مثل TRY أو USD أو EUR.\nأرسل /cancel للإلغاء.");
    if (code === store.currency) return payload(update, `${code} هي العملة الأساسية أصلًا. اختر عملة أخرى.`);
    await sessionSet(db, connection, chatId, "id1_currency_rate", { currency: code });
    return payload(
      update,
      `💱 العملة: ${code}\n\nأرسل قيمة 1 ${code} بالعملة الأساسية ${store.currency}.\n` +
        `مثال: إذا كانت 1 ${code} = 0.025 ${store.currency} فأرسل 0.025\n\nأرسل /cancel للإلغاء.`
    );
  }

  if (session.key === "id1_currency_rate") {
    const rate = currencyRate(text);
    if (rate === null) return payload(update, "أرسل سعرًا موجبًا صحيحًا حتى 8 منازل عشرية.\nأرسل /cancel للإلغاء.");
    const operationId = randomUUID();
    await sessionSet(db, connection, chatId, "id1_currency_confirm", { ...session.data, rateToBase: rate, operationId });
    return payload(
      update,
      `⚠️ تأكيد سعر العملة\n\n1 ${session.data.currency} = ${rate} ${store.currency}\n\n` +
        `سيستخدم هذا السعر لعرض القيم بهذه العملة. لن تتغير العملة الأساسية للمتجر.`,
      [[button("✅ حفظ وتفعيل", `${PREFIX}currency:confirm:${operationId}`, "success")], [button("❌ إلغاء", `${PREFIX}currency:cancel`, "danger")]]
    );
  }

  return null;
}

async function handleCallback(db, connection, store, update, chatId, data) {
  if (data === "adm:settings") {
    await sessionClear(db, connection, chatId);
    return settingsHub(db, connection, update);
  }
  if (data === `${PREFIX}identity`) return identityView(db, connection, update);
  if (data === `${PREFIX}contacts`) return contactsView(db, connection, update);
  if (data === `${PREFIX}currencies`) return currenciesView(db, connection, update);

  if (data === `${PREFIX}identity:primary` || data === `${PREFIX}identity:secondary`) {
    const field = data.endsWith(":primary") ? "primary" : "secondary";
    await sessionSet(db, connection, chatId, "id1_design_color", { field });
    return payload(update, `🎨 أرسل اللون ${field === "primary" ? "الأساسي" : "الثانوي"} بصيغة HEX مثل #E11D48.\n\nأرسل /cancel للإلغاء.`);
  }
  if (data === `${PREFIX}identity:logo` || data === `${PREFIX}identity:cover`) {
    const field = data.endsWith(":logo") ? "logo" : "cover";
    await sessionSet(db, connection, chatId, "id1_design_url", { field });
    return payload(update, `🖼 أرسل رابط HTTPS ${field === "logo" ? "للشعار" : "للغلاف"}.\nأرسل - لمسح الصورة.\nأرسل /cancel للإلغاء.`);
  }
  if (data === `${PREFIX}identity:font`) {
    return payload(update, "🔤 اختر خط المتجر:", [
      [button("Tajawal", `${PREFIX}font:Tajawal`), button("Cairo", `${PREFIX}font:Cairo`)],
      [button("Noto Kufi Arabic", `${PREFIX}font:Noto Kufi Arabic`)],
      [button("System", `${PREFIX}font:system-ui`)],
      [button("↩️ الهوية", `${PREFIX}identity`)]
    ]);
  }
  if (data.startsWith(`${PREFIX}font:`)) {
    const font = data.slice(`${PREFIX}font:`.length);
    if (!FONTS.has(font)) return payload(update, "الخط غير صالح.", [[button("🎨 الهوية", `${PREFIX}identity`)], homeRow()]);
    return updateDesignField(db, connection, update, "font", font);
  }

  if (data.startsWith(`${PREFIX}contact:`)) {
    const field = data.slice(`${PREFIX}contact:`.length);
    if (!["email", "phone", "whatsapp", "telegram"].includes(field)) return null;
    await sessionSet(db, connection, chatId, "id1_contact", { field });
    const labels = { email: "البريد الإلكتروني", phone: "رقم الهاتف", whatsapp: "واتساب", telegram: "تيليجرام" };
    return payload(update, `📇 أرسل ${labels[field]} الجديد.\nأرسل - لمسح القيمة.\nأرسل /cancel للإلغاء.`);
  }

  if (data === `${PREFIX}currency:add`) {
    await sessionSet(db, connection, chatId, "id1_currency_code", {});
    return payload(update, `➕ أرسل رمز العملة التي تريد إضافتها، مثل TRY أو USD أو EUR.\nالعملة الأساسية الحالية: ${store.currency}\n\nأرسل /cancel للإلغاء.`);
  }
  if (data.startsWith(`${PREFIX}currency:rate:`)) {
    const code = currencyCode(data.slice(`${PREFIX}currency:rate:`.length));
    if (!code || code === store.currency) return payload(update, "العملة غير صالحة لتعديل السعر.", [[button("💱 العملات", `${PREFIX}currencies`)], homeRow()]);
    const exists = (
      await db.query(
        "SELECT id FROM store_currency_settings WHERE tenant_id=$1 AND store_id=$2 AND currency=$3 AND is_base=FALSE",
        [connection.tenant_id, connection.store_id, code]
      )
    ).rows[0];
    if (!exists) return payload(update, "العملة غير موجودة.", [[button("💱 العملات", `${PREFIX}currencies`)], homeRow()]);
    await sessionSet(db, connection, chatId, "id1_currency_rate", { currency: code });
    return payload(update, `✏️ أرسل القيمة الجديدة لـ 1 ${code} بالعملة الأساسية ${store.currency}.\n\nأرسل /cancel للإلغاء.`);
  }
  if (data.startsWith(`${PREFIX}currency:confirm:`)) {
    return saveCurrency(db, connection, update, chatId, data.slice(`${PREFIX}currency:confirm:`.length));
  }
  if (data === `${PREFIX}currency:cancel`) {
    await sessionClear(db, connection, chatId);
    return currenciesView(db, connection, update, "تم إلغاء تعديل العملة.");
  }
  if (data.startsWith(`${PREFIX}currency:enable:`) || data.startsWith(`${PREFIX}currency:disable:`)) {
    const enabled = data.startsWith(`${PREFIX}currency:enable:`);
    const marker = enabled ? `${PREFIX}currency:enable:` : `${PREFIX}currency:disable:`;
    const code = currencyCode(data.slice(marker.length));
    if (!code) return payload(update, "العملة غير صالحة.", [[button("💱 العملات", `${PREFIX}currencies`)], homeRow()]);
    return setCurrencyEnabled(db, connection, update, code, enabled);
  }
  if (data.startsWith(`${PREFIX}currency:`)) {
    const code = currencyCode(data.slice(`${PREFIX}currency:`.length));
    if (!code) return null;
    return currencyDetail(db, connection, update, code);
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

export function installAdminBotIdentityV1(app, { db, config }) {
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
      if (!session?.key?.startsWith("id1_")) return;
      await sessionClear(db, connection, chatId);
      outgoing = await settingsHub(db, connection, update, "تم إلغاء تعديل الإعدادات.");
    } else if (data === "adm:settings" || data.startsWith(PREFIX)) {
      outgoing = await handleCallback(db, connection, store, update, chatId, data);
    } else if (text && !text.startsWith("/")) {
      outgoing = await processSession(db, connection, store, update, chatId, text, await sessionGet(db, connection, chatId));
    }

    if (!outgoing) return;
    return send(config, request, reply, connection, chatId, outgoing);
  });
}
