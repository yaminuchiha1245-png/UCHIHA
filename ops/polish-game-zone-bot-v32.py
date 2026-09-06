from pathlib import Path

ROOT=Path('.')
BOT=ROOT/'bot/bot.js'
POLICY=ROOT/'server/lib/adminAutomationPolicy.js'
TEST=ROOT/'server/tests/adminAutomationPolicy.test.js'


def replace_required(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing marker: {label}')
    return text.replace(old,new,1)

# --- Bot helpers: only real configured media URLs, no stock/fake images. ---
s=BOT.read_text()
helper_marker='''function subscriptionKeyboard(){
  const url=REQUIRED_CHANNEL.startsWith("@")?`https://t.me/${REQUIRED_CHANNEL.slice(1)}`:"https://t.me/";
  return Markup.inlineKeyboard([[Markup.button.url("الاشتراك بالقناة",url)],[Markup.button.callback("تحققت من الاشتراك","check_subscription")]]);
}
'''
helpers=helper_marker+'''
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
'''
s=replace_required(s,helper_marker,helpers,'subscription keyboard helper insertion')

# Stable production wording: no "try/experimental purchase" language.
s=s.replace(''' يدعم المتجر أكواد الخصم والعروض.
افتح المتجر المصغر لتجربة الشراء الكاملة.''',''' المنتجات والأرصدة والطلبات مرتبطة مباشرة بحسابك في Game Zone.
افتح المتجر لإتمام الشراء وإدارة محفظتك.''')

# Admin menu: emojis + dedicated verification lifecycle.
admin_start=s.index('function adminMenu(){')
admin_end=s.index('function subscriptionKeyboard(){',admin_start)
new_admin='''function adminMenu(){
  return Markup.inlineKeyboard([
    [Markup.button.callback("📊 الإحصاءات","adm_stats"),Markup.button.callback("📦 آخر الطلبات","adm_orders")],
    [Markup.button.callback("💳 الشحن المعلق","adm_topups"),Markup.button.callback("🪪 التحقق","adm_verifications")],
    [Markup.button.callback("⚠️ أخطاء المزودين","adm_provider_errors"),Markup.button.callback("🛟 تذاكر الدعم","adm_tickets")],
    [Markup.button.callback("🔑 مخزون الأكواد","adm_inventory"),Markup.button.callback("🔄 مزامنة الطلبات","adm_sync")],
    [Markup.button.callback("📣 البث","adm_broadcast_help")]
  ]);
}
'''
s=s[:admin_start]+new_admin+s[admin_end:]

# Photo-first real category/product browsing.
browse_start=s.index('async function browseCategories(ctx){')
browse_end=s.index('bot.action("orders"',browse_start)
new_browse=r'''async function browseCategories(ctx){
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
'''
s=s[:browse_start]+new_browse+s[browse_end:]

# Replace obsolete ticket-KYC branch with dedicated backend verification lifecycle.
kyc_start=s.index('bot.action("adm_tickets"')
kyc_end=s.index('bot.action("adm_broadcast_help"',kyc_start)
new_admin_support=r'''bot.action("adm_tickets",async ctx=>{
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

'''
s=s[:kyc_start]+new_admin_support+s[kyc_end:]

s=s.replace('bot.launch().then(()=>console.log("Game Zone bot v2.1 production started"));','bot.launch().then(()=>console.log("Game Zone bot v3.2 production started"));')

# Hard assertions: obsolete support-ticket KYC actions must be gone.
if 'adm_kyc_' in s or 'startsWith("[KYC]")' in s:
    raise SystemExit('legacy KYC ticket actions still present')
if 'تجربة الشراء الكاملة' in s:
    raise SystemExit('experimental customer wording still present')
BOT.write_text(s)

# --- Telegram automation policy: allow only the dedicated verification reads/decisions. ---
p=POLICY.read_text()
needle='''  ["GET",/^\\/api\\/admin\\/support-tickets$/],
'''
replacement=needle+'''  ["GET",/^\\/api\\/admin\\/verifications$/],
  ["PATCH",/^\\/api\\/admin\\/verifications\\/[^/]+$/],
'''
p=replace_required(p,needle,replacement,'automation verification routes')
POLICY.write_text(p)

# Keep policy tests explicit and method-sensitive.
t=TEST.read_text()
t=replace_required(t,
'''    ["GET","/api/admin/support-tickets"],
''',
'''    ["GET","/api/admin/support-tickets"],
    ["GET","/api/admin/verifications"],
    ["PATCH","/api/admin/verifications/verify_1"],
''','automation allowed tests')
t=replace_required(t,
'''    ["GET","/api/admin/audit"]
''',
'''    ["GET","/api/admin/audit"],
    ["POST","/api/admin/verifications/verify_1"],
    ["DELETE","/api/admin/verifications/verify_1"]
''','automation denied tests')
t=replace_required(t,
'''  assert.equal(canAutomationAccess("POST","/api/admin/topups/topup_1/receipt"),false);
''',
'''  assert.equal(canAutomationAccess("POST","/api/admin/topups/topup_1/receipt"),false);
  assert.equal(canAutomationAccess("PATCH","/api/admin/verifications"),false);
  assert.equal(canAutomationAccess("GET","/api/admin/verifications/verify_1"),false);
''','automation method-sensitive tests')
TEST.write_text(t)

print('GAME_ZONE_BOT_V32_REAL_UI=APPLIED')
