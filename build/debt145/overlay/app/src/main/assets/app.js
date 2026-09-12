'use strict';

const STORAGE_KEY = 'uchiha_debt_store_state_v1';
const APP_VERSION = 1;
const $ = (id) => document.getElementById(id);
const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0,10);
const uid = (p='ID') => p + '-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
const round2 = n => Math.round((Number(n)||0)*100)/100;
const num = v => Number(String(v ?? '').replace(/,/g,'')) || 0;
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt = (n,d=2) => (Number(n)||0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtFlex = n => (Number(n)||0).toLocaleString('en-US',{maximumFractionDigits:2});
const dateFmt = iso => { if(!iso) return ''; const d = new Date(iso); return isNaN(d)?String(iso):d.toLocaleDateString('en-GB'); };
const dateTimeFmt = iso => { if(!iso) return ''; const d = new Date(iso); return isNaN(d)?String(iso):d.toLocaleString('ar',{dateStyle:'short',timeStyle:'short'}); };

function legacyPinHash(pin){
  let h = 2166136261 >>> 0;
  const s = 'UCHIHA::' + String(pin);
  for(let r=0;r<2500;r++) for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i) + r; h = Math.imul(h,16777619) >>> 0; }
  return ('00000000'+h.toString(16)).slice(-8);
}
function pinHash(pin){
  try{ if(window.Android?.hashPin) return Android.hashPin(String(pin)); }catch(e){}
  return legacyPinHash(pin);
}
function verifyPinAccount(account,pin){
  if(!account) return false;
  const strong=pinHash(pin);
  if(account.pinHash===strong) return true;
  const legacy=legacyPinHash(pin);
  if(account.pinHash===legacy){ account.pinHash=strong; saveState(); return true; }
  return false;
}

function baseState(){
  return {
    version:APP_VERSION, setupDone:false,
    shop:{name:'دفتر الديون',phone:'',village:'',address:'',pdfFooter:'شكراً لتعاملكم معنا'},
    rates:{usdTry:0,usdSyp:0,trySyp:0,updatedAt:null,source:'غير محدد',manual:false},
    accounts:[], activeAccountId:null,
    clients:[], entries:[], deferred:[], shortages:[],
    settings:{
      autoRates:true, rateRefreshHours:8, rateAlertTry:0.25,
      requireBiometricPayment:true, requireBiometricPurchase:false,
      rateTemplate:'💱 أسعار الصرف — {SHOP}\n🇺🇸 1 USD = {USD_TRY} TRY\n🇺🇸 1 USD = {USD_SYP} SYP\n🇹🇷 1 TRY = {TRY_SYP} SYP\n🕐 آخر تحديث: {TIME}',
      lockMinutes:5
    },
    audit:[]
  };
}

