const { Telegraf, Markup } = require("telegraf");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();
const {loadBotConfig}=require("./config");

const BOT_CONFIG=loadBotConfig(process.env);
const BOT_TOKEN=BOT_CONFIG.botToken;
const MINI_APP_URL=BOT_CONFIG.miniAppUrl;
const API_URL=BOT_CONFIG.apiUrl;
const SUPPORT_USERNAME=BOT_CONFIG.supportUsername;
const REQUIRED_CHANNEL=BOT_CONFIG.requiredChannel;
const INTERNAL_BOT_SECRET=BOT_CONFIG.internalBotSecret;
const INTERNAL_BOT_ADMIN_SECRET=BOT_CONFIG.internalBotAdminSecret;
const ADMIN_IDS=BOT_CONFIG.adminIds;
const API_TIMEOUT_MS=BOT_CONFIG.apiTimeoutMs;

const bot = new Telegraf(BOT_TOKEN);

async function api(pathname, options={}, admin=false) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),API_TIMEOUT_MS);
  try{
    const r = await fetch(API_URL + pathname, {
      ...options,
      signal:controller.signal,
      headers: {
        "content-type":"application/json",
        "x-bot-secret": INTERNAL_BOT_SECRET,
        ...(admin ? {"x-bot-admin-secret":INTERNAL_BOT_ADMIN_SECRET} : {}),
        ...(options.headers || {})
      }
    });
    const data = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(data.error || `API ${r.status}`);
    return data;
  }catch(e){
    if(e?.name==="AbortError")throw new Error("api_timeout");
    throw e;
  }finally{clearTimeout(timer)}
}
const isAdmin = ctx => ADMIN_IDS.includes(String(ctx.from?.id));
const escapeHtml = (s="") => String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
const pendingBroadcasts=new Map();
const BROADCAST_CONFIRM_TTL_MS=5*60*1000;


async function syncUser(ctx){ return api("/api/users/sync",{method:"POST",body:JSON.stringify(ctx.from)}); }
async function isSubscribed(ctx){
  if(!REQUIRED_CHANNEL)return true;
  try{
    const m=await ctx.telegram.getChatMember(REQUIRED_CHANNEL,ctx.from.id);
    return ["creator","administrator","member","restricted"].includes(m.status)&&m.status!=="left";
  }catch{return false}
}
function menu(){
  return Markup.inlineKeyboard([
    [Markup.button.webApp("فتح متجر Game Zone",MINI_APP_URL)],
    [Markup.button.callback("تصفح الأقسام","browse_categories"),Markup.button.callback("حسابي","account")],
    [Markup.button.callback("طلباتي","orders"),Markup.button.callback("شحن الرصيد","topup")],
    [Markup.button.url("الدعم الفني",`https://t.me/${SUPPORT_USERNAME}`)]
  ]);
}
function adminMenu(){
  return Markup.inlineKeyboard([
    [Markup.button.callback("الإحصاءات","adm_stats"),Markup.button.callback("آخر الطلبات","adm_orders")],
    [Markup.button.callback("الشحن المعلق","adm_topups"),Markup.button.callback("أخطاء المزودين","adm_provider_errors")],
    [Markup.button.callback("تذاكر الدعم","adm_tickets"),Markup.button.callback("مخزون الأكواد","adm_inventory")],
    [Markup.button.callback("مزامنة الطلبات","adm_sync"),Markup.button.callback("البث","adm_broadcast_help")]
  ]);
}
function subscriptionKeyboard(){
  const url=REQUIRED_CHANNEL.startsWith("@")?`https://t.me/${REQUIRED_CHANNEL.slice(1)}`:"https://t.me/";
  return Markup.inlineKeyboard([[Markup.button.url("الاشتراك بالقناة",url)],[Markup.button.callback("تحققت من الاشتراك","check_subscription")]]);
}

