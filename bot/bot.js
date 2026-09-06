const { Telegraf, Markup } = require("telegraf");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();
const {loadBotConfig}=require("./config");

const BOT_CONFIG=loadBotConfig(process.env);
const BOT_TOKEN=BOT_CONFIG.botToken;
const MINI_APP_URL=BOT_CONFIG.miniAppUrl;
const ANDROID_APK_URL=String(process.env.ANDROID_APK_URL||"https://github.com/yaminuchiha1245-png/UCHIHA/releases/download/game-zone-client-v3.1.1/Game-Zone-Client-v3.1.1.apk").trim();
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
async function apiBinary(pathname, admin=false) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),API_TIMEOUT_MS);
  try{
    const r=await fetch(API_URL+pathname,{
      method:"GET",
      signal:controller.signal,
      headers:{
        "x-bot-secret":INTERNAL_BOT_SECRET,
        ...(admin?{"x-bot-admin-secret":INTERNAL_BOT_ADMIN_SECRET}:{})
      }
    });
    if(!r.ok){
      const data=await r.json().catch(()=>({}));
      throw new Error(data.error||`API ${r.status}`);
    }
    const contentType=String(r.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
    if(!["image/jpeg","image/png","image/webp"].includes(contentType))throw new Error("receipt_type_not_allowed");
    const declared=Number(r.headers.get("content-length")||0);
    if(Number.isFinite(declared)&&declared>2*1024*1024)throw new Error("receipt_too_large");
    const buffer=Buffer.from(await r.arrayBuffer());
    if(!buffer.length||buffer.length>2*1024*1024)throw new Error("receipt_size_invalid");
    return {buffer,contentType};
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
    [Markup.button.webApp("🛍️ فتح متجر Game Zone",MINI_APP_URL)],
    [Markup.button.callback("🗂️ الأقسام","browse_categories"),Markup.button.callback("👤 حسابي","account")],
    [Markup.button.callback("📦 طلباتي","orders"),Markup.button.callback("💳 شحن الرصيد","topup")],
    [Markup.button.callback("📱 ربط تطبيق المتجر","android_link")],
    [Markup.button.url("🛟 الدعم الفني",`https://t.me/${SUPPORT_USERNAME}`)]
  ]);
}
function adminMenu(){
  return Markup.inlineKeyboard([
    [Markup.button.callback("📊 الإحصاءات","adm_stats"),Markup.button.callback("📦 آخر الطلبات","adm_orders")],
    [Markup.button.callback("💳 الشحن المعلق","adm_topups"),Markup.button.callback("🪪 التحقق","adm_verifications")],
    [Markup.button.callback("⚠️ أخطاء المزودين","adm_provider_errors"),Markup.button.callback("🛟 تذاكر الدعم","adm_tickets")],
    [Markup.button.callback("🔑 مخزون الأكواد","adm_inventory"),Markup.button.callback("🔄 مزامنة الطلبات","adm_sync")],
    [Markup.button.callback("📣 البث","adm_broadcast_help")]
  ]);
}
function subscriptionKeyboard(){
  const url=REQUIRED_CHANNEL.startsWith("@")?`https://t.me/${REQUIRED_CHANNEL.slice(1)}`:"https://t.me/";
  return Markup.inlineKeyboard([[Markup.button.url("الاشتراك بالقناة",url)],[Markup.button.callback("تحققت من الاشتراك","check_subscription")]]);
}