function normalizeState(s){
  const b=baseState();
  const out={...b,...s,shop:{...b.shop,...(s.shop||{})},rates:{...b.rates,...(s.rates||{})},settings:{...b.settings,...(s.settings||{})}};
  // Compatibility migration: any rate previously saved as a manual entry stays locked after update.
  if(out.rates.manual===true || /يدوي|manual/i.test(String(out.rates.source||''))){
    out.rates.manual=true;
    out.settings.autoRates=false;
  }
  return out;
}
function loadState(){
  try{
    let raw='';
    let nativeSecure=false;
    try{
      if(window.Android?.loadSecureState){ nativeSecure=true; raw=Android.loadSecureState()||''; }
    }catch(e){window.__stateReadFailed=true;return baseState();}
    if(!raw){
      raw=localStorage.getItem(STORAGE_KEY)||'';
      if(raw && nativeSecure){
        const parsed=JSON.parse(raw);
        if(!window.DebtDataGuard.valid(parsed))throw new Error('invalid legacy state');
        if(Android.preserveLegacyState && !Android.preserveLegacyState(raw))throw new Error('checkpoint failed');
        if(Android.saveSecureStateChecked){if(!Android.saveSecureStateChecked(raw))throw new Error('save failed');}
        else Android.saveSecureState(raw);
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    if(!raw) return baseState();
    const parsed=JSON.parse(raw);
    if(!window.DebtDataGuard.valid(parsed))throw new Error('unreadable saved state');
    return normalizeState(parsed);
  }catch(e){ window.__stateReadFailed=true; return baseState(); }
}
let state = loadState();
let view = 'home';
let drawerOpen = false;
let sessionAccountId = null;
let clientSearch = '';
let selectedClientId = null;
let purchaseClientId = null;
let paymentClientId = null;
let purchaseDraft = {amount:'',currency:'TRY',description:''};
let paymentDraft = {amount:'',currency:'USD',description:'دفعة'};
let calcExpr = '';
let calcCurrency = 'TRY';
let calcLastRegistered = '';
let toastTimer = null;
let pendingSensitive = null;
let paymentLogTab = 'recent';
let clientLedgerQuery = '';
let pinFailCount = 0;
let pinLockedUntil = 0;

function saveState(){
  if(window.__stateReadFailed)return false;
  const raw=JSON.stringify(state);
  if(window.Android?.saveSecureStateChecked){
    if(!Android.saveSecureStateChecked(raw)){toast('تعذر الحفظ — احتفظ بالتطبيق مفتوحًا وصدّر نسخة من بياناتك');throw new Error('State persistence failed');}
    localStorage.removeItem(STORAGE_KEY);return true;
  }
  try{
    if(window.Android?.saveSecureState){ Android.saveSecureState(raw); localStorage.removeItem(STORAGE_KEY); return; }
  }catch(e){}
  localStorage.setItem(STORAGE_KEY,raw);
}
function audit(action,details=''){
  state.audit.unshift({id:uid('AUD'),at:nowIso(),by:currentAccount()?.name||'النظام',action,details});
  state.audit = state.audit.slice(0,500);
  saveState();
}
function currentAccount(){ return state.accounts.find(a=>a.id===sessionAccountId)||state.accounts.find(a=>a.id===state.activeAccountId)||null; }
function isOwner(){ return currentAccount()?.role==='owner'; }
function can(permission){ const a=currentAccount(); return !!a && (a.role==='owner' || a.permissions?.[permission]!==false); }
function initials(name){ return String(name||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase(); }
function hasRates(){ return state.rates.usdTry>0 && state.rates.usdSyp>0; }
function ratesAgeHours(){ if(!state.rates.updatedAt) return 9999; return (Date.now()-new Date(state.rates.updatedAt).getTime())/36e5; }

function toast(msg){
  const el=$('toast'); if(!el) return;
  el.textContent=msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),2600);
}
function openModal(html){ $('modalCard').innerHTML=html; $('modal').classList.remove('hidden'); }
function closeModal(){ $('modal').classList.add('hidden'); $('modalCard').innerHTML=''; }
$('modal')?.addEventListener('click',e=>{ if(e.target.id==='modal') closeModal(); });

function convert(amount,currency,rates=state.rates){
  const a=num(amount), ut=num(rates.usdTry), us=num(rates.usdSyp);
  if(a<=0 || ut<=0 || us<=0) return null;
  let usd=0;
  if(currency==='USD') usd=a;
  else if(currency==='TRY') usd=a/ut;
  else if(currency==='SYP') usd=a/us;
  return {usd:round2(usd),try:round2(usd*ut),syp:round2(usd*us)};
}
function currencySymbol(c){ return c==='USD'?'$':c==='TRY'?'₺':'ل.س'; }
function originalText(e){ return `${fmtFlex(e.originalAmount)} ${e.originalCurrency}`; }
function clientDebt(id){ return round2(state.entries.filter(e=>e.clientId===id && ['purchase','opening'].includes(e.type)).reduce((s,e)=>s+num(e.remainingUsd),0)); }
function clientPaid(id){ return round2(state.entries.filter(e=>e.clientId===id && e.type==='payment').reduce((s,e)=>s+num(e.usdAmount),0)); }
function totalDebt(){ return round2(state.clients.reduce((s,c)=>s+clientDebt(c.id),0)); }
function oldestOpen(id){
  return state.entries.filter(e=>e.clientId===id && ['purchase','opening'].includes(e.type) && num(e.remainingUsd)>0.005).sort((a,b)=>new Date(a.date||a.createdAt)-new Date(b.date||b.createdAt))[0]||null;
}
function daysSince(iso){ if(!iso) return 0; return Math.max(0,Math.floor((Date.now()-new Date(iso).getTime())/86400000)); }
function clientFlags(c){
  const debt=clientDebt(c.id), old=oldestOpen(c.id), overdue=old && daysSince(old.date||old.createdAt)>num(c.maxDays||30), overLimit=num(c.debtLimit)>0 && debt>num(c.debtLimit);
  return {debt,overdue,overLimit,oldDays:old?daysSince(old.date||old.createdAt):0};
}
function alertClients(){ return state.clients.filter(c=>{const f=clientFlags(c);return f.overdue||f.overLimit;}); }

function nativeNotify(title,body){ try{ if(window.Android?.notifyUser) Android.notifyUser(title,body); }catch(e){} }
function copyText(text){ try{ if(window.Android?.copyText) Android.copyText(text); else navigator.clipboard?.writeText(text); }catch(e){} }
function shareText(title,text){ try{ if(window.Android?.shareText) Android.shareText(title,text); else copyText(text); }catch(e){} }

function logClientWarnings(clientId, notify=false){
  const c=state.clients.find(x=>x.id===clientId); if(!c) return;
  const f=clientFlags(c);
  if(f.overLimit){ const msg=`${c.name} تجاوز حد الدين — الحالي $${fmt(f.debt)} / الحد $${fmt(c.debtLimit)}`; toast(msg); if(notify) nativeNotify('تنبيه حد الدين',msg); }
  if(f.overdue){ const msg=`${c.name}: أقدم دين مفتوح منذ ${f.oldDays} يومًا`; if(notify) nativeNotify('تنبيه مدة الدين',msg); }
}

function ensureRatesFresh(force=false){
  // A manually pinned rate is a hard lock: background/foreground refreshes must never overwrite it.
  if(state.rates?.manual===true){
    if(force && view==='rates') toast('السعر مثبت يدويًا — ألغِ التثبيت أولًا للتحديث');
    return;
  }
  if(!state.settings.autoRates && !force) return;
  if(!force && ratesAgeHours()<num(state.settings.rateRefreshHours||8)) return;
  try{
    if(window.Android?.refreshRates){ Android.refreshRates(); }
  }catch(e){}
}
window.onNativeRates = function(result){
  // Ignore any late native callback if the owner pinned a manual price while a request was in-flight.
  if(state.rates?.manual===true) return;
  if(!result?.ok){ if(view==='rates') toast('تعذر التحديث، بقي آخر سعر محفوظ'); return; }
  const oldTry=num(state.rates.usdTry);
  state.rates={usdTry:num(result.usdTry),usdSyp:num(result.usdSyp),trySyp:num(result.trySyp),updatedAt:result.timestamp||nowIso(),source:result.source||'LiraScope',manual:false};
  saveState();
  if(oldTry>0 && Math.abs(oldTry-state.rates.usdTry)>=num(state.settings.rateAlertTry||0.25)) nativeNotify('تغير سعر الصرف',`USD/TRY أصبح ${fmt(state.rates.usdTry,3)}`);
  if(view==='rates'||view==='home'||view==='calculator') render();
  toast('تم تحديث سعر الصرف');
};

function nav(v){
  drawerOpen=false; view=v; clientSearch='';
  document.body.classList.toggle('calculator-mode',v==='calculator');
  render();
}
window.appBack=function(){
  if(!$('modal')?.classList.contains('hidden')){ closeModal(); return true; }
  if(drawerOpen){drawerOpen=false;render();return true;}
  if(view==='client'){view='clients';render();return true;}
  if(view!=='home'){view='home';render();return true;}
  return false;
};
function toggleDrawer(){drawerOpen=!drawerOpen;render();}

function topbar(title){
  return `<div class="topbar"><button class="icon-btn" onclick="toggleDrawer()">☰</button><div class="title">${esc(title)}</div><div class="account">${esc(currentAccount()?.name||'')}</div></div>`;
}
function bottomNav(){
  const items=[['home','⌂','الرئيسية'],['clients','👥','العملاء'],['calculator','⌗','الحاسبة'],['partners','🤝','الشركاء']];
  return `<div class="bottom-nav">${items.map(([v,i,t])=>`<button onclick="nav('${v}')" class="${view===v?'active':''}"><b>${i}</b><span>${t}</span></button>`).join('')}</div>`;
}
function drawer(){
  if(!drawerOpen) return '';
  return `<div class="drawer-backdrop" onclick="toggleDrawer()"></div><aside class="drawer">
    <div class="row"><div class="avatar">${esc(initials(currentAccount()?.name))}</div><div class="grow"><h3>${esc(currentAccount()?.name||'')}</h3><div class="small muted">${currentAccount()?.role==='owner'?'صاحب المحل':'شريك'}</div></div><button class="icon-btn" onclick="toggleDrawer()">×</button></div>
    <hr>
    <button class="drawer-item" onclick="nav('rates')">💱 سعر الصرف</button>
    <button class="drawer-item" onclick="nav('deferred')">⏳ المؤجل <span class="badge">${state.deferred.length}</span></button>
    <button class="drawer-item" onclick="nav('shortages')">📦 نواقص المحل</button>
    <button class="drawer-item" onclick="nav('paymentsLog')">🧾 سجل الدفع</button>
    ${isOwner()?`<div class="owner-label">إعدادات المالك</div>
    <button class="drawer-item" onclick="nav('stats')">📊 الإحصائيات</button>
    <button class="drawer-item" onclick="nav('settings')">⚙️ الإعدادات والأمان</button>
    <button class="drawer-item" onclick="nav('backup')">☁️ النسخ الاحتياطي</button>`:''}
    <hr><button class="drawer-item" onclick="lockNow()">🔒 قفل التطبيق</button>
  </aside>`;
}
function shell(title,body){ return `${topbar(title)}<main class="screen">${body}</main>${bottomNav()}${drawer()}`; }

function render(){
  if(window.__stateReadFailed){window.DebtDataGuard.recovery();return;}
  if(!state.setupDone){ renderSetup(); return; }
  if(!sessionAccountId){ renderLock(); return; }
  let html='';
  switch(view){
    case 'home':html=renderHome();break; case 'clients':html=renderClients();break; case 'client':html=renderClient();break;
    case 'purchase':html=renderPurchase();break; case 'payment':html=renderPayment();break; case 'calculator':html=renderCalculator();break;
    case 'deferred':html=renderDeferred();break; case 'shortages':html=renderShortages();break; case 'rates':html=renderRates();break;
    case 'paymentsLog':html=renderPaymentLog();break; case 'partners':html=renderPartners();break; case 'stats':html=renderStats();break;
    case 'settings':html=renderSettings();break; case 'backup':html=renderBackup();break; default:view='home';html=renderHome();
  }
  $('app').innerHTML=html;
}

function renderSetup(){
  $('app').innerHTML=`<div class="setup"><div class="setup-card"><div class="logo">U</div><h1>إعداد دفتر الديون</h1><p>إعداد مرة واحدة فقط. بعده يصبح الاستخدام اليومي: اختر العميل، اكتب المبلغ، وسجّل.</p>
    <div class="form-group"><label class="label">اسم المحل *</label><input id="setupShop" class="input" placeholder="اسم المحل"></div>
    <div class="form-group"><label class="label">القرية / المنطقة</label><input id="setupVillage" class="input" placeholder="مثال: إدلب"></div>
    <div class="form-group"><label class="label">رقم هاتف المحل</label><input id="setupPhone" class="input" inputmode="tel"></div>
    <div class="divider"></div>
    <div class="form-group"><label class="label">اسم صاحب المحل *</label><input id="setupOwner" class="input" placeholder="الاسم"></div>
    <div class="form-group"><label class="label">رمز PIN من 4 أرقام أو أكثر *</label><input id="setupPin" class="input" inputmode="numeric" type="password" maxlength="8"></div>
    <button class="btn primary full" onclick="finishSetup()">إنشاء الدفتر</button></div></div>`;
}
function finishSetup(){
  const shop=$('setupShop').value.trim(), owner=$('setupOwner').value.trim(), pin=$('setupPin').value.trim();
  if(!shop||!owner||pin.length<4){toast('أكمل اسم المحل واسم المالك وPIN');return;}
  const acc={id:uid('ACC'),name:owner,role:'owner',pinHash:pinHash(pin),permissions:{purchase:true,payment:true,clients:true}};
  state=baseState(); state.setupDone=true; state.shop.name=shop; state.shop.village=$('setupVillage').value.trim(); state.shop.phone=$('setupPhone').value.trim(); state.accounts=[acc]; state.activeAccountId=acc.id;
  saveState(); audit('إنشاء الدفتر','إعداد التطبيق لأول مرة'); sessionAccountId=null; render();
}

function renderLock(){
  const accounts=state.accounts;
  const selected=state.activeAccountId||accounts[0]?.id;
  state.activeAccountId=selected; saveState();
  $('app').innerHTML=`<div class="lock"><div class="lock-card"><div class="logo">U</div><h1>${esc(state.shop.name)}</h1><p>اختر الحساب وأدخل PIN. يمكن استخدام بصمة الهاتف أيضًا.</p>
  <div>${accounts.map(a=>`<button class="account-choice ${a.id===selected?'active':''}" onclick="selectLockAccount('${a.id}')"><div class="avatar">${esc(initials(a.name))}</div><div class="grow" style="text-align:right"><b>${esc(a.name)}</b><div class="small muted">${a.role==='owner'?'صاحب المحل':'شريك'}</div></div>${a.id===selected?'✓':''}</button>`).join('')}</div>
  <div class="form-group"><input id="lockPin" class="input" type="password" inputmode="numeric" placeholder="PIN" maxlength="8" onkeydown="if(event.key==='Enter') unlockPin()"></div>
  <button class="btn primary full" onclick="unlockPin()">فتح</button>
  <button class="btn ghost full" style="margin-top:8px" onclick="unlockBiometric()">☝️ فتح بالبصمة</button></div></div>`;
}
function selectLockAccount(id){state.activeAccountId=id;saveState();renderLock();}
function unlockPin(){
  const a=state.accounts.find(x=>x.id===state.activeAccountId), pin=$('lockPin').value;
  if(Date.now()<pinLockedUntil){toast('محاولات كثيرة، انتظر قليلًا');return;}
  if(!verifyPinAccount(a,pin)){
    pinFailCount++;
    if(pinFailCount>=5){pinFailCount=0;pinLockedUntil=Date.now()+30000;toast('تم إيقاف المحاولة 30 ثانية');}
    else toast('PIN غير صحيح');
    return;
  }
  pinFailCount=0;pinLockedUntil=0;sessionAccountId=a.id; audit('تسجيل دخول'); view='home'; render(); ensureRatesFresh();
}
function unlockBiometric(){
  if(!state.activeAccountId){toast('اختر الحساب');return;}
  window.onLoginBiometric=(ok)=>{ if(ok){sessionAccountId=state.activeAccountId;audit('تسجيل دخول','بصمة');view='home';render();ensureRatesFresh();} else toast('استخدم PIN'); };
  try{ if(window.Android?.requestBiometric) Android.requestBiometric('onLoginBiometric'); else toast('البصمة متاحة داخل APK فقط'); }catch(e){toast('استخدم PIN');}
}
function lockNow(){sessionAccountId=null;drawerOpen=false;view='home';render();}

function renderHome(){
  const debt=totalDebt(), alerts=alertClients();
  const rates=hasRates()?`1 USD = ${fmt(state.rates.usdTry,3)} TRY · ${fmt(state.rates.usdSyp,2)} SYP`:'سعر الصرف غير محدث';
  const body=`<section class="hero"><small>إجمالي الدين الحالي</small><div class="big">$${fmt(debt)}</div><div class="sub"><span>${state.clients.length} عميل</span><span>${state.deferred.length} مؤجل</span></div></section>
  <div class="primary-actions"><button class="big-action purchase" onclick="startPurchase()"><strong>＋ تسجيل شراء</strong><span>اختر العميل واكتب المبلغ</span></button><button class="big-action payment" onclick="startPayment()"><strong>💵 تسجيل دفعة</strong><span>الأقدم يُسدد أولًا تلقائيًا</span></button></div>
  <div class="quick-grid"><button class="quick" onclick="nav('clients')"><b>👥</b><span>العملاء</span></button><button class="quick" onclick="nav('calculator')"><b>⌗</b><span>الحاسبة</span></button><button class="quick" onclick="nav('deferred')"><b>⏳</b><span>المؤجل</span></button><button class="quick" onclick="nav('shortages')"><b>📦</b><span>النواقص</span></button></div>
  <button class="rate-strip" onclick="nav('rates')"><span>💱</span><div class="grow"><strong>${rates}</strong><small>${state.rates.updatedAt?'آخر تحديث '+dateTimeFmt(state.rates.updatedAt):'اضغط للتحديث'}</small></div><span>‹</span></button>
  ${alerts.length?`<button class="notice warn" onclick="nav('clients')"><span>⚠️</span><div class="grow"><b>${alerts.length} عميل يحتاج انتباه</b><small>تجاوز حد الدين أو المدة</small></div><span>‹</span></button>`:''}`;
  return shell(state.shop.name,body);
}
function startPurchase(clientId=null){ if(!can('purchase')){toast('لا توجد صلاحية تسجيل شراء');return;} purchaseClientId=clientId;purchaseDraft={amount:'',currency:'TRY',description:''};nav('purchase'); }
function startPayment(clientId=null){ if(!can('payment')){toast('لا توجد صلاحية تسجيل دفعة');return;} paymentClientId=clientId;paymentDraft={amount:'',currency:'USD',description:'دفعة'};nav('payment'); }

function clientCard(c,action='open'){
  const f=clientFlags(c), warn=f.overLimit||f.overdue;
  return `<div class="client-item" onclick="${action==='purchase'?`choosePurchaseClient('${c.id}')`:action==='payment'?`choosePaymentClient('${c.id}')`:`openClient('${c.id}')`}"><div class="avatar">${esc(initials(c.name))}</div><div class="grow"><div class="name">${esc(c.name)} ${c.pinned?'⭐':''}</div><div class="small muted">${c.phone?esc(c.phone):c.area==='outside'?'خارج القرية':'ضمن القرية'} ${warn?'· ⚠️':''}</div></div><div class="debt ${warn?'danger-text':''}">$${fmt(f.debt)}</div><span>‹</span></div>`;
}
function renderClients(){
  const q=clientSearch.trim().toLowerCase();
  const list=[...state.clients].sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||a.name.localeCompare(b.name,'ar')).filter(c=>!q||c.name.toLowerCase().includes(q)||(c.phone||'').includes(q));
  const body=`<div class="row"><div class="grow"><div class="section-title" style="margin-top:4px">العملاء</div></div><button class="btn primary" onclick="openAddClient()">＋ عميل</button></div>
  <div class="searchbox"><input class="input" placeholder="ابحث بالاسم أو الهاتف" value="${esc(clientSearch)}" oninput="clientSearch=this.value;render()"></div>
  <div class="card" style="padding:4px 12px">${list.length?list.map(c=>clientCard(c)).join(''):`<div class="empty"><div class="emoji">👥</div><b>لا يوجد عملاء</b>أضف أول عميل للبدء</div>`}</div>`;
  return shell('العملاء',body);
}
function openAddClient(){
  if(!can('clients')){toast('لا توجد صلاحية إضافة عميل');return;}
  openModal(`<h3>إضافة عميل</h3><div class="tabs"><button id="areaIn" class="tab active" onclick="setClientArea('inside')">ضمن القرية</button><button id="areaOut" class="tab" onclick="setClientArea('outside')">من الخارج</button></div>
  <input type="hidden" id="newClientArea" value="inside"><div class="form-group"><label class="label">الاسم *</label><input id="newClientName" class="input"></div><div class="form-group"><label class="label">رقم الهاتف <span id="phoneReq" class="muted">اختياري</span></label><input id="newClientPhone" class="input" inputmode="tel"></div><div class="form-group"><label class="label">عنوان البيت</label><input id="newClientAddress" class="input"></div>
  <div class="amount-row"><div class="form-group"><label class="label">حد الدين بالدولار</label><input id="newClientLimit" class="input" inputmode="decimal" value="100"></div><div class="form-group"><label class="label">مدة التنبيه</label><select id="newClientDays" class="select"><option value="15">15 يوم</option><option value="30" selected>30 يوم</option><option value="60">60 يوم</option></select></div></div>
  <div class="modal-actions"><button class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary" onclick="saveNewClient()">حفظ</button></div>`);
}
function setClientArea(area){$('newClientArea').value=area;$('areaIn').classList.toggle('active',area==='inside');$('areaOut').classList.toggle('active',area==='outside');$('phoneReq').textContent=area==='outside'?'مطلوب':'اختياري';}
function saveNewClient(){
  const area=$('newClientArea').value,name=$('newClientName').value.trim(),phone=$('newClientPhone').value.trim();
  if(!name){toast('الاسم مطلوب');return;} if(area==='outside'&&!phone){toast('رقم الهاتف مطلوب للعميل من الخارج');return;}
  if(state.clients.some(c=>c.name.trim().toLowerCase()===name.toLowerCase() || (phone&&c.phone===phone))){toast('يوجد عميل بنفس الاسم أو الهاتف');return;}
  const c={id:uid('CLI'),name,phone,address:$('newClientAddress').value.trim(),area,debtLimit:num($('newClientLimit').value),maxDays:num($('newClientDays').value)||30,notes:'',pinned:false,createdAt:nowIso(),createdBy:currentAccount().name};
  state.clients.push(c);saveState();audit('إضافة عميل',name);closeModal();render();toast('تمت إضافة العميل ✓');
}
function openClient(id){selectedClientId=id;clientLedgerQuery='';view='client';render();}

