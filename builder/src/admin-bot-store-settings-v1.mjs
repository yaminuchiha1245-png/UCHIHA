import { randomUUID } from "node:crypto";
import { decryptSecret, safeText, sha256 } from "./security.mjs";
import { TelegramGateway } from "./telegram.mjs";

const PREFIX = "adm5:";
const SESSION_MINUTES = 20;
const SUPPORT_TYPES = new Set(["whatsapp", "telegram", "instagram", "email", "tiktok", "discord", "phone", "custom"]);

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

function messagePayload(update, text, rows = null) {
  const result = { text };
  if (rows) result.reply_markup = keyboard(rows);
  if (update?.callback_query?.id) result.callbackQueryId = update.callback_query.id;
  return result;
}

function typeLabel(type) {
  return ({
    whatsapp: "واتساب",
    telegram: "تيليجرام",
    instagram: "إنستغرام",
    email: "بريد إلكتروني",
    tiktok: "TikTok",
    discord: "Discord",
    phone: "هاتف",
    custom: "مخصص"
  })[type] || type;
}

function safeHttpsUrl(value, { allowRelative = false, optional = false } = {}) {
  const text = String(value || "").trim();
  if (optional && (!text || text === "-" || text.toLocaleLowerCase("en") === "none")) return null;
  if (allowRelative && text.startsWith("/") && !text.startsWith("//")) return text.slice(0, 1000);
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

async function storeRow(db, connection) {
  return (
    await db.query(
      `SELECT id, tenant_id, name, slug, status, currency, welcome_message, contact_data
       FROM stores WHERE id=$1 AND tenant_id=$2`,
      [connection.store_id, connection.tenant_id]
    )
  ).rows[0];
}

async function settingsView(db, connection, update) {
  const store = await storeRow(db, connection);
  if (!store) return messagePayload(update, "المتجر غير موجود.", [homeRow()]);
  const stats = (
    await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM store_support_channels WHERE tenant_id=$1 AND store_id=$2 AND status='active') AS support_channels,
         (SELECT COUNT(*)::int FROM store_banners WHERE tenant_id=$1 AND store_id=$2 AND status='active') AS banners,
         (SELECT COUNT(*)::int FROM support_threads WHERE tenant_id=$1 AND store_id=$2 AND status IN ('open','waiting_customer')) AS support_threads,
         (SELECT COUNT(*)::int FROM bot_connections WHERE tenant_id=$1 AND store_id=$2 AND status='active') AS active_bots`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  return messagePayload(
    update,
    `⚙️ إعدادات ${store.name}\n\n` +
      `الرابط: ${store.slug}\n` +
      `العملة: ${store.currency}\n` +
      `حالة المتجر: ${store.status}\n` +
      `البوتات النشطة: ${stats.active_bots || 0}\n` +
      `قنوات الدعم: ${stats.support_channels || 0}\n` +
      `البنرات الظاهرة: ${stats.banners || 0}\n` +
      `تذاكر تحتاج متابعة: ${stats.support_threads || 0}\n\n` +
      `رسالة الترحيب: ${String(store.welcome_message || "غير مضبوطة").slice(0, 180)}`,
    [
      [button("💬 رسالة الترحيب", `${PREFIX}welcome`, "primary")],
      [button("📞 قنوات الدعم", `${PREFIX}support`), button("🖼 البنرات", `${PREFIX}banners`)],
      [button("🎫 تذاكر الدعم", `${PREFIX}threads`, "success")],
      homeRow()
    ]
  );
}

async function supportList(db, connection, update) {
  const rows = (
    await db.query(
      `SELECT id, channel_type, name, target, status, sort_order
       FROM store_support_channels
       WHERE tenant_id=$1 AND store_id=$2
       ORDER BY sort_order, created_at LIMIT 20`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows;
  const lines = rows.length
    ? rows.map((row) => `• ${row.name} — ${typeLabel(row.channel_type)} • ${row.status === "active" ? "ظاهر" : "مخفي"}\n  ${row.target}`).join("\n\n")
    : "لا توجد قنوات دعم محفوظة.";
  const buttons = rows.slice(0, 10).map((row) => [button(`📞 ${String(row.name).slice(0, 28)}`, `${PREFIX}support:item:${row.id}`)]);
  buttons.push([button("➕ إضافة قناة دعم", `${PREFIX}support:add`, "success")]);
  buttons.push([button("↩️ الإعدادات", "adm:settings")]);
  return messagePayload(update, `📞 قنوات الدعم\n\n${lines}`, buttons);
}

async function supportDetail(db, connection, update, id) {
  const row = (
    await db.query(
      `SELECT id, channel_type, name, description, target, working_hours, status
       FROM store_support_channels
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      [id, connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  if (!row) return messagePayload(update, "قناة الدعم غير موجودة.", [[button("📞 قنوات الدعم", `${PREFIX}support`)], homeRow()]);
  return messagePayload(
    update,
    `📞 ${row.name}\n\n` +
      `النوع: ${typeLabel(row.channel_type)}\n` +
      `الهدف: ${row.target}\n` +
      `الحالة: ${row.status === "active" ? "ظاهرة" : "مخفية"}\n` +
      `ساعات العمل: ${row.working_hours || "—"}\n\n${String(row.description || "").slice(0, 300)}`,
    [
      [button("✏️ تعديل الاسم", `${PREFIX}support:name:${row.id}`), button("🎯 تعديل الهدف", `${PREFIX}support:target:${row.id}`, "primary")],
      [button(row.status === "active" ? "🙈 إخفاء" : "👁 إظهار", `${PREFIX}support:toggle:${row.id}`, row.status === "active" ? "danger" : "success")],
      [button("↩️ قنوات الدعم", `${PREFIX}support`)],
      homeRow()
    ]
  );
}

async function bannerList(db, connection, update) {
  const rows = (
    await db.query(
      `SELECT id, title, media_type, media_url, link_url, status, sort_order
       FROM store_banners
       WHERE tenant_id=$1 AND store_id=$2
       ORDER BY sort_order, created_at LIMIT 20`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows;
  const lines = rows.length
    ? rows.map((row) => `• ${row.title || "بدون عنوان"} — ${row.media_type} • ${row.status === "active" ? "ظاهر" : "مخفي"}`).join("\n")
    : "لا توجد بنرات محفوظة.";
  const buttons = rows.slice(0, 10).map((row) => [button(`🖼 ${String(row.title || "بنر").slice(0, 28)}`, `${PREFIX}banner:${row.id}`)]);
  buttons.push([button("➕ إضافة بنر صورة", `${PREFIX}banner:add`, "success")]);
  buttons.push([button("↩️ الإعدادات", "adm:settings")]);
  return messagePayload(update, `🖼 البنرات\n\n${lines}`, buttons);
}

async function bannerDetail(db, connection, update, id) {
  const row = (
    await db.query(
      `SELECT id, title, subtitle, media_type, media_url, link_url, status, sort_order
       FROM store_banners
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      [id, connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  if (!row) return messagePayload(update, "البنر غير موجود.", [[button("🖼 البنرات", `${PREFIX}banners`)], homeRow()]);
  return messagePayload(
    update,
    `🖼 ${row.title || "بنر"}\n\n` +
      `النوع: ${row.media_type}\n` +
      `الصورة/الوسائط: ${row.media_url || "—"}\n` +
      `الرابط: ${row.link_url || "—"}\n` +
      `الترتيب: ${row.sort_order}\n` +
      `الحالة: ${row.status === "active" ? "ظاهر" : "مخفي"}`,
    [
      [button(row.status === "active" ? "🙈 إخفاء البنر" : "👁 إظهار البنر", `${PREFIX}banner:toggle:${row.id}`, row.status === "active" ? "danger" : "success")],
      [button("↩️ البنرات", `${PREFIX}banners`)],
      homeRow()
    ]
  );
}

async function threadList(db, connection, update) {
  const rows = (
    await db.query(
      `SELECT st.id, st.subject, st.status, st.priority, st.last_message_at,
              c.display_name AS customer_name
       FROM support_threads st
       JOIN store_customers c ON c.id=st.customer_id
       WHERE st.tenant_id=$1 AND st.store_id=$2
       ORDER BY CASE WHEN st.status IN ('open','waiting_customer') THEN 0 ELSE 1 END,
                CASE WHEN st.priority='urgent' THEN 0 ELSE 1 END,
                st.last_message_at DESC LIMIT 12`,
      [connection.tenant_id, connection.store_id]
    )
  ).rows;
  const lines = rows.length
    ? rows.map((row) => `• ${row.priority === "urgent" ? "🔴" : "▫️"} ${row.subject}\n  ${row.customer_name} • ${row.status}`).join("\n\n")
    : "لا توجد تذاكر دعم.";
  const buttons = rows.map((row) => [button(`🎫 ${String(row.subject).slice(0, 28)}`, `${PREFIX}thread:${row.id}`)]);
  buttons.push([button("↩️ الإعدادات", "adm:settings")]);
  return messagePayload(update, `🎫 تذاكر الدعم\n\n${lines}`, buttons);
}

async function threadDetail(db, connection, update, id) {
  const thread = (
    await db.query(
      `SELECT st.*, c.display_name AS customer_name, c.email AS customer_email
       FROM support_threads st
       JOIN store_customers c ON c.id=st.customer_id
       WHERE st.id=$1 AND st.tenant_id=$2 AND st.store_id=$3`,
      [id, connection.tenant_id, connection.store_id]
    )
  ).rows[0];
  if (!thread) return messagePayload(update, "التذكرة غير موجودة.", [[button("🎫 التذاكر", `${PREFIX}threads`)], homeRow()]);
  const messages = (
    await db.query(
      `SELECT author_type, message, created_at
       FROM support_messages
       WHERE thread_id=$1 AND tenant_id=$2 AND store_id=$3
       ORDER BY created_at DESC LIMIT 6`,
      [thread.id, connection.tenant_id, connection.store_id]
    )
  ).rows.reverse();
  const history = messages.length
    ? messages.map((row) => `${row.author_type === "customer" ? "👤 العميل" : row.author_type === "staff" ? "🛠 الإدارة" : "ℹ️ النظام"}: ${String(row.message).slice(0, 350)}`).join("\n\n")
    : "لا توجد رسائل بعد.";
  const actions = [];
  if (!["resolved", "closed"].includes(thread.status)) {
    actions.push([button("✍️ رد على العميل", `${PREFIX}thread:reply:${thread.id}`, "primary")]);
    actions.push([button("✅ تعليم كمحلولة", `${PREFIX}thread:resolve:${thread.id}`, "success")]);
  }
  actions.push([button("↩️ التذاكر", `${PREFIX}threads`)]);
  actions.push(homeRow());
  return messagePayload(
    update,
    `🎫 ${thread.subject}\n\n` +
      `العميل: ${thread.customer_name}\n` +
      `البريد: ${thread.customer_email}\n` +
      `الأولوية: ${thread.priority}\n` +
      `الحالة: ${thread.status}\n\n` +
      `${history}`,
    actions
  );
}

async function processSession(db, connection, update, chatId, text, session) {
  if (!session?.key?.startsWith("set1_")) return null;
  const actorUserId = await ownerUserId(db, connection);

  if (session.key === "set1_welcome") {
    const welcome = safeText(text, 1200);
    if (!welcome) return messagePayload(update, "أرسل رسالة ترحيب واضحة، أو /cancel للإلغاء.");
    await db.transaction(async (client) => {
      const before = (await client.query("SELECT welcome_message FROM stores WHERE id=$1 AND tenant_id=$2 FOR UPDATE", [connection.store_id, connection.tenant_id])).rows[0];
      await client.query("UPDATE stores SET welcome_message=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3", [welcome, connection.store_id, connection.tenant_id]);
      await audit(client, connection, actorUserId, "store.welcome_changed_from_admin_bot", "store", connection.store_id, { welcomeMessage: before?.welcome_message || "" }, { welcomeMessage: welcome });
    }, connection.tenant_id);
    await sessionClear(db, connection, chatId);
    const view = await settingsView(db, connection, update);
    view.text = `✅ تم تحديث رسالة الترحيب.\n\n${view.text}`;
    return view;
  }

  if (session.key === "set1_support_name") {
    const name = safeText(text, 100);
    if (!name || name.length < 2) return messagePayload(update, "أرسل اسمًا واضحًا للقناة، أو /cancel للإلغاء.");
    await sessionSet(db, connection, chatId, "set1_support_target", { type: session.data.type, name });
    return messagePayload(update, `الاسم: ${name}\n\nأرسل الآن الرابط/المعرف/الرقم الذي سيتواصل العميل من خلاله.\nأرسل /cancel للإلغاء.`);
  }

  if (session.key === "set1_support_target") {
    const target = safeText(text, 500);
    if (!target || target.length < 2) return messagePayload(update, "أرسل هدف تواصل صالحًا، أو /cancel للإلغاء.");
    const type = session.data.type;
    const name = session.data.name;
    let id;
    await db.transaction(async (client) => {
      const duplicate = (await client.query(
        "SELECT id FROM store_support_channels WHERE store_id=$1 AND channel_type=$2 AND target=$3 LIMIT 1",
        [connection.store_id, type, target]
      )).rows[0];
      if (duplicate) throw new Error("support_channel_duplicate");
      id = randomUUID();
      const sortOrder = Number((await client.query(
        "SELECT COALESCE(MAX(sort_order),0)+10 AS next_order FROM store_support_channels WHERE tenant_id=$1 AND store_id=$2",
        [connection.tenant_id, connection.store_id]
      )).rows[0]?.next_order || 10);
      await client.query(
        `INSERT INTO store_support_channels (
           id, tenant_id, store_id, channel_type, name, target, sort_order, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`,
        [id, connection.tenant_id, connection.store_id, type, name, target, sortOrder]
      );
      await audit(client, connection, actorUserId, "support_channel.created_from_admin_bot", "support_channel", id, null, { type, name, target });
    }, connection.tenant_id);
    await sessionClear(db, connection, chatId);
    const view = await supportList(db, connection, update);
    view.text = `✅ تمت إضافة قناة الدعم ${name}.\n\n${view.text}`;
    return view;
  }

  if (session.key === "set1_support_name_edit" || session.key === "set1_support_target_edit") {
    const value = safeText(text, session.key.endsWith("target_edit") ? 500 : 100);
    if (!value || value.length < 2) return messagePayload(update, "القيمة غير صالحة. أعد الإرسال أو /cancel للإلغاء.");
    const field = session.key === "set1_support_name_edit" ? "name" : "target";
    let previous;
    await db.transaction(async (client) => {
      const row = (await client.query(
        "SELECT id, name, target FROM store_support_channels WHERE id=$1 AND tenant_id=$2 AND store_id=$3 FOR UPDATE",
        [session.data.id, connection.tenant_id, connection.store_id]
      )).rows[0];
      if (!row) throw new Error("support_channel_not_found");
      previous = row[field];
      await client.query(
        `UPDATE store_support_channels SET ${field}=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND store_id=$4`,
        [value, row.id, connection.tenant_id, connection.store_id]
      );
      await audit(client, connection, actorUserId, `support_channel.${field}_changed_from_admin_bot`, "support_channel", row.id, { [field]: previous }, { [field]: value });
    }, connection.tenant_id);
    await sessionClear(db, connection, chatId);
    return supportDetail(db, connection, update, session.data.id);
  }

  if (session.key === "set1_banner_title") {
    const title = safeText(text, 140);
    if (!title) return messagePayload(update, "أرسل عنوانًا للبنر، أو /cancel للإلغاء.");
    await sessionSet(db, connection, chatId, "set1_banner_media", { title });
    return messagePayload(update, "أرسل رابط HTTPS للصورة التي تريد استخدامها في البنر.\nأرسل /cancel للإلغاء.");
  }

  if (session.key === "set1_banner_media") {
    const mediaUrl = safeHttpsUrl(text);
    if (!mediaUrl) return messagePayload(update, "الرابط غير صالح. أرسل رابط HTTPS مباشرًا للصورة، أو /cancel للإلغاء.");
    await sessionSet(db, connection, chatId, "set1_banner_link", { title: session.data.title, mediaUrl });
    return messagePayload(update, "أرسل رابط HTTPS الذي يفتح عند الضغط على البنر.\nإذا لا تريد رابطًا أرسل: -\nأرسل /cancel للإلغاء.");
  }

  if (session.key === "set1_banner_link") {
    const linkUrl = safeHttpsUrl(text, { allowRelative: true, optional: true });
    if (String(text || "").trim() !== "-" && !linkUrl) return messagePayload(update, "الرابط غير صالح. أرسل HTTPS أو مسارًا يبدأ بـ / أو أرسل - بدون رابط.");
    let id;
    await db.transaction(async (client) => {
      id = randomUUID();
      const sortOrder = Number((await client.query(
        "SELECT COALESCE(MAX(sort_order),-10)+10 AS next_order FROM store_banners WHERE tenant_id=$1 AND store_id=$2",
        [connection.tenant_id, connection.store_id]
      )).rows[0]?.next_order || 0);
      await client.query(
        `INSERT INTO store_banners (
           id, tenant_id, store_id, title, media_type, media_url, link_url, sort_order, status
         ) VALUES ($1,$2,$3,$4,'image',$5,$6,$7,'active')`,
        [id, connection.tenant_id, connection.store_id, session.data.title, session.data.mediaUrl, linkUrl, sortOrder]
      );
      await audit(client, connection, actorUserId, "banner.created_from_admin_bot", "store_banner", id, null, { title: session.data.title, mediaUrl: session.data.mediaUrl, linkUrl });
    }, connection.tenant_id);
    await sessionClear(db, connection, chatId);
    const view = await bannerList(db, connection, update);
    view.text = `✅ تمت إضافة البنر وأصبح ظاهرًا.\n\n${view.text}`;
    return view;
  }

  if (session.key === "set1_thread_reply") {
    const body = safeText(text, 3000);
    if (!body) return messagePayload(update, "أرسل ردًا واضحًا، أو /cancel للإلغاء.");
    await db.transaction(async (client) => {
      const thread = (await client.query(
        `SELECT id, status FROM support_threads
         WHERE id=$1 AND tenant_id=$2 AND store_id=$3 FOR UPDATE`,
        [session.data.threadId, connection.tenant_id, connection.store_id]
      )).rows[0];
      if (!thread) throw new Error("support_thread_not_found");
      if (["resolved", "closed"].includes(thread.status)) throw new Error("support_thread_closed");
      await client.query(
        `INSERT INTO support_messages (
           id, tenant_id, store_id, thread_id, author_type, author_user_id, message
         ) VALUES ($1,$2,$3,$4,'staff',$5,$6)`,
        [randomUUID(), connection.tenant_id, connection.store_id, thread.id, actorUserId, body]
      );
      await client.query(
        `UPDATE support_threads
         SET status='waiting_customer', last_message_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
        [thread.id, connection.tenant_id, connection.store_id]
      );
      await audit(client, connection, actorUserId, "support_thread.replied_from_admin_bot", "support_thread", thread.id, { status: thread.status }, { status: "waiting_customer" });
    }, connection.tenant_id);
    await sessionClear(db, connection, chatId);
    return threadDetail(db, connection, update, session.data.threadId);
  }

  return null;
}

async function handleCallback(db, connection, update, chatId, data) {
  const actorUserId = await ownerUserId(db, connection);
  if (data === "adm:settings") {
    await sessionClear(db, connection, chatId);
    return settingsView(db, connection, update);
  }
  if (data === `${PREFIX}welcome`) {
    await sessionSet(db, connection, chatId, "set1_welcome", {});
    return messagePayload(update, "💬 أرسل رسالة الترحيب الجديدة للمتجر.\n\nأرسل /cancel للإلغاء.");
  }
  if (data === `${PREFIX}support`) {
    await sessionClear(db, connection, chatId);
    return supportList(db, connection, update);
  }
  if (data === `${PREFIX}support:add`) {
    return messagePayload(update, "اختر نوع قناة الدعم:", [
      [button("واتساب", `${PREFIX}support:type:whatsapp`), button("تيليجرام", `${PREFIX}support:type:telegram`)],
      [button("إنستغرام", `${PREFIX}support:type:instagram`), button("بريد", `${PREFIX}support:type:email`)],
      [button("TikTok", `${PREFIX}support:type:tiktok`), button("Discord", `${PREFIX}support:type:discord`)],
      [button("هاتف", `${PREFIX}support:type:phone`), button("مخصص", `${PREFIX}support:type:custom`)],
      [button("↩️ قنوات الدعم", `${PREFIX}support`)]
    ]);
  }
  if (data.startsWith(`${PREFIX}support:type:`)) {
    const type = data.slice(`${PREFIX}support:type:`.length);
    if (!SUPPORT_TYPES.has(type)) return messagePayload(update, "نوع قناة الدعم غير صالح.", [[button("📞 قنوات الدعم", `${PREFIX}support`)], homeRow()]);
    await sessionSet(db, connection, chatId, "set1_support_name", { type });
    return messagePayload(update, `النوع: ${typeLabel(type)}\n\nأرسل اسم القناة كما سيظهر للعميل.\nأرسل /cancel للإلغاء.`);
  }
  if (data.startsWith(`${PREFIX}support:name:`)) {
    const id = data.slice(`${PREFIX}support:name:`.length);
    await sessionSet(db, connection, chatId, "set1_support_name_edit", { id });
    return messagePayload(update, "أرسل الاسم الجديد لقناة الدعم.\nأرسل /cancel للإلغاء.");
  }
  if (data.startsWith(`${PREFIX}support:target:`)) {
    const id = data.slice(`${PREFIX}support:target:`.length);
    await sessionSet(db, connection, chatId, "set1_support_target_edit", { id });
    return messagePayload(update, "أرسل الهدف/الرابط/الرقم الجديد لقناة الدعم.\nأرسل /cancel للإلغاء.");
  }
  if (data.startsWith(`${PREFIX}support:toggle:`)) {
    const id = data.slice(`${PREFIX}support:toggle:`.length);
    await db.transaction(async (client) => {
      const row = (await client.query(
        "SELECT id, status FROM store_support_channels WHERE id=$1 AND tenant_id=$2 AND store_id=$3 FOR UPDATE",
        [id, connection.tenant_id, connection.store_id]
      )).rows[0];
      if (!row) throw new Error("support_channel_not_found");
      const next = row.status === "active" ? "hidden" : "active";
      await client.query("UPDATE store_support_channels SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND store_id=$4", [next, row.id, connection.tenant_id, connection.store_id]);
      await audit(client, connection, actorUserId, "support_channel.visibility_changed_from_admin_bot", "support_channel", row.id, { status: row.status }, { status: next });
    }, connection.tenant_id);
    return supportDetail(db, connection, update, id);
  }
  if (data.startsWith(`${PREFIX}support:item:`)) return supportDetail(db, connection, update, data.slice(`${PREFIX}support:item:`.length));

  if (data === `${PREFIX}banners`) {
    await sessionClear(db, connection, chatId);
    return bannerList(db, connection, update);
  }
  if (data === `${PREFIX}banner:add`) {
    await sessionSet(db, connection, chatId, "set1_banner_title", {});
    return messagePayload(update, "🖼 أرسل عنوان البنر الجديد.\nأرسل /cancel للإلغاء.");
  }
  if (data.startsWith(`${PREFIX}banner:toggle:`)) {
    const id = data.slice(`${PREFIX}banner:toggle:`.length);
    await db.transaction(async (client) => {
      const row = (await client.query(
        "SELECT id, status FROM store_banners WHERE id=$1 AND tenant_id=$2 AND store_id=$3 FOR UPDATE",
        [id, connection.tenant_id, connection.store_id]
      )).rows[0];
      if (!row) throw new Error("banner_not_found");
      const next = row.status === "active" ? "hidden" : "active";
      await client.query("UPDATE store_banners SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND store_id=$4", [next, row.id, connection.tenant_id, connection.store_id]);
      await audit(client, connection, actorUserId, "banner.visibility_changed_from_admin_bot", "store_banner", row.id, { status: row.status }, { status: next });
    }, connection.tenant_id);
    return bannerDetail(db, connection, update, id);
  }
  if (data.startsWith(`${PREFIX}banner:`)) return bannerDetail(db, connection, update, data.slice(`${PREFIX}banner:`.length));

  if (data === `${PREFIX}threads`) {
    await sessionClear(db, connection, chatId);
    return threadList(db, connection, update);
  }
  if (data.startsWith(`${PREFIX}thread:reply:`)) {
    const threadId = data.slice(`${PREFIX}thread:reply:`.length);
    await sessionSet(db, connection, chatId, "set1_thread_reply", { threadId });
    return messagePayload(update, "✍️ أرسل ردك على العميل.\nسيتم حفظه داخل نفس تذكرة الدعم.\nأرسل /cancel للإلغاء.");
  }
  if (data.startsWith(`${PREFIX}thread:resolve:`)) {
    const id = data.slice(`${PREFIX}thread:resolve:`.length);
    await db.transaction(async (client) => {
      const row = (await client.query(
        "SELECT id, status FROM support_threads WHERE id=$1 AND tenant_id=$2 AND store_id=$3 FOR UPDATE",
        [id, connection.tenant_id, connection.store_id]
      )).rows[0];
      if (!row) throw new Error("support_thread_not_found");
      await client.query("UPDATE support_threads SET status='resolved', updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND store_id=$3", [row.id, connection.tenant_id, connection.store_id]);
      await audit(client, connection, actorUserId, "support_thread.resolved_from_admin_bot", "support_thread", row.id, { status: row.status }, { status: "resolved" });
    }, connection.tenant_id);
    return threadDetail(db, connection, update, id);
  }
  if (data.startsWith(`${PREFIX}thread:`)) return threadDetail(db, connection, update, data.slice(`${PREFIX}thread:`.length));
  return null;
}

async function authorizedContext(db, request) {
  const path = String(request.raw?.url || request.url || "").split("?")[0];
  const match = /^\/webhooks\/telegram-admin\/([0-9a-f-]{36})$/i.exec(path);
  if (!match) return null;
  const connection = (
    await db.query("SELECT * FROM bot_connections WHERE id=$1 AND purpose='admin' AND status='active'", [match[1]])
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

export function installAdminBotStoreSettingsV1(app, { db, config }) {
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
      if (!session?.key?.startsWith("set1_")) return;
      await sessionClear(db, connection, chatId);
      outgoing = messagePayload(update, "تم إلغاء العملية الحالية.", [[button("⚙️ الإعدادات", "adm:settings")], homeRow()]);
    } else if (data) {
      outgoing = await handleCallback(db, connection, update, chatId, data);
    } else if (text && !text.startsWith("/")) {
      outgoing = await processSession(db, connection, update, chatId, text, await sessionGet(db, connection, chatId));
    }

    if (!outgoing) return;
    return send(config, request, reply, connection, chatId, outgoing);
  });
}