function telegramMediaUrl(value){
  const raw=String(value||"").trim();
  if(!raw)return null;
  try{
    if(/^https:\/\//i.test(raw))return raw;
    if(raw.startsWith("/")){
      const origin=new URL(MINI_APP_URL).origin;
      return new URL(raw,origin).href;
    }
  }catch{}
  return null;
}
async function replyPhotoCard(ctx,{imageUrl,caption,keyboard}){
  const media=telegramMediaUrl(imageUrl);
  if(media){
    try{return await ctx.replyWithPhoto({url:media},{caption,parse_mode:"HTML",...keyboard});}
    catch(e){console.warn("BOT PHOTO FALLBACK",String(e?.message||e).slice(0,160));}
  }
  return ctx.reply(caption,{parse_mode:"HTML",...keyboard});
}
function categoryButtonLabel(c){
  const icon=String(c?.icon||"").trim();
  return `${icon||"🗂️"} ${String(c?.name||"القسم")}`.slice(0,60);
}
function productButtonLabel(p){
  const icon=String(p?.icon||"").trim();
  return `${icon||"🎮"} ${String(p?.name||"المنتج")}`.slice(0,60);
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

 المنتجات والأرصدة والطلبات مرتبطة مباشرة بحسابك في Game Zone.
افتح المتجر لإتمام الشراء وإدارة محفظتك.`,
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

bot.action("android_link",async ctx=>{
  await ctx.answerCbQuery("جاري تجهيز التطبيق...");
  if(!(await isSubscribed(ctx)))return ctx.reply(" يجب الاشتراك بالقناة أولًا.",subscriptionKeyboard());
  try{
    await syncUser(ctx);
    const issued=await api("/api/device/activation/issue",{method:"POST",body:JSON.stringify({telegramUser:ctx.from})});
    const code=String(issued?.activation?.code||"").trim().toUpperCase();
    if(!code)throw new Error("activation_code_missing");
    const caption=`📱 <b>ربط تطبيق المتجر</b>\n\nكود الربط الخاص بك:\n\n<code>${escapeHtml(code)}</code>\n\n1. افتح التطبيق واختر «ربط بالبوت»\n2. أدخل هذا الكود\n\n⏱️ صالح لـ <b>5 دقائق</b> ويُستخدم مرة واحدة فقط.\n🔒 لا تشاركه مع أحد — من يملكه يدخل حسابك من التطبيق.`;
    const keyboard=Markup.inlineKeyboard([[Markup.button.url("📥 تحميل تطبيق المتجر",ANDROID_APK_URL)]]);
    try{
      await ctx.replyWithDocument({url:ANDROID_APK_URL},{caption,parse_mode:"HTML",...keyboard});
    }catch{
      await ctx.reply(caption,{parse_mode:"HTML",...keyboard});
    }
  }catch(e){
    await ctx.reply("تعذر تجهيز رابط التطبيق الآن. حاول مرة أخرى بعد قليل.");
  }
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
    if(!roots.length)return ctx.reply("لا توجد أقسام متاحة للبيع حاليًا.",menu());
    await ctx.reply("🗂️ <b>أقسام Game Zone</b>\nاختر القسم من البطاقات التالية:",{parse_mode:"HTML"});
    for(const c of roots.slice(0,12)){
      await replyPhotoCard(ctx,{
        imageUrl:c.imageUrl,
        caption:`🗂️ <b>${escapeHtml(c.name)}</b>`,
        keyboard:Markup.inlineKeyboard([[Markup.button.callback(categoryButtonLabel(c),`cat:${c.id}`)]])
      });
    }
    return ctx.reply("🛍️ يمكنك أيضًا فتح واجهة المتجر الكاملة.",Markup.inlineKeyboard([[Markup.button.webApp("🛍️ فتح متجر Game Zone",MINI_APP_URL)]]));
  }catch(e){console.error("browse categories",e);return ctx.reply("تعذر تحميل الأقسام.")}
}
bot.action("products",async ctx=>{await ctx.answerCbQuery();return browseCategories(ctx)});
bot.action("browse_categories",async ctx=>{await ctx.answerCbQuery();return browseCategories(ctx)});
bot.action(/^cat:(.+)$/,async ctx=>{
  await ctx.answerCbQuery();
  try{
    const id=ctx.match[1],cs=await api("/api/categories"),current=cs.find(c=>String(c.id)===String(id)),children=cs.filter(c=>String(c.parentId||"")===String(id)).sort((a,b)=>Number(a.sort||0)-Number(b.sort||0));
    if(!current)return ctx.reply("هذا القسم لم يعد متاحًا.",menu());
    if(children.length){
      await ctx.reply(`🗂️ <b>${escapeHtml(current.name)}</b>\nاختر القسم الفرعي:`,{parse_mode:"HTML"});
      for(const c of children.slice(0,12)){
        await replyPhotoCard(ctx,{
          imageUrl:c.imageUrl,
          caption:`🗂️ <b>${escapeHtml(c.name)}</b>`,
          keyboard:Markup.inlineKeyboard([[Markup.button.callback(categoryButtonLabel(c),`cat:${c.id}`)]])
        });
      }
      return ctx.reply("↩️ رجوع",Markup.inlineKeyboard([[Markup.button.callback("⬅️ رجوع",current.parentId?`cat:${current.parentId}`:"browse_categories")]]));
    }
    const ps=await api(`/api/products?categoryId=${encodeURIComponent(id)}`);
    if(!ps.length)return ctx.reply("لا توجد منتجات متاحة للبيع في هذا القسم حاليًا.",Markup.inlineKeyboard([[Markup.button.callback("⬅️ رجوع",current.parentId?`cat:${current.parentId}`:"browse_categories")]]));
    await ctx.reply(`🛍️ <b>${escapeHtml(current.name)}</b>\nاختر المنتج:`,{parse_mode:"HTML"});
    for(const p of ps.slice(0,12)){
      await replyPhotoCard(ctx,{
        imageUrl:p.imageUrl,
        caption:`<b>${escapeHtml(p.name)}</b>\n💰 <b>$${Number(p.price).toFixed(2)}</b>`,
        keyboard:Markup.inlineKeyboard([[Markup.button.callback(productButtonLabel(p),`prd:${p.id}`)]])
      });
    }
    return ctx.reply("↩️ رجوع",Markup.inlineKeyboard([[Markup.button.callback("⬅️ رجوع",current.parentId?`cat:${current.parentId}`:"browse_categories")]]));
  }catch(e){console.error("category browse",e);return ctx.reply("تعذر تحميل القسم.")}
});
bot.action(/^prd:(.+)$/,async ctx=>{
  await ctx.answerCbQuery();
  try{
    const p=await api(`/api/products/${encodeURIComponent(ctx.match[1])}`);
    const promise=String(p.deliveryText||"حسب المنتج").trim()||"حسب المنتج";
    const caption=`<b>${escapeHtml(p.name)}</b>\n\n${escapeHtml(p.description||"")}\n💰 السعر: <b>$${Number(p.price).toFixed(2)}</b>\n🚚 التسليم: ${escapeHtml(promise)}${p.delivery==="inventory"?`\n🔑 المتوفر: <b>${Number(p.stock||0)}</b>`:""}`;
    return replyPhotoCard(ctx,{
      imageUrl:p.imageUrl,
      caption,
      keyboard:Markup.inlineKeyboard([[Markup.button.webApp("🛒 شراء من المتجر",MINI_APP_URL)],[Markup.button.callback("🗂️ الأقسام","browse_categories")]])
    });
  }catch(e){console.error("product detail",e);return ctx.reply("تعذر تحميل المنتج.")}
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
      const receiptMissing=t.requiresReceipt===true&&!t.receiptUploaded;
      const receiptLabel=t.requiresReceipt?(t.receiptUploaded?"مطلوب • مرفوع":"مطلوب • غير مرفوع"):(t.receiptUploaded?"اختياري • مرفوع":"اختياري");
      const actions=[];
      if(t.receiptUploaded)actions.push([Markup.button.callback("عرض الإيصال",`adm_topup_receipt:${t.id}`)]);
      if(receiptMissing)actions.push([Markup.button.callback(" رفض",`adm_topup_reject:${t.id}`)]);
      else actions.push([Markup.button.callback(" قبول",`adm_topup_approve:${t.id}`),Markup.button.callback(" رفض",`adm_topup_reject:${t.id}`)]);
      await ctx.reply(` <b>طلب شحن</b>
ID: <code>${t.id}</code>
المستخدم: <code>${t.telegramId}</code>
المبلغ: <b>$${Number(t.amount).toFixed(2)}</b>
الإيصال: <b>${receiptLabel}</b>${receiptMissing?"\n⚠️ لا يمكن الاعتماد قبل رفع الإيصال المطلوب.":""}`,{
        parse_mode:"HTML",
        ...Markup.inlineKeyboard(actions)
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
    if(!ts.length)return ctx.reply("🛟 لا توجد تذاكر دعم مفتوحة.",adminMenu());
    for(const t of ts){
      await ctx.reply(`🛟 <b>تذكرة دعم</b>\n\nID: <code>${escapeHtml(t.id)}</code>\nالمستخدم: <code>${escapeHtml(t.telegramId)}</code>\nالعنوان: ${escapeHtml(t.subject||"")}\n\n${escapeHtml(t.message||"")}`,{parse_mode:"HTML",...Markup.inlineKeyboard([[Markup.button.callback("⬅️ رجوع للإدارة","adm_stats")]])});
    }
  }catch(e){console.error("admin tickets",e);ctx.reply("تعذر تحميل التذاكر.")}
});

bot.action("adm_verifications",async ctx=>{
  if(!isAdmin(ctx))return;
  await ctx.answerCbQuery();
  try{
    const rows=(await api("/api/admin/verifications",{},true)).filter(v=>v.status==="pending").slice(0,8);
    if(!rows.length)return ctx.reply("🪪 لا توجد طلبات تحقق معلقة.",adminMenu());
    for(const v of rows){
      await ctx.reply(`🪪 <b>طلب تحقق حساب</b>\n\nID: <code>${escapeHtml(v.id)}</code>\nالمستخدم: <code>${escapeHtml(v.telegramId)}</code>\nالحالة: <b>قيد المراجعة</b>\nالتاريخ: ${escapeHtml(v.createdAt||"-")}\n\nاعتمد الطلب فقط بعد إتمام المطابقة عبر القناة الرسمية المخصصة لذلك.`,{
        parse_mode:"HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("✅ اعتماد",`adm_verify_approve:${v.id}`),Markup.button.callback("❌ رفض",`adm_verify_reject:${v.id}`)]])
      });
    }
  }catch(e){console.error("admin verifications",e);ctx.reply("تعذر تحميل طلبات التحقق.")}
});

bot.action(/^adm_verify_(approve|reject):(.+)$/,async ctx=>{
  if(!isAdmin(ctx))return;
  const action=ctx.match[1],verificationId=ctx.match[2];
  await ctx.answerCbQuery();
  const label=action==="approve"?"اعتماد التحقق":"رفض طلب التحقق";
  await ctx.reply(`🪪 هل تريد تأكيد <b>${label}</b>؟\n<code>${escapeHtml(verificationId)}</code>`,{
    parse_mode:"HTML",
    ...Markup.inlineKeyboard([[Markup.button.callback(action==="approve"?"✅ تأكيد الاعتماد":"❌ تأكيد الرفض",`adm_verify_do_${action}:${verificationId}`)],[Markup.button.callback("إلغاء","adm_verifications")]])
  });
});

bot.action(/^adm_verify_do_(approve|reject):(.+)$/,async ctx=>{
  if(!isAdmin(ctx))return;
  const action=ctx.match[1],verificationId=ctx.match[2];
  await ctx.answerCbQuery();
  try{
    const status=action==="approve"?"verified":"rejected";
    await api(`/api/admin/verifications/${encodeURIComponent(verificationId)}`,{method:"PATCH",body:JSON.stringify({status})},true);
    await ctx.editMessageReplyMarkup({inline_keyboard:[]}).catch(()=>{});
    return ctx.reply(action==="approve"?"✅ تم اعتماد التحقق وتحديث حساب العميل.":"❌ تم رفض طلب التحقق، ويمكن للعميل إرسال طلب جديد.",adminMenu());
  }catch(e){
    if(e.message==="verification_already_reviewed")return ctx.reply("تمت مراجعة هذا الطلب مسبقًا.",adminMenu());
    return ctx.reply("تعذر تحديث طلب التحقق: "+escapeHtml(e.message||"error"),adminMenu());
  }
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

bot.action(/^adm_topup_receipt:(.+)$/,async ctx=>{
  if(!isAdmin(ctx))return;
  const topupId=ctx.match[1];
  await ctx.answerCbQuery();
  try{
    const receipt=await apiBinary(`/api/admin/topups/${encodeURIComponent(topupId)}/receipt`,true);
    const caption=`إيصال شحن Game Zone\n${topupId}`;
    if(receipt.contentType==="image/webp"){
      return ctx.replyWithDocument({source:receipt.buffer,filename:"receipt.webp"},{caption});
    }
    return ctx.replyWithPhoto({source:receipt.buffer},{caption});
  }catch(e){
    if(e.message==="receipt_not_found")return ctx.reply("الإيصال غير موجود أو تمت إزالته.");
    return ctx.reply("تعذر عرض الإيصال حاليًا.");
  }
});

bot.action(/^adm_topup_(approve|reject):(.+)$/,async ctx=>{
  if(!isAdmin(ctx))return;
  const action=ctx.match[1],topupId=ctx.match[2];
  await ctx.answerCbQuery();
  if(action==="approve"){
    try{
      const current=(await api("/api/admin/topups",{},true)).find(t=>String(t.id)===String(topupId));
      if(!current)return ctx.reply("طلب الشحن غير موجود أو تمت معالجته.");
      if(current.status!=="pending")return ctx.reply("طلب الشحن لم يعد معلقًا.");
      if(current.requiresReceipt===true&&!current.receiptUploaded)return ctx.reply("⚠️ لا يمكن اعتماد هذا الشحن قبل رفع الإيصال المطلوب من العميل.");
    }catch{return ctx.reply("تعذر التحقق من حالة الإيصال حاليًا. لم يتم تنفيذ أي اعتماد.")}
  }
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
  }catch(e){
    if(e.message==="topup_receipt_required")ctx.reply("⚠️ لا يمكن اعتماد الشحن قبل رفع الإيصال المطلوب.");
    else ctx.reply("تعذر تنفيذ العملية: "+e.message);
  }
});
bot.action(/^adm_topup_cancel:/,async ctx=>{
  if(!isAdmin(ctx))return;
  await ctx.answerCbQuery("تم الإلغاء");
  await ctx.editMessageReplyMarkup({inline_keyboard:[]}).catch(()=>{});
});

bot.catch((err,ctx)=>console.error("BOT ERROR",ctx.updateType,err));
bot.launch().then(()=>console.log("Game Zone bot v3.2 production started"));
process.once("SIGINT",()=>bot.stop("SIGINT"));
process.once("SIGTERM",()=>bot.stop("SIGTERM"));
