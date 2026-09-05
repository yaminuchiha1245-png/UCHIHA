from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old,new,1)

p=Path('bot/bot.js')
s=p.read_text()
old='''    return ctx.reply(`<b>${escapeHtml(p.name)}</b>\\n\\n${escapeHtml(p.description||"")}\\nالسعر: <b>$${Number(p.price).toFixed(2)}</b>\\nالتسليم: ${p.delivery==="inventory"?"فوري من مخزون الأكواد":p.delivery==="auto"?"تلقائي":"حسب نوع المنتج"}${p.delivery==="inventory"?`\\nالمتوفر: <b>${Number(p.stock||0)}</b>`:""}\\n\\nلإتمام الطلب افتح المتجر المصغر.`,{
'''
new='''    const promise=String(p.deliveryText||"حسب المنتج").trim()||"حسب المنتج";
    return ctx.reply(`<b>${escapeHtml(p.name)}</b>\\n\\n${escapeHtml(p.description||"")}\\nالسعر: <b>$${Number(p.price).toFixed(2)}</b>\\nالتسليم: ${escapeHtml(promise)}${p.delivery==="inventory"?`\\nالمتوفر: <b>${Number(p.stock||0)}</b>`:""}\\n\\nلإتمام الطلب افتح المتجر المصغر.`,{
'''
s=replace_once(s,old,new,'telegram product delivery promise')
p.write_text(s)

p=Path('server/scripts/web-security-audit.js')
s=p.read_text()
anchor='if(!botJs.includes("async function apiBinary")||!botJs.includes("adm_topup_receipt")||!botJs.includes("receipt_type_not_allowed"))failures.push("protected admin bot receipt viewer missing");\n'
check='if(!botJs.includes("p.deliveryText")||botJs.includes("p.delivery===\\\"auto\\\"?\\\"تلقائي\\\""))failures.push("telegram product delivery promise parity missing");\n'
if check not in s:
    s=replace_once(s,anchor,anchor+check,'telegram delivery promise audit')
p.write_text(s)

print('Telegram delivery promise parity prepared')
