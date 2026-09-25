/* Read-only subscriber AAA diagnostics for a saved, verified direct router. */
function installV183RadiusReadiness(state,apiRequest,reportError,setBusy){
 if(state.aaaReadinessInstalled)return;
 state.aaaReadinessInstalled=true;
 const tr=(ar,en)=>t(ar,en),safe=v=>esc(String(v??'—'));
 const issueLabels={
  AAA_SERVER_NOT_ENABLED:["خدمة FreeRADIUS المركزية غير مفعّلة بعد.","Central FreeRADIUS service is not enabled."],
  ROUTER_RADIUS_SETTINGS_UNAVAILABLE:["تعذّر قراءة خوادم RADIUS على MikroTik.","Could not read the router's RADIUS servers."],
  ROUTER_RADIUS_SERVER_NOT_CONFIGURED:["لا يوجد خادم RADIUS مفعّل على الراوتر.","No enabled RADIUS server configured on the router."],
  PPPOE_SETTINGS_UNAVAILABLE:["تعذّر قراءة إعدادات PPPoE.","Could not read PPPoE settings."],
  PPPOE_RADIUS_DISABLED:["خاصية استخدام RADIUS للمشتركين في PPPoE غير مفعّلة.","PPPoE is not configured to use RADIUS."],
  HOTSPOT_SETTINGS_UNAVAILABLE:["تعذّر قراءة إعدادات Hotspot.","Could not read Hotspot settings."],
  HOTSPOT_RADIUS_DISABLED:["لا توجد إعدادات Hotspot مفعّلة لاستخدام RADIUS.","No Hotspot profile is enabled for RADIUS."],
  ROUTER_RADIUS_SERVICE_MISMATCH:["نوع خدمات RADIUS على MikroTik لا يطابق PPPoE أو Hotspot المفعّل.","Router RADIUS services do not match enabled PPPoE/Hotspot."]
 };
 const checked=(value,yesAr,yesEn,noAr,noEn)=>{
  if(value===null||value===undefined)return tr('غير معروف — لم يُتحقق','Unknown — not verified');
  return value?tr(yesAr,yesEn):tr(noAr,noEn);
 };
 document.addEventListener('click',async event=>{
  const button=event.target.closest?.('[data-v183-aaa-choose],[data-v183-aaa-check]');
  if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(!v183CanCreate(state,'device'))return;
  if('v183AaaChoose' in button.dataset){
   const records=state.devices.filter(row=>['api','vpn'].includes(row.connection_method));
   workspaceDialog(tr('فحص إعدادات RADIUS للمشتركين','Check subscriber RADIUS setup'),
    '<p class="membership-callout">'+
     tr('اتصال الإدارة إلى MikroTik وحده لا يعني أن اشتراكات PPPoE أو Hotspot تعمل. افحص إعدادات RADIUS الفعلية أولًا.',
       'A RouterOS management connection alone does not mean subscriber PPPoE/Hotspot AAA works. Inspect the real RADIUS configuration first.')+
    '</p><div class="workspace-form">'+(records.length?
     records.map(row=>'<button type="button" class="btn btn-primary" data-v183-aaa-check="'+safe(row.id)+'">'+
       safe(row.name)+' · '+safe(row.host)+'</button>').join(''):
     '<p>'+tr('لا يوجد راوتر موصول مباشرةً بعد. اربط الراوتر أولًا عبر API-SSL أو REST HTTPS.',
       'No saved direct MikroTik credentials yet. Complete an API-SSL or HTTPS REST pairing first.')+'</p>'+
     '<button class="btn btn-primary" data-v183-direct-choose>'+
       tr('الانتقال إلى الربط المباشر','Open direct pairing')+'</button>')+'</div>');
   return;
  }
  const id=button.dataset.v183AaaCheck;
  const device=state.devices.find(row=>row.id===id);
  if(!device||!['api','vpn'].includes(device.connection_method))return;
  setBusy(button,true,tr('قراءة إعدادات RADIUS من الراوتر…','Inspecting router RADIUS settings…'));
  try{
   const report=await apiRequest('/devices/'+encodeURIComponent(id)+'/radius-readiness',{method:'POST'});
   const serverLines=Array.isArray(report.radiusServers)?
     report.radiusServers.length?
      report.radiusServers.map(server=>'<div class="provider-note">'+
       safe(server.address)+':'+safe(server.authenticationPort)+' / '+safe(server.accountingPort)+
       ' · '+safe((server.services||[]).join(', '))+' · '+
       checked(server.enabled,'مفعّل','Enabled','معطّل','Disabled')+'</div>').join(''):
      '<p>'+tr('لا توجد خوادم RADIUS مضبوطة.','No configured RADIUS servers.')+'</p>':
     '<p>'+tr('تعذّر قراءة قائمة خوادم الراوتر.','Router RADIUS servers unavailable.')+'</p>';
   const findings=(report.issues||[]).map(code=>'<li>'+
     safe(issueLabels[code]?tr(...issueLabels[code]):tr('توجد مشكلة غير مصنّفة.','Unclassified issue.'))+'</li>').join('');
   workspaceDialog(tr('نتيجة فحص RADIUS الفعلي','Real RADIUS readiness results'),
    '<p class="membership-callout">'+tr('اتصال الإدارة: تم التحقق عبر ','Management verified via ')+
       safe(report.transport)+' · '+safe(report.routerIdentity)+'</p>'+
    '<div class="workspace-card"><h3>'+tr('خوادم RADIUS على الراوتر','RADIUS servers on router')+'</h3>'+
       serverLines+'</div>'+
    '<div class="workspace-card">'+
     '<p>'+tr('PPPoE: ','PPPoE: ')+safe(checked(report.pppoe?.useRadius,
       'استخدام RADIUS مفعّل','RADIUS enabled','غير مفعّل','Disabled'))+'</p>'+
     '<p>'+tr('Hotspot: ','Hotspot: ')+safe(checked(report.hotspot?.useRadius,
       'استخدام RADIUS مفعّل','RADIUS enabled','غير مفعّل','Disabled'))+'</p>'+
     '<p>'+tr('خادم FreeRADIUS المركزي: ','Central FreeRADIUS: ')+
       safe(checked(report.aaaServerConfigured,'مُعدّ بحسب حالة الخادم','Configured per server state',
       'غير مُفعّل','Not enabled'))+'</p></div>'+
    '<div class="workspace-card"><h3>'+tr('المطلوب قبل تشغيل المشتركين','Required before subscriber service')+'</h3>'+
     (findings?'<ul>'+findings+'</ul>':'<p>'+tr('لم يظهر نقص إعدادات في هذه القراءة؛ يلزم اختبار طلب مصادقة حقيقي.',
       'No configuration gaps detected, but a real AAA request must still be tested.')+'</p>')+
     '</div><p class="provider-note">'+tr('حتى عند تطابق جميع الإعدادات لا نعتبر PPPoE أو Hotspot فعّالًا دون تسجيل طلب مصادقة حقيقي. لا يعرض هذا الفحص كلمات المرور أو أسرار NAS ولا يغيّر إعدادات الراوتر.',
       'Matching settings are not proof of functioning PPPoE/Hotspot. A real RADIUS request must be recorded. No credentials are displayed and no router settings are changed.')+'</p>'+
     '<button class="btn btn-plain" type="button" data-page="radius">'+
       tr('عرض طلبات المصادقة الفعلية','View actual authentication events')+'</button>');
  }catch(error){reportError(error)}
  finally{setBusy(button,false)}
 },true);
}
