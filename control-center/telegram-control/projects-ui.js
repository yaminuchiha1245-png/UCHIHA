(function(){
'use strict';
var TYPES={app:'📱 تطبيق',website:'🌐 موقع',bot:'🤖 بوت',bundle:'🧩 مشروع متكامل',service:'⚙️ خدمة'};
var projectFilter='all';
function gi(id){return document.getElementById(id)}
function icon(s){return s==='online'?'🟢':s==='partial'?'🟡':s==='offline'?'🔴':'⚪️'}
function runtimeLines(p){return (p.runtime||[]).map(function(x){return x.kind+':'+x.name}).join('\n')}
function parseRuntime(text){return String(text||'').split(/\n+/).map(function(x){return x.trim()}).filter(Boolean).map(function(line){var i=line.indexOf(':');return i>0?{kind:line.slice(0,i).trim(),name:line.slice(i+1).trim()}:null}).filter(Boolean)}
function localDateInput(v){if(!v)return '';var d=new Date(v);if(Number.isNaN(d.getTime()))return '';var z=new Date(d.getTime()-d.getTimezoneOffset()*60000);return z.toISOString().slice(0,16)}
function selectedProject(){return new URLSearchParams(location.search).get('project')||''}
function formInput(id,placeholder,value,type){return '<input id="'+id+'" type="'+(type||'text')+'" value="'+esc(value||'')+'" placeholder="'+esc(placeholder)+'">'}
function typeSelect(id,value){
  var items=[['app','📱 تطبيق'],['website','🌐 موقع'],['bot','🤖 بوت'],['bundle','🧩 مشروع متكامل'],['service','⚙️ خدمة']];
  return '<select id="'+id+'">'+items.map(function(x){return '<option value="'+x[0]+'"'+(x[0]===value?' selected':'')+'>'+x[1]+'</option>'}).join('')+'</select>';
}
function listHtml(rows){
  if(!rows.length)return empty('لا توجد مشاريع.');
  return rows.map(function(p){
    var b=p.billing||{};
    return '<div class="row" onclick="openProjectEditor(\''+p.id+'\')" style="cursor:pointer">'+
      '<div class="rowtop"><span style="font-size:18px">'+icon(p.liveStatus)+'</span><div class="name">'+esc(p.name)+'</div><span class="pill">'+esc(TYPES[p.type]||p.type)+'</span></div>'+
      '<div class="meta">العميل: '+esc(p.client||'—')+' · الحالة: '+esc(p.liveStatus)+'<br>'+
      'الإصدار: <b>'+esc(p.currentVersion||'غير مسجل')+'</b> · التحديثات: '+(p.versions||[]).length+'<br>'+
      'شهريًا: <b>'+esc(b.monthlyFee||0)+' '+esc(b.currency||'USD')+'</b> · الاستحقاق يوم '+esc(b.dueDay||1)+
      (p.expiresAt?'<br>⏱ إيقاف تلقائي: <span class="code">'+esc(p.expiresAt)+'</span>':'')+'</div></div>';
  }).join('');
}
function renderManagedProjects(){
  var rows=(DATA&&DATA.managedProjects)||[];
  var selected=selectedProject();
  if(selected&&rows.some(function(x){return x.id===selected})){openProjectEditor(selected,true);return}
  var monthly=rows.reduce(function(a,p){return a+Number((p.billing||{}).monthlyFee||0)},0);
  var due=((DATA&&DATA.billingAlerts)||[]).reduce(function(a,p){return a+Number(p.monthlyFee||0)},0);
  var html='';
  html+='<div class="section-title"><h2>مشاريعي</h2><span>'+rows.length+'</span></div>';
  html+='<div class="grid">';
  html+='<div class="card"><div class="k">📱 التطبيقات</div><div class="v">'+rows.filter(function(x){return x.type==='app'}).length+'</div></div>';
  html+='<div class="card"><div class="k">🌐 المواقع</div><div class="v">'+rows.filter(function(x){return x.type==='website'}).length+'</div></div>';
  html+='<div class="card"><div class="k">🤖 البوتات</div><div class="v">'+rows.filter(function(x){return x.type==='bot'}).length+'</div></div>';
  html+='<div class="card"><div class="k">🧩 الكل</div><div class="v">'+rows.length+'</div></div>';
  html+='<div class="card wide"><div class="k">💰 إجمالي القيم الشهرية المسجلة</div><div class="v">'+monthly.toFixed(2)+'</div><div class="s">قد تكون المشاريع بعملات مختلفة</div></div>';
  html+='<div class="card wide"><div class="k">🔴 مستحقات متأخرة</div><div class="v">'+due.toFixed(2)+'</div><div class="s">'+(((DATA&&DATA.billingAlerts)||[]).length)+' مشروع</div></div>';
  html+='</div>';
  html+='<div class="actions" style="flex-wrap:wrap;margin:12px 0"><button class="btn '+(projectFilter==='all'?'':'secondary')+'" onclick="setProjectFilter(\'all\')">الكل</button><button class="btn '+(projectFilter==='app'?'':'secondary')+'" onclick="setProjectFilter(\'app\')">📱 التطبيقات</button><button class="btn '+(projectFilter==='website'?'':'secondary')+'" onclick="setProjectFilter(\'website\')">🌐 المواقع</button><button class="btn '+(projectFilter==='bot'?'':'secondary')+'" onclick="setProjectFilter(\'bot\')">🤖 البوتات</button><button class="btn '+(projectFilter==='bundle'?'':'secondary')+'" onclick="setProjectFilter(\'bundle\')">🧩 المتكاملة</button></div>';
  html+='<details style="margin-top:12px"><summary class="row" style="cursor:pointer;font-weight:800">➕ إضافة مشروع جديد</summary>';
  html+='<form id="newProjectForm"><div class="fields">'+
    formInput('npId','project-id','','text')+formInput('npName','اسم المشروع','','text')+typeSelect('npType','app')+
    formInput('npClient','اسم العميل','','text')+formInput('npRepo','owner/repository','','text')+formInput('npBranch','branch','main','text')+
    formInput('npDomain','domain.com','','text')+
    '<textarea class="full" id="npRuntime" style="width:100%;min-height:78px;background:#061018;border:1px solid #263644;color:#fff;border-radius:12px;padding:12px" placeholder="Runtime اختياري، كل سطر مثل:&#10;docker:container-name&#10;systemd:service.service"></textarea>'+
    '</div><div class="actions"><button class="btn" type="submit">إضافة المشروع</button></div></form></details>';
  var filtered=projectFilter==='all'?rows:rows.filter(function(x){return x.type===projectFilter});
  html+='<div class="section-title"><h2>القائمة</h2><span>'+filtered.length+' مشروع</span></div><div class="list">'+listHtml(filtered)+'</div>';
  gi('projects').innerHTML=html;
  gi('newProjectForm').onsubmit=createProjectFromForm;
}
async function createProjectFromForm(ev){
  ev.preventDefault();
  var payload={id:gi('npId').value.trim().toLowerCase(),name:gi('npName').value.trim(),type:gi('npType').value,client:gi('npClient').value.trim(),repository:gi('npRepo').value.trim(),branch:gi('npBranch').value.trim()||'main',domain:gi('npDomain').value.trim(),runtime:parseRuntime(gi('npRuntime').value)};
  try{await api('/projects/upsert',{method:'POST',body:JSON.stringify(payload)});await refresh();show('projects');tg&&tg.HapticFeedback&&tg.HapticFeedback.notificationOccurred('success')}catch(e){alert('تعذر إضافة المشروع: '+e.message)}
}
function projectRuntimeHtml(p){
  var rows=p.runtimeState||[];
  if(!rows.length)return empty('لا يوجد Runtime مربوط بعد.');
  return rows.map(function(x){return '<div class="row"><div class="rowtop"><span class="dot '+(x.active?'good':'bad')+'"></span><div class="name code">'+esc(x.kind)+':'+esc(x.name)+'</div><span class="pill">'+esc(x.status)+'</span></div></div>'}).join('');
}
function versionsHtml(p){
  var rows=(p.versions||[]).slice().reverse();
  if(!rows.length)return empty('لا يوجد سجل إصدارات بعد.');
  return rows.map(function(v){return '<div class="row"><div class="rowtop"><div class="name">'+esc(v.version)+'</div><span class="pill">'+esc(v.kind)+'</span></div><div class="meta">'+esc(v.createdAt)+' · '+esc(v.source)+'<br>'+esc(v.notes||'')+'</div></div>'}).join('');
}
window.setProjectFilter=function(v){projectFilter=v||'all';renderManagedProjects()};
window.openProjectEditor=function(id,keepUrl){
  var p=((DATA&&DATA.managedProjects)||[]).find(function(x){return x.id===id});
  if(!p){renderManagedProjects();return}
  if(!keepUrl)history.replaceState(null,'',location.pathname+'?tab=projects&project='+encodeURIComponent(id));
  var b=p.billing||{};
  var power='';
  if(p.runtime&&p.runtime.length){
    power=p.liveStatus==='online'?'<button class="btn danger" onclick="projectPower(\''+p.id+'\',\'stop\')">⏹ إطفاء</button>':'<button class="btn" onclick="projectPower(\''+p.id+'\',\'start\')">▶️ تشغيل</button>';
  }else power='<span class="pill">Runtime غير مربوط</span>';
  var html='';
  html+='<div class="actions"><button class="btn secondary" onclick="closeProjectEditor()">↩️ كل المشاريع</button></div>';
  html+='<div class="section-title"><h2>'+icon(p.liveStatus)+' '+esc(p.name)+'</h2><span>'+esc(TYPES[p.type]||p.type)+'</span></div>';
  html+='<div class="grid">'+
    '<div class="card"><div class="k">الحالة</div><div class="v">'+esc(p.liveStatus)+'</div></div>'+
    '<div class="card"><div class="k">الإصدار الحالي</div><div class="v" style="font-size:16px">'+esc(p.currentVersion||'غير مسجل')+'</div></div>'+
    '<div class="card"><div class="k">المبلغ الشهري</div><div class="v">'+esc(b.monthlyFee||0)+' '+esc(b.currency||'USD')+'</div><div class="s">'+(b.overdue?'🔴 متأخر':b.paidThisMonth?'✅ مدفوع':'⏳ بانتظار الاستحقاق')+'</div></div>'+
    '<div class="card"><div class="k">المؤقت</div><div class="v" style="font-size:13px">'+esc(p.expiresAt||'غير مفعّل')+'</div><div class="s">Auto Stop: '+(p.autoStop?'ON':'OFF')+'</div></div></div>';
  html+='<div class="actions">'+power+(b.monthlyFee?'<button class="btn secondary" onclick="markProjectPaid(\''+p.id+'\')">💵 تسجيل دفعة</button><button class="btn secondary" onclick="renewProject(\''+p.id+'\')">🔁 استلام +30 يوم</button>':'')+'</div>';
  html+='<div class="section-title"><h2>المكونات</h2><span>'+(p.runtimeState||[]).length+'</span></div><div class="list">'+projectRuntimeHtml(p)+'</div>';
  html+='<div class="section-title"><h2>بيانات المشروع</h2><span>قابلة للتعديل</span></div>';
  html+='<form id="projectMetaForm"><div class="fields">'+formInput('pmName','الاسم',p.name,'text')+typeSelect('pmType',p.type)+
    formInput('pmClient','العميل',p.client||'','text')+formInput('pmRepo','GitHub repository',p.repository||'','text')+
    formInput('pmBranch','branch',p.branch||'main','text')+formInput('pmDomain','domain',p.domain||'','text')+
    '<textarea class="full" id="pmRuntime" style="width:100%;min-height:78px;background:#061018;border:1px solid #263644;color:#fff;border-radius:12px;padding:12px">'+esc(runtimeLines(p))+'</textarea>'+
    '</div><div class="actions"><button class="btn" type="submit">حفظ بيانات المشروع</button></div></form>';
  html+='<div class="section-title"><h2>الفوترة الشهرية</h2><span>المستحقات</span></div>';
  html+='<form id="billingForm"><div class="fields">'+formInput('billAmount','المبلغ',b.monthlyFee||0,'number')+formInput('billCurrency','USD / EUR / SYP',b.currency||'USD','text')+formInput('billDue','يوم الاستحقاق',b.dueDay||1,'number')+formInput('billClient','اسم العميل',p.client||'','text')+'</div><div class="actions"><button class="btn" type="submit">حفظ الفوترة</button></div></form>';
  var pays=(p.payments||[]).slice().reverse().slice(0,12);
  html+='<div class="section-title"><h2>سجل الدفعات</h2><span>'+(p.payments||[]).length+'</span></div><div class="list">'+(pays.length?pays.map(function(x){return '<div class="row"><div class="rowtop"><div class="name">'+esc(x.amount)+' '+esc(x.currency)+'</div><span class="pill">مدفوع</span></div><div class="meta">'+esc(x.at)+'</div></div>'}).join(''):empty('لا توجد دفعات مسجلة بعد.'))+'</div>';
  html+='<div class="section-title"><h2>مؤقت الإيقاف</h2><span>Auto Stop</span></div>';
  html+='<form id="timerForm"><div class="fields">'+formInput('timerAt','',localDateInput(p.expiresAt),'datetime-local')+'<label class="row" style="display:flex;align-items:center;gap:8px"><input id="timerAuto" type="checkbox" style="width:auto" '+(p.autoStop?'checked':'')+'> إطفاء تلقائي عند انتهاء الوقت</label></div><div class="actions"><button class="btn" type="submit">حفظ المؤقت</button><button class="btn secondary" type="button" onclick="clearTimer(\''+p.id+'\')">إلغاء المؤقت</button></div></form>';
  html+='<div class="section-title"><h2>الإصدارات والتحديثات</h2><span>'+(p.versions||[]).length+'</span></div>';
  html+='<form id="versionForm"><div class="fields">'+formInput('verName','مثال v1.5.14','','text')+'<select id="verKind"><option value="release">Release</option><option value="update">Update</option><option value="apk">APK</option><option value="hotfix">Hotfix</option></select>'+formInput('verNotes','ملاحظات هذا التحديث','','text')+'</div><div class="actions"><button class="btn" type="submit">إضافة إصدار/تحديث</button></div></form>';
  html+='<div class="list">'+versionsHtml(p)+'</div>';
  gi('projects').innerHTML=html;
  gi('projectMetaForm').onsubmit=function(ev){saveProjectMeta(ev,p)};
  gi('billingForm').onsubmit=function(ev){saveProjectBilling(ev,p.id)};
  gi('timerForm').onsubmit=function(ev){saveProjectTimer(ev,p.id)};
  gi('versionForm').onsubmit=function(ev){saveProjectVersion(ev,p.id)};
};
window.closeProjectEditor=function(){history.replaceState(null,'',location.pathname+'?tab=projects');renderManagedProjects()};
async function saveProjectMeta(ev,p){
  ev.preventDefault();
  var payload={id:p.id,name:gi('pmName').value.trim(),type:gi('pmType').value,client:gi('pmClient').value.trim(),repository:gi('pmRepo').value.trim(),branch:gi('pmBranch').value.trim()||'main',domain:gi('pmDomain').value.trim(),runtime:parseRuntime(gi('pmRuntime').value)};
  try{await api('/projects/upsert',{method:'POST',body:JSON.stringify(payload)});await refresh();openProjectEditor(p.id,true)}catch(e){alert('تعذر الحفظ: '+e.message)}
}
async function saveProjectBilling(ev,id){
  ev.preventDefault();
  try{await api('/projects/'+id+'/billing',{method:'POST',body:JSON.stringify({monthlyFee:Number(gi('billAmount').value||0),currency:gi('billCurrency').value.trim(),dueDay:Number(gi('billDue').value||1),client:gi('billClient').value.trim()})});await refresh();openProjectEditor(id,true)}catch(e){alert('تعذر حفظ الفوترة: '+e.message)}
}
async function saveProjectTimer(ev,id){
  ev.preventDefault();var raw=gi('timerAt').value;var expiresAt=raw?new Date(raw).toISOString():'';
  try{await api('/projects/'+id+'/timer',{method:'POST',body:JSON.stringify({expiresAt:expiresAt,autoStop:gi('timerAuto').checked})});await refresh();openProjectEditor(id,true)}catch(e){alert('تعذر حفظ المؤقت: '+e.message)}
}
window.clearTimer=async function(id){try{await api('/projects/'+id+'/timer',{method:'POST',body:JSON.stringify({expiresAt:'',autoStop:false})});await refresh();openProjectEditor(id,true)}catch(e){alert('تعذر إلغاء المؤقت: '+e.message)}};
async function saveProjectVersion(ev,id){ev.preventDefault();try{await api('/projects/'+id+'/version',{method:'POST',body:JSON.stringify({version:gi('verName').value.trim(),kind:gi('verKind').value,notes:gi('verNotes').value.trim()})});await refresh();openProjectEditor(id,true)}catch(e){alert('تعذر إضافة الإصدار: '+e.message)}}
window.markProjectPaid=async function(id){if(!confirm('تأكيد استلام دفعة هذا الشهر؟'))return;try{await api('/projects/'+id+'/paid',{method:'POST',body:'{}'});await refresh();openProjectEditor(id,true)}catch(e){alert('تعذر تسجيل الدفعة: '+e.message)}};
window.renewProject=async function(id){if(!confirm('تأكيد استلام الدفعة وتمديد الخدمة 30 يوم؟'))return;try{await api('/projects/'+id+'/renew',{method:'POST',body:JSON.stringify({days:30})});await refresh();openProjectEditor(id,true);if(tg&&tg.HapticFeedback)tg.HapticFeedback.notificationOccurred('success')}catch(e){alert('تعذر التجديد: '+e.message)}};
window.projectPower=async function(id,action){var word=action==='start'?'تشغيل':'إطفاء';if(!confirm('تأكيد '+word+' المشروع؟'))return;try{await api('/projects/'+id+'/'+action,{method:'POST',body:JSON.stringify({confirm:action==='start'?'START':'STOP'})});await refresh();openProjectEditor(id,true);if(tg&&tg.HapticFeedback)tg.HapticFeedback.notificationOccurred('success')}catch(e){alert('تعذر '+word+' المشروع: '+e.message)}};
window.renderProjects=renderManagedProjects;
var firstTab=new URLSearchParams(location.search).get('tab');
if(firstTab==='projects'){try{show('projects')}catch(e){}}
})();