function entryDescription(e){ if(e.type==='payment')return e.description||'دفعة';if(e.type==='opening')return e.description||'رصيد افتتاحي';return e.description||'شراء'; }
function ledgerRows(clientId){ return state.entries.filter(e=>e.clientId===clientId).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)); }
function renderClient(){
  const c=state.clients.find(x=>x.id===selectedClientId); if(!c){view='clients';return renderClients();}
  const f=clientFlags(c), q=clientLedgerQuery.toLowerCase(); let rows=ledgerRows(c.id); if(q)rows=rows.filter(e=>entryDescription(e).toLowerCase().includes(q)||e.originalCurrency.toLowerCase().includes(q)||String(e.originalAmount).includes(q)||dateFmt(e.date).includes(q));
  const table=rows.length?`<table class="ledger"><thead><tr><th>التاريخ</th><th>البيان</th><th>المبلغ الأصلي</th><th>USD</th><th>TRY</th><th>SYP</th><th>مدفوع</th><th>متبقي</th><th>USD/TRY</th><th>USD/SYP</th><th>المسجل</th></tr></thead><tbody>${rows.map(e=>{
    const cls=e.type==='payment'?'payment-row':e.type==='opening'?'opening-row':num(e.remainingUsd)<=.005?'settled':'';
    return `<tr class="${cls}"><td>${dateFmt(e.date||e.createdAt)}</td><td>${esc(entryDescription(e))}</td><td class="original">${e.type==='payment'?'- ':''}${esc(originalText(e))}</td><td>${fmt(e.usdAmount)}</td><td>${fmt(e.tryAmount)}</td><td>${fmt(e.sypAmount)}</td><td>${e.type==='payment'?fmt(e.usdAmount):fmt(e.paidUsd)}</td><td>${e.type==='payment'?'—':fmt(e.remainingUsd)}</td><td>${fmt(e.rateUsdTry,3)}</td><td>${fmt(e.rateUsdSyp,2)}</td><td>${esc(e.createdBy)}</td></tr>`;
  }).join('')}</tbody></table>`:`<div class="empty"><div class="emoji">📒</div><b>لا توجد سطور</b>${q?'لا توجد نتيجة للبحث':'ابدأ بتسجيل أول شراء'}</div>`;
  const body=`<div class="card"><div class="row"><div class="avatar">${esc(initials(c.name))}</div><div class="grow"><h2 style="margin:0;font-size:20px">${esc(c.name)}</h2><div class="small muted">${c.phone?esc(c.phone):'بدون رقم هاتف'} · ${c.area==='outside'?'من الخارج':'ضمن القرية'}</div></div><button class="icon-btn" onclick="editClient('${c.id}')">✎</button></div><div class="row" style="margin-top:13px"><div class="grow"><div class="muted small">الدين الحالي</div><div style="font-size:29px;font-weight:900;direction:ltr;text-align:right" class="${f.overLimit?'danger-text':''}">$${fmt(f.debt)}</div></div>${f.overLimit?`<span class="badge red">فوق الحد</span>`:f.overdue?`<span class="badge amber">متأخر</span>`:`<span class="badge green">طبيعي</span>`}</div></div>
  <div class="row"><button class="btn primary grow" onclick="startPurchase('${c.id}')">＋ شراء</button><button class="btn green grow" onclick="startPayment('${c.id}')">💵 دفعة</button><button class="btn" onclick="exportClient('${c.id}','pdf')">PDF</button><button class="btn" onclick="exportClient('${c.id}','csv')">CSV</button></div>
  <div class="form-group"><input class="input" placeholder="بحث داخل الدفتر" value="${esc(clientLedgerQuery)}" oninput="clientLedgerQuery=this.value;render()"></div>
  <div class="table-wrap">${table}</div>
  <div class="ledger-summary"><div class="summary-box"><strong>$${fmt(f.debt)}</strong><small>المتبقي</small></div><div class="summary-box"><strong>$${fmt(clientPaid(c.id))}</strong><small>إجمالي الدفعات</small></div><div class="summary-box"><strong>${ledgerRows(c.id).length}</strong><small>عدد السطور</small></div></div>`;
  return shell('دفتر العميل',body);
}
function editClient(id){
  const c=state.clients.find(x=>x.id===id);if(!c)return;
  openModal(`<h3>تعديل العميل</h3><div class="form-group"><label class="label">الاسم</label><input id="editName" class="input" value="${esc(c.name)}"></div><div class="form-group"><label class="label">الهاتف</label><input id="editPhone" class="input" value="${esc(c.phone||'')}"></div><div class="form-group"><label class="label">العنوان</label><input id="editAddress" class="input" value="${esc(c.address||'')}"></div><div class="amount-row"><div class="form-group"><label class="label">حد الدين $</label><input id="editLimit" class="input" value="${esc(c.debtLimit)}"></div><div class="form-group"><label class="label">المدة بالأيام</label><input id="editDays" class="input" value="${esc(c.maxDays)}"></div></div><label class="row card"><input id="editPinned" type="checkbox" ${c.pinned?'checked':''}> <span>تثبيت العميل ⭐</span></label><div class="modal-actions"><button class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary" onclick="saveClientEdit('${c.id}')">حفظ</button></div>`);
}
function saveClientEdit(id){const c=state.clients.find(x=>x.id===id);if(!c)return;const name=$('editName').value.trim();if(!name){toast('الاسم مطلوب');return;}c.name=name;c.phone=$('editPhone').value.trim();c.address=$('editAddress').value.trim();c.debtLimit=num($('editLimit').value);c.maxDays=num($('editDays').value)||30;c.pinned=$('editPinned').checked;saveState();audit('تعديل عميل',name);closeModal();render();toast('تم الحفظ');}

