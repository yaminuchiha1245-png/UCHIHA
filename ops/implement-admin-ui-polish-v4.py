from pathlib import Path

CSS_PATH = Path('admin/admin.css')
JS_PATH = Path('admin/admin.js')
CSS_MARK = '/* GAME_ZONE_ADMIN_POLISH_V4 */'
JS_MARK = '// GAME_ZONE_ADMIN_POLISH_V4'

css = CSS_PATH.read_text(encoding='utf-8')
js = JS_PATH.read_text(encoding='utf-8')

if CSS_MARK not in css:
    css += r'''

/* GAME_ZONE_ADMIN_POLISH_V4 */
:root{
  --gz-bg:#111113;
  --gz-card:#050506;
  --gz-card2:#0b0b0d;
  --gz-line:#29292f;
  --gz-text:#f8f8fa;
  --gz-muted:#8f8f99;
  --gz-red:#ff293f;
  --gz-red-dark:#c80e25;
  --gz-blue:#72b9ff;
  --gz-green:#62db98;
  --gz-purple:#b49cf0;
  --gz-orange:#ffb04f;
}

html{background:var(--gz-bg);scrollbar-color:#383840 #0b0b0d}
body{background:var(--gz-bg)!important;color:var(--gz-text);-webkit-tap-highlight-color:transparent}
button,input,select,textarea{font:inherit}
button{cursor:pointer}
button:disabled{opacity:.42!important;cursor:not-allowed!important}
.page{animation:gzPageIn .16s ease-out}
@keyframes gzPageIn{from{opacity:.35;transform:translateY(4px)}to{opacity:1;transform:none}}
.panel{overflow:hidden}
.panel,.stat,.runtime-card,.integrity-row{box-shadow:0 1px 0 rgba(255,255,255,.015) inset}
.panel-head h2{letter-spacing:-.2px}
.actions button,.panel-head button,header button{min-height:38px}
input,select,textarea{outline:none;transition:border-color .15s,box-shadow .15s}
input:focus,select:focus,textarea:focus{border-color:#54545e!important;box-shadow:0 0 0 3px rgba(255,255,255,.035)}
.pill{font-weight:700;white-space:nowrap}
.toast{z-index:500!important;max-width:min(90vw,430px);text-align:center}

@media(max-width:700px){
  html{background:#111113}
  body{min-height:100dvh;overflow-x:hidden;padding-bottom:calc(78px + env(safe-area-inset-bottom))!important}
  main{padding:0 12px calc(92px + env(safe-area-inset-bottom))!important;overflow:visible}

  /* One clean mobile header only; removes the duplicated desktop header. */
  main>header{display:none!important}
  .gz-owner-topbar{
    display:grid!important;
    grid-template-columns:44px minmax(0,1fr) auto;
    gap:10px;
    position:sticky;
    top:0;
    z-index:80;
    margin:0 -12px 14px;
    padding:calc(10px + env(safe-area-inset-top)) 12px 10px;
    background:rgba(5,5,6,.97);
    border-bottom:1px solid #242428;
    box-shadow:0 10px 24px rgba(0,0,0,.12);
    backdrop-filter:blur(18px);
  }
  .gz-owner-topbar>button{
    width:44px;height:44px;border:1px solid #29292f!important;border-radius:13px!important;
    background:#171719!important;color:#fff!important;font-size:22px!important;display:grid;place-items:center;padding:0!important
  }
  .gz-owner-topbar .gz-account{min-width:0;margin:0!important;align-self:center;text-align:right}
  .gz-owner-topbar .gz-account b{font-size:18px!important;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .gz-owner-topbar .gz-account span{font-size:9px!important;color:#8f8f99!important;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .gz-owner-topbar .gz-live{align-self:center;padding:7px 9px!important;border-radius:10px!important;background:#dfffee!important;color:#157145!important;font-size:9px!important;font-weight:800}

  aside{width:min(84vw,360px)!important;padding-top:78px!important;box-shadow:-24px 0 60px rgba(0,0,0,.35)}
  aside nav{gap:4px!important}
  aside nav button{min-height:48px!important;border-radius:11px!important;padding:11px 12px!important;color:#cfcfd5!important}
  aside nav button.active{color:#ff5263!important;background:rgba(255,41,63,.11)!important;border-color:rgba(255,41,63,.16)!important}
  aside nav button svg{width:21px;height:21px}
  .gz-drawer-shade{backdrop-filter:blur(2px)}

  .page.active{display:block;padding-top:0}
  .page>.panel:first-child,.page>.stats:first-child{margin-top:0}
  .panel{border-radius:16px!important;margin-bottom:12px!important;background:#050506!important;border-color:#29292f!important}
  .panel-head{padding:14px 13px!important;gap:10px!important;border-color:#232328!important}
  .panel-head h2{font-size:16px!important;line-height:1.35}
  .panel-head>div{width:100%}
  .panel-tools{display:grid!important;grid-template-columns:1fr 1fr!important;gap:7px!important;width:100%!important}
  .panel-tools input{grid-column:1/-1!important;width:100%!important;min-width:0!important;height:43px}
  .panel-tools select,.panel-tools button{width:100%!important;min-width:0!important;min-height:41px!important}

  .stats{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:8px!important;margin-bottom:12px!important}
  .stat{min-width:0!important;min-height:96px!important;padding:13px 8px!important;border-radius:14px!important;text-align:center!important;display:flex!important;flex-direction:column!important;justify-content:center!important}
  .stat span{font-size:9px!important;line-height:1.4;color:#8f8f99!important}
  .stat strong{font-size:20px!important;line-height:1.25;margin-top:4px!important;overflow-wrap:anywhere}
  .stat i{font-size:8px!important;line-height:1.3;margin-top:3px;color:#8f8f99!important}
  [data-page-view="dashboard"] #stats .stat:nth-child(1){background:#a99be6!important;border-color:#a99be6!important}
  [data-page-view="dashboard"] #stats .stat:nth-child(1) *{color:#14121b!important}
  [data-page-view="dashboard"] #stats .stat:nth-child(3){background:#afd6f4!important;border-color:#afd6f4!important}
  [data-page-view="dashboard"] #stats .stat:nth-child(3) *{color:#10151b!important}
  [data-page-view="dashboard"] #stats .stat:nth-child(4){background:#60d890!important;border-color:#60d890!important}
  [data-page-view="dashboard"] #stats .stat:nth-child(4) *{color:#0b2818!important}
  [data-page-view="dashboard"] #stats .stat:nth-child(n+7){display:none!important}

  /* Convert desktop tables into readable mobile cards while preserving all actions. */
  .table-wrap.gz-mobile-cards{overflow:visible!important;background:transparent!important;padding:0 10px 10px}
  .table-wrap.gz-mobile-cards table{display:block!important;min-width:0!important;width:100%!important;border-collapse:separate!important}
  .table-wrap.gz-mobile-cards thead{display:none!important}
  .table-wrap.gz-mobile-cards tbody{display:grid!important;gap:9px!important;width:100%!important}
  .table-wrap.gz-mobile-cards tr{display:grid!important;grid-template-columns:1fr 1fr!important;gap:0!important;width:100%!important;background:#08080a!important;border:1px solid #29292f!important;border-radius:14px!important;overflow:hidden!important;padding:5px 10px!important}
  .table-wrap.gz-mobile-cards td{display:flex!important;min-width:0!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;padding:9px 4px!important;border:0!important;border-bottom:1px solid #1f1f23!important;text-align:left!important;font-size:11px!important;overflow-wrap:anywhere}
  .table-wrap.gz-mobile-cards td::before{content:attr(data-gz-label);color:#777781;font-size:8px;font-weight:600;white-space:nowrap;text-align:right;margin-left:8px}
  .table-wrap.gz-mobile-cards td:nth-last-child(-n+2){border-bottom:0!important}
  .table-wrap.gz-mobile-cards td:first-child{grid-column:1/-1!important;font-size:12px!important;font-weight:700!important;text-align:right!important;justify-content:space-between!important}
  .table-wrap.gz-mobile-cards td:last-child{grid-column:1/-1!important;border-bottom:0!important;justify-content:flex-start!important}
  .table-wrap.gz-mobile-cards td:last-child::before{margin-left:auto}
  .table-wrap.gz-mobile-cards .actions{width:100%!important;display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px!important}
  .table-wrap.gz-mobile-cards .actions button{width:100%!important;min-height:38px!important;border-radius:10px!important;font-size:9px!important}
  .table-wrap.gz-mobile-cards button:not(.actions button){min-height:35px;border-radius:9px}
  .table-wrap.gz-mobile-cards .admin-thumb{width:44px;height:44px;border-radius:10px}

  #quickOrders.table-wrap,#quickOrders{overflow:visible!important}
  #quickOrders table{min-width:0!important}

  .form-panel{padding:14px!important;gap:10px!important}
  .field label{font-size:9px!important;margin-bottom:6px!important}
  .field input,.field select,.field textarea{min-height:44px!important;border-radius:11px!important;background:#0b0b0d!important;border-color:#2e2e34!important;font-size:12px!important}
  .save{min-height:46px!important;border-radius:12px!important;background:linear-gradient(135deg,#ff293f,#c80e25)!important}

  .modal{padding:0!important;align-items:flex-end!important;background:rgba(0,0,0,.67)!important}
  .modal-card{width:100%!important;max-width:none!important;max-height:88dvh!important;overflow:auto!important;border-radius:22px 22px 0 0!important;border-left:0!important;border-right:0!important;border-bottom:0!important;padding:22px 14px calc(18px + env(safe-area-inset-bottom))!important;background:#0a0a0c!important}
  .modal-card .x{position:sticky!important;float:left!important;top:0!important;z-index:2!important;background:#202024!important;border-color:#36363d!important}
  .form-grid{grid-template-columns:1fr!important}
  .field.full{grid-column:auto!important}

  .gz-bottom-nav{height:72px!important;padding:6px 7px max(7px,env(safe-area-inset-bottom))!important;background:rgba(5,5,6,.98)!important;border-color:#242428!important;box-shadow:0 -12px 28px rgba(0,0,0,.2)}
  .gz-bottom-nav button{min-height:54px!important;font-size:8px!important;color:#74747e!important}
  .gz-bottom-nav button svg{width:23px!important;height:23px!important}
  .gz-bottom-nav button.gz-active{color:#ff3449!important}
  .gz-bottom-nav .gz-plus{width:64px!important;height:64px!important;min-height:64px!important;margin-top:-22px!important;font-size:34px!important;background:linear-gradient(145deg,#ff3046,#ef1830)!important;box-shadow:0 12px 28px rgba(255,41,63,.3)!important}

  .gz-quick-sheet{left:9px!important;right:9px!important;bottom:calc(80px + env(safe-area-inset-bottom))!important;border-radius:18px!important;padding:14px!important;max-height:72dvh!important;background:#060607!important;border-color:#303037!important;box-shadow:0 20px 70px rgba(0,0,0,.48)}
  .gz-quick-sheet h3{font-size:16px!important;margin-bottom:12px!important}
  .gz-quick-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:12px 8px!important}
  .gz-quick-grid button{font-size:8px!important;min-width:0!important}
  .gz-quick-grid i{width:54px!important;height:54px!important;border-radius:13px!important;font-size:23px!important;background:#f6f6f8!important}

  .login-gate{padding:14px!important;background:#050506!important}
  .login-card{padding:24px 18px!important;border-radius:22px!important;background:#0a0a0c!important}
  .login-card img{width:76px!important;height:76px!important;border-radius:20px!important}
  .login-card input,.login-card button{min-height:46px!important}
}

@media(max-width:390px){
  .stats{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  .gz-quick-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}
  .table-wrap.gz-mobile-cards tr{grid-template-columns:1fr!important}
  .table-wrap.gz-mobile-cards td,.table-wrap.gz-mobile-cards td:first-child,.table-wrap.gz-mobile-cards td:last-child{grid-column:1!important}
  .table-wrap.gz-mobile-cards td:nth-last-child(-n+2){border-bottom:1px solid #1f1f23!important}
  .table-wrap.gz-mobile-cards td:last-child{border-bottom:0!important}
}
'''
    CSS_PATH.write_text(css, encoding='utf-8')