async function welcome(ctx){
  const payload=String(ctx.startPayload||"");
  if(payload.startsWith("pair_")){
    const code=payload.slice(5).trim().toUpperCase();
    try{
      await api("/api/device/pair/approve",{method:"POST",body:JSON.stringify({code,telegramUser:ctx.from})});
      await ctx.reply(`🔐 <b>كود ربط Game Zone</b>\n\n<code>${escapeHtml(code)}</code>\n\nانسخ هذا الكود وارجع إلى التطبيق ثم اكتبه في خانة الربط. الكود مؤقت ولا تشاركه مع أي شخص.`,{parse_mode:"HTML",...Markup.inlineKeyboard([[Markup.button.webApp("العودة إلى Game Zone",MINI_APP_URL)]])});
    }catch(e){
      await ctx.reply(" تعذر ربط التطبيق. قد يكون رمز الربط منتهيًا أو غير صحيح.");
    }
  }
  if(!(await isSubscribed(ctx)))return ctx.reply(" يجب الاشتراك بالقناة أولًا لاستخدام Game Zone.",subscriptionKeyboard());
  const synced=await syncUser(ctx),u=synced.user;
  const full=[u.firstName,u.lastName].filter(Boolean).join(" ")||"عميل Game Zone";
  return ctx.replyWithPhoto({source:path.join(__dirname,"../miniapp/icon-512.png")},{
    caption:` <b>مرحبًا بك في Game Zone</b>

أهلًا <b>${escapeHtml(full)}</b> 
متجرك للمنتجات الرقمية والشحن والبطاقات والخدمات.

 الرصيد: <b>$${Number(u.balance).toFixed(2)}</b>
 ID: <code>${u.telegramId}</code>

 يدعم المتجر أكواد الخصم والعروض.
افتح المتجر المصغر لتجربة الشراء الكاملة.`,
    parse_mode:"HTML",...menu()
  });
}

bot.start(welcome);
bot.command("menu",welcome);

