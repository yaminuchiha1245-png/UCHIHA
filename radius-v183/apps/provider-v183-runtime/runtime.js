function setupUchihaV183Runtime(){
 const TOKEN_KEY='uchiha_radius_v183_session';
 const TENANT_KEY='uchiha_radius_v183_tenant';
 const INSTALLATION_KEY='uchiha_radius_installation_id';
 const configuredBase=document.querySelector('meta[name="uchiha-api-base"]')?.content?.replace(/\/$/,'')||'';
 const apiPrefix=(configuredBase||'')+'/api/v1';
 const nativeRuntime=document.querySelector('meta[name="uchiha-runtime"]')?.content==='native';
 const releaseBuild=document.querySelector('meta[name="uchiha-build-channel"]')?.content==='release';
 const state={meta:null,token:null,tenantId:null,installationId:null,me:null,plans:[],sessions:[],loading:false,
  overview:null,report:null,diagnostics:null,sites:[],tickets:[],team:[],resellers:[],vouchers:[],nodes:[],
  integrations:[],timelines:{day:null,week:null},authEvents:[],payments:[],alerts:[],
  devices:[],invoices:[],extraLoaded:false,liveRevision:0,liveWorkspacesInstalled:false,devices:[],invoices:[],
  initialLiveReady:false,secondaryFailures:[],refreshInFlight:null};
 // The Telegram button supplies only a destination; API auth and tenant permissions
 // are still verified after opening the exact same V1-83 Mini App.
 const requestedOpen=new URLSearchParams(window.location.search).get('open')||'';
 const miniAppDestinations=Object.freeze({
  dashboard:['dashboard'],subscribers:['subscribers'],'add-subscriber':['subscribers','subscriber'],
  plans:['plans'],'add-plan':['plans','plan'],mikrotik:['nas'],'add-mikrotik':['nas','device'],
  'mikrotik-status':['radius'],'site-agent':['radius','agent-template'],
  sessions:['sessions'],invoices:['billing'],support:['support'],'add-ticket':['support','ticket'],
  reports:['reports'],sites:['providers'],'add-site':['providers','site'],
  vouchers:['vouchers'],resellers:['agents'],telegram:['telegram'],subscription:['subscription'],
 });
 let miniAppRouteConsumed=false;
 function openRequestedMiniAppRoute(){
  if(miniAppRouteConsumed||!state.initialLiveReady)return;
  miniAppRouteConsumed=true;
  const destination=miniAppDestinations[requestedOpen];
  if(!destination)return; // Invalid/untrusted links have no side effects.
  const [target,action]=destination;
  navigate(target);
  if(!action)return;
  const writeAllowed=action==='agent-template'?
   ['owner','admin'].includes(state.me?.role):
   state.me?.canWrite===true&&
   (action==='subscriber'||action==='ticket'?
    ['owner','admin','operator'].includes(state.me.role):state.me.role==='owner'||
    (action!=='agent'&&state.me.role==='admin'));
  if(!writeAllowed){
   toast(t('لا تسمح صلاحيات حسابك بهذه العملية.','Your account cannot perform this action.'));
   return;
  }
  if(action==='subscriber'){toggleAdd(true);return;}
  const targetSelector=action==='agent'?'[data-v183-agent-setup]':
   action==='agent-template'?'[data-v183-agent-template]':
   '[data-v183-create="'+action+'"]';
  const button=document.querySelector(targetSelector);
  if(button)button.click();
  else toast(t('تعذر فتح نموذج الإضافة؛ حدّث البيانات وحاول مجددًا.','The action is unavailable. Refresh and try again.'));
 }

 function uuid(){
  if(typeof crypto?.randomUUID==='function')return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
 }
 function readSession(key){try{return sessionStorage.getItem(key)}catch{return null}}
 function writeSession(key,value){try{value?sessionStorage.setItem(key,value):sessionStorage.removeItem(key)}catch{}}
 function readPersistent(key){try{return localStorage.getItem(key)}catch{return null}}
 function writePersistent(key,value){try{localStorage.setItem(key,value)}catch{}}
 async function installationId(){
  const plugin=window.Capacitor?.Plugins?.UchihaNative;
  if(nativeRuntime&&plugin?.getInstallationId){
   const result=await plugin.getInstallationId();
   if(result?.installationId)return result.installationId;
  }
  let value=readPersistent(INSTALLATION_KEY);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value||'')){
   value=uuid();writePersistent(INSTALLATION_KEY,value);
  }
  return value;
 }
 function idempotencyKey(){return uuid()}
 async function request(path,{method='GET',body,auth=true,idempotent=false}={}){
  const headers={accept:'application/json','x-installation-id':state.installationId,'x-uchiha-platform':nativeRuntime?'android':'web'};
  if(body!==undefined)headers['content-type']='application/json';
  if(auth&&state.token)headers.authorization=`Bearer ${state.token}`;
  if(auth&&state.tenantId)headers['x-tenant-id']=state.tenantId;
  if(idempotent)headers['idempotency-key']=idempotencyKey();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
   const response=await fetch(apiPrefix+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
   const payload=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(payload.error?.message||t('تعذر إكمال الطلب','Unable to complete the request'));
   return payload.data;
  }catch(error){
   if(error.name==='AbortError')throw Error(t('انتهت مهلة الاتصال بالخادم','Server request timed out'));
   throw error;
  }finally{clearTimeout(timer)}
 }
 function setBusy(button,busy,label){
  if(!button)return;button.disabled=busy;
  if(busy){button.dataset.runtimeLabel=button.textContent;button.textContent=label}
  else if(button.dataset.runtimeLabel){button.textContent=button.dataset.runtimeLabel;delete button.dataset.runtimeLabel}
 }
 function runtimeError(error){
  const message=error?.message||t('حدث خطأ غير متوقع','Unexpected error');
  toast(message);const banner=$('connection-banner');if(banner){banner.hidden=false;banner.textContent=message}
 }
 function nativePlugin(){return window.Capacitor?.Plugins?.UchihaNative||null}
 function routerDiscoveryView(){
  return `<div class="entity"><span class="stat-icon blue-bg">${art('router')}</span><div><h2>${t('إضافة MikroTik','Add MikroTik')}</h2><p class="muted">${t('اكتشاف آمن على شبكة Wi-Fi الحالية أو إدخال IP يدويًا','Secure discovery on the current Wi-Fi or manual IP entry')}</p></div></div><div id="router-discovery-status" class="provider-note" role="status">${t('اضغط اكتشاف للبحث عن الراوتر.','Tap discover to find the router.')}</div><div id="router-discovery-results"></div><form id="router-manual-form" class="workspace-form"><label><span>${t('عنوان IP اليدوي','Manual IP address')}</span><input name="host" inputmode="decimal" autocomplete="off" placeholder="192.168.88.1" required></label><label><span>${t('نوع الاتصال','Connection type')}</span><select name="transport"><option value="api">RouterOS API · 8728</option><option value="api-ssl">RouterOS API-SSL · 8729</option></select></label><div class="account-actions"><button type="button" class="btn btn-primary" data-router-discover>${actionArt('search')}${t('اكتشاف تلقائي','Auto discover')}</button><button type="submit" class="btn btn-plain">${actionArt('router')}${t('إضافة يدويًا','Add manually')}</button></div></form><p class="source-note">${t('لن تُحفظ كلمة مرور MikroTik في الصفحة أو localStorage. سيطلبها Android في نافذة أصلية مؤقتة.','The MikroTik password is never stored in the page or localStorage. Android requests it in a temporary native dialog.')}</p>`;
 }
 function openRouterWizard(){
  if(!nativePlugin()){
   runtimeError(Error(t('إضافة MikroTik المباشرة متاحة داخل تطبيق Android.','Direct MikroTik setup is available in the Android app.')));return;
  }
  workspaceDialog(t('ربط MikroTik','Connect MikroTik'),routerDiscoveryView());
 }
 async function discoverRouters(button){
  const plugin=nativePlugin(),status=$('router-discovery-status'),host=$('router-discovery-results');
  setBusy(button,true,t('جارٍ البحث…','Discovering…'));
  try{
   const result=await plugin.discoverRouters();const rows=result.routers||[];
   status.textContent=rows.length?t('اختر الراوتر المكتشف للمتابعة.','Choose a discovered router to continue.'):t('لم يظهر راوتر. يمكنك إدخال IP يدويًا.','No router was found. You can enter its IP manually.');
   host.innerHTML=rows.map(item=>`<button class="btn btn-plain" data-router-host="${esc(item.host)}" data-router-tls="${item.apiSsl&&!item.api}">${actionArt('router')}<span class="mono">${esc(item.host)}</span><small>${item.apiSsl?'API-SSL ':''}${item.api?'API ':''}</small></button>`).join('');
  }catch(error){runtimeError(error)}finally{setBusy(button,false)}
 }
 async function connectRouter(host,tls,button){
  const plugin=nativePlugin();if(!plugin)return;
  setBusy(button,true,t('جارٍ الاتصال…','Connecting…'));let credentialHandle=null;
  try{
   const credential=await plugin.requestRouterCredentials({host,tls});credentialHandle=credential.credentialHandle;
   const router=await plugin.verifyRouter({credentialHandle});
   await request('/devices',{method:'POST',idempotent:true,body:{name:router.identity||router.model||'MikroTik',branch:null,host:router.host,apiPort:router.tls?8729:8728,connectionMethod:'api',username:null,secret:null}});
   await loadLiveData();$('workspace-dialog')?.close();toast(t(`تم التحقق من ${router.identity} وإضافته.`,`Verified and added ${router.identity}.`));
  }catch(error){if(error?.code!=='ROUTER_LOGIN_CANCELLED')runtimeError(error)}finally{
   if(credentialHandle)await plugin.clearRouterCredentials({credentialHandle}).catch(()=>{});setBusy(button,false);
  }
 }
 function clearRuntimeError(){const banner=$('connection-banner');if(banner){banner.hidden=true;banner.textContent=''}}
 function sessionStatus(item){
  if(item.status==='pending')return 'pending';
  if(item.status==='suspended'||item.status==='expired')return 'suspended';
  if(item.status!=='active')return 'pending';
  if(item.serviceExpiresAt&&Date.parse(item.serviceExpiresAt)-Date.now()<=7*86400000)return 'expiring';
  return 'active';
 }
 function initialsFor(name){return String(name||'U').trim().split(/\s+/).map(part=>part[0]).slice(0,2).join('')}
 function mapLiveSubscriber(item,index,sessionBySubscriber){
  const live=sessionBySubscriber.get(item.id);
  const used=Number(item.usage?.usedBytes||0),limit=Number(item.usage?.limitBytes||0);
  return {
   id:index+1,backendId:item.id,sessionId:live?.id||null,name:item.fullName,en:item.fullName,
   initials:initialsFor(item.fullName),user:item.username,plan:item.plan?.name||t('بلا باقة','No plan'),
   planId:item.plan?.id||null,status:sessionStatus(item),access:'PPPoE / Hotspot',
   expires:item.serviceExpiresAt?.slice(0,10)||'—',usage:limit?Math.min(100,Math.round(used/limit*100)):0,
   usageBytes:used,remainingBytes:item.usage?.remainingBytes??null,balance:Number(item.balanceMinor||0)/100,
   online:Boolean(live),provider:'AC',ip:live?.framed_ip||'—',nas:live?.nas_ip||'—',tone:index%3===1?'violet':index%3===2?'aqua':''
  };
 }
 function mapLivePlan(item,index){
  return {backendId:item.id,name:item.name,down:Number(item.speedDownMbps),up:Number(item.speedUpMbps),
   quota:item.quotaBytes?Math.round(Number(item.quotaBytes)/1073741824):0,price:Number(item.priceMinor||0)/100,
   days:Number(item.durationDays||30),afterQuota:item.quotaAction==='throttle'?Number(item.throttleDownMbps||0):0,
   quotaAction:item.quotaAction,quotaPeriod:item.quotaPeriod,concurrent:Number(item.simultaneousUse||1),
   tone:['teal','blue','purple'][index%3],label:item.scopeType==='all'?['كل الشبكة','All network']:item.scopeType==='site'?['فرع محدد','Specific branch']:['راوتر محدد','Specific router']};
 }
 function updateProviderData(dashboard){
  const provider=providers[0];providers.splice(1);
  provider.name=state.me?.tenantName||provider.name;provider.subs=Number(dashboard.metrics?.subscribers||0);
  provider.sessions=Number(dashboard.metrics?.activeSessions||0);provider.nas=Number(dashboard.metrics?.devices||0);
  provider.healthy=Number(dashboard.metrics?.onlineDevices||0);provider.branches=state.sites.length;
  provider.health=provider.nas?Math.round(provider.healthy/provider.nas*100):0;
  provider.capacity=Math.min(100,Math.round(provider.sessions/Math.max(1,provider.subs)*100));
  provider.revenue=Number(state.report?.billing?.collectedMinor||0)/100;
  const measured=Number(state.overview?.last24Hours?.authenticationRequests||0);
  provider.auth=measured?Math.round(1000*Number(state.overview.last24Hours.accepted||0)/measured)/10:0;
  const delays=state.authEvents.filter(e=>Number.isFinite(e.latencyMs)&&e.latencyMs>=0);
  provider.latency=delays.length?Math.round(delays.reduce((sum,e)=>sum+e.latencyMs,0)/delays.length):0;
  provider.state=provider.nas===0?'watch':provider.health<80?'degraded':provider.health<100?'watch':'stable';
  const name=state.me?.tenantName||'UCHIHA RADIUS';
  document.querySelector('.drawer-profile b').textContent=state.me?.user?.displayName||t('حساب المزود','Provider account');
  document.querySelector('.drawer-profile small').textContent=name;
 }
 function updatePlanData(items){
  state.plans=items;const mapped=items.map(mapLivePlan);internetPlans.splice(0,internetPlans.length,...mapped);
  accountPlans.splice(0,accountPlans.length,...mapped.map(item=>item.name));
  comparedPlans=mapped.slice(0,Math.min(2,mapped.length)).map(item=>item.name);
  const select=$('add-form')?.elements?.plan;
  if(select)select.innerHTML=mapped.map(item=>`<option value="${esc(item.backendId)}">${esc(item.name)}</option>`).join('');
 }
 function updateDeviceData(items){
  const mapped=items.map(item=>({id:item.id,tenant:'AC',ip:item.host,site:[item.branch||item.name,item.branch||item.name],
   online:item.status==='online',sessions:state.sessions.filter(session=>session.device_id===item.id&&session.status==='active').length,
   last:item.last_seen_at?new Date(item.last_seen_at).toLocaleTimeString(lang==='ar'?'ar':'en',{hour:'2-digit',minute:'2-digit'}):'—',
   latency:null,cpu:null,memory:null,service:'PPPoE / Hotspot',event:item.status==='online'?["الجهاز متصل بالخادم.","Device connected to the server."]:["لا توجد استجابة حديثة.","No recent response."]}));
  nasDevices.splice(0,nasDevices.length,...mapped);
 }
 function updateBillingData(items){
  const byBackend=new Map(subscribers.map(item=>[item.backendId,item.id]));
  const mapped=items.filter(item=>byBackend.has(item.subscriberId)).map(item=>({id:item.number||item.id,backendId:item.id,
   person:byBackend.get(item.subscriberId),issued:(item.createdAt||'').slice(0,10),due:(item.dueAt||'').slice(0,10),
   amount:Number(item.amountMinor||0)/100,paid:Number(item.paidMinor||0)/100,plan:'—',
   period:[`${(item.periodStart||'').slice(0,10)} — ${(item.periodEnd||'').slice(0,10)}`,`${(item.periodStart||'').slice(0,10)} — ${(item.periodEnd||'').slice(0,10)}`],payment:null}));
  billingInvoices.splice(0,billingInvoices.length,...mapped);
 }
 function updateAuthData(items){
  const mapped=items.map(item=>({time:new Date(item.occurredAt).toLocaleTimeString(lang==='ar'?'ar':'en',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
   user:item.username,nas:item.nasIp||'—',result:item.result==='accept'?'Accept':item.result==='reject'?'Reject':'Timeout',
   reason:[item.reason||'—',item.reason||'—']}));authSample.splice(0,authSample.length,...mapped);
 }
 async function loadLiveData(){
  if(!state.me?.tenantId)return;
  if(state.refreshInFlight)return state.refreshInFlight;
  state.refreshInFlight=(async()=>{
   clearRuntimeError();state.secondaryFailures=[];
   const collector=state.me.role==='collector';
   const required=[
    ['/dashboard',true],['/subscribers?limit=100',true],
    ['/sessions?limit=100',!collector],['/plans',true],['/devices',!collector],
    ['/invoices?limit=100',true],['/radius/auth-events?limit=100',!collector],
   ];
   const [dashboard,subscriberData,sessionData,planData,deviceData,invoiceData,authData]=
    await Promise.all(required.map(([path,allowed])=>allowed?request(path):Promise.resolve({items:[]})));
   state.authEvents=authData.items||[];
   state.sessions=sessionData.items||[];
   const activeBySubscriber=new Map();
   for(const item of state.sessions)if(item.status==='active'&&item.subscriber_id&&!activeBySubscriber.has(item.subscriber_id))activeBySubscriber.set(item.subscriber_id,item);
   subscribers=(subscriberData.items||[]).map((item,index)=>mapLiveSubscriber(item,index,activeBySubscriber));
   state.devices=deviceData.items||[];state.invoices=invoiceData.items||[];
   updatePlanData(planData.items||[]);updateDeviceData(state.devices);
   updateBillingData(state.invoices);updateAuthData(state.authEvents);
   // Clear all hardcoded preview records BEFORE exposing the authenticated workspace.
   inboxAlerts.splice(0);supportTickets.splice(0);providerTeam.splice(0);
   resellerSample.splice(0);batchSample.splice(0);
   const extra=[
    ['/sites','sites'],['/devices/connection-diagnostics','diagnostics'],['/support/tickets?limit=100','tickets'],
    ['/team','team'],['/resellers','resellers'],
    ['/voucher-batches?limit=100','vouchers'],['/radius/nodes','nodes'],
    ['/integrations','integrations'],['/alerts?limit=100','alerts'],
    ['/reports/summary','report'],['/radius/overview','overview'],
    ['/reports/sessions-timeline?period=day','dayTimeline'],
    ['/reports/sessions-timeline?period=week','weekTimeline'],
    ['/payments?limit=100','payments'],
   ];
   const snapshots=await Promise.all(extra.map(async([path,key])=>{
    const restricted=collector&&['sites','nodes','integrations','overview','diagnostics'].includes(key);
    const ownerOnly=key==='team'&&state.me.role!=='owner';
    if(restricted||ownerOnly)return [key,null];
    try{return [key,await request(path)]}
    catch(error){state.secondaryFailures.push(path);return [key,null]}
   }));
   for(const [key,data] of snapshots){
    if(key==='dayTimeline')state.timelines.day=data;
    else if(key==='weekTimeline')state.timelines.week=data;
    else if(key==='report'||key==='overview'||key==='diagnostics')state[key]=data;
    else state[key]=data?.items||[];
   }
   installV183LiveWorkspaces(state,request);
   installV183LiveCharts(state);
   installV183LiveDashboard(state);
   installV183LiveActions(state,request,loadLiveData,runtimeError,setBusy);
   updateProviderData(dashboard);
   document.body.dataset.runtime='live';
   document.body.dataset.preview='off';
   state.initialLiveReady=true;
   invalidateDataCachesV18();
   workspaceDomCacheV18.clear();
   renderDashboard();renderSubscribers();renderSessions();
   if(workspaces[page])renderWorkspace();
   if(state.secondaryFailures.length)runtimeError(Error(t('تعذر تحديث بعض بيانات الخادم. لا نعرض أرقامًا افتراضية.','Some live data could not load. No sample figures are shown.')));
  })().catch(error=>{runtimeError(error);throw error}).finally(()=>{state.refreshInFlight=null});
  return state.refreshInFlight;
 }
 async function establishSession(login){
  if(login?.token){state.token=login.token;writeSession(TOKEN_KEY,state.token)}
  // The signed Telegram login selects the member's explicitly linked network;
  // an older browser session must never redirect a different provider's token.
  state.tenantId=login?.tenantId||readSession(TENANT_KEY);
  if(login?.tenantId)writeSession(TENANT_KEY,state.tenantId);
  state.me=await request('/auth/me');
  if(!state.tenantId&&state.me.tenantId){state.tenantId=state.me.tenantId;writeSession(TENANT_KEY,state.tenantId);state.me=await request('/auth/me')}
  // Never reveal the legacy preview's example figures before real API hydration.
  await loadLiveData();signedInPreview=true;enterBrowse();renderAccessStrip();
  openRequestedMiniAppRoute();
  if(state.me.role==='owner'&&!state.me.canWrite)showMembership();
 }
 async function googleCredential(){
  if(nativeRuntime){
   if(!window.UchihaNativeAuth)throw Error(t('تسجيل Google الأصلي غير متاح','Native Google sign-in is unavailable'));
   return window.UchihaNativeAuth.signInWithGoogle(state.meta.googleClientId);
  }
  if(!window.google?.accounts?.id){
   await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.onload=resolve;script.onerror=reject;document.head.append(script)});
  }
  return new Promise((resolve,reject)=>{
   let settled=false;
   google.accounts.id.initialize({client_id:state.meta.googleClientId,callback:result=>{settled=true;resolve(result.credential)}});
   google.accounts.id.prompt(notification=>{if(!settled&&notification.isNotDisplayed?.())reject(Error(t('تعذر فتح تسجيل Google','Unable to open Google sign-in'))) });
  });
 }
 async function login(button){
  if(state.meta?.telegramLoginAvailable&&!state.meta?.googleClientId&&!state.meta?.devAuthAvailable){
   const name=state.meta.telegramBotUsername;
   if(name){window.open('https://t.me/'+encodeURIComponent(name),'_blank','noopener,noreferrer');return}
   runtimeError(Error(t('افتح التطبيق من بوت تيليغرام الخاص بالراديوس.','Open this app from the RADIUS Telegram bot.')));return;
  }
  setBusy(button,true,t('جارٍ تسجيل الدخول…','Signing in…'));
  try{
   const loginData=state.meta.devAuthAvailable&&!state.meta.googleClientId
    ? await request('/auth/dev',{method:'POST',body:{mode:'provider'},auth:false})
    : await request('/auth/google',{method:'POST',body:{credential:await googleCredential()},auth:false});
   await establishSession(loginData);
  }catch(error){runtimeError(error)}finally{setBusy(button,false)}
 }
 async function redeemActivation(button){
  const input=$('activation-code-preview'),result=$('activation-code-preview-result');
  const activationCode=String(input?.value||'').trim().toUpperCase();
  if(!/^UCHI(?:-[A-HJ-NP-Z2-9]{4}){4}$/.test(activationCode)){
   if(result){result.className='activation-code-result is-invalid';result.textContent=t('صيغة كود التفعيل غير صالحة.','Invalid activation code format.')}
   return;
  }
  setBusy(button,true,t('جارٍ التحقق…','Checking…'));
  try{
   await request('/subscriptions/redeem',{method:'POST',body:{activationCode},idempotent:true});
   state.me=await request('/auth/me');renderAccessStrip();
   if(result){result.className='activation-code-result is-valid';result.textContent=t('تم تفعيل الاشتراك بنجاح.','Subscription activated successfully.')}
   setTimeout(()=>{$('workspace-dialog')?.close();$('membership-dialog')?.close()},700);await loadLiveData();
  }catch(error){if(result){result.className='activation-code-result is-invalid';result.textContent=error.message}else runtimeError(error)}finally{setBusy(button,false)}
 }
 function liveStrip(){
  const subscription=state.me?.subscription;
  if(state.me?.canWrite)return `<div class="subscription-main">${art('membership')}<div class="subscription-copy"><b>${t('اشتراك UCHIHA RADIUS','UCHIHA RADIUS subscription')}</b><span class="subscription-status">${t('فعّال','Active')}</span><p>${esc(subscription?.productName||'')} · ${subscription?.endsAt?date(subscription.endsAt.slice(0,10)):t('بلا تاريخ انتهاء','No expiry')}</p></div></div>`;
  return `<div class="subscription-main">${art('membership')}<div class="subscription-copy"><b>${t('اشتراك UCHIHA RADIUS','UCHIHA RADIUS subscription')}</b><span class="subscription-status">${t('بانتظار كود التفعيل','Waiting for activation code')}</span><p>${t('أدخل كود الإدارة لفتح التشغيل الكامل','Enter the admin code to enable full operation')}</p></div></div><div class="access-actions"><button class="btn btn-plain activation-code-trigger" data-activation-code>${art('activation-code','activation-code-art')}<span>${t('إضافة كود','Enter code')}</span></button><button class="btn whatsapp-code-trigger" data-request-code>${art('whatsapp-request','whatsapp-request-art')}<span>${t('طلب الكود','Request code')}</span></button></div>`;
 }
 renderAccessStrip=function(){const host=$('access-strip');if(host)host.innerHTML=liveStrip()};
 canOperate=function(){return state.me?.canWrite===true};
 providerPages.subscription=()=>`<section class="panel workspace-card"><div class="entity"><span class="stat-icon green-bg">${art('membership')}</span><div><h2>${t('اشتراك المنصة','Platform subscription')}</h2><p class="muted">${esc(state.me?.tenantName||'')}</p></div></div>${workspaceLine(t('الحالة','Status'),state.me?.canWrite?t('فعّال','Active'):t('بانتظار كود التفعيل','Waiting for activation code'))}${workspaceLine(t('الباقة','Plan'),esc(state.me?.subscription?.productName||'—'))}${workspaceLine(t('تاريخ الانتهاء','Expires'),state.me?.subscription?.endsAt?date(state.me.subscription.endsAt.slice(0,10)):'—')}<button class="btn btn-primary" data-activation-code>${t('إضافة كود التفعيل','Enter activation code')}</button><button class="btn whatsapp-code-trigger" data-request-code>${art('whatsapp-request','whatsapp-request-art')}${t('طلب الكود عبر واتساب','Request code via WhatsApp')}</button></section>`;

 function ensureSubscriberCredentialField(){
  const form=$('add-form');if(!form||form.elements.radiusPassword)return;
  const username=form.elements.username?.closest('label');if(!username)return;
  username.insertAdjacentHTML('afterend',`<label><span>${t('كلمة مرور الاتصال','Connection password')}</span><input name="radiusPassword" type="password" minlength="8" maxlength="128" required autocomplete="new-password"></label>`);
 }
 async function createLiveSubscriber(form){
  const data=new FormData(form),button=form.querySelector('[type="submit"]');setBusy(button,true,t('جارٍ الحفظ…','Saving…'));
  try{
   await request('/subscribers',{method:'POST',idempotent:true,body:{fullName:String(data.get('name')).trim(),username:String(data.get('username')).trim(),radiusPassword:String(data.get('radiusPassword')||''),planId:String(data.get('plan')||'')||null}});
   form.reset();toggleAdd(false);await loadLiveData();toast(t('تمت إضافة المشترك وربطه بالباقة.','Subscriber added and linked to the plan.'));
  }catch(error){$('form-error').textContent=error.message}finally{setBusy(button,false)}
 }
 async function runAccountAction(form){
  const item=subscribers.find(value=>value.id===Number(form.dataset.id));if(!item)return;
  const data=Object.fromEntries(new FormData(form)),action=form.dataset.action,reason=String(data.reason||'').trim();
  const button=form.querySelector('[type="submit"]');setBusy(button,true,t('جارٍ التنفيذ…','Working…'));
  try{
   if(action==='renew')await request(`/subscribers/${item.backendId}/renew`,{method:'POST',body:{reason},idempotent:true});
   else if(action==='plan'){
    const plan=state.plans.find(value=>value.name===data.plan);if(!plan)throw Error(t('الباقة غير موجودة','Plan not found'));
    await request(`/subscribers/${item.backendId}`,{method:'PATCH',body:{planId:plan.id},idempotent:true});
   }else if(action==='suspend'||action==='resume'){
    await request(`/subscribers/${item.backendId}/${action==='resume'?'activate':'suspend'}`,{method:'POST',body:{reason},idempotent:true});
   }else if(action==='disconnect'){
    if(!item.sessionId)throw Error(t('لا توجد جلسة نشطة','No active session'));
    await request(`/sessions/${item.sessionId}/disconnect`,{method:'POST',body:{reason},idempotent:true});
   }
   $('workspace-dialog')?.close();await loadLiveData();toast(t('تم تنفيذ العملية وتسجيلها.','Operation completed and audited.'));
  }catch(error){const host=$('account-error');if(host)host.textContent=error.message;else runtimeError(error)}finally{setBusy(button,false)}
 }
 window.addEventListener('click',event=>{
  const button=event.target.closest?.('button');if(!button)return;
  if(button.hasAttribute('data-link-nas')){
   event.preventDefault();event.stopImmediatePropagation();if(canOperate())openRouterWizard();else showMembership();return;
  }
  if(button.hasAttribute('data-router-discover')){
   event.preventDefault();event.stopImmediatePropagation();discoverRouters(button);return;
  }
  if(button.hasAttribute('data-router-host')){
   event.preventDefault();event.stopImmediatePropagation();connectRouter(button.dataset.routerHost,button.dataset.routerTls==='true',button);return;
  }
 },true);
 document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.id==='google-preview'){
   // Live deployments must never fall back to the original mock preview.
   // Fail closed when the real API is unavailable.
   if(!state.meta){event.preventDefault();event.stopImmediatePropagation();runtimeError(Error(t('خادم UCHIHA RADIUS غير متاح الآن. حاول مجددًا.','UCHIHA RADIUS server is unavailable. Try again.')));return}
   event.preventDefault();event.stopImmediatePropagation();login(button);return;
  }
  if(button.hasAttribute('data-activation-code-submit')){
   event.preventDefault();event.stopImmediatePropagation();redeemActivation(button);
  }
 },true);
 document.addEventListener('submit',event=>{
  const form=event.target;if(!(form instanceof HTMLFormElement)||!canOperate())return;
  if(form.id==='add-form'){
   event.preventDefault();event.stopImmediatePropagation();createLiveSubscriber(form);
  }else if(form.id==='account-action-form'){
   event.preventDefault();event.stopImmediatePropagation();runAccountAction(form);
  }else if(form.id==='router-manual-form'){
   event.preventDefault();event.stopImmediatePropagation();const data=new FormData(form);
   connectRouter(String(data.get('host')||'').trim(),data.get('transport')==='api-ssl',form.querySelector('[type="submit"]'));
  }
 },true);
 window.addEventListener('online',()=>{clearRuntimeError();if(state.token)loadLiveData()});

 async function bootRuntime(){
  const googleButton=$('google-preview');
  googleButton?.querySelector('.google-label')?.remove();
  googleButton?.querySelector('[data-ar]')?.setAttribute('data-ar',releaseBuild&&!nativeRuntime?'فتح بوت UCHIHA RADIUS':'متابعة باستخدام Google');
  googleButton?.querySelector('[data-en]')?.setAttribute('data-en',releaseBuild&&!nativeRuntime?'Open the UCHIHA RADIUS bot':'Continue with Google');
  if(releaseBuild&&!nativeRuntime){
   const disclosure=document.querySelector('.entry-disclosure');
   if(disclosure){disclosure.setAttribute('data-ar','سجّل الدخول عبر بوت تيليغرام الموثّق.');disclosure.setAttribute('data-en','Sign in through the verified Telegram bot.');}
  }
  translateStatic();
  try{
   state.installationId=await installationId();state.meta=await request('/meta',{auth:false});
   state.token=readSession(TOKEN_KEY);state.tenantId=readSession(TENANT_KEY);ensureSubscriberCredentialField();
   const telegram=window.Telegram?.WebApp;
   if(telegram?.initData){
    if(!state.meta.telegramLoginAvailable)throw Error(t('دخول تيليغرام غير متاح حاليًا.','Telegram sign-in is not available.'));
    googleButton?.setAttribute('hidden','');
    telegram.ready?.();telegram.expand?.();
    // Never use initDataUnsafe or trust a Telegram-supplied ID. The API verifies
    // Telegram's HMAC and checks this identity's explicit provider membership.
    const signed=await request('/auth/telegram',{method:'POST',body:{initData:telegram.initData},auth:false});
    await establishSession(signed);
    return;
   }
   if(state.meta.devAuthAvailable&&!state.meta.googleClientId){
    googleButton?.querySelector('[data-ar]')?.setAttribute('data-ar','دخول تجريبي آمن');
    googleButton?.querySelector('[data-en]')?.setAttribute('data-en','Secure preview login');
   }else if(state.meta.telegramLoginAvailable&&!state.meta.googleClientId){
    googleButton?.querySelector('[data-ar]')?.setAttribute('data-ar','فتح بوت UCHIHA RADIUS');
    googleButton?.querySelector('[data-en]')?.setAttribute('data-en','Open the UCHIHA RADIUS bot');
    const disclosure=document.querySelector('.entry-disclosure');
    if(disclosure){disclosure.setAttribute('data-ar','تسجيل الدخول عبر بوت تيليغرام الموثّق فقط.');disclosure.setAttribute('data-en','Sign in through the verified Telegram bot only.');}
   }
   translateStatic();
   if(state.token){try{await establishSession({token:state.token})}catch{state.token=null;state.tenantId=null;writeSession(TOKEN_KEY,null);writeSession(TENANT_KEY,null)}}
  }catch(error){runtimeError(error)}
 }
 queueMicrotask(bootRuntime);
}