if JS_MARK not in js:
    js += r'''

// GAME_ZONE_ADMIN_POLISH_V4
(()=>{
  const ready = fn => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn();
  ready(()=>{
    const topbar = document.querySelector('.gz-owner-topbar');
    const pageTitle = document.getElementById('pageTitle');
    const titleEl = topbar?.querySelector('.gz-account b');
    const subEl = topbar?.querySelector('.gz-account span');

    const syncTitle = ()=>{
      if(titleEl) titleEl.textContent = pageTitle?.textContent?.trim() || 'لوحة التحكم';
      if(subEl) subEl.textContent = 'Game Zone • إدارة المتجر';
    };
    syncTitle();
    if(pageTitle) new MutationObserver(syncTitle).observe(pageTitle,{childList:true,subtree:true,characterData:true});

    const enhanceTable = wrap=>{
      if(!wrap || wrap.dataset.gzEnhanced === '1') return;
      const table = wrap.querySelector('table');
      if(!table) return;
      const headers = [...table.querySelectorAll('thead th')].map(x=>x.textContent.trim());
      if(!headers.length) return;
      table.querySelectorAll('tbody tr').forEach(row=>{
        [...row.children].forEach((td,i)=>td.setAttribute('data-gz-label',headers[i]||''));
      });
      wrap.classList.add('gz-mobile-cards');
      wrap.dataset.gzEnhanced='1';
    };

    const enhanceAll = ()=>{
      document.querySelectorAll('.table-wrap').forEach(enhanceTable);
      const quick = document.getElementById('quickOrders');
      if(quick && !quick.classList.contains('table-wrap')) quick.classList.add('table-wrap');
      if(quick) enhanceTable(quick);
    };
    enhanceAll();

    let scheduled=false;
    const observer = new MutationObserver(()=>{
      if(scheduled) return;
      scheduled=true;
      requestAnimationFrame(()=>{scheduled=false;document.querySelectorAll('.table-wrap').forEach(w=>{
        w.dataset.gzEnhanced='';
        enhanceTable(w);
      });});
    });
    const main=document.querySelector('main');
    if(main) observer.observe(main,{childList:true,subtree:true});

    document.addEventListener('keydown',e=>{
      if(e.key!=='Escape') return;
      document.body.classList.remove('gz-drawer-open');
      const sheet=document.querySelector('.gz-quick-sheet');
      const plus=document.getElementById('gzQuickBtn');
      sheet?.classList.remove('gz-show');
      if(plus) plus.textContent='＋';
    });

    const closeFloating=()=>{
      const sheet=document.querySelector('.gz-quick-sheet');
      const plus=document.getElementById('gzQuickBtn');
      if(sheet?.classList.contains('gz-show')){
        sheet.classList.remove('gz-show');
        if(plus) plus.textContent='＋';
      }
    };
    document.querySelectorAll('aside nav button[data-page]').forEach(btn=>btn.addEventListener('click',()=>{
      closeFloating();
      window.scrollTo({top:0,behavior:'smooth'});
      setTimeout(syncTitle,0);
    }));

    window.addEventListener('resize',()=>{if(innerWidth>700){document.body.classList.remove('gz-drawer-open');closeFloating()}});
  });
})();
'''
    JS_PATH.write_text(js, encoding='utf-8')

print('GAME_ZONE_ADMIN_POLISH_V4=APPLIED')