bot.action("check_subscription",async ctx=>{
  await ctx.answerCbQuery();
  if(!(await isSubscribed(ctx)))return ctx.reply(" لم يتم التحقق من الاشتراك بعد.",subscriptionKeyboard());
  await ctx.reply(" تم التحقق بنجاح.");return welcome(ctx);
});
bot.action("account",async ctx=>{
  await ctx.answerCbQuery();
  try{await syncUser(ctx);const u=await api(`/api/me?telegramId=${ctx.from.id}`);
    return ctx.reply(` <b>حساب Game Zone</b>

الاسم: ${escapeHtml([u.firstName,u.lastName].filter(Boolean).join(" ")||"-")}
المعرف: ${u.username?"@"+escapeHtml(u.username):"غير موجود"}
الرصيد: <b>$${Number(u.balance).toFixed(2)}</b>
العملة: ${u.currency}`,{parse_mode:"HTML",...menu()});
  }catch{return ctx.reply("تعذر جلب الحساب حاليًا.")}
});
async function browseCategories(ctx){
  try{
    const cs=await api("/api/categories"),roots=cs.filter(c=>!c.parentId).sort((a,b)=>Number(a.sort||0)-Number(b.sort||0));
    const rows=roots.map(c=>[Markup.button.callback(c.name,`cat:${c.id}`)]);
    rows.push([Markup.button.webApp("فتح المتجر الكامل",MINI_APP_URL)]);
    return ctx.reply("<b>أقسام Game Zone</b>\nاختر القسم:",{parse_mode:"HTML",...Markup.inlineKeyboard(rows)});
  }catch{return ctx.reply("تعذر تحميل الأقسام.")}
}
bot.action("products",async ctx=>{await ctx.answerCbQuery();return browseCategories(ctx)});
bot.action("browse_categories",async ctx=>{await ctx.answerCbQuery();return browseCategories(ctx)});
bot.action(/^cat:(.+)$/,async ctx=>{
  await ctx.answerCbQuery();
  try{
    const id=ctx.match[1],cs=await api("/api/categories"),current=cs.find(c=>c.id===id),children=cs.filter(c=>c.parentId===id).sort((a,b)=>Number(a.sort||0)-Number(b.sort||0));
    if(children.length){
      const rows=children.map(c=>[Markup.button.callback(c.name,`cat:${c.id}`)]);
      rows.push([Markup.button.callback("رجوع",current?.parentId?`cat:${current.parentId}`:"browse_categories")]);
      return ctx.reply(`<b>${escapeHtml(current?.name||"الأقسام الفرعية")}</b>\nاختر القسم الفرعي:`,{parse_mode:"HTML",...Markup.inlineKeyboard(rows)});
    }
    const ps=await api(`/api/products?categoryId=${encodeURIComponent(id)}`);
    if(!ps.length)return ctx.reply("لا توجد منتجات في هذا القسم حاليًا.");
    const rows=ps.slice(0,12).map(p=>[Markup.button.callback(p.name,`prd:${p.id}`)]);
    rows.push([Markup.button.callback("رجوع",current?.parentId?`cat:${current.parentId}`:"browse_categories")]);
    return ctx.reply(`<b>${escapeHtml(current?.name||"المنتجات")}</b>\nاختر المنتج:`,{parse_mode:"HTML",...Markup.inlineKeyboard(rows)});
  }catch{return ctx.reply("تعذر تحميل القسم.")}
});
bot.action(/^prd:(.+)$/,async ctx=>{
  await ctx.answerCbQuery();
  try{
    const p=await api(`/api/products/${encodeURIComponent(ctx.match[1])}`);
    return ctx.reply(`<b>${escapeHtml(p.name)}</b>\n\n${escapeHtml(p.description||"")}\nالسعر: <b>$${Number(p.price).toFixed(2)}</b>\nالتسليم: ${p.delivery==="inventory"?"فوري من مخزون الأكواد":p.delivery==="auto"?"تلقائي":"حسب نوع المنتج"}${p.delivery==="inventory"?`\nالمتوفر: <b>${Number(p.stock||0)}</b>`:""}\n\nلإتمام الطلب افتح المتجر المصغر.`,{
      parse_mode:"HTML",
      ...Markup.inlineKeyboard([[Markup.button.webApp("شراء من المتجر",MINI_APP_URL)],[Markup.button.callback("الأقسام","browse_categories")]])
    });
  }catch{return ctx.reply("تعذر تحميل المنتج.")}
});
bot.action("orders",async ctx=>{
  await ctx.answerCbQuery();
  try{await syncUser(ctx);const os=await api(`/api/orders?telegramId=${ctx.from.id}`);
    if(!os.length)return ctx.reply(" لا توجد طلبات حتى الآن.",menu());
    const text=os.slice(0,8).map(o=>`• <b>${escapeHtml(o.productName)}</b>\n  ${escapeHtml(o.orderNo)} — ${escapeHtml(o.status)}`).join("\n\n");
    return ctx.reply(` <b>طلباتك</b>\n\n${text}`,{parse_mode:"HTML",...menu()});
  }catch{return ctx.reply("تعذر تحميل الطلبات.")}
});
bot.action("topup",async ctx=>{await ctx.answerCbQuery();return ctx.reply(" افتح المتجر ثم قسم المحفظة لإنشاء طلب شحن.",menu())});
bot.command("support",ctx=>ctx.reply(` الدعم الفني: @${SUPPORT_USERNAME}`));

