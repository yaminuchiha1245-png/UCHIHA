from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)

p=Path('miniapp/app.js')
s=p.read_text()

anchor='function esc(v){\n'
helper=r'''function topupDisplayPreviewText(value){
  const amount=Number(value||0);
  if(!Number.isFinite(amount)||amount<=0)return "";
  const cfg=displayCurrencyConfig();
  if(cfg.code==="USD")return `المبلغ الفعلي ${baseMoney(amount)} USD`;
  return `المبلغ الفعلي ${baseMoney(amount)} USD • للعرض تقريبًا ${money(amount)} (${cfg.code}) حسب سعر العرض الذي ضبطته الإدارة`;
}
'''
s=replace_once(s,anchor,helper+anchor,'topup display preview helper')

old='<div class="field"><label>المبلغ بالدولار (USD)</label><input id="topupAmount" type="number" value="10"><small class="input-help">عملة الشحن الأساسية هي USD. اختيار EUR / TRY / SYP يغيّر العرض داخل المتجر فقط ولا يغيّر مبلغ التحويل المالي.</small></div>'
new=old+'<div id="topupAmountPreview" class="payment-info"></div>'
s=replace_once(s,old,new,'topup preview host')

old='''  let selectedMethod=safeMethods[0].id;\n  openSheet(`'''
new='''  let selectedMethod=safeMethods[0].id;\n  openSheet(`'''
if old not in s:
    raise SystemExit('missing anchor: selected payment method')

old='''  const renderMethod=()=>{\n    const m=safeMethods.find(x=>x.id===selectedMethod)||safeMethods[0];'''
new='''  const renderTopupAmountPreview=()=>{\n    const el=$("#topupAmountPreview"),input=$("#topupAmount");if(!el||!input)return;\n    const text=topupDisplayPreviewText(input.value);\n    el.innerHTML=text?`<b>ملخص المبلغ</b><span>${esc(text)}</span>`:"";\n  };\n  const renderMethod=()=>{\n    const m=safeMethods.find(x=>x.id===selectedMethod)||safeMethods[0];'''
s=replace_once(s,old,new,'topup preview renderer')

old='''    $("#topupRefLabel").textContent=m.requiresReference?"رقم العملية / المرجع (مطلوب)":"رقم العملية / المرجع (اختياري)";\n  };\n  renderMethod();'''
new='''    $("#topupRefLabel").textContent=m.requiresReference?"رقم العملية / المرجع (مطلوب)":"رقم العملية / المرجع (اختياري)";\n    renderTopupAmountPreview();\n  };\n  renderMethod();\n  $("#topupAmount")?.addEventListener("input",renderTopupAmountPreview);'''
s=replace_once(s,old,new,'topup preview live update')
p.write_text(s)

p=Path('server/scripts/web-security-audit.js')
s=p.read_text()
anchor='if(!mini.includes("refreshDisplayCurrencyViews"))failures.push("currency selection does not refresh visible monetary views");\n'
addition=anchor+'if(!mini.includes("topupDisplayPreviewText")||!mini.includes("topupAmountPreview"))failures.push("topup base/display currency preview missing");\n'
s=replace_once(s,anchor,addition,'topup preview audit')
p.write_text(s)

print('Top-up currency preview implementation prepared')