function chooseClientList(action,query=''){
  const q=query.toLowerCase();return state.clients.filter(c=>!q||c.name.toLowerCase().includes(q)||(c.phone||'').includes(q)).slice(0,60).map(c=>clientCard(c,action)).join('');
}
function renderPurchase(){
  let body='';
  if(!purchaseClientId){body=`<div class="section-title">اختر العميل</div><input id="purchaseSearch" class="input" placeholder="ابحث بالاسم أو الهاتف" oninput="$('purchaseList').innerHTML=chooseClientList('purchase',this.value)"><div class="card" id="purchaseList" style="padding:4px 12px">${chooseClientList('purchase')}</div>`;}
  else{
    const c=state.clients.find(x=>x.id===purchaseClientId); if(!c){purchaseClientId=null;return renderPurchase();}
    body=`<div class="card row"><div class="avatar">${esc(initials(c.name))}</div><div class="grow"><b>${esc(c.name)}</b><div class="small muted">الدين الحالي $${fmt(clientDebt(c.id))}</div></div><button class="btn ghost" onclick="purchaseClientId=null;render()">تغيير</button></div>
    ${!hasRates()?`<div class="notice warn"><span>⚠️</span><div class="grow"><b>سعر الصرف غير جاهز</b><small>حدّث السعر قبل التسجيل حتى تُحفظ القيم الثلاث</small></div><button class="btn" onclick="nav('rates')">تحديث</button></div>`:''}
    <div class="amount-row"><div class="form-group"><label class="label">المبلغ *</label><input id="purchaseAmount" class="input amount-input" inputmode="decimal" value="${esc(purchaseDraft.amount)}" oninput="purchaseDraft.amount=this.value;updatePurchasePreview()"></div><div class="form-group"><label class="label">العملة</label><select id="purchaseCurrency" class="select" onchange="purchaseDraft.currency=this.value;updatePurchasePreview()"><option value="TRY" ${purchaseDraft.currency==='TRY'?'selected':''}>🇹🇷 TRY</option><option value="USD" ${purchaseDraft.currency==='USD'?'selected':''}>🇺🇸 USD</option><option value="SYP" ${purchaseDraft.currency==='SYP'?'selected':''}>🇸🇾 SYP</option></select></div></div>
    <div class="form-group"><label class="label">البيان / ماذا اشترى؟</label><input id="purchaseDesc" class="input" value="${esc(purchaseDraft.description)}" oninput="purchaseDraft.description=this.value" placeholder="اختياري"></div>
    <div id="purchasePreview" class="card small muted">اكتب المبلغ لرؤية التحويل</div>
    <button class="btn primary full" ${hasRates()?'':'disabled'} onclick="submitPurchase()">تسجيل على ${esc(c.name)}</button>`;
  }
  setTimeout(updatePurchasePreview,0); return shell('تسجيل شراء',body);
}
function choosePurchaseClient(id){purchaseClientId=id;render();}
function updatePurchasePreview(){const el=$('purchasePreview');if(!el)return;const c=convert(purchaseDraft.amount,purchaseDraft.currency);el.innerHTML=c?`<div class="row"><span>🇺🇸 $${fmt(c.usd)}</span><span>🇹🇷 ${fmt(c.try)} TRY</span><span>🇸🇾 ${fmt(c.syp)} SYP</span></div><div style="margin-top:5px">سيُحفظ سعر الصرف الحالي داخل السطر ولن يتغير لاحقًا.</div>`:'اكتب المبلغ لرؤية التحويل';}
function submitPurchase(){
  const amount=num(purchaseDraft.amount);if(!purchaseClientId||amount<=0){toast('اكتب مبلغًا صحيحًا');return;}if(!hasRates()){toast('حدّث سعر الصرف أولًا');return;}
  const payload={clientId:purchaseClientId,amount,currency:purchaseDraft.currency,description:purchaseDraft.description||'شراء'};
  const need=state.settings.requireBiometricPurchase; requireSensitive(need,'تسجيل شراء',method=>commitPurchase(payload,method));
}
function commitPurchase(p,authMethod='none'){
  const cv=convert(p.amount,p.currency); if(!cv)return;
  const e={id:uid('PUR'),clientId:p.clientId,type:'purchase',date:today(),createdAt:nowIso(),description:p.description,originalAmount:p.amount,originalCurrency:p.currency,usdAmount:cv.usd,tryAmount:cv.try,sypAmount:cv.syp,rateUsdTry:state.rates.usdTry,rateUsdSyp:state.rates.usdSyp,paidUsd:0,remainingUsd:cv.usd,allocations:[],createdBy:currentAccount().name,authMethod};
  state.entries.push(e);saveState();audit('تسجيل شراء',`${state.clients.find(c=>c.id===p.clientId)?.name} — ${p.amount} ${p.currency}`);logClientWarnings(p.clientId,true);toast(`تم تسجيل ${fmtFlex(p.amount)} ${p.currency} ✓`);purchaseDraft={amount:'',currency:p.currency,description:''};selectedClientId=p.clientId;view='client';render();
}