bot.command("admin",async ctx=>{
  if(!isAdmin(ctx))return;
  ctx.reply(" <b>Game Zone Admin Bot</b>\nاختر العملية:",{parse_mode:"HTML",...adminMenu()});
});
bot.action("adm_stats",async ctx=>{
  if(!isAdmin(ctx))return;
  await ctx.answerCbQuery();
  try{const d=await api("/api/admin/dashboard",{},true);
    ctx.reply(` <b>إحصاءات Game Zone</b>

 المستخدمون: ${d.users}
 المنتجات: ${d.products}
 الأقسام: ${d.categories||0}
 الطلبات: ${d.orders}
 المكتملة: ${d.completedOrders}
 شحن معلق: ${d.pendingTopups}
 تذاكر مفتوحة: ${d.openTickets||0}
 الإيرادات: $${Number(d.revenue).toFixed(2)}
 الربح: $${Number(d.profit).toFixed(2)}
 الأكواد المتاحة: ${d.inventoryAvailable||0}
 مخزون منخفض: ${d.inventoryLowStockProducts||0}
 المزودون الفعالون: ${d.providers}`,{parse_mode:"HTML",...adminMenu()});
  }catch{ctx.reply("تعذر تحميل الإحصاءات.")}
});
bot.action("adm_orders",async ctx=>{
  if(!isAdmin(ctx))return;
  await ctx.answerCbQuery();
  try{const os=await api("/api/admin/orders",{},true);const text=os.slice(0,8).map(o=>`• <code>${o.orderNo}</code> — ${escapeHtml(o.productName)} — <b>${o.status}</b>`).join("\n");
    ctx.reply(` <b>آخر الطلبات</b>\n\n${text||"لا توجد طلبات"}`,{parse_mode:"HTML",...adminMenu()});
  }catch{ctx.reply("تعذر تحميل الطلبات.")}
});
bot.action("adm_topups",async ctx=>{
  if(!isAdmin(ctx))return;
  await ctx.answerCbQuery();
  try{const ts=(await api("/api/admin/topups",{},true)).filter(t=>t.status==="pending").slice(0,6);
    if(!ts.length)return ctx.reply(" لا توجد طلبات شحن معلقة.",adminMenu());
    for(const t of ts){
      await ctx.reply(` <b>طلب شحن</b>\nID: <code>${t.id}</code>\nالمستخدم: <code>${t.telegramId}</code>\nالمبلغ: <b>$${Number(t.amount).toFixed(2)}</b>`,{
        parse_mode:"HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback(" قبول",`adm_topup_approve:${t.id}`),Markup.button.callback(" رفض",`adm_topup_reject:${t.id}`)]])
      });
    }
  }catch{ctx.reply("تعذر تحميل طلبات الشحن.")}
});
bot.action("adm_sync",async ctx=>{
  if(!isAdmin(ctx))return;
  await ctx.answerCbQuery();
  try{
    const before=await api("/api/admin/sync-worker",{},true);
    const r=await api("/api/admin/sync-worker/run",{method:"POST"},true);
    const x=r.runtime||before.runtime||{};
    ctx.reply(` <b>مزامنة الطلبات</b>

المفحوص: ${x.lastScanned||0}
المحدّث: ${x.lastUpdated||0}
الأخطاء: ${x.lastErrors||0}
آخر تشغيل: ${x.lastRunAt||"-"}`,{parse_mode:"HTML",...adminMenu()});
  }catch{ctx.reply("تعذر تشغيل مزامنة الطلبات.")}
});

bot.action("adm_provider_errors",async ctx=>{
  if(!isAdmin(ctx))return;
  await ctx.answerCbQuery();
  try{const logs=(await api("/api/admin/provider-logs",{},true)).filter(x=>x.ok===false).slice(0,8);
    const text=logs.map(x=>`• ${escapeHtml(x.providerId)} — <code>${escapeHtml(x.orderNo||"-")}</code>\n  ${escapeHtml(x.error||"error")}`).join("\n\n");
    ctx.reply(` <b>أحدث أخطاء المزودين</b>\n\n${text||"لا توجد أخطاء"}`,{parse_mode:"HTML",...adminMenu()});
  }catch{ctx.reply("تعذر تحميل سجل المزودين.")}
});
bot.action("adm_inventory",async ctx=>{
  if(!isAdmin(ctx))return;
  await ctx.answerCbQuery();
  try{
    const rows=await api("/api/admin/inventory/summary",{},true);
    const text=rows.map(x=>`• <b>${escapeHtml(x.productName)}</b>\n  متاح: ${x.available} — مسلّم: ${x.delivered} — إجمالي: ${x.total}`).join("\n\n");
    ctx.reply(` <b>مخزون الأكواد الرقمية</b>\n\n${text||"لا توجد منتجات مخزنية"}`,{parse_mode:"HTML",...adminMenu()});
  }catch{ctx.reply("تعذر تحميل المخزون.")}
});

