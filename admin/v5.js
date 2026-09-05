/* GAME_ZONE_ADMIN_UI_V5 — consolidate legacy mobile shells */
(()=>{
  const ready=fn=>document.readyState==='loading'?document.addEventListener('DOMContentLoaded',fn,{once:true}):fn();
  ready(()=>{
    const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)];
    const labels={dashboard:'لوحة التحكم',orders:'الطلبات',support:'المحادثات',storeHub:'عناصر المتجر',moreHub:'المزيد',products:'المنتجات',categories:'الأقسام',inventory:'المخزون',announcements:'البنرات والعروض',payments:'طرق الدفع',coupons:'القسائم',users:'إدارة المستخدمين',topups:'شحن الرصيد',verification:'تحقق KYC',profits:'الأرباح',providers:'مزودو API',providerLogs:'سجل API',settings:'الإعدادات',operations:'التشغيل',security:'الأمان',audit:'سجل الإدارة',broadcast:'إرسال إشعار'};
    const storePages=new Set(['storeHub','products','categories','inventory','announcements','payments','coupons']);
    const morePages=new Set(['moreHub','settings','providers','providerLogs','verification','profits','users','topups','broadcast','operations','security','audit']);
    const path={
      home:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/>',
      chat:'<path d="M4 5h16v12H9l-5 3V5Z"/><path d="M8 10h8M8 13h5"/>',
      grid:'<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
      menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
      box:'<path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/>',
      ticket:'<path d="M4 7a2 2 0 0 0 2-2h12a2 2 0 0 0 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 0-2 2H6a2 2 0 0 0-2-2v-3a2 2 0 0 0 0-4V7Z"/>',
      wallet:'<path d="M4 7h14a2 2 0 0 1 2 2v9H4z"/><path d="M4 7V5h12v2M15 12h5v4h-5a2 2 0 0 1 0-4Z"/>',
      image:'<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m6 17 4-4 3 3 2-2 3 3"/>',
      plus:'<path d="M12 5v14M5 12h14"/>'
    };
    const icon=n=>`<svg viewBox="0 0 24 24" aria-hidden="true">${path[n]||path.grid}</svg>`;

    function removeDuplicateChrome(){
      qa('.gz3-bottom,.gz3-drawer,.gz3-backdrop,.gz3-quick,.gz3-quick-backdrop').forEach(el=>el.remove());
      qa('.gz3-menu-btn').forEach(el=>el.remove());
    }
    function bottomKey(page){
      if(page==='dashboard')return 'dashboard';
      if(page==='orders')return 'orders';
      if(page==='support')return 'support';
      if(storePages.has(page))return 'storeHub';
      if(morePages.has(page))return 'moreHub';
      return '';
    }
    function updateBottom(page){
      const key=bottomKey(page);
      qa('.gz-bottom-nav [data-gz-page]').forEach(btn=>btn.classList.toggle('gz-active',btn.dataset.gzPage===key));
    }
    function closeFloating(){
      document.body.classList.remove('gz-drawer-open');
      const sheet=q('.gz-quick-sheet'),plus=q('#gzQuickBtn');
      sheet?.classList.remove('gz-show');
      plus?.classList.remove('gz-open');
      if(plus)plus.innerHTML=icon('plus');
    }
    function activateHub(page){
      const view=q(`[data-page-view="${CSS.escape(page)}"]`);if(!view)return false;
      qa('.page').forEach(p=>p.classList.remove('active'));view.classList.add('active');
      qa('aside nav button[data-page]').forEach(b=>b.classList.remove('active'));
      const title=q('#pageTitle');if(title)title.textContent=labels[page]||page;
      updateBottom(page);closeFloating();window.scrollTo({top:0,behavior:'smooth'});return true;
    }
    function route(page){
      if(page==='storeHub'||page==='moreHub')return activateHub(page);
      const btn=q(`aside nav button[data-page="${CSS.escape(page)}"]`);
      if(btn){btn.click();updateBottom(page);closeFloating();window.scrollTo({top:0,behavior:'smooth'});return true}
      return false;
    }
    function rebuildStoreHub(){
      const hub=q('[data-page-view="storeHub"]'),grid=q('.gz3-hub-grid',hub);if(!hub||!grid)return;
      const cards=[
        ['products','المنتجات','grid',''],
        ['categories','الأقسام','ticket','green'],
        ['payments','طرق الدفع','wallet','purple'],
        ['announcements','البنرات والعروض','image','orange'],
        ['inventory','المخزون','box',''],
        ['coupons','القسائم','ticket','green']
      ];
      grid.innerHTML=cards.map(c=>`<button type="button" class="gz3-hub-card" data-gz5-page="${c[0]}"><span class="gz3-iconbox ${c[3]}">${icon(c[2])}</span><span>${c[1]}</span></button>`).join('');
      qa('[data-gz5-page]',grid).forEach(b=>b.addEventListener('click',()=>route(b.dataset.gz5Page)));
    }
    function rebuildBottom(){
      const bar=q('.gz-bottom-nav');if(!bar)return;
      bar.innerHTML=`
        <button type="button" data-gz-page="dashboard">${icon('home')}<span>الرئيسية</span></button>
        <button type="button" data-gz-page="support">${icon('chat')}<span>المحادثات</span></button>
        <span class="gz-center-slot"><button type="button" class="gz-plus" id="gzQuickBtn" aria-label="إجراء سريع" aria-expanded="false">${icon('plus')}</button></span>
        <button type="button" data-gz-page="storeHub">${icon('grid')}<span>عناصر المتجر</span></button>
        <button type="button" data-gz-page="moreHub">${icon('menu')}<span>المزيد</span></button>`;
      qa('[data-gz-page]',bar).forEach(b=>b.addEventListener('click',()=>route(b.dataset.gzPage)));
      const plus=q('#gzQuickBtn',bar),sheet=q('.gz-quick-sheet');
      plus?.addEventListener('click',()=>{
        const show=!sheet?.classList.contains('gz-show');
        sheet?.classList.toggle('gz-show',show);plus.classList.toggle('gz-open',show);plus.setAttribute('aria-expanded',String(show));plus.innerHTML=show?'×':icon('plus');
      });
    }
    function bindExistingNavigation(){
      qa('aside nav button[data-page]').forEach(btn=>btn.addEventListener('click',()=>setTimeout(()=>updateBottom(btn.dataset.page),0)));
      document.addEventListener('keydown',e=>{if(e.key==='Escape')closeFloating()});
    }
    function detectCurrent(){return q('.page.active')?.dataset.pageView||'dashboard'}

    removeDuplicateChrome();
    rebuildStoreHub();
    rebuildBottom();
    bindExistingNavigation();
    updateBottom(detectCurrent());
    document.body.classList.add('gz-admin-v5');
    window.GameZoneAdminV5={route};
  });
})();
