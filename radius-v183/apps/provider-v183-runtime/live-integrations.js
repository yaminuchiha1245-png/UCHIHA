/* Tenant-scoped integration cards. Keep V1-83 layout; never show reference
 * sample endpoints or call a configured key a proven working connection. */
function installV183LiveIntegrations(state){
 const tr=(ar,en)=>t(ar,en);
 const safe=value=>esc(String(value??'—'));
 const snapshot=()=>{
  const canView=state.me?.role!=='collector';
  const overview=canView?state.overview:null;
  const devices=canView?state.devices:null;
  const integrations=canView?state.integrations:null;
  const integrationsFailed=state.secondaryFailures.some(path=>path.startsWith('/integrations'));
  const overviewFailed=state.secondaryFailures.some(path=>path.startsWith('/radius/overview'));
  // The authenticated overview holds the *total*, not merely the current
  // page returned by /devices when a provider has many registered routers.
  const allDevices=state.diagnostics?.uniqueEndpoints??overview?.devices;
  const deviceCount=Number.isFinite(Number(allDevices))&&allDevices!==null&&allDevices!==undefined
    ?Math.max(0,Number(allDevices)):Array.isArray(devices)?devices.length:null;
  const verifiedCount=state.diagnostics?.verifiedOnline??overview?.onlineDevices;
  const verified=overview&&Number.isFinite(Number(verifiedCount))
    ?Math.max(0,Number(verifiedCount)):null;
  const agentLive=overview?.agentConnected===true;
  const accepted=overview&&Number.isFinite(Number(overview.last24Hours?.accepted))
    ?Number(overview.last24Hours.accepted):null;
  const radiusKey=overview?.credentialConfigured===true;
  const radiusConnected=agentLive&&accepted!==null&&accepted>0;
  const radiusUnknown=!overview||overviewFailed;
  const radiusStatus=radiusUnknown?'unknown':radiusConnected?'active':'attention';
  const radiusDescription=radiusUnknown
   ?tr('تعذّر التحقق من حالة RADIUS','RADIUS status unavailable')
   :radiusConnected
    ?tr('وكيل متصل ومصادقة مقبولة خلال 24 ساعة','Live agent and accepted AAA in the last 24h')
    :agentLive
     ?tr('الوكيل متصل؛ مصادقة المشتركين غير مثبتة','Agent connected; subscriber AAA unverified')
     :radiusKey
      ?tr('المفتاح صادر؛ لا توجد نبضة موقّعة حديثة','Agent key issued; no recent signed heartbeat')
      :tr('لم يُربط Site Agent بعد','Site Agent not paired yet');
  const mikrotikUnknown=deviceCount===null||verified===null;
  const mikrotikStatus=mikrotikUnknown?'unknown':deviceCount>0&&verified===deviceCount?'active':'attention';
  const mikrotikDescription=mikrotikUnknown
   ?tr('تعذّر التحقق من اتصال الأجهزة','Router connection status unavailable')
   :deviceCount===0
    ?tr('لا توجد أجهزة مسجّلة','No registered routers')
    :verified===0
     ?tr('الأجهزة مسجّلة فقط؛ لم ينجح فحص أيّ راوتر','Registered only; no verified router probes')
     :verified===deviceCount
      ?tr('تمّ إثبات اتصال كلّ الأجهزة المسجّلة','All registered routers verified')
      :tr('بعض الأجهزة متصلة والبقية تحتاج متابعة','Some routers verified; others need attention');
  const telegram=integrations?.find(row=>row.type==='telegram');
  const telegramUnknown=!Array.isArray(integrations)||integrationsFailed;
  const telegramSuccess=telegram?.status==='active'&&!!telegram.lastSeenAt&&!telegram.lastError;
  const telegramStatus=telegramUnknown?'unknown':telegramSuccess?'active':'attention';
  const telegramDescription=telegramUnknown
   ?tr('تعذّر قراءة تكامل التنبيهات','Notification integration unavailable')
   :telegramSuccess
    ?tr('تم تسجيل إرسال تنبيه ناجح','Successful notification delivery recorded')
    :telegram?.status==='active'
     ?tr('تمّ الإعداد؛ لم يثبت إرسال تنبيه ناجح','Configured; no successful notification confirmed')
     :tr('تنبيهات Telegram غير مهيأة','Telegram notifications not configured');
  // Existing manual invoice payments are NOT a payment gateway. No fictional
  // provider or enabled checkout is inferred from ordinary collection records.
  const collection=integrations?.find(row=>row.type==='collection'||row.type==='payment');
  const collectionConnected=collection?.status==='active'&&!!collection.lastSeenAt&&!collection.lastError;
  const collectionStatus=telegramUnknown?'unknown':collectionConnected?'active':'planned';
  return [
   {id:'INT-RADIUS',art:'auth-key',name:[ 'خادم RADIUS الرئيسي','Primary RADIUS server'],
    kind:['مصادقة AAA','AAA authentication'],state:radiusStatus,
    statusText:radiusUnknown?tr('غير متاح','Unavailable'):radiusConnected?tr('تم التحقق','Verified'):tr('يحتاج ربطًا','Needs setup'),
    endpoint:tr('شبكتك الخاصة','Your provider network'),
    scope:tr('حساب المزود فقط','Current tenant only'),last:overview?.lastSeenAt,
    facts:[[tr('التحقق','Verification'),radiusDescription],
           [tr('Site Agent','Site Agent'),agentLive?tr('متصل','Online'):radiusUnknown?'—':tr('غير متصل','Offline')],
           [tr('طلبات مقبولة خلال 24 ساعة','Accepted AAA, last 24h'),accepted??'—']],
    target:'radius'},
   {id:'INT-MIKROTIK',art:'router',name:['أجهزة MikroTik','MikroTik devices'],
    kind:['إدارة أجهزة NAS','NAS management'],state:mikrotikStatus,
    statusText:mikrotikUnknown?tr('غير متاح','Unavailable'):
      verified===0?tr('غير متصل','Offline'):verified===deviceCount?tr('متصل','Online'):tr('اتصال جزئي','Partially online'),
    endpoint:mikrotikUnknown?'—':verified+' / '+deviceCount+' NAS',
    scope:tr('أجهزة شبكتك فقط','Your registered routers only'),last:overview?.lastSeenAt,
    facts:[[tr('التحقق','Verification'),mikrotikDescription],
           [tr('الأجهزة المسجّلة','Registered devices'),deviceCount??'—'],
           [tr('المتصلة فعليًا','Verified online'),verified??'—']],
    target:'nas'},
   {id:'INT-TELEGRAM',art:'bot',name:['بوت Telegram للتنبيهات','Telegram notification bot'],
    kind:['تنبيهات ومتابعة','Notifications & follow-up'],state:telegramStatus,
    statusText:telegramUnknown?tr('غير متاح','Unavailable'):
      telegramSuccess?tr('إرسال مؤكد','Delivery verified'):telegram?.status==='active'?tr('بانتظار الاختبار','Needs test'):tr('غير مهيأ','Not configured'),
    endpoint:telegram?.config?.chatLabel||telegramDescription,
    scope:tr('تنبيهات شبكتك','Your network alerts'),last:telegram?.lastSeenAt,
    facts:[[tr('خدمة التنبيهات','Notification service'),telegramDescription],
           [tr('بوت الإدارة','Management bot'),tr('مستقل عن تكامل التنبيهات','Separate from notification delivery')],
           ...(telegram?.lastError?[[tr('آخر خطأ','Last error'),telegram.lastError]]:[])],
    target:'telegram'},
   {id:'INT-COLLECTION',art:'receipt',name:['قناة التحصيل','Collection channel'],
    kind:['الدفعات والفواتير','Payments & invoices'],state:collectionStatus,
    statusText:collectionStatus==='active'?tr('إرسال مؤكد','Verified'):collectionStatus==='unknown'?tr('غير متاح','Unavailable'):tr('غير مفعّل','Not enabled'),
    endpoint:collection?.config?.providerName||tr('لا توجد بوابة دفع مثبتة','No verified payment gateway'),
    scope:tr('الفواتير والتحصيل','Invoices & collection'),last:collection?.lastSeenAt,
    facts:[[tr('بوابة الدفع','Payment gateway'),collectionConnected?
        tr('نجحت عملية عبر التكامل','A successful integration event was recorded'):
        tr('لا توجد بوابة دفع مثبتة؛ تسجيل المدفوعات اليدوي منفصل','No verified gateway; manual payment recording is separate')]],
    target:'billing'}
  ];
 };
 const localizedDate=dateValue=>{
  if(!dateValue||!Number.isFinite(Date.parse(dateValue)))return '—';
  return new Date(dateValue).toLocaleString(lang==='ar'?'ar':'en',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
 };
 const label=entry=>t(...entry.name);
 const stateClass=entry=>entry.state==='active'?'active':entry.state==='planned'?'planned':'attention';
 const tone=entry=>entry.state==='active'?'':entry.state==='planned'?'no-dot':'warn';
 const detailButtons=entry=>'<button class="btn btn-plain" type="button" data-integration-detail="'+entry.id+'">'+
     art(entry.art)+tr('التفاصيل','Details')+'</button>'+
    '<button class="btn btn-plain" type="button" data-integration-target="'+entry.target+'">'+
     tr('فتح القسم المرتبط','Open related area')+'</button>';
 providerPages.integrations=()=>{
  const rows=snapshot();
  const verified=rows.filter(entry=>entry.state==='active').length;
  const attention=rows.filter(entry=>entry.state==='attention'||entry.state==='unknown').length;
  const planned=rows.filter(entry=>entry.state==='planned').length;
  return '<div class="integration-summary">'+[
   [tr('الخدمات','Services'),rows.length,'integrations',''],
   [tr('تم التحقق','Verified'),verified,'connected','green'],
   [tr('تحتاج متابعة','Needs attention'),attention,'configure','amber'],
   [tr('غير مفعّلة','Not enabled'),planned,'planned','purple']
  ].map(([name,count,iconName,colour])=>'<article class="panel integration-stat"><small>'+name+
     '</small><strong class="'+colour+' num">'+count+'</strong>'+art(iconName)+'</article>').join('')+
   '</div><section class="panel integration-intro">'+art('integrations')+
   '<div><h2>'+tr('مركز ربط خدمات المزود','Provider connection hub')+'</h2><p>'+
   tr('حالة فعلية من خادم شبكتك؛ تسجيل الجهاز لا يعني اتصاله.',
      'Live tenant status; registering a router does not prove connectivity.')+
   '</p></div>'+(v183CanCreate(state,'device')?
     '<button class="btn btn-primary" type="button" data-v183-integration-add>'+
       art('link')+tr('إعداد خدمة','Configure a service')+'</button>':'')+'</section>'+
   '<div class="integration-grid">'+rows.map(entry=>
    '<article class="panel integration-card '+stateClass(entry)+'"><header class="integration-head">'+
     '<span class="stat-icon">'+art(entry.art)+'</span><div><h2>'+label(entry)+'</h2><p>'+
     t(...entry.kind)+' · <span class="mono">'+entry.id+'</span></p></div>'+
     '<span class="chip '+tone(entry)+'">'+safe(entry.statusText)+'</span></header>'+
     '<div class="integration-facts"><div><small>'+tr('الوجهة','Endpoint')+
     '</small><b class="mono">'+safe(entry.endpoint)+'</b></div><div><small>'+
     tr('النطاق','Scope')+'</small><b>'+safe(entry.scope)+'</b></div></div>'+
     '<p class="provider-note">'+safe(entry.facts[0][1])+'</p>'+
     '<div class="integration-card-actions">'+detailButtons(entry)+'</div></article>'
   ).join('')+'</div><div class="integration-security">'+art('shield')+'<p>'+
     tr('تُعرض معلومات شبكتك الحقيقية فقط. لا تظهر مفاتيح RADIUS أو كلمات مرور MikroTik هنا، ولا تُعتبر أي خدمة متصلة دون دليل تحقق.',
        'Only your network data is shown. Router credentials remain private; integrations are not marked connected without verification.')+
     '</p></div>';
 };
 showIntegration=function(id){
  const entry=snapshot().find(item=>item.id===id);if(!entry)return;
  workspaceDialog(tr('تفاصيل التكامل الفعلية','Actual integration details'),
   '<div class="integration-detail-head">'+art(entry.art)+'<div><b>'+label(entry)+
   '</b><small class="mono">'+entry.id+'</small></div><span class="chip '+tone(entry)+'">'+
   safe(entry.statusText)+'</span></div>'+
   workspaceLine(tr('الوجهة','Endpoint'),safe(entry.endpoint))+
   entry.facts.map(([name,value])=>workspaceLine(safe(name),safe(value))).join('')+
   workspaceLine(tr('آخر تحقق مُسجّل','Last recorded verification'),safe(localizedDate(entry.last)))+
   '<div class="account-actions"><button class="btn btn-primary" type="button" data-integration-target="'+
    entry.target+'">'+tr('فتح إعدادات الخدمة','Open service settings')+'</button></div>'+
   '<p class="source-note">'+
    tr('هذه البيانات تُحدّث من حسابك فقط. تفاصيل أجهزة الشبكات تحتاج فحص Site Agent محليًا.',
       'Data is scoped to your account. Router connectivity requires an authenticated local Site Agent probe.')+
   '</p>');
 };
 if(!state.liveIntegrationClickInstalled){
  state.liveIntegrationClickInstalled=true;
  document.addEventListener('click',event=>{
   const button=event.target.closest?.('[data-v183-integration-add]');
   if(!button)return;
   event.preventDefault();event.stopImmediatePropagation();
   if(!v183CanCreate(state,'device'))return;
   workspaceDialog(tr('اختيار الخدمة لإعدادها','Choose a service to configure'),
    '<div class="account-actions">'+[
     ['radius',tr('خادم RADIUS وSite Agent','RADIUS & Site Agent')],
     ['nas',tr('إضافة جهاز MikroTik','Register MikroTik')],
     ['telegram',tr('ربط تنبيهات Telegram','Configure Telegram notifications')],
     ['billing',tr('إدارة الفواتير','Manage invoices')]
    ].map(([target,name])=>'<button class="btn btn-plain" type="button" data-integration-target="'+
       target+'">'+name+'</button>').join('')+'</div>');
  },true);
 }
}