function renderPayment(){
  let body='';
  if(!paymentClientId){body=`<div class="section-title">اختر العميل</div><input id="paymentSearch" class="input" placeholder="ابحث بالاسم أو الهاتف" oninput="$('paymentList').innerHTML=chooseClientList('payment',this.value)"><div class="card" id="paymentList" style="padding:4px 12px">${chooseClientList('payment')}</div>`;}
  else{
    const c=state.clients.find(x=>x.id===paymentClientId);if(!c){paymentClientId=null;return renderPayment();}const debt=clientDebt(c.id);
    body=`<div class="card row"><div class="avatar">${esc(initials(c.name))}</div><div class="grow"><b>${esc(c.name)}</b><div class="small muted">الدين الحالي $${fmt(debt)}</div></div><button class="btn ghost" onclick="paymentClientId=null;render()">تغيير</button></div>
    ${debt<=.005?`<div class="notice ok"><span>✓</span><div class="grow"><b>لا يوجد دين مفتوح</b><small>حساب العميل مسدد بالكامل</small></div></div>`:''}
    ${!hasRates()?`<div class="notice warn"><span>⚠️</span><div class="grow"><b>سعر الصرف غير جاهز</b><small>حدّث السعر قبل تسجيل الدفعة</small></div><button class="btn" onclick="nav('rates')">تحديث</button></div>`:''}
    <div class="amount-row"><div class="form-group"><label class="label">المبلغ المدفوع *</label><input id="paymentAmount" class="input amount-input" inputmode="decimal" value="${esc(paymentDraft.amount)}" oninput="paymentDraft.amount=this.value;updatePaymentPreview()"></div><div class="form-group"><label class="label">العملة</label><select id="paymentCurrency" class="select" onchange="paymentDraft.currency=this.value;updatePaymentPreview()"><option value="USD" ${paymentDraft.currency==='USD'?'selected':''}>🇺🇸 USD</option><option value="TRY" ${paymentDraft.currency==='TRY'?'selected':''}>🇹🇷 TRY</option><option value="SYP" ${paymentDraft.currency==='SYP'?'selected':''}>🇸🇾 SYP</option></select></div></div>
    <div id="paymentPreview" class="card small muted">سيتم الخصم من أقدم الديون أولًا تلقائيًا.</div>
    <button class="btn green full" ${hasRates()&&debt>.005?'':'disabled'} onclick="submitPayment()">تسجيل الدفعة بالبصمة</button>`;
  }
  setTimeout(updatePaymentPreview,0);return shell('تسجيل دفعة',body);
}
function choosePaymentClient(id){paymentClientId=id;render();}
function fifoPreview(clientId,paymentUsd){
  let left=paymentUsd;const arr=[];const debts=state.entries.filter(e=>e.clientId===clientId&&['purchase','opening'].includes(e.type)&&num(e.remainingUsd)>.005).sort((a,b)=>new Date(a.date||a.createdAt)-new Date(b.date||b.createdAt));
  for(const e of debts){if(left<=.005)break;const take=Math.min(left,num(e.remainingUsd));arr.push({e,take});left-=take;}return {arr,left:round2(left)};
}
function updatePaymentPreview(){
  const el=$('paymentPreview');if(!el||!paymentClientId)return;const cv=convert(paymentDraft.amount,paymentDraft.currency);if(!cv){el.textContent='سيتم الخصم من أقدم الديون أولًا تلقائيًا.';return;}const p=fifoPreview(paymentClientId,cv.usd);let html=`<b>القيمة: $${fmt(cv.usd)}</b><div class="divider"></div>`;html+=p.arr.length?p.arr.slice(0,4).map(x=>`<div class="row"><span class="grow">${dateFmt(x.e.date)} · ${esc(entryDescription(x.e))}</span><b>-$${fmt(x.take)}</b></div>`).join(''):'لا توجد ديون مفتوحة';if(p.left>.005)html+=`<div class="danger-text" style="margin-top:8px">المبلغ أكبر من الدين بـ $${fmt(p.left)}</div>`;el.innerHTML=html;
}
function submitPayment(){
  const amount=num(paymentDraft.amount);if(!paymentClientId||amount<=0){toast('اكتب مبلغًا صحيحًا');return;}if(!hasRates()){toast('حدّث سعر الصرف أولًا');return;}const cv=convert(amount,paymentDraft.currency);const debt=clientDebt(paymentClientId);if(!cv||cv.usd>debt+.01){toast('الدفعة أكبر من الدين الحالي');return;}
  const payload={clientId:paymentClientId,amount,currency:paymentDraft.currency,description:'دفعة'};requireSensitive(state.settings.requireBiometricPayment,'تسجيل دفعة',method=>commitPayment(payload,method));
}
function commitPayment(p,authMethod='pin'){
  const cv=convert(p.amount,p.currency), preview=fifoPreview(p.clientId,cv.usd);if(!cv||preview.left>.01){toast('تعذر توزيع الدفعة');return;}
  const paymentId=uid('PAY'), allocations=[];
  for(const x of preview.arr){x.e.paidUsd=round2(num(x.e.paidUsd)+x.take);x.e.remainingUsd=round2(Math.max(0,num(x.e.remainingUsd)-x.take));if(x.e.remainingUsd<=.005){x.e.remainingUsd=0;x.e.settledAt=nowIso();}allocations.push({entryId:x.e.id,usd:round2(x.take)});}
  state.entries.push({id:paymentId,clientId:p.clientId,type:'payment',date:today(),createdAt:nowIso(),description:'دفعة',originalAmount:p.amount,originalCurrency:p.currency,usdAmount:cv.usd,tryAmount:cv.try,sypAmount:cv.syp,rateUsdTry:state.rates.usdTry,rateUsdSyp:state.rates.usdSyp,paidUsd:cv.usd,remainingUsd:0,allocations,createdBy:currentAccount().name,authMethod});
  saveState();audit('تسجيل دفعة',`${state.clients.find(c=>c.id===p.clientId)?.name} — ${p.amount} ${p.currency}`);toast(`تم تسجيل الدفعة ${fmtFlex(p.amount)} ${p.currency} ✓`);paymentDraft={amount:'',currency:p.currency,description:'دفعة'};selectedClientId=p.clientId;view='client';render();
}

function requireSensitive(required,title,callback){
  if(!required){callback('none');return;}pendingSensitive={callback,title};
  window.onSensitiveBiometric=(ok,reason)=>{if(ok){const p=pendingSensitive;pendingSensitive=null;p?.callback('biometric');}else showPinConfirm();};
  try{if(window.Android?.requestBiometric)Android.requestBiometric('onSensitiveBiometric');else showPinConfirm();}catch(e){showPinConfirm();}
}
function showPinConfirm(){
  openModal(`<h3>🔐 ${esc(pendingSensitive?.title||'تأكيد')}</h3><p class="muted small">استخدم PIN للحساب الحالي إذا لم تستخدم البصمة.</p><div class="form-group"><input id="confirmPin" class="input" type="password" inputmode="numeric" placeholder="PIN" maxlength="8"></div><div class="modal-actions"><button class="btn ghost" onclick="pendingSensitive=null;closeModal()">إلغاء</button><button class="btn primary" onclick="confirmPinSensitive()">تأكيد</button></div>`);
}
function confirmPinSensitive(){const a=currentAccount();if(!verifyPinAccount(a,$('confirmPin').value)){toast('PIN غير صحيح');return;}const p=pendingSensitive;pendingSensitive=null;closeModal();p?.callback('pin');}

function renderCalculator(){
  const result=calcValue(), cv=hasRates()&&result>0?convert(result,calcCurrency):null;
  return `<div class="calc-screen"><div class="calc-top"><button class="icon-btn back" onclick="nav('home')">→</button><div class="grow"><b>الحاسبة</b><div class="small muted">عملة الحساب والتسجيل</div></div></div>
  <div class="currency-tabs"><button class="${calcCurrency==='SYP'?'active':''}" onclick="setCalcCurrency('SYP')">🇸🇾 SYP</button><button class="${calcCurrency==='TRY'?'active':''}" onclick="setCalcCurrency('TRY')">🇹🇷 TRY</button><button class="${calcCurrency==='USD'?'active':''}" onclick="setCalcCurrency('USD')">🇺🇸 USD</button></div>
  <div id="calcExpression" class="calc-expression">${esc(calcExpr||'0')}</div>
  <div class="calc-result"><span>الناتج</span><strong>${fmtFlex(result)} ${calcCurrency}</strong></div>
  <div class="calc-conversions"><div class="calc-conv"><small>🇺🇸 USD</small><b>${cv?'$'+fmt(cv.usd):'—'}</b></div><div class="calc-conv"><small>🇹🇷 TRY</small><b>${cv?fmt(cv.try):'—'}</b></div><div class="calc-conv"><small>🇸🇾 SYP</small><b>${cv?fmt(cv.syp):'—'}</b></div></div>
  <div class="keypad"><div class="ops"><button class="key clear" onclick="calcClear()">C</button><button class="key op" onclick="calcKey('/')">÷</button><button class="key op" onclick="calcKey('*')">×</button><button class="key op" onclick="calcKey('-')">−</button><button class="key eq" onclick="calcEquals()">=</button></div><div class="nums"><button class="key" onclick="calcKey('7')">7</button><button class="key" onclick="calcKey('8')">8</button><button class="key" onclick="calcKey('9')">9</button><button class="key" onclick="calcKey('4')">4</button><button class="key" onclick="calcKey('5')">5</button><button class="key" onclick="calcKey('6')">6</button><button class="key" onclick="calcKey('1')">1</button><button class="key" onclick="calcKey('2')">2</button><button class="key" onclick="calcKey('3')">3</button><button class="key" onclick="calcKey('.')">.</button><button class="key" onclick="calcKey('0')">0</button><button class="key op" onclick="calcKey('+')">＋</button></div></div>
  <div class="calc-hint">${esc(calcLastRegistered||(!hasRates()?'حدّث سعر الصرف حتى تظهر التحويلات':''))}</div>
  <button class="calc-register" ${result>0&&hasRates()?'':'disabled'} onclick="calcPickClient()">تسجيل ${fmtFlex(result)} ${calcCurrency} على عميل</button></div>`;
}
function setCalcCurrency(c){calcCurrency=c;render();}
function calcKey(k){
  const last=calcExpr.slice(-1);if('+-*/'.includes(k)&&'+-*/'.includes(last)){calcExpr=calcExpr.slice(0,-1)+k;}else if(calcExpr.length<80)calcExpr+=k;render();setTimeout(()=>{$('calcExpression')?.scrollTo({left:9999})},0);
}
function calcClear(){calcExpr='';render();}
function calcValue(){try{if(!calcExpr||!/^[0-9+\-*/. ()]+$/.test(calcExpr))return 0;const v=Function('"use strict";return ('+calcExpr+')')();return isFinite(v)?round2(v):0;}catch(e){return 0;}}
function calcEquals(){const v=calcValue();if(v||v===0)calcExpr=String(v);render();}
function calcPickClient(){
  const v=calcValue();if(v<=0||!hasRates())return;
  openModal(`<h3>تسجيل من الحاسبة</h3><div class="form-group"><input id="calcClientSearch" class="input" placeholder="ابحث عن العميل" oninput="renderCalcClientList(this.value)"></div><div id="calcClientList">${calcClientList('')}</div><button class="btn ghost full" onclick="closeModal()">إغلاق</button>`);
}
function calcClientList(q){const s=q.toLowerCase();return `<div class="card" style="padding:4px 12px">${state.clients.filter(c=>!s||c.name.toLowerCase().includes(s)||(c.phone||'').includes(s)).slice(0,40).map(c=>`<div class="client-item"><div class="avatar">${esc(initials(c.name))}</div><div class="grow"><b>${esc(c.name)}</b><div class="small muted">$${fmt(clientDebt(c.id))}</div></div><button class="btn primary" onclick="registerCalcClient('${c.id}')">سجل ${fmtFlex(calcValue())}</button></div>`).join('')||'<div class="empty">لا توجد نتائج</div>'}</div>`;}
function renderCalcClientList(q){$('calcClientList').innerHTML=calcClientList(q);}
function registerCalcClient(id){const v=calcValue();if(v<=0)return;const c=state.clients.find(x=>x.id===id);closeModal();const payload={clientId:id,amount:v,currency:calcCurrency,description:'شراء'};requireSensitive(state.settings.requireBiometricPurchase,'تسجيل شراء',method=>{commitPurchaseSilent(payload,method);calcLastRegistered=`✓ تم التسجيل على ${c?.name||''}: ${fmtFlex(v)} ${calcCurrency}`;view='calculator';render();});}
function commitPurchaseSilent(p,authMethod='none'){const cv=convert(p.amount,p.currency);if(!cv)return;state.entries.push({id:uid('PUR'),clientId:p.clientId,type:'purchase',date:today(),createdAt:nowIso(),description:p.description,originalAmount:p.amount,originalCurrency:p.currency,usdAmount:cv.usd,tryAmount:cv.try,sypAmount:cv.syp,rateUsdTry:state.rates.usdTry,rateUsdSyp:state.rates.usdSyp,paidUsd:0,remainingUsd:cv.usd,allocations:[],createdBy:currentAccount().name,authMethod});saveState();audit('تسجيل شراء من الحاسبة',`${state.clients.find(c=>c.id===p.clientId)?.name} — ${p.amount} ${p.currency}`);logClientWarnings(p.clientId,true);toast('تم التسجيل بنجاح ✓');}