bot.action("adm_tickets",async ctx=>{
  if(!isAdmin(ctx))return;
  await ctx.answerCbQuery();
  try{
    const ts=(await api("/api/admin/support-tickets",{},true)).filter(t=>["open","pending"].includes(t.status)).slice(0,8);
    if(!ts.length)return ctx.reply("لا توجد تذاكر مفتوحة.",adminMenu());
    for(const t of ts){
      const isKyc=String(t.subject||"").startsWith("[KYC]");
      const rows=isKyc?[[Markup.button.callback("✅ اعتماد KYC",`adm_kyc_approve:${t.id}`),Markup.button.callback("❌ رفض KYC",`adm_kyc_reject:${t.id}`)]]:[];
      rows.push([Markup.button.callback("رجوع للإدارة","adm_stats")]);
      await ctx.reply(`${isKyc?"🪪 <b>طلب KYC</b>":"🎫 <b>تذكرة دعم</b>"}\n\nID: <code>${escapeHtml(t.id)}</code>\nالمستخدم: <code>${escapeHtml(t.telegramId)}</code>\nالعنوان: ${escapeHtml(t.subject||"")}\n\n${escapeHtml(t.message||"")}`,{parse_mode:"HTML",...Markup.inlineKeyboard(rows)});
    }
  }catch{ctx.reply("تعذر تحميل التذاكر.")}
});

bot.action(/^adm_kyc_(approve|reject):(.+)$/,async ctx=>{
  if(!isAdmin(ctx))return;
  const action=ctx.match[1],ticketId=ctx.match[2];
  await ctx.answerCbQuery();
  try{
    const reply=action==="approve"?"KYC_VERIFIED — تم توثيق الحساب بعد المراجعة اليدوية.":"KYC_REJECTED — تعذر اعتماد التحقق. راجع البيانات أو تواصل مع الدعم.";
    await api(`/api/admin/support-tickets/${encodeURIComponent(ticketId)}`,{method:"PATCH",body:JSON.stringify({status:"closed",reply})},true);
    await ctx.editMessageReplyMarkup({inline_keyboard:[]}).catch(()=>{});
    await ctx.reply(action==="approve"?"✅ تم اعتماد KYC.":"❌ تم رفض طلب KYC.");
  }catch(e){ctx.reply("تعذر تحديث KYC: "+e.message)}
});
bot.action("adm_broadcast_help",async ctx=>{
  if(!isAdmin(ctx))return;
  await ctx.answerCbQuery();
  ctx.reply(" لإرسال بث استخدم:\n<code>/broadcast نص الرسالة</code>",{parse_mode:"HTML"});
});
bot.command("broadcast",async ctx=>{
  if(!isAdmin(ctx))return;
  const message=ctx.message.text.replace(/^\/broadcast(@\w+)?\s*/,"").trim();
  if(!message)return ctx.reply("اكتب الرسالة بعد الأمر.");
  if(message.length>3500)return ctx.reply("الرسالة طويلة جدًا. اجعلها أقل من 3500 حرف.");
  const nonce=crypto.randomBytes(6).toString("hex"),adminId=String(ctx.from.id);
  pendingBroadcasts.set(adminId,{nonce,message,expiresAt:Date.now()+BROADCAST_CONFIRM_TTL_MS});
  await ctx.reply(` <b>تأكيد البث</b>\n\nسيتم إرسال الرسالة لجميع العملاء:\n\n${escapeHtml(message.slice(0,500))}${message.length>500?"…":""}\n\nاضغط تأكيد خلال 5 دقائق.`,{
    parse_mode:"HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(" تأكيد البث",`adm_broadcast_do:${nonce}`)],
      [Markup.button.callback("إلغاء","adm_broadcast_cancel")]
    ])
  });
});
bot.action(/^adm_broadcast_do:([a-f0-9]+)$/,async ctx=>{
  if(!isAdmin(ctx))return;
  const adminId=String(ctx.from.id),pending=pendingBroadcasts.get(adminId);
  await ctx.answerCbQuery();
  if(!pending||pending.nonce!==ctx.match[1]||pending.expiresAt<Date.now()){
    pendingBroadcasts.delete(adminId);
    return ctx.reply("انتهت صلاحية تأكيد البث. أرسل الأمر من جديد.");
  }
  pendingBroadcasts.delete(adminId);
  try{
    const r=await api("/api/admin/broadcast",{method:"POST",body:JSON.stringify({title:"Game Zone",message:pending.message,audience:"all",confirmation:"SEND_BROADCAST"})},true);
    await ctx.editMessageReplyMarkup({inline_keyboard:[]}).catch(()=>{});
    ctx.reply(` تمت جدولة البث.\nالمستهدفون: ${r.broadcast.total}\nسيتم الإرسال تدريجيًا في الخلفية.`);
  }catch(e){ctx.reply("تعذر إرسال البث: "+e.message)}
});
bot.action("adm_broadcast_cancel",async ctx=>{
  if(!isAdmin(ctx))return;
  pendingBroadcasts.delete(String(ctx.from.id));
  await ctx.answerCbQuery("تم الإلغاء");
  await ctx.editMessageReplyMarkup({inline_keyboard:[]}).catch(()=>{});
});

