/* V1-83 live-only screens. The locked design source is never changed. */
function installV183LiveWorkspaces(state, apiRequest){
 const tr=(ar,en)=>t(ar,en);
 const num=x=>Number.isFinite(Number(x))?Number(x):0;
 const cash=x=>(num(x)/100).toFixed(2);
 const safe=x=>esc(String(x??'—'));
 const line=(label,value)=>workspaceLine(safe(label),safe(value));
 const section=(heading,content)=>'<section class="panel workspace-card"><h2>'+safe(heading)+'</h2>'+content+'</section>';
 const item=(heading,details,status)=>'<article class="panel workspace-card"><div class="entity"><div><h3>'+safe(heading)+'</h3><p class="muted">'+safe(details)+'</p></div></div>'+(status?'<span class="chip">'+safe(status)+'</span>':'')+'</article>';
 const action=(heading,kind)=>'<button class="btn btn-primary" type="button" data-v183-create="'+kind+'">'+safe(heading)+'</button>';
 const failure=route=>state.secondaryFailures.some(value=>value.startsWith(route));
 const listing=(data,render,route,ar,en)=>data.length?'<div class="workspace-grid">'+data.map(render).join('')+'</div>':
  '<p class="provider-note">'+(failure(route)?tr('تعذر جلب هذه البيانات من الخادم.','Server data unavailable; retry.'):tr(ar,en))+'</p>';
 providerPages.providers=()=>'<div class="plan-intro"><p>'+tr('الفروع المسجلة في شبكة مزودك','Your real network sites')+'</p>'+action(tr('إضافة فرع','Add site'),'site')+'</div>'+
  listing(state.sites,s=>item(s.name,(s.code||'—')+' • '+num(s.devices)+' '+tr('أجهزة','devices')+' • '+num(s.activeSessions)+' '+tr('جلسات','sessions'),s.status),'/sites','لا توجد فروع مسجلة.','No sites registered.');
 providerPages.plans=()=>'<div class="plan-intro"><p>'+tr('باقات الإنترنت في قاعدة بياناتك','Internet plans from your database')+'</p>'+action(tr('إضافة باقة','Add plan'),'plan')+'</div>'+
  listing(state.plans,p=>item(p.name,num(p.speedDownMbps)+'/'+num(p.speedUpMbps)+' Mbps · '+cash(p.priceMinor)+' '+(state.me?.currency||'USD'),p.status),'/plans','لا توجد باقات بعد.','No plans added.');
 providerPages.billing=()=>listing(state.invoices,i=>item(i.number||i.id,(i.subscriberName||'—')+' · '+cash(i.amountMinor)+' '+(i.currency||'USD')+' · '+tr('المدفوع','Paid')+': '+cash(i.paidMinor),i.status),'/invoices','لا توجد فواتير.','No invoices yet.');
 domainPages.nas=()=>'<div class="plan-intro"><p>'+tr('حالة الاتصال من آخر نبضة فعلية','Status from the last verified heartbeat')+'</p>'+action(tr('تسجيل MikroTik','Register MikroTik'),'device')+'</div>'+
  listing(state.devices,d=>item(d.name,(d.host||'—')+':'+(d.api_port||8728)+' · '+tr('آخر استجابة','Last heartbeat')+': '+(d.last_seen_at||'—'),d.status==='online'?tr('متصل','Online'):tr('غير متصل','Not connected')),'/devices','لا توجد راوترات مسجلة.','No routers registered.');
 providerPages.support=()=>'<div class="plan-intro"><p>'+tr('تذاكر الدعم الحقيقية','Actual support tickets')+'</p>'+action(tr('تذكرة جديدة','Create ticket'),'ticket')+'</div>'+
  listing(state.tickets,ticket=>item(ticket.title,ticket.description,ticket.status),'/support/tickets','لا توجد تذاكر دعم.','No support tickets.');
 providerPages.team=()=>listing(state.team,user=>item(user.displayName,user.role,user.status),'/team','لم يُضف أعضاء فريق بعد.','No team members added.');
 providerPages.telegram=()=>section(tr('تكامل تيليغرام','Telegram integration'),
  line(tr('بوت الإدارة','Management bot'),'@RadiusUchihabot')+
  line(tr('خدمة التنبيهات','Notification service'),state.integrations.find(i=>i.type==='telegram')?.status||'not_configured')+
  '<p class="muted">'+tr('بوت الإدارة يعمل مستقلاً؛ التنبيهات تحتاج تكاملًا مفعّلًا.','Management bot is separate; alerts require a configured integration.')+'</p>'+
  '<a href="https://t.me/RadiusUchihabot" target="_blank" rel="noopener noreferrer" class="btn btn-primary">'+tr('فتح بوت الإدارة','Open management bot')+'</a>');
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
  device:()=>field('name',t('اسم MikroTik','MikroTik name'),'text','minlength="2" maxlength="100"')+
   field('host',t('عنوان الراوتر الداخلي','Internal router address'),'text','pattern="[A-Za-z0-9.:-]{3,253}"')+
   '<p class="provider-note">'+t('سيُسجَّل كقيد الربط. لا نطلب كلمة مرور الراوتر؛ يلزم Site Agent داخل شبكتك لتأكيد الاتصال.','Registered as pending. Router credentials stay at your site, and a Site Agent is required for verified connectivity.')+'</p>',
  reseller:()=>field('name',t('اسم الوكيل','Reseller name'),'text','minlength="2" maxlength="120"'),
  ticket:()=>field('title',t('عنوان التذكرة','Ticket title'),'text','minlength="3" maxlength="160"')+
   '<label><span>'+t('التفاصيل','Description')+'</span><textarea name="description" minlength="5" maxlength="4000" required></textarea></label>'
 };
 const names={
  site:t('إضافة فرع','Add site'),plan:t('إضافة باقة','Add plan'),
  device:t('تسجيل MikroTik','Register MikroTik'),
  reseller:t('إضافة وكيل','Add reseller'),ticket:t('فتح تذكرة','Create ticket')
 };
 document.addEventListener('click',async event=>{
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
  const button=event.target.closest?.('[data-v183-create]');
  if(!button||!state.initialLiveReady)return;
  event.preventDefault();event.stopImmediatePropagation();
  const kind=button.dataset.v183Create;
  if(!forms[kind]||!state.me?.canWrite){reportError(Error(t('هذه العملية تتطلب صلاحية كتابة فعالة.','Active write permission is required.')));return;}
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
  if(!forms[kind])return;
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
    route='/devices';body={name:text('name'),host:text('host'),connectionMethod:'agent'};
   }else if(kind==='reseller'){
    route='/resellers';body={name:text('name'),commissionBps:0};
   }else if(kind==='ticket'){
    route='/support/tickets';body={category:'network',priority:'medium',
     title:text('title'),description:text('description')};
   }else return;
   if(!window.confirm(t('تأكيد الحفظ الحقيقي داخل قاعدة شبكة مزودك؟','Save this record to your actual provider database?')))return;
   setBusy(button,true,t('جارٍ الحفظ...','Saving...'));
   await apiRequest(route,{method:'POST',body,idempotent:true});
   $('workspace-dialog')?.close();
   await refresh();
   toast(kind==='device'?t('تم تسجيل MikroTik بانتظار الربط الحقيقي.','MikroTik registered; real connection remains pending.'):
    t('تم الحفظ داخل قاعدة الشبكة.','Saved in your network database.'));
  }catch(error){
   if(alert)alert.textContent=error.message;
   else reportError(error);
  }finally{
   setBusy(button,false);
  }
 },true);
}