function renderDeferred(){
  const body=`<div class="section-title">المؤجل</div><p class="muted small">للوقت المزدحم: احفظ العملية بسرعة ثم اعتمدها لاحقًا. لا تدخل في الحسابات قبل الاعتماد.</p>
  <button class="btn primary full" onclick="openDeferredAdd()">＋ إضافة مؤجل</button>
  ${state.deferred.length?state.deferred.map(d=>`<div class="card"><div class="row"><span>${d.type==='payment'?'💵':d.type==='purchase'?'＋':'📝'}</span><div class="grow"><b>${esc(d.clientName||'بدون عميل')}</b><div class="small muted">${esc(d.note||'')} ${d.amount?`· ${fmtFlex(d.amount)} ${d.currency}`:''}</div><div class="small muted">${dateTimeFmt(d.createdAt)} · ${esc(d.createdBy)}</div></div>${d.type!=='note'?`<button class="btn primary" onclick="adoptDeferred('${d.id}')">اعتماد</button>`:''}<button class="icon-btn" onclick="removeDeferred('${d.id}')">×</button></div></div>`).join(''):`<div class="empty"><div class="emoji">⏳</div><b>لا يوجد مؤجل</b>كل شيء مسجل</div>`}`;
  return shell('المؤجل',body);
}
function openDeferredAdd(){openModal(`<h3>إضافة مؤجل</h3><div class="form-group"><label class="label">النوع</label><select id="defType" class="select"><option value="purchase">شراء</option><option value="payment">دفعة</option><option value="note">ملاحظة</option></select></div><div class="form-group"><label class="label">العميل (اختياري)</label><select id="defClient" class="select"><option value="">بدون عميل</option>${state.clients.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div><div class="amount-row"><div class="form-group"><label class="label">المبلغ</label><input id="defAmount" class="input" inputmode="decimal"></div><div class="form-group"><label class="label">العملة</label><select id="defCurrency" class="select"><option>TRY</option><option>USD</option><option>SYP</option></select></div></div><div class="form-group"><label class="label">ملاحظة</label><input id="defNote" class="input"></div><div class="modal-actions"><button class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary" onclick="saveDeferred()">حفظ</button></div>`);}
function saveDeferred(){const type=$('defType').value,cid=$('defClient').value,c=state.clients.find(x=>x.id===cid);state.deferred.unshift({id:uid('DEF'),type,clientId:cid||null,clientName:c?.name||'',amount:num($('defAmount').value),currency:$('defCurrency').value,note:$('defNote').value.trim(),createdAt:nowIso(),createdBy:currentAccount().name});saveState();audit('إضافة مؤجل',type);closeModal();render();toast('تم الحفظ في المؤجل');}
function adoptDeferred(id){const d=state.deferred.find(x=>x.id===id);if(!d)return;if(!d.clientId){toast('حدد العميل أولًا');return;}state.deferred=state.deferred.filter(x=>x.id!==id);saveState();if(d.type==='purchase'){purchaseClientId=d.clientId;purchaseDraft={amount:String(d.amount||''),currency:d.currency,description:d.note||''};view='purchase';}else{paymentClientId=d.clientId;paymentDraft={amount:String(d.amount||''),currency:d.currency,description:'دفعة'};view='payment';}render();}
function removeDeferred(id){state.deferred=state.deferred.filter(x=>x.id!==id);saveState();render();}

function renderShortages(){
  const listHtml = state.shortages.length
    ? state.shortages.map(s => {
        const qtyText = s.qty ? `الكمية: ${esc(s.qty)} · ` : '';
        const statusText = s.status==='needed' ? 'ناقص' : s.status==='ordered' ? 'تم الطلب' : 'تم الشراء';
        return `<div class="card row"><div class="grow"><b>${esc(s.name)}</b><div class="small muted">${qtyText}${statusText} · ${esc(s.createdBy)}</div></div><select class="select" style="width:110px;min-height:42px" onchange="updateShortage('${s.id}',this.value)"><option value="needed" ${s.status==='needed'?'selected':''}>ناقص</option><option value="ordered" ${s.status==='ordered'?'selected':''}>تم الطلب</option><option value="bought" ${s.status==='bought'?'selected':''}>تم الشراء</option></select></div>`;
      }).join('')
    : `<div class="empty"><div class="emoji">📦</div><b>لا يوجد نواقص</b></div>`;
  const activeCount=state.shortages.filter(s=>s.status!=='bought').length;
  const body = `<div class="row"><div class="grow"><div class="section-title">نواقص المحل</div><div class="small muted">${activeCount} صنف بحاجة للمتابعة</div></div><button class="btn" onclick="openShortagesPdfExport()">PDF</button><button class="btn primary" onclick="openShortageAdd()">＋ إضافة</button></div>${listHtml}`;
  return shell('نواقص المحل',body);
}
function openShortageAdd(){openModal(`<h3>إضافة نقص</h3><div class="form-group"><label class="label">اسم البضاعة *</label><input id="shortName" class="input"></div><div class="form-group"><label class="label">الكمية / ملاحظة</label><input id="shortQty" class="input"></div><div class="modal-actions"><button class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary" onclick="saveShortage()">حفظ</button></div>`);}
function saveShortage(){const name=$('shortName').value.trim();if(!name){toast('اكتب اسم البضاعة');return;}state.shortages.unshift({id:uid('SH'),name,qty:$('shortQty').value.trim(),status:'needed',createdAt:nowIso(),createdBy:currentAccount().name});saveState();closeModal();render();toast('تمت الإضافة');}
function updateShortage(id,status){const s=state.shortages.find(x=>x.id===id);if(s){s.status=status;saveState();render();}}

