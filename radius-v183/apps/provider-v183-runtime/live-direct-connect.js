/* Conventional MikroTik direct-connect flow, retaining the locked V1-83 UI.
 * Router secrets exist in a form only until the HTTPS request completes. */
function installV183DirectConnect(state,apiRequest,refresh,reportError,setBusy){
 if(state.directConnectInstalled)return;
 state.directConnectInstalled=true;
 const tr=(ar,en)=>t(ar,en),safe=v=>esc(String(v??''));
 document.addEventListener('click',async event=>{
  const button=event.target.closest?.('[data-v183-direct-choose],[data-v183-direct-connect],[data-v183-direct-verify]');
  if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(!v183CanCreate(state,'device')){
   reportError(Error(tr('هذه العملية مخصصة لإدارة الشبكة.','Network administrator access required.')));return;
  }
  if('v183DirectChoose' in button.dataset){
   workspaceDialog(tr('اختر الراوتر الذي تريد ربطه','Choose the actual router to connect'),
    '<p class="membership-callout">'+
     tr('السجلات المحفوظة لا تعني أن الأجهزة متصلة. اختر سجل الراوتر الرئيسي الموجود بدل إنشاء نسخ مكررة.',
       'Saved registrations do not prove hardware connectivity. Choose the existing main router record to avoid duplicates.')+'</p>'+
    '<div class="workspace-form">'+(state.devices.length?
      state.devices.map(row=>'<button type="button" class="btn btn-primary" data-v183-direct-connect="'+
       safe(row.id)+'">'+safe(row.name)+' · '+safe(row.host)+'</button>').join(''):
      '<button type="button" class="btn btn-primary" data-v183-create="device">'+
       tr('تسجيل أول راوتر','Register first router')+'</button>')+'</div>');
   return;
  }
  const id=button.dataset.v183DirectConnect||button.dataset.v183DirectVerify;
  const row=state.devices.find(device=>device.id===id);
  if(!row)return;
  if(button.dataset.v183DirectVerify){
   setBusy(button,true,tr('فحص راوتر MikroTik…','Probing MikroTik…'));
   try{
    const tested=await apiRequest('/devices/'+encodeURIComponent(id)+'/verify-direct',{method:'POST'});
    await refresh();
    workspaceDialog(tr('الراوتر متصل بالفعل','Router connection verified'),
      '<p class="membership-callout">'+tr('تم تسجيل الدخول فعليًا وقراءة اسم MikroTik عبر API-SSL المشفّر.',
       'TLS-verified RouterOS login and identity command succeeded.')+'</p>'+
      '<p>'+tr('اسم الجهاز:','Device identity:')+' '+safe(tested.identity)+'</p>'+
      '<button class="btn btn-primary" data-page="nas">'+tr('العودة للأجهزة','Back to routers')+'</button>');
   }catch(error){reportError(error)}
   finally{setBusy(button,false)}
   return;
  }
  let modes;
  try{modes=await apiRequest('/devices/direct-capabilities')}
  catch(error){reportError(error);return}
  workspaceDialog(tr('ربط MikroTik بالطريقة المباشرة','Direct MikroTik connection'),
   '<p class="membership-callout">'+
    tr('كما في أنظمة الراديوس المعتادة: أدخل عنوان الراوتر وحساب RouterOS، ثم اضغط اختبار الاتصال. لا يتم حفظ بيانات الدخول قبل نجاح اتصال مشفّر والتحقق من هوية الجهاز.',
      'Enter the router address and RouterOS account, then test. Credentials are not saved until TLS authentication and identity verification succeed.')+
   '</p>'+
   (!modes.ready?'<p class="membership-callout">'+
      tr('خادم الراديوس يحتاج مسار VPN مصرحًا للوصول المباشر. يمكن استخدام Site Agent داخل الشبكة الآن.',
         'The central server needs an authorized VPN route. An on-site agent remains available.')+'</p>':
    !modes.vpnEnabled?'<p class="provider-note">'+
      tr('الاتصال المباشر متاح للعناوين العامة القابلة للوصول فقط. العناوين الداخلية تتطلب VPN أو Site Agent؛ لا تكشف API-SSL للإنترنت دون حماية.',
         'Direct connection supports reachable public endpoints. Private LAN addresses require VPN or Site Agent. Protect public API-SSL.')+
      '</p>':'')+
   '<form id="v183-direct-connect-form" class="workspace-form" data-id="'+safe(id)+'">'+
    '<label><span>'+tr('سجل الجهاز المختار','Selected record')+'</span><input readonly dir="ltr" value="'+safe(id)+'"></label>'+
    '<label><span>'+tr('IP الراوتر الحقيقي أو اسمه','Real router IP or hostname')+
     '</span><input name="host" type="text" dir="ltr" required pattern="[A-Za-z0-9.:-]{3,253}" value="'+safe(row.host)+'"></label>'+
    '<label><span>'+tr('منفذ API-SSL المشفّر','Encrypted API-SSL port')+
     '</span><input name="port" type="number" required min="1024" max="65535" value="'+
       safe(row.api_port===8728?8729:(row.api_port||8729))+'"></label>'+
    '<label><span>'+tr('مستخدم RouterOS','RouterOS username')+
     '</span><input name="username" type="text" required minlength="1" maxlength="100" autocomplete="off" value="'+safe(row.username||'')+'"></label>'+
    '<label><span>'+tr('كلمة مرور الراوتر','Router password')+
     '</span><input name="password" type="password" required minlength="8" maxlength="500" autocomplete="new-password"></label>'+
    '<label><span>'+tr('اسم شهادة الراوتر (اختياري)','Router certificate DNS name (optional)')+
     '</span><input name="serverName" type="text" dir="ltr" pattern="[A-Za-z0-9.:-]{3,253}" placeholder="router.example.com"></label>'+
    '<label><span>'+tr('شهادة CA الموثوقة (للشهادة الخاصة فقط)','Trusted CA certificate (only for private CAs)')+
     '</span><textarea name="caPem" dir="ltr" rows="3" maxlength="20000" spellcheck="false" placeholder="-----BEGIN CERTIFICATE-----"></textarea></label>'+
    '<label><span>'+tr('سبب الربط','Connection reason')+
     '</span><input name="reason" required minlength="3" maxlength="500" value="'+tr('اختبار الراوتر الرئيسي وربطه مباشرة','Verify and connect main ISP router')+'"></label>'+
    '<label><input type="checkbox" name="owned" required> '+tr('أؤكد أن لديّ صلاحية إدارة هذا الراوتر','I am authorized to administer this router')+'</label>'+
    '<button type="submit" class="btn btn-primary"'+(!modes.ready?' disabled':'')+'>'+
     tr('اختبار الاتصال وحفظه عند النجاح','Test and connect securely')+'</button>'+
    '<p id="v183-direct-error" class="form-error" role="alert"></p></form>'+
    '<p class="provider-note">'+tr('فحص API-SSL يثبت وصول الإدارة إلى MikroTik. مصادقة مشتركي PPPoE/Hotspot تحتاج تهيئة RADIUS AAA بصورة منفصلة.',
     'API-SSL verifies router management. Subscriber PPPoE/Hotspot AAA must also be configured separately.')+'</p>');
 },true);
 document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!(form instanceof HTMLFormElement)||form.id!=='v183-direct-connect-form')return;
  event.preventDefault();event.stopImmediatePropagation();
  if(!v183CanCreate(state,'device'))return;
  const values=new FormData(form),id=form.dataset.id,
   name=key=>String(values.get(key)||'').trim(),button=form.querySelector('[type="submit"]'),
   message=form.querySelector('#v183-direct-error');
  if(!values.has('owned'))return;
  const body={host:name('host'),apiPort:Number(name('port')),username:name('username'),
   password:String(values.get('password')||''),caPem:name('caPem')||null,
   serverName:name('serverName')||null,reason:name('reason'),confirmedOwned:true};
  if(message)message.textContent='';
  setBusy(button,true,tr('جارٍ اختبار الاتصال الفعلي…','Testing actual RouterOS TLS connection…'));
  try{
   const linked=await apiRequest('/devices/'+encodeURIComponent(id)+'/direct-connect',{
    method:'POST',body
   });
   form.querySelector('[name="password"]').value='';
   form.querySelector('[name="caPem"]').value='';
   await refresh();
   $('workspace-dialog')?.close();
   workspaceDialog(tr('نجح الربط المباشر','Direct MikroTik connection successful'),
    '<p class="membership-callout">'+
      tr('تم فحص TLS وتسجيل الدخول وقراءة هوية RouterOS. لا حاجة إلى Site Agent لإدارة هذا الراوتر طالما بقي مسار الاتصال متاحًا.',
         'Verified TLS, RouterOS login and identity. Site Agent is not needed for this reachable management endpoint.')+'</p>'+
    '<p>'+tr('اسم الراوتر:','Router identity:')+' '+safe(linked.identity)+'</p>'+
    '<p>'+tr('آخر تحقق:','Verified at:')+' '+safe(linked.verifiedAt)+'</p>'+
    '<button class="btn btn-primary" data-page="nas">'+tr('عرض الجهاز','View router')+'</button>');
  }catch(error){
   if(message)message.textContent=error.message;
   else reportError(error);
  }finally{
   body.password='';
   setBusy(button,false);
  }
 },true);
}
