/* V1-83 verified dashboard — retain original panels, never show source-fixture figures. */
function installV183LiveDashboard(state){
 if(state.realDashboardInstalled)return;
 state.realDashboardInstalled=true;
 const fmt=value=>Number(value||0).toLocaleString('en-US');
 const money=value=>(Number(value||0)/100).toLocaleString('en-US',{
  minimumFractionDigits:2,maximumFractionDigits:2})+' '+(state.me?.currency||'USD');
 const reportError=()=>state.secondaryFailures.includes('/reports/summary');
 const realPage=renderWorkspace;
 renderWorkspace=function(){
  realPage();
  if(document.body.dataset.runtime==='live'){
   const description=$('workspace-content')?.querySelector('.heading p');
   if(description)description.textContent=t('بيانات فعلية من خادم UCHIHA RADIUS V1-83',
      'Actual UCHIHA RADIUS V1-83 server records');
  }
 };
 const realSessions=renderSessions;
 renderSessions=function(){
  realSessions();
  if(document.body.dataset.runtime!=='live')return;
  $('sessions-summary')?.querySelectorAll('small')?.forEach(element=>{
   element.textContent=element.textContent.replace(/في العينة/g,'فعليًا').replace(/in sample/gi,'from actual records');
  });
 };
 renderOperationalPulse=function(){
  const host=$('ops-pulse');if(!host)return;
  const alerts=(state.alerts||[]).filter(row=>row.status==='open');
  const header='<header class="ops-pulse-head">'+art('pulse')+
   '<div><h2>'+t('تنبيهات الشبكة','Network alerts')+'</h2><p>'+
   t('من الأحداث الفعلية المسجّلة','From actual recorded events')+'</p></div></header>';
  host.innerHTML=header+(state.secondaryFailures.includes('/alerts?limit=100')?
   '<p class="provider-note">'+t('تعذّر جلب التنبيهات؛ لا نعرض بيانات بديلة.',
     'Alerts could not be fetched; no sample data is shown.')+'</p>':
   alerts.length?
    alerts.slice(0,4).map(item=>'<article class="panel workspace-card">'+
      '<h3>'+esc(item.title)+'</h3><p>'+esc(item.body||'')+'</p>'+
      '<span class="chip">'+esc(item.severity)+'</span></article>').join(''):
    '<p class="provider-note">'+t('لا توجد تنبيهات مفتوحة.', 'No open alerts.')+'</p>');
 };
 renderDashboardStaticV26=function(){
  const p=providers[0];
  const sessions=fmt(p.sessions),subscribers=fmt(p.subs);
  const linked=Number(p.nas||0)>0;
  const available=linked&&Number(p.healthy||0)===Number(p.nas||0);
  const st=linked?(available?t('متصلة','Connected'):t('تحتاج متابعة','Needs attention')):
   t('بانتظار ربط MikroTik','MikroTik not connected yet');
  const status=$('workspace-status');
  if(status)status.innerHTML='<span class="workspace-caption">'+art('branches')+
   '<bdi>'+esc(p.name)+'</bdi></span><span class="chip '+(available?'':'warn')+'">'+st+'</span>';
  const kpis=$('dashboard-kpis');
  if(kpis)kpis.innerHTML=
   '<article class="focus-card"><div class="focus-top"><span class="focus-label">'+
     t('الجلسات المتصلة الآن','Sessions connected now')+
    '</span></div><div class="focus-middle"><strong class="num">'+sessions+
    '</strong><span class="focus-art">'+art('satellite')+'</span></div>'+
    '<div class="focus-bottom"><span>'+t('من قاعدة RADIUS الفعلية','From actual RADIUS records')+
    '</span><span class="num">'+fmt(p.healthy)+' / '+fmt(p.nas)+' NAS</span></div></article>'+
   '<article class="small-stat"><div class="small-stat-top">'+art('people')+'</div><p>'+
    t('المشتركون','Subscribers')+'</p><strong class="num">'+subscribers+'</strong></article>'+
   '<article class="small-stat"><div class="small-stat-top">'+art('router')+'</div><p>'+
    t('سجلات أجهزة الشبكة','Registered router records')+'</p><strong class="num">'+fmt(p.nas)+'</strong></article>'+
   '<article class="small-stat"><div class="small-stat-top">'+art('receipt')+'</div><p>'+
    t('التحصيل المسجّل','Recorded collections')+'</p><strong class="num">'+
    (reportError()||!state.report?'—':money(state.report?.billing?.collectedMinor))+
    '</strong></article>';
  const auth=state.overview?.last24Hours;
  const ratio=auth?.authenticationRequests?
   (100*Number(auth.accepted||0)/Number(auth.authenticationRequests)).toFixed(1)+'%':'—';
  const delays=(state.authEvents||[]).filter(row=>row.latencyMs!=null&&
   Number.isFinite(Number(row.latencyMs)));
  const latency=delays.length?Math.round(delays.reduce((sum,row)=>sum+Number(row.latencyMs),0)/delays.length)+' ms':'—';
  const health=$('network-health');
  if(health)health.innerHTML=[
   [t('نجاح المصادقة خلال 24 ساعة','Authentication success over 24 hours'),ratio],
   [t('زمن الاستجابة المقاس','Measured response time'),latency],
   [t('الراوترات المتصلة فعليًا','Actually connected devices'),fmt(p.healthy)+' / '+fmt(p.nas)]
  ].map(([label,value])=>'<div class="health-row"><span class="health-title">'+label+
   '</span><b class="num">'+esc(value)+'</b></div>').join('');
  const chip=$('network-chip');if(chip){chip.className='chip'+(available?'':' warn');chip.textContent=st;}
  const note=$('health-note');
  if(note)note.innerHTML=art('router')+'<span>'+t('العدد هنا هو سجلات أُضيفت للتطبيق، وليس عدد الراوترات المكتشفة فعليًا. لا يظهر اتصال أخضر دون فحص RouterOS ناجح.',
    'These are saved registrations, not discovered hardware. Connection turns green only after a verified RouterOS probe.')+
    (state.diagnostics?.requireSiteSeparation?' '+t('قد تكون هناك تسجيلات متكررة للراوتر الرئيسي.',
      'Your main router may have duplicate registrations.'):'')+'</span>';
  setTextV25($('provider-count'),t('مزود واحد فعلي','One actual provider'));
  const cols=['<th>'+t('المزود','Provider')+'</th>',
   '<th>'+t('المشتركون','Subscribers')+'</th>',
   '<th>'+t('الجلسات','Sessions')+'</th>','<th>NAS</th>'];
  const table=$('provider-table'),cards=$('provider-cards');
  const row='<tr><td>'+esc(p.name)+'</td><td class="num">'+subscribers+
   '</td><td class="num">'+sessions+'</td><td class="num">'+fmt(p.healthy)+' / '+fmt(p.nas)+'</td></tr>';
  if(responsiveQueryV25.matches){
   table.hidden=true;table.replaceChildren();cards.hidden=false;
   cards.innerHTML='<div class="provider-card"><div class="entity">'+art('branches')+
    '<div><bdi class="entity-title">'+esc(p.name)+'</bdi><small>'+
    t('المتصلون','Connected')+': '+sessions+'</small></div></div>'+
    '<div class="provider-card-side"><span>'+st+'</span><br><span class="num">'+
    fmt(p.healthy)+' / '+fmt(p.nas)+' NAS</span></div></div>';
  }else{
   cards.hidden=true;cards.replaceChildren();table.hidden=false;
   table.innerHTML='<table class="provider-table"><thead><tr>'+cols.join('')+
     '</tr></thead><tbody>'+row+'</tbody></table>';
  }
 };
}