function openShortagesPdfExport(){
  if(!state.shortages.length){toast('لا توجد نواقص لتصديرها');return;}
  const active=state.shortages.filter(s=>s.status!=='bought').length;
  const bought=state.shortages.filter(s=>s.status==='bought').length;
  openModal(`<h3>تصدير نواقص المحل PDF</h3><div class="card" style="margin-bottom:12px"><div class="row"><div class="grow"><b>القائمة الحالية</b><div class="small muted">الناقص + تم الطلب</div></div><span class="badge amber">${active}</span></div><div class="row" style="margin-top:8px"><div class="grow"><b>تم شراؤه</b><div class="small muted">يمكن تضمينه للأرشفة</div></div><span class="badge green">${bought}</span></div></div><button class="btn primary full" onclick="exportShortagesPdf(false)">تصدير النواقص الحالية</button><button class="btn full" style="margin-top:8px" onclick="exportShortagesPdf(true)">تصدير القائمة كاملة</button><button class="btn ghost full" style="margin-top:8px" onclick="closeModal()">إلغاء</button>`);
}
function exportShortagesPdf(includeBought){
  const all=Array.isArray(state.shortages)?state.shortages:[];
  const selected=all.filter(s=>includeBought||s.status!=='bought');
  if(!selected.length){toast('لا توجد نواقص حالية لتصديرها');return;}
  const statusLabel=s=>s==='ordered'?'تم الطلب':s==='bought'?'تم الشراء':'ناقص';
  const rows=selected.map((s,i)=>({index:i+1,name:s.name||'',qty:s.qty||'—',status:s.status||'needed',statusLabel:statusLabel(s.status),createdBy:s.createdBy||'—',date:dateFmt(s.createdAt||today())}));
  const summary={total:selected.length,needed:selected.filter(s=>s.status==='needed').length,ordered:selected.filter(s=>s.status==='ordered').length,bought:selected.filter(s=>s.status==='bought').length,includeBought:!!includeBought};
  const payload={shop:state.shop,generatedAt:nowIso(),summary,rows};
  const safeShop=(state.shop.name||'المحل').replace(/[\\/:*?"<>|]/g,'-');
  const fileName=`نواقص-${safeShop}-${today()}.pdf`;
  closeModal();
  try{if(window.Android?.exportShortagesPdf)Android.exportShortagesPdf(JSON.stringify(payload),fileName);else toast('تصدير PDF متاح داخل التطبيق');}
  catch(e){toast('تعذر إنشاء PDF النواقص');}
}

function rateMessage(){const r=state.rates;return state.settings.rateTemplate.replaceAll('{SHOP}',state.shop.name).replaceAll('{USD_TRY}',fmt(r.usdTry,3)).replaceAll('{USD_SYP}',fmt(r.usdSyp,2)).replaceAll('{TRY_SYP}',fmt(r.trySyp,2)).replaceAll('{TIME}',r.updatedAt?dateTimeFmt(r.updatedAt):'غير محدث');}
function renderRates(){
  const r=state.rates;const body=`<div class="row"><div class="grow"><div class="section-title">سعر الصرف</div><div class="small muted">المصدر: ${esc(r.source)} · ${r.updatedAt?dateTimeFmt(r.updatedAt):'غير محدث'}</div></div><button class="btn blue" onclick="ensureRatesFresh(true)">↻ تحديث</button></div>
  <div class="card"><div class="client-item"><div class="grow"><b>🇺🇸 USD / 🇹🇷 TRY</b></div><strong>${r.usdTry?fmt(r.usdTry,3):'—'}</strong></div><div class="client-item"><div class="grow"><b>🇺🇸 USD / 🇸🇾 SYP</b></div><strong>${r.usdSyp?fmt(r.usdSyp,2):'—'}</strong></div><div class="client-item"><div class="grow"><b>🇹🇷 TRY / 🇸🇾 SYP</b></div><strong>${r.trySyp?fmt(r.trySyp,2):'—'}</strong></div></div>
  <div class="row"><button class="btn grow" onclick="copyText(rateMessage())">📋 نسخ النشرة</button><button class="btn grow" onclick="shareText('سعر الصرف',rateMessage())">↗ مشاركة</button></div>
  ${isOwner()?`<div class="section-title">تعديل يدوي عند الحاجة</div><div class="card"><div class="form-group"><label class="label">1 USD = كم TRY</label><input id="manualTry" class="input" inputmode="decimal" value="${r.usdTry||''}"></div><div class="form-group"><label class="label">1 USD = كم SYP</label><input id="manualSyp" class="input" inputmode="decimal" value="${r.usdSyp||''}"></div><button class="btn primary full" onclick="saveManualRates()">حفظ السعر اليدوي</button></div>`:''}`;
  return shell('سعر الصرف',body);
}
function saveManualRates(){const ut=num($('manualTry').value),us=num($('manualSyp').value);if(ut<=0||us<=0){toast('اكتب سعرين صحيحين');return;}state.rates={usdTry:ut,usdSyp:us,trySyp:us/ut,updatedAt:nowIso(),source:'إدخال يدوي',manual:true};saveState();audit('تعديل سعر الصرف','يدوي');render();toast('تم حفظ السعر');}

function renderPaymentLog(){
  const now=Date.now();const pays=state.entries.filter(e=>e.type==='payment').sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));const list=pays.filter(e=>paymentLogTab==='recent'?(now-new Date(e.createdAt).getTime())<=30*86400000:(now-new Date(e.createdAt).getTime())>30*86400000);
  const body=`<div class="tabs"><button class="tab ${paymentLogTab==='recent'?'active':''}" onclick="paymentLogTab='recent';render()">آخر 30 يوم</button><button class="tab ${paymentLogTab==='archive'?'active':''}" onclick="paymentLogTab='archive';render()">الأرشيف</button></div><p class="small muted">لا يتم حذف أي سجل. بعد 30 يوم ينتقل من العرض الحديث إلى الأرشيف.</p>${list.length?list.map(e=>{const c=state.clients.find(x=>x.id===e.clientId);return `<div class="card"><div class="row"><div class="grow"><b>${esc(c?.name||'عميل')}</b><div class="small muted">${dateTimeFmt(e.createdAt)} · بواسطة ${esc(e.createdBy)}</div></div><strong class="success-text">${fmtFlex(e.originalAmount)} ${e.originalCurrency}</strong></div><div class="divider"></div><div class="small muted">توزعت على ${e.allocations?.length||0} من أقدم السجلات · القيمة $${fmt(e.usdAmount)}</div></div>`}).join(''):`<div class="empty"><div class="emoji">🧾</div><b>لا توجد دفعات هنا</b></div>`}`;
  return shell('سجل الدفع',body);
}

function renderPartners(){
  const body=`<div class="row"><div class="grow"><div class="section-title">الشركاء والحسابات</div></div>${isOwner()?`<button class="btn primary" onclick="openPartnerAdd()">＋ شريك</button>`:''}</div>${state.accounts.map(a=>`<div class="card row"><div class="avatar">${esc(initials(a.name))}</div><div class="grow"><b>${esc(a.name)}</b><div class="small muted">${a.role==='owner'?'صاحب المحل':'شريك'} ${a.id===sessionAccountId?'· الحساب الحالي':''}</div></div>${a.id===sessionAccountId?'<span class="badge green">نشط</span>':''}</div>`).join('')}`;
  return shell('الشركاء',body);
}
function openPartnerAdd(){openModal(`<h3>إضافة شريك</h3><div class="form-group"><label class="label">الاسم *</label><input id="partnerName" class="input"></div><div class="form-group"><label class="label">PIN مؤقت *</label><input id="partnerPin" class="input" inputmode="numeric" type="password" maxlength="8"></div><div class="card"><label class="row"><input id="permPurchase" type="checkbox" checked> تسجيل شراء</label><div class="divider"></div><label class="row"><input id="permPayment" type="checkbox" checked> تسجيل دفعة</label><div class="divider"></div><label class="row"><input id="permClients" type="checkbox" checked> إضافة عملاء</label></div><div class="modal-actions"><button class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary" onclick="savePartner()">حفظ</button></div>`);}
function savePartner(){const name=$('partnerName').value.trim(),pin=$('partnerPin').value.trim();if(!name||pin.length<4){toast('الاسم وPIN مطلوبان');return;}state.accounts.push({id:uid('ACC'),name,role:'partner',pinHash:pinHash(pin),permissions:{purchase:$('permPurchase').checked,payment:$('permPayment').checked,clients:$('permClients').checked}});saveState();audit('إضافة شريك',name);closeModal();render();toast('تمت إضافة الشريك');}

function renderStats(){
  if(!isOwner())return shell('الإحصائيات','<div class="empty">للمالك فقط</div>');
  const month=today().slice(0,7);const monthPays=state.entries.filter(e=>e.type==='payment'&&String(e.date).startsWith(month)).reduce((s,e)=>s+num(e.usdAmount),0);const monthPurch=state.entries.filter(e=>e.type==='purchase'&&String(e.date).startsWith(month)).reduce((s,e)=>s+num(e.usdAmount),0);const newClients=state.clients.filter(c=>String(c.createdAt).startsWith(month)).length;
  const body=`<div class="hero"><small>إجمالي الدين الموجود</small><div class="big">$${fmt(totalDebt())}</div></div><div class="ledger-summary"><div class="summary-box"><strong>$${fmt(monthPays)}</strong><small>دُفع هذا الشهر</small></div><div class="summary-box"><strong>$${fmt(monthPurch)}</strong><small>ديون جديدة</small></div><div class="summary-box"><strong>${newClients}</strong><small>عملاء جدد</small></div></div><div class="section-title">أعلى العملاء دينًا</div>${[...state.clients].sort((a,b)=>clientDebt(b.id)-clientDebt(a.id)).slice(0,8).map(c=>`<div class="card row"><div class="grow"><b>${esc(c.name)}</b></div><strong>$${fmt(clientDebt(c.id))}</strong></div>`).join('')}`;
  return shell('الإحصائيات',body);
}

