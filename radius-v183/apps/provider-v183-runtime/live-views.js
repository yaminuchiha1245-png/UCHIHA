/* V1-83 live-only screens. The locked design source is never changed. */
function v183CanCreate(state,kind){
 const me=state.me;
 if(!me?.canWrite)return false;
 const role=me.role;
 if(kind==='ticket')return ['owner','admin','operator'].includes(role);
 return ['owner','admin'].includes(role);
}
function installV183LiveWorkspaces(state, apiRequest){
 const tr=(ar,en)=>t(ar,en);
 const num=x=>Number.isFinite(Number(x))?Number(x):0;
 const cash=x=>(num(x)/100).toFixed(2);
 const safe=x=>esc(String(x??'—'));
 const line=(label,value)=>workspaceLine(safe(label),safe(value));
 const section=(heading,content)=>'<section class="panel workspace-card"><h2>'+safe(heading)+'</h2>'+content+'</section>';
 const item=(heading,details,status)=>'<article class="panel workspace-card"><div class="entity"><div><h3>'+safe(heading)+'</h3><p class="muted">'+safe(details)+'</p></div></div>'+(status?'<span class="chip">'+safe(status)+'</span>':'')+'</article>';
 const action=(heading,kind)=>v183CanCreate(state,kind)?
  '<button class="btn btn-primary" type="button" data-v183-create="'+kind+'">'+safe(heading)+'</button>':'';
 const failure=route=>state.secondaryFailures.some(value=>value.startsWith(route));
 const listing=(data,render,route,ar,en)=>data.length?'<div class="workspace-grid">'+data.map(render).join('')+'</div>':
  '<p class="provider-note">'+(failure(route)?tr('تعذر جلب هذه البيانات من الخادم.','Server data unavailable; retry.'):tr(ar,en))+'</p>';
 providerPages.providers=()=>'<div class="plan-intro"><p>'+tr('الفروع المسجلة في شبكة مزودك','Your real network sites')+'</p>'+action(tr('إضافة فرع','Add site'),'site')+'</div>'+
  listing(state.sites,s=>item(s.name,(s.code||'—')+' • '+num(s.devices)+' '+tr('أجهزة','devices')+' • '+num(s.activeSessions)+' '+tr('جلسات','sessions'),s.status),'/sites','لا توجد فروع مسجلة.','No sites registered.');
 providerPages.plans=()=>'<div class="plan-intro"><p>'+tr('باقات الإنترنت في قاعدة بياناتك','Internet plans from your database')+'</p>'+action(tr('إضافة باقة','Add plan'),'plan')+'</div>'+
  listing(state.plans,p=>item(p.name,num(p.speedDownMbps)+'/'+num(p.speedUpMbps)+' Mbps · '+cash(p.priceMinor)+' '+(state.me?.currency||'USD'),p.status),'/plans','لا توجد باقات بعد.','No plans added.');
 providerPages.billing=()=>listing(state.invoices,i=>item(i.number||i.id,(i.subscriberName||'—')+' · '+cash(i.amountMinor)+' '+(i.currency||'USD')+' · '+tr('المدفوع','Paid')+': '+cash(i.paidMinor),i.status),'/invoices','لا توجد فواتير.','No invoices yet.');
 domainPages.nas=()=>'<div class="plan-intro"><p>'+tr('الأجهزة التي أضفتها أنت ضمن شبكتك. لا نعتبر الاسم أو عنوان IP دليلاً على الاتصال.','Your own tenant devices. A saved IP address is never proof of connectivity.')+'</p>'+
  action(tr('➕ إضافة MikroTik','Add MikroTik'),'device')+
  '<button type="button" class="btn btn-plain" data-page="radius">'+tr('🩺 فحص Site Agent','Check Site Agent')+'</button></div>'+
  listing(state.devices,d=>'<article class="panel workspace-card"><h3>'+safe(d.name)+'</h3>'+
   line('ID',d.id)+line('IP',d.host)+line(tr('منفذ الإدارة','Management port'),d.api_port||8728)+
   line(tr('آخر اتصال حقيقي','Last verified connection'),d.last_seen_at||'—')+
   '<span class="chip '+(d.status==='online'?'green':d.status==='error'?'warn':'')+'">'+safe(d.status==='online'?tr('متصل بواجهة RouterOS','RouterOS verified'):d.status==='error'?tr('تعذر فحص RouterOS؛ راجع الوكيل والشهادة','RouterOS probe failed; check agent/TLS'):tr('بانتظار تثبيت الوكيل وربط الراوتر','Waiting for agent + router pairing'))+'</span>'+
   (d.status!=='online'?'<p class="provider-note">'+tr('ضع معرّف الجهاز وعنوانه داخل ملف routers.json في شبكة المزود. لا تُدخل كلمة المرور في بوت تيليغرام.','Put the exact ID and host in your on-site routers.json. Never send router passwords through Telegram.')+'</p>':'')+
   (v183CanCreate(state,'device')?'<button class="btn btn-plain" type="button" data-v183-edit-device="'+safe(d.id)+'">'+tr('✏️ تعديل الجهاز والعنوان','Edit device and address')+'</button>':'')+
   '</article>','/devices','لا توجد راوترات مسجلة.','No routers registered.');
 providerPages.support=()=>'<div class="plan-intro"><p>'+tr('تذاكر الدعم الحقيقية','Actual support tickets')+'</p>'+action(tr('تذكرة جديدة','Create ticket'),'ticket')+'</div>'+
  listing(state.tickets,ticket=>item(ticket.title,ticket.description,ticket.status),'/support/tickets','لا توجد تذاكر دعم.','No support tickets.');
 providerPages.team=()=>listing(state.team,user=>item(user.displayName,user.role,user.status),'/team','لم يُضف أعضاء فريق بعد.','No team members added.');
 providerPages.telegram=()=>section(tr('تكامل تيليغرام','Telegram integration'),
  line(tr('بوت الإدارة','Management bot'),'@RadiusUchihabot')+
  line(tr('خدمة التنبيهات','Notification service'),state.integrations.find(i=>i.type==='telegram')?.status||'not_configured')+
  '<p class="muted">'+tr('بوت الإدارة يعمل مستقلاً؛ التنبيهات تحتاج تكاملًا مفعّلًا.','Management bot is separate; alerts require a configured integration.')+'</p>'+
  '<a href="https://t.me/RadiusUchihabot" target="_blank" rel="noopener noreferrer" class="btn btn-primary">'+tr('فتح بوت الراديوس','Open RADIUS bot')+'</a>'+
  '<p class="provider-note">'+tr('لربط حساب تيليغرام الشخصي بشبكتك: افتح الراديوس بحسابك الموثق أولاً، ثم استخرج رمز ربط صالحًا لمدة 15 دقيقة وأرسله إلى البوت في محادثة خاصة.','Link your personal Telegram to your existing authenticated network account: request a 15-minute code here and send it privately to the bot.')+'</p>'+
  '<button type="button" class="btn btn-primary" data-v183-telegram-link>'+tr('🔗 إصدار رمز ربط حسابي','Generate my one-time linking code')+'</button>');
 providerPages.reports=()=>section(tr('التقرير الفعلي لآخر 30 يومًا','Actual report for 30 days'),
  line(tr('المشتركون','Subscribers'),state.report?.subscribers?.total??'—')+
  line(tr('بدايات الجلسات','Session starts'),state.report?.sessions?.total??'—')+
  line(tr('الفواتير','Invoices'),state.report?.billing?.invoices??'—')+
  line(tr('المدفوعات','Payments'),state.report?.billing?.payments??'—')+
  line(tr('المبلغ المحصّل','Collected'),cash(state.report?.billing?.collectedMinor)+' '+(state.me?.currency||'USD'))+
  '<p class="muted">'+safe(state.report?.range?.from)+' — '+safe(state.report?.range?.to)+'</p>');
 domainPages.radius=()=>section(tr('طلبات المصادقة الفعلية خلال 24 ساعة','Actual authentication, last 24 hours'),
  line(tr('الطلبات','Requests'),state.overview?.last24Hours?.authenticationRequests??'—')+
  line(tr('المقبولة','Accepted'),state.overview?.last24Hours?.accepted??'—')+
  line(tr('المرفوضة','Rejected'),state.overview?.last24Hours?.rejected??'—')+
  line(tr('مفتاح Site Agent','Site Agent key'),state.overview?.credentialConfigured?
    tr('تم إصداره','Issued'):tr('لم يُصدر بعد','Not issued'))+
  line(tr('حالة الربط الحقيقي','Verified connection'),state.overview?.agentConnected?
    tr('متصل عبر نبضة موقعة','Connected by signed heartbeat'):
    tr('غير متصل — لا توجد نبضة حديثة','Offline — no recent heartbeat'))+
  line(tr('الوكلاء المتصلون','Online agents'),(state.overview?.agentsOnline??'—')+' / '+(state.overview?.agentsTotal??'—'))+
  line(tr('آخر نبضة','Last heartbeat'),state.overview?.lastSeenAt??'—')+
  (state.me?.role==='owner'&&state.me?.canWrite?
    '<button class="btn btn-primary" type="button" data-v183-agent-setup>'+tr('ربط Site Agent بأمان','Secure Site Agent setup')+'</button>':'')+
  (['owner','admin'].includes(state.me?.role)?
    '<button class="btn btn-plain" type="button" data-v183-agent-template>'+tr('📄 إعداد الوكيل لأجهزتي تلقائيًا','Generate agent configuration for my routers')+'</button>':'')+
  '<p class="provider-note">'+tr('المفتاح وحده لا يعني أن MikroTik متصل. يلزم تشغيل Site Agent داخل شبكتك ومشاهدة نبضة حقيقية.','An issued key does not mean a router is online. Run the Site Agent on your network and verify its heartbeat.')+'</p>'+
  listing(state.authEvents.slice(0,15),e=>item(e.username,(e.nasIp||'—')+' • '+(e.occurredAt||'—'),e.result),'/radius/auth-events','لا توجد طلبات مصادقة مسجلة.','No recorded authentication requests.'));
 domainPages.vouchers=()=>listing(state.vouchers,v=>item(v.code,num(v.quantity)+' '+tr('بطاقة','cards')+' • '+tr('المفعّلة','Active')+': '+num(v.active)+' • '+tr('المتاحة','Available')+': '+num(v.available),v.status),'/voucher-batches','لم تُنشأ بطاقات بعد.','No vouchers created.');
 domainPages.agents=()=>'<div class="plan-intro">'+action(tr('إضافة وكيل','Add reseller'),'reseller')+'</div>'+
  listing(state.resellers,r=>item(r.name,(r.phone||'—')+' • '+num(r.voucherBatches)+' '+tr('دفعات','batches'),r.status),'/resellers','لا يوجد وكلاء.','No resellers registered.');


}

