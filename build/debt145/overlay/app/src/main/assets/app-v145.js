/* Activation, company administration and support backups. Ledger schema remains v1. */
(function(){'use strict';
const VERSION='1.4.5', PHONE='963942586044';
let meta={}, showActivation=false, busy=false, page='', licenses=[], backups=[], events=[];
let backupTarget='', pendingRestore=null, sequence=0, backupTimer=null, lastAutoAttempt=0;
const requests=new Map();
try{meta=JSON.parse(window.Android?.serviceStatus?.()||'{}');}catch(_e){}
const oldRender=window.render, oldDrawer=window.drawer, oldBackup=window.renderBackup, oldBack=window.appBack;
const licensed=()=>!!meta.license_id&&!meta.reauth_required;
const companyOwner=()=>licensed()&&meta.active&&meta.role==='owner'&&!!sessionAccountId&&isOwner();
const ico=(name)=>window.uiIconV140?.(name)||'';
const formattedCode=code=>String(code||'').match(/.{1,8}/g)?.join('-')||'';
const date=raw=>raw?new Date(raw).toLocaleString('ar',{dateStyle:'medium',timeStyle:'short'}):'لا توجد نسخة بعد';
const footer=()=>'<footer class="debt-credit">البرمجة والتصميم بواسطة<strong>شركة أوتشيها البرمجية</strong></footer>';
const whatsapp=text=>'https://wa.me/'+PHONE+'?text='+encodeURIComponent(text);
const supportLink=()=>whatsapp('مرحبًا، أحتاج مساعدة بخصوص تطبيق دفتر الديون.'+(meta.license_id?' رقم الترخيص: '+meta.license_id:''));
function errorMessage(r){return ({INVALID_CODE:'الكود غير صحيح أو غير مفعّل.',DEVICE_LIMIT:'هذا الكود مرتبط بجهاز آخر. تواصل مع الإدارة لنقل التفعيل.',SESSION_REQUIRED:'أعد إدخال كود التفعيل للاتصال بالخدمة.',LICENSE_INACTIVE:'الخدمة موقوفة؛ بياناتك المحلية ونسخك المتاحة باقية.',FORBIDDEN:'هذه العملية متاحة لإدارة الشركة فقط.',CONSENT_REQUIRED:'لم يتم تفعيل خدمة النسخ الاحتياطي والدعم لهذا العميل.',SUPPORT_REASON_REQUIRED:'اكتب سبب طلب الاسترجاع، وتحقق من موافقة العميل على دعم النسخ.',RATE_LIMITED:'محاولات كثيرة. انتظر دقيقة ثم أعد المحاولة.',INVALID_BACKUP:'النسخة غير مكتملة أو أكبر من الحجم المسموح.',BODY_TOO_LARGE:'حجم النسخة كبير. صدّر نسخة محلية وتواصل مع الإدارة.',BACKUP_INTEGRITY:'تعذّر التحقق من سلامة النسخة. لم نغيّر بياناتك.',INVALID_EXPIRY:'اختر تاريخ صلاحية لاحقًا.',LABEL_REQUIRED:'اكتب اسم العميل.',NOT_FOUND:'النسخة المطلوبة غير موجودة.'})[r?.error]||'تعذّر الاتصال بالخدمة. بياناتك محفوظة على الهاتف.';}
function call(action,args={}){
  return new Promise(resolve=>{
    if(!window.Android?.serviceRequest){resolve({ok:false,error:'NATIVE_REQUIRED'});return;}
    const id='D'+Date.now()+'-'+(++sequence), timer=setTimeout(()=>{requests.delete(id);resolve({ok:false,error:'TIMEOUT'});},55000);
    requests.set(id,{resolve,timer});
    try{Android.serviceRequest(action,JSON.stringify(args),id);}catch(_e){clearTimeout(timer);requests.delete(id);resolve({ok:false,error:'SERVICE_UNAVAILABLE'});}
  });
}
window.onDebtServiceResult=function(id,result){const item=requests.get(id);if(!item)return;clearTimeout(item.timer);requests.delete(id);item.resolve(result||{ok:false});};
async function refreshStatus(){
  if(!licensed())return;
  const r=await call('status');
  if(r.ok){meta={...meta,...r,reauth_required:false};}
  else if(r.error==='SESSION_REQUIRED'){meta.active=false;meta.reauth_required=true;}
}
function activation(){
  $('app').innerHTML=`<main class="debt-activation">
    <div class="debt-brand"><div class="debt-app-icon" aria-hidden="true"></div><h1>دفتر الديون</h1><span>UCHIHA <b>Debt Store</b></span></div>
    <h2>تفعيل التطبيق</h2><p class="debt-subtitle">أدخل كود التفعيل لبدء الاستخدام</p>
    <form id="debtActivationForm" onsubmit="event.preventDefault();DebtUI.activate()">
      <label for="debtCode">كود التفعيل</label><div class="debt-code-input">${ico('lock')}<input id="debtCode" type="password" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="80" placeholder="أدخل الكود هنا" required></div>
      <p id="debtActivateError" class="debt-error" role="alert"></p>
      <button id="debtVerify" class="btn primary full" type="submit">تحقق</button>
    </form>
    <a class="debt-whatsapp" href="${whatsapp('مرحبًا، أريد طلب كود تفعيل لتطبيق دفتر الديون.')}">${ico('message')} طلب كود تفعيل عبر واتساب</a>
    <div class="debt-phone" dir="ltr">+963 942 586 044</div>
    <section class="debt-benefits"><h3>مزايا الخدمة</h3>
      <div>${ico('cloud')}<span><b>نسخ احتياطي</b><small>احفظ نسخة من سجلاتك لاستعادتها عند الحاجة.</small></span></div>
      <div>${ico('refresh')}<span><b>مساعدة في استعادة البيانات</b><small>الاسترجاع من نسخة احتياطية متاحة.</small></span></div>
      <div>${ico('message')}<span><b>دعم مباشر عبر واتساب</b><small>تواصل مع الإدارة عند حدوث مشكلة.</small></span></div>
      <a class="debt-support" href="${supportLink()}">تواصل مع الإدارة ${ico('message')}</a>
    </section>
    ${state.setupDone&&!window.__stateReadFailed?'<button class="btn ghost full" onclick="DebtUI.continueLegacy()">متابعة إلى سجلاتي الحالية</button>':''}
    ${licensed()?'<button class="btn ghost full" onclick="DebtUI.backups()">عرض النسخ الاحتياطية المتاحة</button>':''}
    ${footer()}</main>`;
}
function serviceFrame(title,body){
  return `<div class="debt-service-top"><button class="icon-btn" aria-label="رجوع" onclick="DebtUI.close()">${ico('home')}</button><h2>${esc(title)}</h2></div><main class="screen debt-service-screen">${body}${footer()}</main>`;
}
function setupLocal(){
  $('app').innerHTML=serviceFrame('إعداد الدفتر',`<div class="debt-benefits"><h3>تم التفعيل</h3><p>جهّز اسم المحل ورمز قفل هاتفك. تستطيع ربط المزامنة لاحقًا من القائمة.</p>
  <label>اسم المحل<input class="input" id="setupShop" value="${esc(meta.role==='owner'?'أوتشيها':meta.label||'')}" maxlength="100"></label>
  <label>اسمك<input class="input" id="setupOwner" maxlength="100"></label><input type="hidden" id="setupVillage" value=""><input type="hidden" id="setupPhone" value="">
  <label>رمز PIN لحماية هذا الهاتف<input class="input" id="setupPin" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"></label>
  <button class="btn primary full" onclick="DebtUI.setup()">فتح الدفتر</button></div><button class="btn ghost full" onclick="DebtUI.backups()">استعادة دفتر سابق من النسخ الاحتياطية</button>`);
}
function backupPanel(){
  const consent=!!meta.backup_consent;
  return `<section class="debt-benefits"><h3>نسخ الخدمة والدعم</h3>
    <p>عند التفعيل، تُحفظ نسخة مشفّرة من سجلات المحل في خدمة أوتشيها، ويمكن لإدارة الشركة استخراجها لمساعدتك عند حدوث مشكلة. يمكنك إيقاف الوصول في أي وقت.</p>
    <label class="debt-toggle"><input id="debtConsent" type="checkbox" ${consent?'checked':''} onchange="DebtUI.consent(this.checked)"><span>أوافق على النسخ الاحتياطي ومساعدة الإدارة في الاسترجاع</span></label>
    <div class="debt-last-backup"><small>آخر نسخة مؤكدة</small><b>${esc(date(meta.last_backup_at))}</b></div>
    <small class="muted">نسخ تلقائي أثناء فتح التطبيق عند توفر الإنترنت. نحتفظ بآخر 20 نسخة ناجحة. إيقاف الموافقة يمنع الرفع ووصول الدعم، وتبقى نسخك متاحة لك.</small>
    <button class="btn primary full" onclick="DebtUI.backupNow()" ${!consent||!meta.active?'disabled':''}>نسخ احتياطي الآن</button>
    <button class="btn ghost full" onclick="DebtUI.backups()">عرض النسخ واسترجاعها</button>
    <a class="debt-support" href="${supportLink()}">تواصل مع الإدارة</a></section>`;
}
function backupRows(){
  return backups.map(b=>`<article class="debt-license"><div class="debt-row"><b>${esc(date(b.created_at))}</b><span class="badge">${esc(b.app_version)}</span></div>
    <p>${esc(b.summary?.shop||'دفتر الديون')}</p><div class="debt-counts"><span>${Number(b.summary?.clients)||0} عميل</span><span>${Number(b.summary?.entries)||0} حركة</span><span>${Number(b.summary?.products)||0} منتج</span></div>
    <button class="btn primary full" onclick="DebtUI.download('${b.id}',${!!backupTarget})">${backupTarget?'استخراج نسخة للدعم':'معاينة الاسترجاع'}</button></article>`).join('')||'<div class="debt-empty">لا توجد نسخ احتياطية متاحة بعد.</div>';
}
function admin(){
  if(!companyOwner()){page='';return oldRender();}
  const rows=licenses.map(l=>`<article class="debt-license"><div class="debt-row"><b>${esc(l.label)}</b><span class="badge ${l.active?'green':'amber'}">${!l.active?'موقوف':l.activated_at?'مستخدم':'جديد'}</span></div>
    <small>${esc(l.phone||'بدون هاتف')} · ${l.devices}/${l.max_devices} أجهزة</small><div class="debt-code-row"><code dir="ltr">${esc(formattedCode(l.code))}</code><button class="mini-btn" onclick="DebtUI.copy('${l.id}')">نسخ</button></div>
    <small>الصلاحية: ${l.expires_at?esc(date(l.expires_at)):'دائمة'}</small><small class="debt-backup-meta">آخر نسخة: ${esc(date(l.last_backup_at))}</small>
    <div class="debt-actions"><button class="btn ghost" onclick="DebtUI.backups('${l.id}')" ${!l.backup_consent?'disabled':''}>نسخ العميل</button><button class="btn ghost" onclick="DebtUI.setActive('${l.id}',${!l.active})">${l.active?'إيقاف الكود':'إعادة التفعيل'}</button><button class="btn ghost" onclick="DebtUI.resetDevice('${l.id}')">نقل إلى جهاز جديد</button></div>
    ${!l.backup_consent?'<small class="muted">العميل لم يفعّل وصول خدمة النسخ والدعم.</small>':''}</article>`).join('');
  $('app').innerHTML=serviceFrame('لوحة شركة أوتشيها',`<div class="debt-admin-title"><p>الأكواد والعملاء والنسخ الاحتياطية</p><span class="badge green">إدارة الشركة</span></div>
    <div class="debt-actions"><button class="btn primary" onclick="DebtUI.newCode()">${ico('plus')} إنشاء كود</button><button class="btn ghost" onclick="DebtUI.admin()">تحديث</button><button class="btn ghost" onclick="DebtUI.audit()">سجل الإدارة</button></div>
    <form class="debt-search" onsubmit="event.preventDefault();DebtUI.admin(document.getElementById('debtSearch').value)"><input id="debtSearch" class="input" placeholder="بحث باسم العميل أو رقم الهاتف"><button class="btn ghost">بحث</button></form>
    <p class="small muted">أكواد العملاء ظاهرة هنا لصلاحية الشركة فقط. كود المالك لا يظهر في هذه القائمة.</p>
    ${rows||'<div class="debt-empty">لم تُنشئ أكوادًا بعد.</div>'}${licenses.length===100?'<button class="btn ghost full" onclick="DebtUI.more()">عرض الصفحة التالية</button>':''}`);
}
let listOffset=0,listSearch='';
window.DebtUI={
  close(){page='';showActivation=false;window.__debtRecoveryService=false;render();},
  openActivation(){page='';showActivation=true;window.__debtRecoveryService=true;activation();},
  continueLegacy(){showActivation=false;page='';window.__debtRecoveryService=false;render();},
  async activate(){
    if(busy)return;const code=$('debtCode')?.value||'';if(!code.trim())return;
    busy=true;$('debtVerify').disabled=true;$('debtVerify').textContent='جاري التحقق…';$('debtActivateError').textContent='';
    const r=await call('activate',{code});busy=false;
    if(r.ok){meta={...r,reauth_required:false};showActivation=false;page='';
      if(window.__stateReadFailed){await this.backups();return;}render();toast('تم تفعيل التطبيق');}
    else{const message=$('debtActivateError');if(message)message.textContent=errorMessage(r);const b=$('debtVerify');if(b){b.disabled=false;b.textContent='تحقق';}}
  },
  setup(){if(state.setupDone||window.__stateReadFailed||!licensed()||!meta.active)return;finishSetup();},
  async admin(search='',offset=0){
    if(!companyOwner())return;const r=await call('owner_list',{search:String(search).slice(0,120),offset});
    if(!r.ok){toast(errorMessage(r));return;}licenses=r.licenses||[];page='admin';listOffset=offset;listSearch=search;drawerOpen=false;admin();
  },
  more(){return this.admin(listSearch,listOffset+100);},
  copy(id){if(!companyOwner())return;const value=licenses.find(l=>l.id===id)?.code;if(!value)return;try{Android.copyText(formattedCode(value));toast('تم نسخ كود العميل');}catch(_e){toast('النسخ متاح داخل التطبيق');}},
  newCode(){if(!companyOwner())return;openModal(`<h3>إنشاء كود تفعيل</h3><label>اسم العميل<input id="debtNewLabel" class="input" maxlength="120"></label><label>رقم الهاتف<input id="debtNewPhone" class="input" type="tel" maxlength="30"></label><label>الصلاحية<select id="debtNewDays" class="input"><option value="0">دائمة</option><option value="30">30 يومًا من اليوم</option><option value="365">سنة من اليوم</option></select></label><label>الأجهزة المسموحة<select id="debtNewDevices" class="input"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label><div class="modal-actions"><button class="btn ghost" onclick="closeModal()">إلغاء</button><button id="debtCreateBtn" class="btn primary" onclick="DebtUI.create()">إنشاء الكود</button></div>`);},
  async create(){
    if(busy||!companyOwner())return;const label=$('debtNewLabel').value.trim();if(!label){toast('اكتب اسم العميل');return;}
    const days=Number($('debtNewDays').value),args={label,phone:$('debtNewPhone').value.trim(),max_devices:Number($('debtNewDevices').value)};
    if(days)args.expires_at=new Date(Date.now()+days*86400000).toISOString();
    busy=true;$('debtCreateBtn').disabled=true;const r=await call('owner_create',args);busy=false;
    if(!r.ok){toast(errorMessage(r));if($('debtCreateBtn'))$('debtCreateBtn').disabled=false;return;}closeModal();await this.admin();toast('تم إنشاء الكود');
  },
  setActive(id,active){if(!companyOwner())return;openModal(`<h3>${active?'إعادة تفعيل الكود':'إيقاف الكود'}</h3><p>لن تُحذف سجلات العميل أو نسخه الاحتياطية.</p><div class="modal-actions"><button class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary" onclick="DebtUI.confirmActive('${id}',${active})">تأكيد</button></div>`);},
  async confirmActive(id,active){if(busy||!companyOwner())return;busy=true;const r=await call('owner_set_active',{license_id:id,active});busy=false;if(!r.ok){toast(errorMessage(r));return;}closeModal();await this.admin(listSearch,listOffset);},
  resetDevice(id){if(!companyOwner())return;openModal(`<h3>نقل التفعيل إلى جهاز جديد</h3><p>تحقق من هوية العميل أولًا. ينتهي اتصال الأجهزة السابقة بالخدمة، وتبقى سجلاتها المحلية. لا يُحذف أي دفتر.</p><label>سبب النقل<textarea id="debtResetReason" class="input" maxlength="300"></textarea></label><div class="modal-actions"><button class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary" onclick="DebtUI.confirmReset('${id}')">السماح بتفعيل جهاز جديد</button></div>`);},
  async confirmReset(id){if(busy||!companyOwner())return;const reason=$('debtResetReason').value.trim();if(reason.length<5){toast('اكتب سبب النقل');return;}busy=true;const r=await call('owner_reset_device',{license_id:id,reason});busy=false;if(!r.ok){toast(errorMessage(r));return;}closeModal();await this.admin();toast('يمكن استخدام الكود على الجهاز الجديد');},
  async consent(enabled){
    if(!licensed()||!meta.active||!state.setupDone||!sessionAccountId)return;const r=await call('consent',{enabled});if(!r.ok){toast(errorMessage(r));render();return;}meta.backup_consent=enabled;render();if(enabled)await this.backupNow();
  },
  async backupNow(automatic=false){
    if(!licensed()||!meta.active||!meta.backup_consent||!state.setupDone||window.__stateReadFailed||!sessionAccountId)return;
    if(automatic&&Date.now()-lastAutoAttempt<600000)return;lastAutoAttempt=Date.now();
    // Auth credentials live only in native preferences. No service/session secrets in this snapshot.
    const snapshot=JSON.parse(JSON.stringify(state));
    const r=await call('backup',{snapshot,app_version:VERSION});
    if(r.ok){meta.last_backup_at=r.created_at;if(!automatic){render();toast('تم حفظ النسخة الاحتياطية');}}
    else if(!automatic)toast(errorMessage(r));
  },
  async backups(licenseId=''){
    if(licenseId&&!companyOwner())return;if(!licensed()){this.openActivation();return;}
    const r=await call(licenseId?'owner_backups':'backups',licenseId?{license_id:licenseId}:{});
    if(!r.ok){toast(errorMessage(r));return;}backupTarget=licenseId;backups=r.backups||[];page='backups';showActivation=false;drawerOpen=false;window.__debtRecoveryService=true;
    $('app').innerHTML=serviceFrame(licenseId?'نسخ العميل الاحتياطية':'استرجاع النسخ الاحتياطية',backupRows());
  },
  async download(id,support=false){
    if(support){if(!companyOwner())return;openModal(`<h3>استخراج نسخة للدعم</h3><p>يُسجّل هذا الطلب في سجل الإدارة. استخرجها لمعالجة مشكلة العميل فقط.</p><label>سبب الطلب<textarea id="debtSupportReason" class="input" maxlength="300"></textarea></label><div class="modal-actions"><button class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary" onclick="DebtUI.supportDownload('${id}')">استخراج النسخة</button></div>`);return;}
    if(busy)return;busy=true;const r=await call('download',{backup_id:id});busy=false;if(!r.ok){toast(errorMessage(r));return;}previewRestore(r.snapshot);
  },
  async supportDownload(id){
    if(busy||!companyOwner())return;const reason=$('debtSupportReason').value.trim();if(reason.length<5){toast('اكتب سبب الطلب');return;}
    busy=true;const r=await call('owner_download',{backup_id:id,reason});busy=false;
    if(!r.ok){toast(errorMessage(r));return;}if(!DebtDataGuard.valid(r.snapshot)){toast('النسخة غير صالحة');return;}
    try{Android.exportBackup(JSON.stringify(r.snapshot),'UCHIHA-support-'+id+'.json');closeModal();toast('تم تجهيز نسخة العميل للمشاركة');}catch(_e){toast('تعذر تجهيز الملف');}
  },
  async audit(){if(!companyOwner())return;const r=await call('owner_audit');if(!r.ok){toast(errorMessage(r));return;}events=r.events||[];page='audit';
    const names={activated:'تفعيل جهاز',code_created:'إنشاء كود',backup_consent:'تغيير موافقة النسخ',owner_download:'استخراج للدعم',download:'استرجاع نسخة',owner_set_active:'تغيير حالة كود',owner_reset_device:'نقل التفعيل'};
    $('app').innerHTML=serviceFrame('سجل الإدارة',events.map(e=>`<article class="debt-license"><b>${esc(names[e.action]||e.action)}</b><p>${esc(e.label||'')}</p><small>${esc(date(e.created_at))}</small>${e.detail?.reason?`<p>${esc(e.detail.reason)}</p>`:''}</article>`).join('')||'<p>لا توجد عمليات.</p>');
  },
  restore(){
    if(!pendingRestore||!DebtDataGuard.valid(pendingRestore))return;
    const incoming=JSON.parse(JSON.stringify(pendingRestore));
    if(incoming.cloud)incoming.cloud.linked=false; // Keep pending records; reconnect deliberately after restore.
    const raw=JSON.stringify(incoming);
    if(window.Android?.restoreSecureState){
      if(!Android.restoreSecureState(raw)){toast('تعذر حفظ نقطة الرجوع. لم تُستبدل بياناتك.');return;}
    }else{
      try{const before=localStorage.getItem(STORAGE_KEY);if(before)localStorage.setItem(STORAGE_KEY+'_before_restore_v145',before);localStorage.setItem(STORAGE_KEY,raw);}catch(_e){toast('تعذر الاسترجاع. لم نغيّر الدفتر.');return;}
    }
    pendingRestore=null;window.__stateReadFailed=false;
    if(window.Android?.restartAfterRestore){Android.restartAfterRestore();return;}
    state=normalizeState(incoming);sessionAccountId=null;closeModal();page='';showActivation=false;window.__debtRecoveryService=false;render();toast('تمت الاستعادة؛ المزامنة متوقفة حتى تعيد ربطها');
  }
};
function previewRestore(incoming){
  if(!DebtDataGuard.valid(incoming)||!incoming.setupDone){toast('ملف النسخة غير صالح. لم نغيّر بياناتك.');return;}
  if(!window.__stateReadFailed&&state.setupDone&&(!sessionAccountId||!isOwner())){toast('افتح حساب صاحب المحل أولًا');return;}
  pendingRestore=incoming;
  openModal(`<h3>معاينة استرجاع الدفتر</h3><p>${esc(incoming.shop?.name||'دفتر الديون')}</p><div class="debt-counts"><span>${incoming.clients.length} عميل</span><span>${incoming.entries.length} حركة</span></div><p>سيتم استبدال الدفتر الحالي. نحفظ نسخة محلية من وضعه قبل الاسترجاع، وتتوقف المزامنة إلى أن تعيد ربطها.</p><div class="modal-actions"><button class="btn ghost" onclick="closeModal()">إلغاء</button><button class="btn primary" onclick="DebtUI.restore()">حفظ نقطة رجوع والاسترجاع</button></div>`);
}
window.onNativeBackupPicked=function(text){try{previewRestore(JSON.parse(text));}catch(_e){toast('ملف النسخة غير صالح');}};
window.confirmRestoreBackup=function(text){try{previewRestore(JSON.parse(text));}catch(_e){toast('ملف النسخة غير صالح');}};
window.drawer=function(){
  const html=oldDrawer();if(!drawerOpen||!html)return html;
  const extra=`<hr>${companyOwner()?`<button class="drawer-item" onclick="DebtUI.admin()"><span class="ui-icon">${ico('settings')}</span><span>لوحة شركة أوتشيها</span></button>`:''}
  <button class="drawer-item" onclick="DebtUI.openActivation()"><span class="ui-icon">${ico('lock')}</span><span>${licensed()&&meta.active?'تفعيل الخدمة':'تفعيل التطبيق'}</span></button>
  <a class="drawer-item" href="${supportLink()}"><span class="ui-icon">${ico('message')}</span><span>تواصل مع الإدارة</span></a>`;
  return html.replace('</aside>',extra+'</aside>');
};
window.renderBackup=function(){const html=oldBackup();return licensed()?html.replace('</main>',backupPanel()+'</main>'):html.replace('</main>','<button class="btn primary full" onclick="DebtUI.openActivation()">تفعيل خدمة النسخ والدعم</button></main>');};
window.render=function(){
  if(window.__stateReadFailed){if(showActivation)return activation();if(page==='backups'){$('app').innerHTML=serviceFrame('استرجاع النسخ الاحتياطية',backupRows());return;}DebtDataGuard.recovery();return;}
  if(showActivation||(!state.setupDone&&(!licensed()||!meta.active))){activation();return;}
  if(page==='backups'){$('app').innerHTML=serviceFrame(backupTarget?'نسخ العميل الاحتياطية':'استرجاع النسخ الاحتياطية',backupRows());return;}
  if(!state.setupDone){setupLocal();return;}
  if(page==='admin'&&companyOwner()){admin();return;}
  if(page==='audit'&&companyOwner())return;
  return oldRender();
};
window.appBack=function(){if(page||showActivation){DebtUI.close();return true;}return oldBack?.()||false;};
const priorSave=window.saveState;
window.saveState=function(){const r=priorSave();if(!window.__stateReadFailed&&meta.backup_consent){clearTimeout(backupTimer);backupTimer=setTimeout(()=>DebtUI.backupNow(true),30000);}return r;};
window.UCHIHA_UI_VERSION=VERSION;
render();
if(licensed())refreshStatus().then(()=>{if(!showActivation&&!page)render();});
window.addEventListener('online',()=>{refreshStatus();DebtUI.backupNow(true);});
})();