bot.action(/^adm_topup_(approve|reject):(.+)$/,async ctx=>{
  if(!isAdmin(ctx))return;
  const action=ctx.match[1],topupId=ctx.match[2];
  await ctx.answerCbQuery();
  const label=action==="approve"?"قبول الشحن وإضافة الرصيد":"رفض طلب الشحن";
  await ctx.reply(` هل تريد تأكيد <b>${label}</b>؟\n<code>${escapeHtml(topupId)}</code>`,{
    parse_mode:"HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(action==="approve"?" تأكيد القبول":" تأكيد الرفض",`adm_topup_do_${action}:${topupId}`)],
      [Markup.button.callback("إلغاء",`adm_topup_cancel:${topupId}`)]
    ])
  });
});
bot.action(/^adm_topup_do_(approve|reject):(.+)$/,async ctx=>{
  if(!isAdmin(ctx))return;
  const action=ctx.match[1],topupId=ctx.match[2];
  await ctx.answerCbQuery();
  try{
    await api(`/api/admin/topups/${encodeURIComponent(topupId)}/${action}`,{method:"POST",body:JSON.stringify({confirmation:action==="approve"?"APPROVE_TOPUP":"REJECT_TOPUP"})},true);
    await ctx.editMessageReplyMarkup({inline_keyboard:[]}).catch(()=>{});
    await ctx.reply(action==="approve"?" تم قبول الشحن.":" تم رفض الشحن.");
  }catch(e){ctx.reply("تعذر تنفيذ العملية: "+e.message)}
});
bot.action(/^adm_topup_cancel:/,async ctx=>{
  if(!isAdmin(ctx))return;
  await ctx.answerCbQuery("تم الإلغاء");
  await ctx.editMessageReplyMarkup({inline_keyboard:[]}).catch(()=>{});
});

bot.catch((err,ctx)=>console.error("BOT ERROR",ctx.updateType,err));
bot.launch().then(()=>console.log("Game Zone bot v2.1 production started"));
process.once("SIGINT",()=>bot.stop("SIGINT"));
process.once("SIGTERM",()=>bot.stop("SIGTERM"));