/* Real timeline endpoint: session starts per UTC bucket, never an interpolated
 * sample of current concurrency. Missing data is marked unavailable. */
function installV183LiveCharts(state){
 renderChart=function(){
  const root=document.getElementById('activity-chart');
  const time=state.timelines[period];
  const total=document.getElementById('chart-total');
  const caption=document.getElementById('period-caption');
  if(!root)return;
  const changeLabel=(node,ar,en)=>{
   if(!node)return;
   node.dataset.ar=ar;node.dataset.en=en;node.textContent=t(ar,en);
  };
  changeLabel(total?.parentElement?.querySelector('small'),'بدايات الجلسات الفعلية','Actual session starts');
  changeLabel(root.parentElement?.querySelector('.chart-foot .legend span'),'بدايات الجلسات','Session starts');
  changeLabel(root.parentElement?.querySelector('.panel-head p'),'من سجل الجلسات الفعلي (UTC)','From actual session records (UTC)');
  if(!time||!Array.isArray(time.buckets)){
   if(total)total.textContent='—';
   if(caption)caption.textContent=t('تعذر تحميل سجل الجلسات','Session history unavailable');
   root.innerHTML='<p class="muted">'+t('لا نعرض بيانات بيانية افتراضية.','No sample chart is displayed.')+'</p>';
   return;
  }
  const values=time.buckets.map(bucket=>Math.max(0,Number(bucket.starts)||0));
  // A zero-activity tenant must not display invented 1-session axis ticks.
  if(values.every(value=>value===0)){
   root.innerHTML='<div class="provider-note" role="status">'+t('لم تبدأ أي جلسة في هذه الفترة حتى الآن.','No sessions started during this period yet.')+'</div>';
   if(total)total.textContent='0';
   if(caption)caption.textContent=t('سجل الجلسات الحقيقي · UTC','Actual session history · UTC');
   return;
  }
  const peak=Math.max(1,...values),w=620,h=165,left=43,right=605,top=10,bottom=139;
  const x=i=>left+(right-left)*i/Math.max(1,values.length-1);
  const y=v=>bottom-v/peak*(bottom-top);
  const path=values.map((value,i)=>(i?'L':'M')+x(i).toFixed(1)+','+y(value).toFixed(1)).join(' ');
  const grid=(values.some(value=>value>0)?[0,1,2,3,4]:[0]).map(tick=>{
   const value=Math.round(peak*tick/4),yy=y(peak*tick/4);
   return '<line class="gridline" x1="'+left+'" y1="'+yy+'" x2="'+right+'" y2="'+yy+
    '"/><text x="'+(left-8)+'" y="'+(yy+4)+'" text-anchor="end">'+value+'</text>';
  }).join('');
  const every=period==='day'?6:1;
  const axes=time.buckets.map((bucket,i)=>{
   if(i%every!==0&&i!==time.buckets.length-1)return '';
   const date=new Date(bucket.at);
   const label=period==='day'?date.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'}):
    date.toLocaleDateString('en-GB',{day:'2-digit',month:'short',timeZone:'UTC'});
   return '<text x="'+x(i)+'" y="161" text-anchor="'+(i===0?'start':i===values.length-1?'end':'middle')+'">'+esc(label)+'</text>';
  }).join('');
  root.innerHTML='<svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+
   esc(t('بدايات الجلسات الحقيقية خلال الفترة','Actual session starts during the period'))+
   '">'+grid+'<path d="'+path+'" fill="none" stroke="var(--teal)" stroke-width="2.4" stroke-linejoin="round"/>'+
   values.map((v,i)=>v>0?'<circle cx="'+x(i)+'" cy="'+y(v)+'" r="2.1" fill="var(--teal)"/>':'').join('')+axes+'</svg>';
  if(total)total.textContent=String(time.totalStarts||0);
  if(caption)caption.textContent=t('بدايات الجلسات المسجلة','Recorded session starts')+' · UTC · '+
   (period==='day'?'24h':'7d');
 };
}


