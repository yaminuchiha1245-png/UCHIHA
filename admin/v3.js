/* Game Zone Admin Mobile V3 */
(()=>{
  const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)];
  const pageLabels={
    dashboard:"لوحة التحكم",orders:"الطلبات",products:"المنتجات",inventory:"المخزون",categories:"الأقسام",
    topups:"شحن الرصيد",users:"إدارة المستخدمين",verification:"تحقق KYC",profits:"الأرباح",coupons:"القسائم",
    providers:"مزودو API",providerLogs:"سجل API",payments:"طرق الدفع",operations:"التشغيل",announcements:"البنرات والعروض",
    support:"الدعم",broadcast:"إرسال إشعار",settings:"الإعدادات",audit:"سجل الإدارة",security:"الأمان",
    storeHub:"عناصر المتجر",moreHub:"المزيد"
  };
  const paths={
    home:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/>',
    orders:'<path d="M6 4h12v16H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    users:'<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.2"/><path d="M3.5 19c.8-4 3-6 5.5-6s4.7 2 5.5 6M14 14c2.8.1 4.8 1.7 5.5 4.5"/>',
    grid:'<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    wallet:'<path d="M4 7h14a2 2 0 0 1 2 2v9H4z"/><path d="M4 7V5h12v2M15 12h5v4h-5a2 2 0 0 1 0-4Z"/>',
    box:'<path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/>',
    bell:'<path d="M6 17h12l-2-3V9a4 4 0 0 0-8 0v5l-2 3Z"/><path d="M10 20h4"/>',
    ticket:'<path d="M4 7a2 2 0 0 0 2-2h12a2 2 0 0 0 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 0-2 2H6a2 2 0 0 0-2-2v-3a2 2 0 0 0 0-4Z"/>',
    image:'<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m6 17 4-4 3 3 2-2 3 3"/>',
    gear:'<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"/>',
    api:'<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.4 3.5 5 3.5 8S14.5 17.6 12 20M12 4c-2.5 2.4-3.5 5-3.5 8s1 5.6 3.5 8"/>',
    shield:'<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-5"/>',
    chart:'<path d="M5 19V11M10 19V7M15 19V13M20 19V5"/>',
    chat:'<path d="M4 5h16v12H9l-5 3V5Z"/><path d="M8 10h8M8 13h5"/>',
    more:'<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    tag:'<path d="M4 12V5h7l9 9-7 7-9-9Z"/><circle cx="8.5" cy="8.5" r="1"/>',
    log:'<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    verify:'<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z"/><path d="m8.7 12 2.2 2.2 4.6-5"/>',
    sync:'<path d="M20 7h-6V1"/><path d="M20 7a8 8 0 1 0 1 8"/>',
    broadcast:'<path d="M5 12a7 7 0 0 1 7-7M5 12a7 7 0 0 0 7 7"/><circle cx="5" cy="12" r="2"/><path d="M12 2a10 10 0 0 1 0 20"/>',
    close:'<path d="M6 6l12 12M18 6 6 18"/>',
    menu:'<path d="M4 7h16M4 12h16M4 17h16"/>'
  };
  const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.grid}</svg>`;
  const groups=[
    {label:"أساسية",cls:"",items:[["dashboard","الرئيسية","home"],["orders","الطلبات","orders"],["topups","المدفوعات والشحن","wallet"],["users","المستخدمون","users"]]},
    {label:"خصائص المتجر",cls:"store",items:[["categories","الأقسام","grid"],["products","المنتجات","box"],["inventory","المخزون","box"],["announcements","البنرات والعروض","image"],["payments","طرق الدفع","wallet"],["coupons","القسائم","ticket"]]},
    {label:"إعدادات أخرى",cls:"other",items:[["settings","الإعدادات","gear"],["providers","ربط API خارجي","api"],["providerLogs","سجل API","log"],["verification","تحقق KYC","verify"],["profits","الإحصاءات والأرباح","chart"],["support","الدعم","chat"],["broadcast","إرسال إشعار","broadcast"],["operations","التشغيل","sync"],["security","الأمان","shield"],["audit","سجل الإدارة","log"]]}
  ];

  let drawer,backdrop,quick,quickBackdrop,fab;
  function setTitle(page){const t=q('#pageTitle');if(t)t.textContent=pageLabels[page]||page;const p=q('main header p');if(p)p.textContent='Game Zone  •  مسؤول';}
  function activeBottom(page){
    const storePages=new Set(['storeHub','products','categories','inventory','announcements','payments','coupons']);
    const morePages=new Set(['moreHub','settings','providers','providerLogs','verification','profits','support','broadcast','operations','security','audit','users','topups']);
    const key=page==='dashboard'?'dashboard':page==='orders'?'orders':storePages.has(page)?'storeHub':morePages.has(page)?'moreHub':'';
    qa('.gz3-bottom-btn').forEach(b=>b.classList.toggle('active',b.dataset.gzPage===key));
    qa('.gz3-drawer-btn').forEach(b=>b.classList.toggle('active',b.dataset.gzPage===page));
  }
  function closeDrawer(){drawer?.classList.remove('open');backdrop?.classList.remove('show')}
  function openDrawer(){drawer?.classList.add('open');backdrop?.classList.add('show')}
  function closeQuick(){quick?.classList.remove('show');quickBackdrop?.classList.remove('show');fab?.classList.remove('open')}
  function toggleQuick(){const on=!quick?.classList.contains('show');if(on){closeDrawer();quick?.classList.add('show');quickBackdrop?.classList.add('show');fab?.classList.add('open')}else closeQuick()}
  function showPage(page){
    const view=q(`[data-page-view="${CSS.escape(page)}"]`);if(!view)return false;
    qa('.page').forEach(p=>p.classList.remove('active'));view.classList.add('active');
    qa('aside nav [data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
    setTitle(page);activeBottom(page);closeDrawer();closeQuick();window.scrollTo({top:0,behavior:'smooth'});return true;
  }

  function makeHubPages(){
    const main=q('main'),header=q('main>header');if(!main||!header)return;
    if(!q('[data-page-view="storeHub"]')){
      const store=document.createElement('section');store.className='page gz3-hub';store.dataset.pageView='storeHub';
      store.innerHTML=`<div class="gz3-hub-intro"><h2>عناصر المتجر</h2><p>إدارة محتوى Game Zone من مكان واحد</p></div><div class="gz3-hub-grid">
        <button class="gz3-hub-card" data-gz-page="products"><span class="gz3-iconbox">${icon('grid')}</span><span>المنتجات</span></button>
        <button class="gz3-hub-card" data-gz-page="categories"><span class="gz3-iconbox green">${icon('ticket')}</span><span>الأقسام</span></button>
        <button class="gz3-hub-card" data-gz-page="payments"><span class="gz3-iconbox purple">${icon('wallet')}</span><span>طرق الدفع</span></button>
        <button class="gz3-hub-card" data-gz-page="announcements"><span class="gz3-iconbox orange">${icon('image')}</span><span>البنرات والعروض</span></button>
        <button class="gz3-hub-card" data-gz-page="inventory"><span class="gz3-iconbox">${icon('box')}</span><span>المخزون</span></button>
        <button class="gz3-hub-card" data-gz-page="coupons"><span class="gz3-iconbox green">${icon('ticket')}</span><span>القسائم</span></button>
      </div>`;
      header.insertAdjacentElement('afterend',store);
    }
    if(!q('[data-page-view="moreHub"]')){
      const more=document.createElement('section');more.className='page gz3-hub';more.dataset.pageView='moreHub';
      const cards=[
        ['settings','الإعدادات','الدعم الفني، إعدادات المتجر والبيانات','gear'],['providers','ربط API خارجي','ربط مزودي المنتجات والخدمات','api'],
        ['verification','التحقق والحسابات','طلبات التحقق وحالة الحساب','verify'],['profits','الإحصاءات','تقارير الأرباح وأداء المتجر','chart'],
        ['providerLogs','سجل API','مراجعة اتصالات مزودي التنفيذ','log'],['support','الدعم','تذاكر العملاء والردود','chat'],
        ['broadcast','إرسال إشعار','إرسال تنبيه لعملاء المتجر','broadcast'],['operations','التشغيل','المزامنة والنسخ الاحتياطي وسلامة البيانات','sync'],
        ['security','الأمان','الجلسات والأحداث الأمنية','shield'],['audit','سجل الإدارة','تاريخ الإجراءات الإدارية','log']
      ];
      more.innerHTML=`<div class="gz3-hub-intro"><h2>المزيد</h2><p>إعدادات وتشغيل Game Zone</p></div><div class="gz3-more-list">${cards.map(c=>`<button class="gz3-more-card" data-gz-page="${c[0]}"><span class="gz3-iconbox">${icon(c[3])}</span><span><b>${c[1]}</b><small>${c[2]}</small></span><span class="arrow">‹</span></button>`).join('')}</div>`;
      header.insertAdjacentElement('afterend',more);
    }
    qa('[data-gz-page]').forEach(b=>{if(!b.dataset.gzBound){b.dataset.gzBound='1';b.addEventListener('click',()=>showPage(b.dataset.gzPage))}});
  }

  function buildDrawer(){
    backdrop=document.createElement('div');backdrop.className='gz3-backdrop';document.body.appendChild(backdrop);
    drawer=document.createElement('aside');drawer.className='gz3-drawer';drawer.innerHTML=`<div class="gz3-drawer-head"><img src="/assets/game-zone-logo.png" alt=""><span><b>Game Zone</b><small>لوحة إدارة المتجر</small></span><button class="gz3-drawer-close" aria-label="إغلاق">×</button></div>${groups.map(g=>`<div class="gz3-group-label ${g.cls}">${g.label}</div>${g.items.map(i=>`<button class="gz3-drawer-btn" data-gz-page="${i[0]}">${icon(i[2])}<span>${i[1]}</span></button>`).join('')}`).join('')}`;document.body.appendChild(drawer);
    backdrop.addEventListener('click',closeDrawer);q('.gz3-drawer-close',drawer)?.addEventListener('click',closeDrawer);qa('.gz3-drawer-btn',drawer).forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.gzPage)));
  }

  function buildBottom(){
    const bar=document.createElement('nav');bar.className='gz3-bottom';bar.innerHTML=`
      <button class="gz3-bottom-btn" data-gz-page="moreHub">${icon('menu')}<span>المزيد</span></button>
      <button class="gz3-bottom-btn" data-gz-page="storeHub">${icon('grid')}<span>عناصر المتجر</span></button>
      <span class="gz3-fab-wrap"><button class="gz3-fab" aria-label="إجراء سريع">${icon('plus')}</button></span>
      <button class="gz3-bottom-btn" data-gz-page="orders">${icon('orders')}<span>الطلبات</span></button>
      <button class="gz3-bottom-btn" data-gz-page="dashboard">${icon('home')}<span>الرئيسية</span></button>`;document.body.appendChild(bar);
    fab=q('.gz3-fab',bar);fab.addEventListener('click',toggleQuick);qa('.gz3-bottom-btn',bar).forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.gzPage)));
  }

  function buildQuick(){
    quickBackdrop=document.createElement('div');quickBackdrop.className='gz3-quick-backdrop';document.body.appendChild(quickBackdrop);
    const items=[
      ['products','#addProductBtn','منتج','box'],['categories','#addCategoryBtn','قسم','grid'],['inventory','#addInventoryBtn','المخزون','box'],
      ['announcements','#addAnnouncementBtn','إرسال إعلان','bell'],['payments','#addPaymentBtn','طريقة دفع','wallet'],['coupons','#addCouponBtn','قسيمة خصم','ticket'],
      ['providers','#addProviderBtn','مزود API','api'],['users','', 'إدارة المستخدمين','users'],['topups','', 'شحن الرصيد','wallet'],
      ['settings','', 'إعدادات المتجر','gear'],['verification','', 'التحقق','verify'],['profits','', 'الإحصاءات','chart']
    ];
    quick=document.createElement('div');quick.className='gz3-quick';quick.innerHTML=`<div class="gz3-quick-head"><h3>إجراء سريع</h3><button aria-label="إغلاق">×</button></div><div class="gz3-quick-grid">${items.map((i,n)=>`<button class="gz3-quick-item" data-gz-quick="${n}"><span class="gz3-iconbox">${icon(i[3])}</span><span>${i[2]}</span></button>`).join('')}</div>`;document.body.appendChild(quick);
    q('.gz3-quick-head button',quick).addEventListener('click',closeQuick);quickBackdrop.addEventListener('click',closeQuick);
    qa('[data-gz-quick]',quick).forEach(b=>b.addEventListener('click',()=>{const i=items[Number(b.dataset.gzQuick)];showPage(i[0]);if(i[1])setTimeout(()=>q(i[1])?.click(),60)}));
  }

  function addHeaderMenu(){
    const header=q('main>header');if(!header||q('.gz3-menu-btn',header))return;
    const btn=document.createElement('button');btn.className='gz3-menu-btn';btn.setAttribute('aria-label','فتح القائمة');btn.innerHTML=icon('menu');btn.addEventListener('click',openDrawer);header.insertBefore(btn,header.firstChild);
    const p=q('p',header);if(p)p.textContent='Game Zone  •  مسؤول';
  }

  function getData(){try{return typeof data!=='undefined'?data:null}catch{return null}}
  function ensureSummary(page,id,cards,three=false){
    const view=q(`[data-page-view="${page}"]`),panel=view?.querySelector('.panel');if(!view||!panel)return;
    let host=q('#'+id,view);if(!host){host=document.createElement('div');host.id=id;host.className='gz3-summary'+(three?' three':'');panel.insertAdjacentElement('beforebegin',host)}
    const sig=JSON.stringify(cards);if(host.dataset.sig===sig)return;host.dataset.sig=sig;
    host.innerHTML=cards.map(c=>`<div class="gz3-summary-card ${c[2]||''}"><strong>${String(c[0])}</strong><span>${c[1]}</span></div>`).join('');
  }
  function refreshSummaries(){
    const d=getData();if(!d)return;
    const os=Array.isArray(d.orders)?d.orders:[],pending=os.filter(o=>['pending','processing'].includes(o.status)).length,review=os.filter(o=>o.requiresManualReview).length,ok=os.filter(o=>o.status==='completed').length,bad=os.filter(o=>['failed','cancelled','refunded'].includes(o.status)).length;
    ensureSummary('orders','gz3OrdersSummary',[[pending,'الطلبات المعلقة','warn'],[review,'قيد المراجعة',''],[ok,'المقبولة',''],[bad,'المرفوضة','']]);
    const us=Array.isArray(d.users)?d.users:[],verified=new Set((d.verification||[]).filter(v=>v.status==='verified').map(v=>String(v.telegramId))),withBalance=us.filter(u=>Number(u.balance||0)>0).length;
    ensureSummary('users','gz3UsersSummary',[[us.length,'الكل','purple'],[withBalance,'برصيد متاح',''],[verified.size,'موثق','']],true);
    const quickHead=q('[data-page-view="dashboard"] .panel-head h2');if(quickHead&&quickHead.textContent==='نظرة سريعة')quickHead.textContent='أحدث النشاطات';
  }

  function decorateTables(){
    qa('table').forEach(table=>{
      const labels=qa('thead th',table).map(x=>x.textContent.trim());
      qa('tbody tr',table).forEach(row=>qa('td',row).forEach((td,i)=>{if(!td.hasAttribute('data-gz-label')&&labels[i])td.setAttribute('data-gz-label',labels[i])}));
    });
    q('#quickOrders')?.classList.add('table-wrap');
  }
  let frame=0;
  function scheduleDecorate(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;decorateTables();refreshSummaries()})}

  function init(){
    if(document.body.classList.contains('gz-admin-v3'))return;document.body.classList.add('gz-admin-v3');q('#toast')?.classList.add('gz3-toast-offset');
    addHeaderMenu();makeHubPages();buildDrawer();buildBottom();buildQuick();decorateTables();refreshSummaries();showPage('dashboard');
    const main=q('main');if(main)new MutationObserver(scheduleDecorate).observe(main,{childList:true,subtree:true});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeDrawer();closeQuick()}});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
