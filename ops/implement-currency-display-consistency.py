from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old,new,1)

# Make the core money formatter respect the selected enabled display currency,
# while preserving an explicit base USD formatter for actual top-up settlement.
p=Path('miniapp/app.js')
s=p.read_text()
old='function money(v){return `$${Number(v||0).toFixed(2)}`}\n'
new=r'''function displayCurrencyConfig(){
  const fallback={code:"USD",symbol:"$",rate:1,enabled:true};
  let requested="USD";
  try{requested=String(localStorage.getItem("gamezone_display_currency")||state.user?.currency||"USD").toUpperCase()}catch{}
  const list=Array.isArray(state.config?.currencies)?state.config.currencies:[];
  const found=list.find(c=>String(c.code||"").toUpperCase()===requested&&c.enabled===true);
  if(found){
    const rate=Number(found.rate||1);
    if(Number.isFinite(rate)&&rate>0)return {code:requested,symbol:String(found.symbol||requested),rate};
  }
  return fallback;
}
function baseMoney(v){
  const n=Number(v||0),sign=n<0?"-":"";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}
function money(v){
  const cfg=displayCurrencyConfig(),raw=Number(v||0)*cfg.rate,sign=raw<0?"-":"",abs=Math.abs(raw);
  const decimals=cfg.code==="SYP"?0:2;
  const value=abs.toLocaleString("en-US",{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
  if(cfg.code==="SYP")return `${sign}${value} ${cfg.symbol}`;
  return `${sign}${cfg.symbol}${value}`;
}
'''
s=replace_once(s,old,new,'core money formatter')
old='<div class="field"><label>المبلغ بالدولار</label><input id="topupAmount" type="number" value="10"></div>'
new='<div class="field"><label>المبلغ بالدولار (USD)</label><input id="topupAmount" type="number" value="10"><small class="input-help">عملة الشحن الأساسية هي USD. اختيار EUR / TRY / SYP يغيّر العرض داخل المتجر فقط ولا يغيّر مبلغ التحويل المالي.</small></div>'
s=replace_once(s,old,new,'topup base-currency label')
s=replace_once(s,'<small>الحد: ${money(min)} — ${money(max)}</small>','<small>الحد الفعلي: ${baseMoney(min)} — ${baseMoney(max)}</small>','topup actual limits')
s=replace_once(s,'<p>المبلغ: <b>${money(r.topup.amount)}</b></p>','<p>المبلغ الفعلي: <b>${baseMoney(r.topup.amount)}</b></p>${displayCurrencyConfig().code!=="USD"?`<p>للعرض في المتجر: <b>${money(r.topup.amount)}</b></p>`:""}','checkout amount transparency')
p.write_text(s)

# Tighten the v2.1 currency picker and refresh live rendered views after a change.
p=Path('miniapp/v21.js')
s=p.read_text()
old=r'''  function currentCurrency(){
    try{return String(localStorage.getItem("gamezone_display_currency")||safeState()?.user?.currency||"USD").toUpperCase()}catch{return "USD"}
  }'''
new=r'''  function currentCurrency(){
    let requested="USD";
    try{requested=String(localStorage.getItem("gamezone_display_currency")||safeState()?.user?.currency||"USD").toUpperCase()}catch{}
    const active=currencyList().find(c=>c.code===requested&&c.enabled===true);
    if(active)return active.code;
    try{localStorage.setItem("gamezone_display_currency","USD")}catch{}
    return "USD";
  }'''
s=replace_once(s,old,new,'active display currency guard')
old='''  function moneyRaw(value){return Number(value||0).toFixed(2)}\n  function refreshBalanceChip(){'''
new='''  function moneyRaw(value){return Number(value||0).toFixed(2)}\n  function refreshDisplayCurrencyViews(){\n    refreshBalanceChip();\n    try{renderUser()}catch{}\n    try{if(typeof currentCategoryId!=="undefined"&&currentCategoryId&&document.querySelector('.screen[data-screen="category"]')?.classList.contains("active"))openCategory(currentCategoryId)}catch{}\n    try{if(document.querySelector('.screen[data-screen="orders"]')?.classList.contains("active"))loadOrders()}catch{}\n    try{if(document.querySelector('.screen[data-screen="wallet"]')?.classList.contains("active"))loadWallet()}catch{}\n  }\n  function refreshBalanceChip(){'''
s=replace_once(s,old,new,'currency view refresh helper')
s=replace_once(s,'setCurrentCurrency(b.dataset.gz21Currency);renderCurrencyCards();refreshBalanceChip();','setCurrentCurrency(b.dataset.gz21Currency);renderCurrencyCards();refreshDisplayCurrencyViews();','currency selection refresh')
s=replace_once(s,'<div class="gz21-card-icon">${paymentIcon(m.name)}</div><b>${String(m.name||"طريقة دفع").replace(/[<>]/g,"")}</b><small>${m.minAmount?`من $${Number(m.minAmount).toFixed(2)}`:"اضغط لإنشاء طلب شحن"}</small>','<div class="gz21-card-icon">${paymentIcon(m.name)}</div><b>${String(m.name||"طريقة دفع").replace(/[<>]/g,"")}</b><small>${m.minAmount?`الحد الفعلي من $${Number(m.minAmount).toFixed(2)} USD`:"اضغط لإنشاء طلب شحن"}</small>','payment card base-currency clarity')
s=replace_once(s,'<div class="gz21-block-head"><h3>العملات</h3><small>بدون أسعار صرف وهمية</small></div>','<div class="gz21-block-head"><h3>عملات العرض</h3><small>الشحن المالي الأساسي يبقى USD</small></div>','wallet currency heading')
p.write_text(s)

# Extend frontend audit so future changes cannot accidentally blur display currency vs settlement currency.
p=Path('server/scripts/web-security-audit.js')
s=p.read_text()
anchor='if(!mini.includes(\'gz21-balance-chip\'))failures.push("real balance chip upgrade missing");\n'
addition=anchor+'if(!mini.includes("function baseMoney")||!mini.includes("عملة الشحن الأساسية هي USD"))failures.push("display/base currency separation missing");\nif(!mini.includes("refreshDisplayCurrencyViews"))failures.push("currency selection does not refresh visible monetary views");\n'
s=replace_once(s,anchor,addition,'currency frontend audit')
p.write_text(s)

print('Currency display consistency implementation prepared')