function renderSettings(){
  if(!isOwner())return shell('الإعدادات','<div class="empty">للمالك فقط</div>');
  const s=state.settings;const body=`<div class="section-title">الأمان</div><div class="card"><label class="row"><input type="checkbox" ${s.requireBiometricPayment?'checked':''} onchange="state.settings.requireBiometricPayment=this.checked;saveState()"><div class="grow"><b>بصمة عند تسجيل دفعة</b><div class="small muted">الافتراضي: مفعّل</div></div></label><div class="divider"></div><label class="row"><input type="checkbox" ${s.requireBiometricPurchase?'checked':''} onchange="state.settings.requireBiometricPurchase=this.checked;saveState()"><div class="grow"><b>بصمة عند تسجيل شراء</b><div class="small muted">اختياري لتسريع البيع</div></div></label></div>
  <div class="section-title">بيانات المحل</div><div class="card"><div class="form-group"><label class="label">اسم المحل</label><input id="setShop" class="input" value="${esc(state.shop.name)}"></div><div class="form-group"><label class="label">الهاتف</label><input id="setPhone" class="input" value="${esc(state.shop.phone)}"></div><div class="form-group"><label class="label">القرية</label><input id="setVillage" class="input" value="${esc(state.shop.village)}"></div><div class="form-group"><label class="label">نص أسفل PDF</label><input id="setFooter" class="input" value="${esc(state.shop.pdfFooter)}"></div><button class="btn primary full" onclick="saveShopSettings()">حفظ بيانات المحل</button></div>
  <div class="section-title">رسالة سعر الصرف</div><div class="card"><textarea id="setRateTemplate" class="textarea">${esc(s.rateTemplate)}</textarea><div class="small muted">المتغيرات: {SHOP} {USD_TRY} {USD_SYP} {TRY_SYP} {TIME}</div><div class="form-group"><label class="label">تنبيه عند تغير USD/TRY بمقدار</label><input id="setRateAlert" class="input" inputmode="decimal" value="${esc(s.rateAlertTry)}"></div><button class="btn primary full" onclick="saveRateSettings()">حفظ قالب الصرف</button></div>
  <button class="btn ghost full" onclick="lockNow()">🔒 قفل التطبيق الآن</button>`;
  return shell('الإعدادات',body);
}
function saveShopSettings(){state.shop.name=$('setShop').value.trim()||state.shop.name;state.shop.phone=$('setPhone').value.trim();state.shop.village=$('setVillage').value.trim();state.shop.pdfFooter=$('setFooter').value.trim();saveState();audit('تعديل بيانات المحل');render();toast('تم الحفظ');}
function saveRateSettings(){state.settings.rateTemplate=$('setRateTemplate').value;state.settings.rateAlertTry=num($('setRateAlert').value)||.25;saveState();audit('تعديل إعدادات سعر الصرف');toast('تم الحفظ');}

function renderBackup(){
  if(!isOwner())return shell('النسخ الاحتياطي','<div class="empty">للمالك فقط</div>');
  const body=`
  <div class="notice ok"><span>☁️</span><div class="grow"><b>البيانات محفوظة داخل الهاتف</b><small>أنشئ نسخة خارجية بشكل دوري لحماية الدفتر.</small></div></div>
  <div class="section-title">نسخة البيانات الكاملة</div>
  <div class="card">
    <button class="btn primary full" onclick="exportBackup()">⬇ تصدير نسخة احتياطية JSON</button>
    <button class="btn full" style="margin-top:9px" onclick="pickBackup()">⬆ استعادة نسخة احتياطية</button>
    <div class="small muted" style="margin-top:10px">تشمل العملاء، دفتر الحساب، الدفعات، المؤجل، النواقص، الحسابات والإعدادات. <b>الملف حساس؛ احتفظ به في مكان خاص.</b></div>
  </div>
  <div class="section-title">نسخة PDF مختصرة</div>
  <div class="card">
    <div class="row" style="align-items:flex-start"><div style="font-size:28px">📄</div><div class="grow"><b>الدين المتبقي لكل عميل حسب العملة الأصلية</b><div class="small muted">يعرض اسم العميل ورصيد USD ورصيد TRY كما سُجّلا، بدون تحويل بين العملات وبدون تفاصيل العمليات.</div></div></div>
    <button class="btn full" style="margin-top:12px" onclick="exportDebtSummaryPdf()">تصدير PDF مختصر</button>
  </div>
  <div class="small muted">استعادة نسخة JSON تستبدل البيانات الحالية بعد التأكيد. ملف PDF مخصص للحفظ أو الطباعة والمراجعة السريعة فقط.</div>`;
  return shell('النسخ الاحتياطي',body);
}
function exportBackup(){const name=`UCHIHA-backup-${today()}.json`;try{if(window.Android?.exportBackup)Android.exportBackup(JSON.stringify(state),name);else downloadText(JSON.stringify(state,null,2),name,'application/json');}catch(e){toast('تعذر التصدير');}}
function exportDebtSummaryPdf(){
  const clients=state.clients.map(c=>({name:c.name,debt:clientDebt(c.id)})).sort((a,b)=>b.debt-a.debt || String(a.name).localeCompare(String(b.name),'ar'));
  const payload={shop:{name:state.shop.name},generatedAt:nowIso(),clients};
  const fileName=`ملخص-ديون-${today()}.pdf`;
  try{
    if(window.Android?.exportDebtSummaryPdf) Android.exportDebtSummaryPdf(JSON.stringify(payload),fileName);
    else toast('تصدير PDF متاح داخل APK');
  }catch(e){toast('تعذر إنشاء PDF المختصر');}
}
function pickBackup(){try{if(window.Android?.pickBackup)Android.pickBackup();else toast('الاستعادة من ملف متاحة داخل APK');}catch(e){toast('تعذر فتح الملف');}}
window.onNativeBackupPicked=function(text){try{const incoming=JSON.parse(text);if(!incoming.setupDone||!Array.isArray(incoming.clients)||!Array.isArray(incoming.entries))throw new Error('invalid');openModal(`<h3>استعادة النسخة؟</h3><p class="muted">سيتم استبدال البيانات الحالية بالنسخة المختارة. لا يمكن التراجع إلا إذا كان لديك نسخة من البيانات الحالية.</p><div class="modal-actions"><button class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary" onclick='confirmRestoreBackup(${JSON.stringify(JSON.stringify(incoming))})'>استعادة</button></div>`);}catch(e){toast('ملف النسخة غير صالح');}};
function confirmRestoreBackup(jsonString){try{state=JSON.parse(jsonString);saveState();sessionAccountId=null;closeModal();render();toast('تمت الاستعادة');}catch(e){toast('تعذر الاستعادة');}}

function exportClient(id,type){
  const c=state.clients.find(x=>x.id===id);if(!c)return;
  const rows=ledgerRows(id);let runningUsd=0,totalPurchasesUsd=0,totalPaymentsUsd=0;
  const symbol=cur=>cur==='USD'?'$':cur==='TRY'?'₺':cur==='SYP'?'ل.س':'';
  const balInCur=(usd,e)=>e.originalCurrency==='TRY'?usd*num(e.rateUsdTry||state.rates.usdTry):e.originalCurrency==='SYP'?usd*num(e.rateUsdSyp||state.rates.usdSyp):usd;
  const exportRows=rows.map(e=>{const pay=e.type==='payment',buy=['purchase','opening'].includes(e.type);if(buy){runningUsd+=num(e.usdAmount);totalPurchasesUsd+=num(e.usdAmount);}else if(pay){runningUsd=Math.max(0,runningUsd-num(e.usdAmount));totalPaymentsUsd+=num(e.usdAmount);}const sym=symbol(e.originalCurrency);const amount=e.originalCurrency==='SYP'?`${fmtFlex(e.originalAmount)} ${sym}`:`${sym}${fmtFlex(e.originalAmount)}`;const bv=balInCur(runningUsd,e);const balance=e.originalCurrency==='SYP'?`${fmtFlex(bv)} ${sym}`:`${sym}${fmtFlex(bv)}`;return{date:dateFmt(e.date||e.createdAt),type:pay?'payment':'purchase',typeLabel:pay?'دفعة':'شراء',amount,currency:e.originalCurrency,balance,description:entryDescription(e),by:e.createdBy};});
  const safeName=c.name.replace(/[\\/:*?"<>|]/g,'-');
  if(type==='pdf'){const payload={shop:state.shop,client:c,summary:{purchasesUsd:fmt(totalPurchasesUsd),paymentsUsd:fmt(totalPaymentsUsd),operations:exportRows.length},rows:exportRows};try{if(window.Android?.exportPdf)Android.exportPdf(JSON.stringify(payload),`كشف-${safeName}-${today()}.pdf`);else toast('PDF متاح داخل APK');}catch(e){toast('تعذر إنشاء PDF');}}
  else{const headers=['التاريخ','نوع العملية','مبلغ العملية','العملة','الرصيد بعد العملية','البيان','المسجل'];const csv=[headers,...exportRows.map(r=>[r.date,r.typeLabel,r.amount,r.currency,r.balance,r.description,r.by])].map(row=>row.map(csvCell).join(',')).join('\n');try{if(window.Android?.exportCsv)Android.exportCsv(csv,`كشف-${safeName}-${today()}.csv`);else downloadText('\ufeff'+csv,`كشف-${safeName}.csv`,'text/csv');}catch(e){toast('تعذر تصدير CSV');}}
}
function csvCell(v){return '"'+String(v??'').replace(/"/g,'""')+'"';}
function downloadText(text,name,mime){const b=new Blob([text],{type:mime});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

// Auto-lock after inactivity.
let lastInteraction=Date.now();
['click','touchstart','keydown'].forEach(ev=>document.addEventListener(ev,()=>lastInteraction=Date.now(),{passive:true}));
setInterval(()=>{if(sessionAccountId&&num(state.settings.lockMinutes)>0&&(Date.now()-lastInteraction)>num(state.settings.lockMinutes)*60000){lockNow();toast('تم قفل التطبيق تلقائيًا');}},30000);

document.addEventListener('visibilitychange',()=>{if(!document.hidden && sessionAccountId)ensureRatesFresh();});
render();
