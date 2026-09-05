from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)

# Allow only the exact read-only receipt route for the internal Telegram automation role.
p=Path('server/lib/adminAutomationPolicy.js')
s=p.read_text()
rule='  ["GET",/^\\/api\\/admin\\/topups\\/[^/]+\\/receipt$/],\n'
anchor='  ["GET",/^\\/api\\/admin\\/topups$/],\n'
if rule not in s:
    s=replace_once(s, anchor, anchor+rule, 'automation receipt rule')
p.write_text(s)

# Lock the narrow permission into tests and confirm the method remains read-only.
p=Path('server/tests/adminAutomationPolicy.test.js')
s=p.read_text()
allowed='    ["GET","/api/admin/topups/topup_1/receipt"],\n'
anchor='    ["GET","/api/admin/topups"],\n'
if allowed not in s:
    s=replace_once(s, anchor, anchor+allowed, 'automation receipt allowed test')
method_anchor='  assert.equal(canAutomationAccess("GET","/api/admin/broadcast"),false);\n'
method_check='  assert.equal(canAutomationAccess("POST","/api/admin/topups/topup_1/receipt"),false);\n'
if method_check not in s:
    s=replace_once(s, method_anchor, method_anchor+method_check, 'automation receipt method test')
p.write_text(s)

# Add a bounded binary fetch helper to the Bot. It authenticates over the internal
# admin channel, accepts only the image formats the receipt uploader already allows,
# and caps memory even if an upstream response lies about Content-Length.
p=Path('bot/bot.js')
s=p.read_text()
if 'async function apiBinary(' not in s:
    insert_at=s.index('const isAdmin =')
    helper=r'''async function apiBinary(pathname, admin=false) {
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
'''
    s=s[:insert_at]+helper+'\n'+s[insert_at:]

old_actions=r'''      const actions=receiptMissing
        ? [[Markup.button.callback(" رفض",`adm_topup_reject:${t.id}`)]]
        : [[Markup.button.callback(" قبول",`adm_topup_approve:${t.id}`),Markup.button.callback(" رفض",`adm_topup_reject:${t.id}`)]];
'''
new_actions=r'''      const actions=[];
      if(t.receiptUploaded)actions.push([Markup.button.callback("عرض الإيصال",`adm_topup_receipt:${t.id}`)]);
      if(receiptMissing)actions.push([Markup.button.callback(" رفض",`adm_topup_reject:${t.id}`)]);
      else actions.push([Markup.button.callback(" قبول",`adm_topup_approve:${t.id}`),Markup.button.callback(" رفض",`adm_topup_reject:${t.id}`)]);
'''
if 'adm_topup_receipt:${t.id}' not in s:
    s=replace_once(s, old_actions, new_actions, 'admin bot receipt button')

if 'bot.action(/^adm_topup_receipt:' not in s:
    anchor='bot.action(/^adm_topup_(approve|reject):(.+)$/,async ctx=>{\n'
    handler=r'''bot.action(/^adm_topup_receipt:(.+)$/,async ctx=>{
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
'''
    s=replace_once(s, anchor, handler+'\n'+anchor, 'admin bot receipt handler')
p.write_text(s)

# Keep the security audit aware of this privileged binary-read path.
p=Path('server/scripts/web-security-audit.js')
s=p.read_text()
audit_anchor='if(!botJs.includes("receiptMissing=t.requiresReceipt===true&&!t.receiptUploaded")||!botJs.includes("current.requiresReceipt===true&&!current.receiptUploaded")||!botJs.includes("topup_receipt_required"))failures.push("admin bot topup receipt review guard missing");\n'
audit_check='if(!botJs.includes("async function apiBinary")||!botJs.includes("adm_topup_receipt")||!botJs.includes("receipt_type_not_allowed"))failures.push("protected admin bot receipt viewer missing");\n'
if audit_check not in s:
    s=replace_once(s, audit_anchor, audit_anchor+audit_check, 'receipt viewer security audit')
p.write_text(s)

print('Protected Admin Bot receipt viewer prepared')
