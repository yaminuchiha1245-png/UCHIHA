from pathlib import Path

root = Path('.')
admin = root / 'admin'
index = admin / 'index.html'

v5_css = r'''/* GAME_ZONE_ADMIN_UI_V5 — single mobile shell, no duplicate chrome */
:root{
  --gz5-bg:#151517;
  --gz5-black:#050506;
  --gz5-panel:#09090b;
  --gz5-line:#29292f;
  --gz5-text:#f7f7f9;
  --gz5-muted:#8d8d96;
  --gz5-red:#ff2a42;
  --gz5-safe-bottom:env(safe-area-inset-bottom,0px);
}

@media (max-width:700px){
  html,body{background:var(--gz5-bg)!important;overflow-x:hidden!important}
  body.gz-admin-v3{min-height:100dvh!important;padding-bottom:calc(78px + var(--gz5-safe-bottom))!important}
  body.gz-admin-v3 main{width:100%!important;min-height:0!important;margin:0!important;padding:0 12px calc(92px + var(--gz5-safe-bottom))!important;background:var(--gz5-bg)!important}

  /* V5 owns the mobile chrome. The original desktop header and V3 chrome must never stack. */
  body.gz-admin-v3 main>header{display:none!important}
  body.gz-admin-v3 .gz3-menu-btn,
  body.gz-admin-v3 .gz3-bottom,
  body.gz-admin-v3 .gz3-drawer,
  body.gz-admin-v3 .gz3-backdrop,
  body.gz-admin-v3 .gz3-quick,
  body.gz-admin-v3 .gz3-quick-backdrop{display:none!important}

  body.gz-admin-v3 .gz-owner-topbar{
    display:grid!important;
    grid-template-columns:44px minmax(0,1fr) auto!important;
    align-items:center!important;
    gap:10px!important;
    position:sticky!important;
    top:0!important;
    z-index:100!important;
    margin:0 -12px 16px!important;
    padding:calc(10px + env(safe-area-inset-top,0px)) 12px 10px!important;
    min-height:66px!important;
    background:rgba(5,5,6,.98)!important;
    border-bottom:1px solid #242428!important;
    box-shadow:0 8px 24px rgba(0,0,0,.16)!important;
    backdrop-filter:blur(18px)!important;
  }
  body.gz-admin-v3 .gz-owner-topbar>button{
    width:44px!important;height:44px!important;min-height:44px!important;padding:0!important;
    display:grid!important;place-items:center!important;border:1px solid #29292f!important;border-radius:13px!important;
    background:#171719!important;color:#fff!important;font-size:23px!important;line-height:1!important
  }
  body.gz-admin-v3 .gz-owner-topbar .gz-account{min-width:0!important;margin:0!important;text-align:right!important}
  body.gz-admin-v3 .gz-owner-topbar .gz-account b{display:block!important;font-size:19px!important;line-height:1.25!important;font-weight:800!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
  body.gz-admin-v3 .gz-owner-topbar .gz-account span{display:block!important;margin-top:3px!important;font-size:9px!important;color:#8f8f99!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
  body.gz-admin-v3 .gz-owner-topbar .gz-live{padding:7px 10px!important;border-radius:10px!important;background:#dfffee!important;color:#157145!important;font-size:9px!important;font-weight:800!important;white-space:nowrap!important}

  /* The hub title lives in the topbar on mobile; do not repeat it inside the page. */
  body.gz-admin-v3 [data-page-view="storeHub"] .gz3-hub-intro,
  body.gz-admin-v3 [data-page-view="moreHub"] .gz3-hub-intro{display:none!important}
  body.gz-admin-v3 .gz3-hub{padding:2px 0 24px!important}
  body.gz-admin-v3 .gz3-hub-grid{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:12px!important;margin:0!important}
  body.gz-admin-v3 .gz3-hub-card{
    min-width:0!important;min-height:156px!important;padding:18px 12px!important;
    gap:14px!important;border-radius:20px!important;border:1px solid #36363d!important;
    background:#050506!important;color:#f5f5f7!important;font-size:15px!important;font-weight:600!important;
    box-shadow:none!important
  }
  body.gz-admin-v3 .gz3-hub-card:active{transform:scale(.985)}
  body.gz-admin-v3 .gz3-hub-card .gz3-iconbox{width:60px!important;height:60px!important;border-radius:17px!important}
  body.gz-admin-v3 .gz3-hub-card svg{width:29px!important;height:29px!important}

  /* One bottom navigation only. The center slot owns the floating action button. */
  body.gz-admin-v3 .gz-bottom-nav{
    display:grid!important;
    grid-template-columns:1fr 1fr 82px 1fr 1fr!important;
    align-items:center!important;
    direction:rtl!important;
    position:fixed!important;z-index:130!important;left:0!important;right:0!important;bottom:0!important;
    height:calc(74px + var(--gz5-safe-bottom))!important;
    padding:6px 8px max(7px,var(--gz5-safe-bottom))!important;
    background:rgba(3,3,4,.99)!important;border-top:1px solid #242428!important;
    box-shadow:0 -10px 28px rgba(0,0,0,.24)!important
  }
  body.gz-admin-v3 .gz-bottom-nav>button{
    min-width:0!important;min-height:54px!important;padding:4px 2px!important;margin:0!important;border:0!important;border-radius:12px!important;
    background:transparent!important;box-shadow:none!important;color:#71717b!important;
    display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:4px!important;
    font-size:8px!important;line-height:1.15!important
  }
  body.gz-admin-v3 .gz-bottom-nav>button svg{width:23px!important;height:23px!important;stroke:currentColor!important;fill:none!important;stroke-width:1.8!important}
  body.gz-admin-v3 .gz-bottom-nav>button.gz-active{color:#ff344a!important;background:transparent!important;box-shadow:none!important}
  body.gz-admin-v3 .gz-bottom-nav .gz-center-slot{position:relative!important;display:block!important;height:100%!important;min-width:0!important}
  body.gz-admin-v3 .gz-bottom-nav .gz-plus{
    position:absolute!important;left:50%!important;top:-26px!important;transform:translateX(-50%)!important;
    width:68px!important;height:68px!important;min-height:68px!important;margin:0!important;padding:0!important;
    border:6px solid #030304!important;border-radius:50%!important;background:linear-gradient(145deg,#ff3149,#ef1831)!important;color:#fff!important;
    display:grid!important;place-items:center!important;font-size:34px!important;line-height:1!important;
    box-shadow:0 12px 30px rgba(255,42,66,.34)!important;z-index:2!important
  }
  body.gz-admin-v3 .gz-bottom-nav .gz-plus.gz-open{background:#b7152a!important}

  body.gz-admin-v3 .gz-quick-sheet{bottom:calc(82px + var(--gz5-safe-bottom))!important;z-index:160!important}

  /* Keep all page content clear of the fixed navigation without creating a huge artificial footer. */
  body.gz-admin-v3 .page{padding-bottom:8px!important}
  body.gz-admin-v3 .page>.panel:last-child{margin-bottom:8px!important}
}

@media (max-width:390px){
  body.gz-admin-v3 .gz3-hub-card{min-height:142px!important;font-size:14px!important}
  body.gz-admin-v3 .gz3-hub-card .gz3-iconbox{width:56px!important;height:56px!important}
  body.gz-admin-v3 .gz-bottom-nav{grid-template-columns:1fr 1fr 76px 1fr 1fr!important;padding-left:4px!important;padding-right:4px!important}
  body.gz-admin-v3 .gz-bottom-nav .gz-plus{width:64px!important;height:64px!important;min-height:64px!important;top:-23px!important}
}
'''

v5_js = r'''/* GAME_ZONE_ADMIN_UI_V5 — consolidate legacy mobile shells */
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
'''

(admin / 'v5.css').write_text(v5_css, encoding='utf-8')
(admin / 'v5.js').write_text(v5_js, encoding='utf-8')

s = index.read_text(encoding='utf-8')
css_anchor = '<link rel="stylesheet" href="./v3.css?v=310">'
js_anchor = '<script src="./v3.js?v=310"></script>'
if css_anchor not in s or js_anchor not in s:
    raise SystemExit('admin v3 anchors missing')
if './v5.css?v=500' not in s:
    s = s.replace(css_anchor, css_anchor + '\n<link rel="stylesheet" href="./v5.css?v=500">', 1)
if './v5.js?v=500' not in s:
    s = s.replace(js_anchor, js_anchor + '\n<script src="./v5.js?v=500"></script>', 1)
index.write_text(s, encoding='utf-8')

print('GAME_ZONE_ADMIN_UI_V5=WRITTEN')