/* Every control introduced above writes to the real, tenant-scoped API.
 * No router is labelled online until its signed connector heartbeat arrives.
 * Network secrets are never requested in the web registration form. */
function installV183LiveActions(state,apiRequest,refresh,reportError,setBusy){
 if(state.liveActionsInstalled)return;
 state.liveActionsInstalled=true;
 const field=(name,label,type='text',attrs='')=>'<label><span>'+esc(label)+'</span><input name="'+name+'" type="'+type+'" required '+attrs+'></label>';
 const desc=()=>'<p class="provider-note">'+t('ستُحفظ المعلومات داخل شبكة مزودك فقط.','Records are stored inside your own tenant.')+'</p>';
 const forms={
  site:()=>field('name',t('اسم الفرع','Site name'),'text','minlength="2" maxlength="100"')+
   field('code',t('رمز الفرع بالإنجليزية','Site code'),'text','pattern="[A-Za-z0-9_-]{2,24}"'),
  plan:()=>field('name',t('اسم الباقة','Plan name'),'text','minlength="2" maxlength="80"')+
   field('down',t('سرعة التنزيل Mbps','Download Mbps'),'number','min="1" max="100000"')+
   field('up',t('سرعة الرفع Mbps','Upload Mbps'),'number','min="1" max="100000"')+
   field('price',t('السعر بالدولار','USD price'),'number','min="0" step="0.01"'),
  device:()=>field('name',t('اسم MikroTik الحقيقي','Router name'),'text','minlength="2" maxlength="100"')+
   field('host',t('عنوان الراوتر الذي يستطيع Site Agent الوصول إليه','Address reachable by your Site Agent'),'text','pattern="[A-Za-z0-9.:-]{3,253}" dir="ltr"')+
   field('port',t('منفذ RouterOS API-SSL المشفّر','Encrypted RouterOS API-SSL port'),'number','min="1" max="65535" value="8729"')+
   '<p class="membership-callout">'+t('التسجيل لا يوصّل الراوتر تلقائيًا. بعد الحفظ ستحصل على معرّف الجهاز وخطوات تشغيل Site Agent محليًا مع شهادة TLS موثوقة. لا ترسل كلمات المرور عبر Telegram.','Registration alone will not connect the router. After saving, use the assigned device ID to configure your local Site Agent with verified TLS. Never share router passwords in Telegram.')+'</p>',
  reseller:()=>field('name',t('اسم الوكيل','Reseller name'),'text','minlength="2" maxlength="120"'),
  ticket:()=>field('title',t('عنوان التذكرة','Ticket title'),'text','minlength="3" maxlength="160"')+
   '<label><span>'+t('التفاصيل','Description')+'</span><textarea name="description" minlength="5" maxlength="4000" required></textarea></label>'
 };
 const names={
  site:t('إضافة فرع','Add site'),plan:t('إضافة باقة','Add plan'),
  device:t('تسجيل MikroTik','Register MikroTik'),
  reseller:t('إضافة وكيل','Add reseller'),ticket:t('فتح تذكرة','Create ticket')
 };
 let setupDraft=null;
 document.addEventListener('click',async event=>{
  const template=event.target.closest?.('[data-v183-agent-template]');
  if(template){
   event.preventDefault();event.stopImmediatePropagation();
   if(!['owner','admin'].includes(state.me?.role)){
    reportError(Error(t('هذه الوظيفة مخصصة لإدارة الشبكة.','Network admin required.')));return;
   }
   setBusy(template,true,t('جارٍ تجهيز الملفات…','Preparing configuration…'));
   try{
    const data=await apiRequest('/radius/agent-setup');
    const env=Object.entries(data.environment||{}).map(([k,v])=>k+'='+v).join('\n')+'\n';
    const routers=JSON.stringify({routers:(data.routers||[]).map(({id,host,port,username,password,caFile,serverName,nasIps})=>
     ({id,host,port,username,password,caFile,serverName,nasIps}))},null,2)+'\n';
    setupDraft={env,routers};
    const mismatches=(data.routers||[]).filter(router=>router.needsTlsPortUpdate);
    workspaceDialog(t('إعداد Site Agent لشبكتك','Site Agent configuration for your network'),
     '<p class="membership-callout">'+t('هذه قوالب بدون أي كلمة مرور أو مفتاح حقيقي؛ املأ الأسرار على جهاز الوكيل المحلي فقط. نسخ الملف لا يشغّل الراوتر تلقائيًا.','These are templates WITHOUT real passwords or signing keys. Enter all secrets only on your local agent host. Downloading does not connect a router.')+'</p>'+
     '<p class="provider-note">'+t('الشبكة:','Tenant:')+' '+esc(data.tenantName)+' · '+t('الأجهزة:','Routers:')+' '+Number(data.routerCount||0)+'</p>'+
     (!data.credentialConfigured?'<p class="membership-callout">'+t('لم تُصدر مفتاح Site Agent بعد؛ يلزم صاحب الشبكة لإصداره من زر الربط.','Agent key is not issued. The owner must issue it from the enrollment button.')+'</p>':'')+
     (mismatches.length?'<p class="membership-callout">'+t('تنبيه:','Warning:')+' '+mismatches.length+' '+t('جهاز مسجّل بمنفذ مختلف عن API-SSL 8729. عدّل المنفذ من بطاقة الجهاز قبل اعتماد هذا الملف.','router(s) have a registered port other than encrypted API-SSL 8729. Correct them in their device cards before using this file.')+'</p>':'')+
     '<div class="workspace-form">'+
     '<label><span>radius-agent.env</span><textarea id="v183-setup-env" dir="ltr" readonly rows="9" spellcheck="false"></textarea></label>'+
     '<button type="button" class="btn btn-plain" data-v183-setup-copy="env">'+t('نسخ إعداد الوكيل','Copy agent settings')+'</button>'+
     '<button type="button" class="btn btn-primary" data-v183-setup-download="env">'+t('تحميل ملف الإعداد','Download settings template')+'</button>'+
     '<label><span>routers.json</span><textarea id="v183-setup-routers" dir="ltr" readonly rows="9" spellcheck="false"></textarea></label>'+
     '<button type="button" class="btn btn-plain" data-v183-setup-copy="routers">'+t('نسخ ملف الراوترات','Copy router template')+'</button>'+
     '<button type="button" class="btn btn-primary" data-v183-setup-download="routers">'+t('تحميل ملف الراوترات','Download router template')+'</button>'+
     '<p class="provider-note">'+t('الخطوات: ① افتح الملفات على حاسوب داخل شبكتك. ② أضف كلمة مرور RouterOS وشهادة CA موثوقة والمفتاح الصادر من حسابك. ③ ثبّت FreeRADIUS وSite Agent على ذلك الحاسوب. ④ بعد التشغيل ارجع إلى فحص RADIUS.','Steps: 1. Open the templates on a computer inside your network. 2. Add a local RouterOS password, trusted CA certificate, and your issued agent key. 3. Install and run FreeRADIUS and Site Agent. 4. Return to RADIUS status to verify signed probes.')+'</p>'+
     (state.me?.role==='owner'&&!data.credentialConfigured?'<button type="button" class="btn btn-primary" data-v183-agent-setup>'+t('إصدار المفتاح الآن','Issue the agent key')+'</button>':'')+
     '</div>');
    $('v183-setup-env').value=env;
    $('v183-setup-routers').value=routers;
   }catch(error){reportError(error)}
   finally{setBusy(template,false);}
   return;
  }
  const copySetup=event.target.closest?.('[data-v183-setup-copy]');
  if(copySetup){
   event.preventDefault();event.stopImmediatePropagation();
   const kind=copySetup.dataset.v183SetupCopy;
   if(!setupDraft||!['env','routers'].includes(kind))return;
   const field=$(kind==='env'?'v183-setup-env':'v183-setup-routers');
   try{await navigator.clipboard.writeText(setupDraft[kind]);toast(t('تم نسخ القالب. أضف الأسرار محليًا فقط.','Template copied. Add credentials locally only.'))}
   catch{field?.focus();field?.select();toast(t('حدد القالب وانسخه يدويًا.','Select and copy the template manually.'));}
   return;
  }
  const downloadSetup=event.target.closest?.('[data-v183-setup-download]');
  if(downloadSetup){
   event.preventDefault();event.stopImmediatePropagation();
   const kind=downloadSetup.dataset.v183SetupDownload;
   if(!setupDraft||!['env','routers'].includes(kind))return;
   const blob=new Blob([setupDraft[kind]],{type:kind==='env'?'text/plain;charset=utf-8':'application/json;charset=utf-8'});
   const url=URL.createObjectURL(blob),link=document.createElement('a');
   link.href=url;link.download=kind==='env'?'radius-agent.env.template':'routers.json.template';
   document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
   return;
  }
  const link=event.target.closest?.('[data-v183-telegram-link]');
  if(link){
   event.preventDefault();event.stopImmediatePropagation();
   if(!state.me?.tenantId)return;
   setBusy(link,true,t('جارٍ إصدار الرمز…','Generating code…'));
   try{
    const result=await apiRequest('/auth/telegram-link',{method:'POST',body:{}});
    const code=String(result.code||'');
    if(!/^UCHL-[A-Za-z0-9_-]{43}$/.test(code))throw Error(t('تعذر إصدار رمز الربط.','Could not generate a linking code.'));
    workspaceDialog(t('ربط حساب تيليغرام بشبكتك','Link Telegram to your network account'),
     '<p class="membership-callout">'+t('صلاحية الرمز 15 دقيقة ولمرة واحدة. لا ترسله إلا إلى البوت الرسمي في محادثة خاصة.','This single-use code expires in 15 minutes. Send it only to the official bot in a private chat.')+'</p>'+
     '<div class="workspace-form"><label><span>'+t('أرسل هذا الأمر إلى البوت','Send this command to the bot')+'</span>'+
     '<textarea rows="3" readonly dir="ltr" spellcheck="false" id="v183-link-command"></textarea></label>'+
     '<button type="button" class="btn btn-primary" data-v183-copy-link>'+t('نسخ الأمر','Copy command')+'</button>'+
     '<a class="btn btn-plain" href="https://t.me/RadiusUchihabot" target="_blank" rel="noopener noreferrer">'+t('فتح بوت RADIUS','Open RADIUS bot')+'</a></div>');
    $('v183-link-command').value='/link '+code;
   }catch(error){reportError(error)}
   finally{setBusy(link,false)}
   return;
  }
  const copyLink=event.target.closest?.('[data-v183-copy-link]');
  if(copyLink){
   event.preventDefault();event.stopImmediatePropagation();
   const field=$('v183-link-command');if(!field)return;
   try{await navigator.clipboard.writeText(field.value);toast(t('تم نسخ أمر الربط.','Link command copied.'))}
   catch{field.focus();field.select();toast(t('انسخ الأمر المحدّد يدويًا.','Copy the selected command manually.'))}
   return;
  }
  const setup=event.target.closest?.('[data-v183-agent-setup]');
  if(setup){
   event.preventDefault();event.stopImmediatePropagation();
   if(state.me?.role!=='owner'||!state.me?.canWrite||!state.overview){
    reportError(Error(t('هذه العملية مخصصة لصاحب الشبكة بعد تحميل حالة الربط.','Only the network owner can perform this action after loading connection status.')));return;
   }
   const rotate=Boolean(state.overview.credentialConfigured);
   workspaceDialog(t('إعداد Site Agent','Site Agent setup'),
    '<p class="provider-note">'+t('ثبّت الوكيل على جهاز داخل شبكة المزود، واحتفظ ببيانات MikroTik محليًا. المفتاح يظهر مرة واحدة هنا فقط، ولا يُرسل عبر Telegram.','Install the agent inside your network. Keep MikroTik credentials locally. The key is displayed here once, never through Telegram.')+'</p>'+
    (rotate?'<p class="membership-callout">'+t('تنبيه: تدوير المفتاح يوقف الوكيل الحالي حتى تحديث إعداداته.','Warning: rotating the key disconnects existing agents until they receive the new key.')+'</p>':'')+
    '<form id="v183-agent-enroll" class="workspace-form">'+
    '<label><span>'+t('سبب الإصدار أو التدوير','Reason for issuing or rotating')+'</span><input name="reason" minlength="10" maxlength="500" autocomplete="off" required></label>'+
    '<label><span>'+t('اكتب كلمة التأكيد','Type confirmation')+' — '+(rotate?'ROTATE':'ISSUE')+'</span><input name="confirmation" pattern="'+(rotate?'ROTATE':'ISSUE')+'" autocomplete="off" autocapitalize="characters" required></label>'+
    '<button class="btn btn-primary" type="submit">'+(rotate?t('تدوير المفتاح','Rotate agent key'):t('إصدار مفتاح Site Agent','Issue Site Agent key'))+'</button>'+
    '<p class="form-error" id="v183-agent-error" role="alert"></p></form>');
   return;
  }
  const close=event.target.closest?.('[data-v183-close-key]');
  if(close){event.preventDefault();event.stopImmediatePropagation();$('v183-agent-key-dialog')?.close();return;}
  const copy=event.target.closest?.('[data-v183-copy-agent]');
  if(!copy)return;
  event.preventDefault();event.stopImmediatePropagation();
  const field=$('v183-one-time-agent-key');
  if(!field)return;
  try{
   if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(field.value);
   else{field.focus();field.select();document.execCommand('copy');}
   toast(t('تم نسخ المفتاح. احتفظ به في إعدادات الوكيل المحلية فقط.','Key copied. Store it only in the local agent configuration.'));
  }catch{field.focus();field.select();toast(t('حدّد المفتاح وانسخه يدويًا.','Select and copy the key manually.'));}
 },true);
 document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!(form instanceof HTMLFormElement)||form.id!=='v183-agent-enroll')return;
  event.preventDefault();event.stopImmediatePropagation();
  const error=$('v183-agent-error'),button=form.querySelector('[type="submit"]');
  if(state.me?.role!=='owner'||!state.me?.canWrite||!state.overview)return;
  const reason=String(new FormData(form).get('reason')||'').trim();
  const confirmation=String(new FormData(form).get('confirmation')||'').trim();
  const expect=state.overview.credentialConfigured?'ROTATE':'ISSUE';
  if(confirmation!==expect){if(error)error.textContent=t('كلمة التأكيد غير مطابقة.','Confirmation does not match.');return;}
  if(!window.confirm(expect==='ROTATE'?
    t('تأكيد: سيتوقف الوكيل الحالي حتى تحديث مفتاحه الجديد.','Confirm: existing agents will disconnect until updated with the new key.'):
    t('إصدار مفتاح جديد لهذه الشبكة؟','Issue a new key for this network?')))return;
  setBusy(button,true,t('جارٍ الإصدار…','Issuing…'));
  try{
   const issued=await apiRequest('/radius/credential',{method:'POST',body:{reason,confirmation},idempotent:true});
   const secret=String(issued.connectorSecret||'');
   if(secret.length<32)throw Error(t('تعذر عرض المفتاح؛ تواصل مع الإدارة قبل إعادة التدوير.','Key could not be displayed. Contact support before rotating again.'));
   $('workspace-dialog')?.close();
   const dialog=document.createElement('dialog');
   dialog.className='workspace-dialog';dialog.id='v183-agent-key-dialog';
   dialog.setAttribute('aria-label',t('المفتاح السري لمرة واحدة','One-time agent secret'));
   dialog.innerHTML='<h2>'+t('احتفظ بمفتاح Site Agent','Store your Site Agent key')+'</h2>'+
    '<p class="membership-callout">'+t('هذا المفتاح يظهر مرة واحدة، ويُمسح من الشاشة عند الإغلاق. لا تشاركه عبر تيليغرام.','This key appears only once and is cleared when this window closes. Never share it on Telegram.')+'</p>'+
    '<div class="workspace-form"><label><span>UCHIHA_TENANT_SLUG</span><input readonly dir="ltr" value="'+esc(issued.tenantSlug)+'"></label>'+
    '<label><span>RADIUS_AGENT_SIGNING_SECRET</span><textarea id="v183-one-time-agent-key" rows="3" readonly dir="ltr" spellcheck="false"></textarea></label>'+
    '<button type="button" class="btn btn-primary" data-v183-copy-agent>'+t('نسخ المفتاح','Copy key')+'</button>'+
    '<p class="provider-note">'+t('ضع القيمتين داخل ملف إعدادات الوكيل على جهاز الشبكة. شغّله ثم افحص النبضات الموقّعة هنا.','Place both values in the local agent configuration. Start it, then verify signed heartbeats here.')+'</p>'+
    '<button type="button" class="btn btn-plain" data-v183-close-key>'+t('إغلاق ومسح المفتاح','Close and clear key')+'</button></div>';
   document.body.appendChild(dialog);
   dialog.querySelector('#v183-one-time-agent-key').value=secret;
   dialog.addEventListener('close',()=>{const field=dialog.querySelector('#v183-one-time-agent-key');
    if(field){field.value='';field.textContent='';}dialog.remove();},{once:true});
   dialog.showModal();
   state.overview={...state.overview,credentialConfigured:true,agentConnected:false,agentsOnline:0,lastSeenAt:null};
   refresh().catch(err=>reportError(err));
  }catch(err){if(error)error.textContent=err.message;else reportError(err);}
  finally{setBusy(button,false);}
 },true);
 document.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-v183-edit-device]');
  if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(!v183CanCreate(state,'device')){reportError(Error(t('لا تملك صلاحية تعديل الأجهزة.','Device editing permission required.')));return;}
  const device=state.devices.find(item=>item.id===button.dataset.v183EditDevice);
  if(!device||!/^dev_[A-Za-z0-9_-]{8,55}$/.test(device.id))return;
  workspaceDialog(t('تصحيح بيانات MikroTik','Edit MikroTik device'),
   '<form class="workspace-form" id="v183-edit-device" data-id="'+esc(device.id)+'">'+
   '<p class="membership-callout">'+t('تغيير العنوان أو المنفذ يعيد حالة الجهاز إلى بانتظار الربط. لا يظهر متصلاً قبل وصول فحص RouterOS جديد.','Changing host or port resets the device to pending until a new verified RouterOS probe arrives.')+'</p>'+
   '<label><span>'+t('اسم الجهاز','Device name')+'</span><input name="name" required minlength="2" maxlength="100" value="'+esc(device.name)+'"></label>'+
   '<label><span>'+t('عنوان الجهاز لدى Site Agent','Address reachable by your Site Agent')+'</span><input name="host" dir="ltr" required pattern="[A-Za-z0-9.:-]{3,253}" value="'+esc(device.host)+'"></label>'+
   '<label><span>'+t('منفذ API-SSL (عادة 8729)','RouterOS API-SSL port (usually 8729)')+'</span><input name="port" type="number" required min="1" max="65535" value="'+esc(device.api_port||8729)+'"></label>'+
   '<label><span>'+t('سبب التصحيح','Reason')+'</span><textarea name="reason" required minlength="3" maxlength="500"></textarea></label>'+
   '<p class="provider-note">'+t('لا ترسل كلمات مرور MikroTik داخل الراديوس أو تيليغرام. عدّل إعدادات الوكيل المحلية عند تغيير عنوان الراوتر.','Never send RouterOS passwords in RADIUS or Telegram. Update local Site Agent settings when changing a router endpoint.')+'</p>'+
   '<button type="submit" class="btn btn-primary">'+t('حفظ التعديل','Save changes')+'</button>'+
   '<p id="v183-edit-device-error" role="alert" class="form-error"></p></form>');
 },true);
 document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!(form instanceof HTMLFormElement)||form.id!=='v183-edit-device')return;
  event.preventDefault();event.stopImmediatePropagation();
  if(!v183CanCreate(state,'device'))return;
  const id=form.dataset.id,device=state.devices.find(item=>item.id===id);
  if(!device)return;
  const data=new FormData(form),name=String(data.get('name')||'').trim(),
    host=String(data.get('host')||'').trim(),port=Number(data.get('port')),
    reason=String(data.get('reason')||'').trim(),alert=$('v183-edit-device-error'),
    button=form.querySelector('[type="submit"]');
  const changed=host!==device.host||port!==Number(device.api_port||8728);
  if(changed&&!window.confirm(t('سيتوقف عرض هذا الجهاز متصلاً حتى تهيئة الوكيل والتحقق من الاتصال مجددًا. هل تريد المتابعة؟',
    'Connection will reset to pending until your agent is reconfigured and verifies RouterOS again. Continue?')))return;
  setBusy(button,true,t('جارٍ حفظ التصحيح…','Saving…'));
  try{
   await apiRequest('/devices/'+encodeURIComponent(id),{method:'PATCH',
    body:{name,host,apiPort:port,connectionMethod:'agent',reason},idempotent:true});
   $('workspace-dialog')?.close();await refresh();
   toast(changed?t('تم التصحيح. يجب الآن تحديث إعدادات Site Agent المحلي.','Saved. Update your local Site Agent configuration.'):
     t('تم تحديث الجهاز.','Device updated.'));
  }catch(error){if(alert)alert.textContent=error.message;else reportError(error)}
  finally{setBusy(button,false);}
 },true);
 document.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-v183-create]');
  if(!button||!state.initialLiveReady)return;
  event.preventDefault();event.stopImmediatePropagation();
  const kind=button.dataset.v183Create;
  if(!forms[kind]||!v183CanCreate(state,kind)){reportError(Error(t('لا تملك صلاحية هذه العملية.','You do not have permission for this action.')));return;}
  workspaceDialog(names[kind],'<form id="v183-live-create" data-kind="'+kind+'">'+
   forms[kind]()+desc()+
   '<button type="submit" class="btn btn-primary">'+t('مراجعة وحفظ','Review and save')+'</button>'+
   '<p id="v183-live-create-error" role="alert" class="form-error"></p></form>');
 },true);
 document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!(form instanceof HTMLFormElement)||form.id!=='v183-live-create')return;
  event.preventDefault();event.stopImmediatePropagation();
  if(!state.initialLiveReady||!state.me?.canWrite)return;
  const kind=form.dataset.kind;
  if(!forms[kind]||!v183CanCreate(state,kind))return;
  const data=new FormData(form),text=name=>String(data.get(name)||'').trim();
  const numeric=name=>Number(text(name));
  const button=form.querySelector('[type="submit"]');
  const alert=form.querySelector('#v183-live-create-error');
  let route,body;
  try{
   if(kind==='site'){
    route='/sites';body={name:text('name'),code:text('code').toUpperCase()};
   }else if(kind==='plan'){
    const amount=numeric('price')*100;
    if(!Number.isFinite(amount)||Math.abs(amount-Math.round(amount))>0.00001)throw Error(t('السعر يجب ألا يتجاوز منزلتين عشريتين','Use at most two decimal places.'));
    route='/plans';body={name:text('name'),speedDownMbps:numeric('down'),speedUpMbps:numeric('up'),
     priceMinor:Math.round(amount),billingCycle:'monthly'};
   }else if(kind==='device'){
    route='/devices';body={name:text('name'),host:text('host'),apiPort:numeric('port'),connectionMethod:'agent'};
   }else if(kind==='reseller'){
    route='/resellers';body={name:text('name'),commissionBps:0};
   }else if(kind==='ticket'){
    route='/support/tickets';body={category:'network',priority:'medium',
     title:text('title'),description:text('description')};
   }else return;
   if(!window.confirm(t('تأكيد الحفظ الحقيقي داخل قاعدة شبكة مزودك؟','Save this record to your actual provider database?')))return;
   setBusy(button,true,t('جارٍ الحفظ...','Saving...'));
   const created=await apiRequest(route,{method:'POST',body,idempotent:true});
   $('workspace-dialog')?.close();
   await refresh();
   if(kind==='device'){
    workspaceDialog(t('خطوة لازمة: تشغيل MikroTik فعليًا','Required: connect your MikroTik'),
      '<p class="membership-callout">'+t('تم حفظ الجهاز في شبكتك فقط؛ حالته الآن «بانتظار الاتصال»، وليست «متصل».','Router added to your own network as pending, NOT connected.')+'</p>'+
      '<div class="workspace-form"><label><span>'+t('معرّف الجهاز اللازم في إعداد Site Agent','Device ID required in your local Site Agent config')+'</span>'+
      '<input readonly dir="ltr" value="'+esc(created.id)+'"></label>'+
      '<label><span>'+t('عنوان الراوتر','Router address')+'</span><input readonly dir="ltr" value="'+esc(created.host)+'"></label>'+
      '<p class="provider-note">'+t('شغّل Site Agent داخل نفس الشبكة، وأضف معرّف الجهاز والعنوان في ملف routers.json الخاص به، مع حساب RouterOS محلي وشهادة TLS موثوقة ومنفذ 8729. ثم تحقق من ظهوره متصلاً بعد اتصال TLS ناجح.','Install Site Agent inside the network, place this ID and host in its local routers.json alongside local RouterOS credentials and trusted TLS certificate on port 8729. Connection turns green only after a successful authenticated TLS probe.')+'</p>'+
      '<button class="btn btn-primary" type="button" data-v183-agent-setup>'+t('إصدار مفتاح Site Agent','Configure Site Agent')+'</button>'+
      '<button class="btn btn-plain" type="button" data-page="nas">'+t('عرض حالة الأجهزة','View devices')+'</button></div>');
   }else toast(t('تم الحفظ داخل قاعدة الشبكة.','Saved in your network database.'));
  }catch(error){
   if(alert)alert.textContent=error.message;
   else reportError(error);
  }finally{
   setBusy(button,false);
  }
 },true);
}
