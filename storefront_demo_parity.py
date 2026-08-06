"""Professional demo-store parity layer with UCHIHA identity assets.

This module recreates the public information architecture and interaction style
of the referenced demo store without copying its source code or brand assets.
"""
from __future__ import annotations

from typing import Any


DEMO_PARITY_CSS = r"""
    /* Demo parity v1 — serious merchant UI with UCHIHA used only as demo identity. */
    :root{
      --bg:#0f1115;--bg-2:#14171c;--panel:#181c22;--panel-2:#1e232b;--panel-3:#242a33;
      --text:#f5f7fa;--muted:#a4acb8;--line:rgba(255,255,255,.085);
      --primary:#c62835;--secondary:#8c1d27;--accent:#d6d9df;
      --primary-rgb:198,40,53;--secondary-rgb:140,29,39;
      --success:#2fad68;--warning:#d8942f;--danger:#d9414d;
      --radius:12px;--shadow:0 18px 48px rgba(0,0,0,.34);
      --control-h:44px;--control-sm:40px;
      --demo-fast:160ms;--demo-base:220ms;--demo-slow:320ms;
      --demo-ease:cubic-bezier(.16,1,.3,1)
    }
    html{background:var(--bg)}
    body{
      background:
        radial-gradient(circle at 88% -15%,rgba(var(--primary-rgb),.075),transparent 28%),
        linear-gradient(180deg,#101217 0%,#0d0f13 100%);
      color:var(--text);
      font-family:"IBM Plex Sans Arabic",Tahoma,"Segoe UI",Arial,sans-serif
    }
    .shell{width:min(1180px,calc(100% - 28px))}
    .top-accent{height:2px;background:var(--primary)}
    .header{
      height:72px;border-bottom:1px solid var(--line);
      background:rgba(15,17,21,.94);backdrop-filter:blur(18px)
    }
    .header-inner{gap:10px}
    .brand{gap:11px}
    .logo{
      width:42px;height:42px;border-radius:11px;
      border:1px solid rgba(var(--primary-rgb),.28);
      background:var(--panel-2);box-shadow:none
    }
    .brand-copy b{font-size:15px;font-weight:900}
    .brand-copy small{font-size:8px;letter-spacing:1px;color:var(--muted)}
    .head-actions{gap:8px}
    .icon-btn,.balance-pill{
      height:var(--control-sm);min-height:var(--control-sm);
      border:1px solid var(--line);border-radius:10px;background:var(--panel);
      transition:background var(--demo-fast),border-color var(--demo-fast),transform var(--demo-fast)
    }
    .icon-btn{width:var(--control-sm)}
    .icon-btn:hover,.balance-pill:hover{background:var(--panel-2);border-color:rgba(var(--primary-rgb),.28)}
    .balance-pill{padding-inline:12px;font-size:11px}
    .main{padding-top:18px}

    /* Promotional slider: simple, readable and close to a classic merchant demo. */
    .hero{
      min-height:210px;aspect-ratio:16/6;border-radius:14px;
      border:1px solid var(--line);background:var(--panel);box-shadow:var(--shadow)
    }
    .slide:after{
      background:linear-gradient(90deg,rgba(10,12,15,.08),rgba(10,12,15,.52) 48%,rgba(10,12,15,.94))
    }
    .slide img{filter:saturate(.82) contrast(1.04) brightness(.76)}
    .slide-copy{width:min(58%,620px);padding:30px}
    .slide-kicker{
      min-height:28px;padding:5px 10px;border-radius:8px;
      border:1px solid rgba(var(--primary-rgb),.26);
      background:rgba(var(--primary-rgb),.09);color:#f1d2d5;
      font-size:9px;letter-spacing:.2px
    }
    .slide h2{margin:12px 0 8px;font-size:clamp(23px,4vw,38px);line-height:1.25}
    .slide p{font-size:12px;line-height:1.8;color:#c9ced6}
    .slide-cta{
      height:var(--control-h);min-height:var(--control-h);padding:0 18px;margin-top:16px;
      display:inline-flex;align-items:center;justify-content:center;
      border:0;border-radius:10px;background:var(--primary);box-shadow:none
    }
    .slider-dots{bottom:12px}
    .dot{height:6px;width:6px}.dot.active{width:22px;background:var(--primary)}

    .ticker{
      min-height:44px;margin:14px 0;padding:10px 14px;border:1px solid var(--line);
      border-radius:11px;background:var(--panel);font-size:11px
    }
    .search-wrap{margin:14px 0 19px}
    .search{
      height:50px;border:1px solid var(--line);border-radius:11px;
      background:var(--panel);padding-inline-start:50px
    }
    .search:focus{border-color:rgba(var(--primary-rgb),.48);box-shadow:0 0 0 3px rgba(var(--primary-rgb),.08)}
    .section-head{margin:20px 0 12px}
    .section-head h2{font-size:18px}
    .section-head p{font-size:10px}

    /* Category layout: equal cards, equal controls, no playful decorative shapes. */
    .category-grid.uchiha-root-grid{
      display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px
    }
    .category-grid.uchiha-sub-grid{
      display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px
    }
    .category-card{
      border:1px solid var(--line)!important;border-radius:12px!important;
      background:var(--panel)!important;box-shadow:none!important;overflow:hidden;
      transition:transform var(--demo-base) var(--demo-ease),border-color var(--demo-base),background var(--demo-base)
    }
    .category-card:hover{transform:translateY(-2px);border-color:rgba(var(--primary-rgb),.34)!important;background:var(--panel-2)!important}
    .category-grid.uchiha-root-grid .category-img,
    .category-grid.uchiha-sub-grid .category-img{aspect-ratio:16/10!important;background:var(--panel-2)}
    .category-img img{filter:saturate(.86) contrast(1.03);transition:transform var(--demo-slow) var(--demo-ease)}
    .category-card:hover .category-img img{transform:scale(1.025)}
    .category-name{
      min-height:46px!important;padding:11px 12px!important;
      display:flex;align-items:center;font-size:12px!important;font-weight:800
    }
    .category-summary{display:none!important}
    .category-icon{display:none!important}
    .category-count,.category-badge{
      top:8px!important;left:8px!important;right:auto!important;
      padding:4px 7px!important;border:1px solid rgba(255,255,255,.1)!important;
      border-radius:7px!important;background:rgba(12,14,18,.78)!important;font-size:8px!important
    }

    .product-section{padding-top:10px}
    body:not(.demo-catalog-mode) .product-section{display:none!important}
    .product-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
    .product-card{
      border:1px solid var(--line);border-radius:12px;
      background:var(--panel);box-shadow:none;
      transition:transform var(--demo-base) var(--demo-ease),border-color var(--demo-base),background var(--demo-base)
    }
    .product-card:hover{transform:translateY(-2px);border-color:rgba(var(--primary-rgb),.32);background:var(--panel-2)}
    .product-img{aspect-ratio:16/10;background:var(--panel-2)}
    .product-img img{filter:saturate(.86) contrast(1.03)}
    .provider-tag{display:none}
    .product-body{padding:12px}
    .product-body h3{min-height:38px;margin-bottom:10px;font-size:11px}
    .price{font-size:14px}.stock{font-size:8px}
    .buy-mini{
      width:34px;height:34px;border-radius:9px;background:var(--primary);box-shadow:none
    }

    /* One control system across storefront and admin-like dialogs. */
    .primary-btn,.outline-btn,.danger-btn,.slide-cta,.modal-card button:not(.icon-btn):not(.buy-mini),
    .page-card button:not(.icon-btn):not(.buy-mini),.method-row{
      min-height:var(--control-h);height:var(--control-h);
      border-radius:10px!important;padding-inline:16px;
      display:inline-flex;align-items:center;justify-content:center;gap:8px;
      font-size:12px;font-weight:800;line-height:1
    }
    .primary-btn{background:var(--primary)!important;border:1px solid var(--primary)!important;color:#fff}
    .outline-btn{background:transparent!important;border:1px solid var(--line)!important;color:var(--text)}
    .danger-btn{background:rgba(217,65,77,.12)!important;border:1px solid rgba(217,65,77,.28)!important;color:#ffadb4}
    .text-btn{min-height:36px;padding:0 10px;border-radius:8px}
    .input,.select,.textarea{
      min-height:var(--control-h);border:1px solid var(--line);border-radius:10px;
      background:#12151a;color:var(--text)
    }
    .textarea{height:auto;min-height:100px}
    .input:focus,.select:focus,.textarea:focus{border-color:rgba(var(--primary-rgb),.48);box-shadow:0 0 0 3px rgba(var(--primary-rgb),.08)}

    .page-card,.drawer,.modal-card{
      border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:var(--shadow)
    }
    .page-title .title-icon{border-radius:10px;background:rgba(var(--primary-rgb),.09);color:var(--primary)}
    .history-row,.order-row,.method-row{border-color:var(--line);border-radius:10px;background:var(--panel-2)}
    .history-icon,.method-icon{border-radius:9px;background:rgba(var(--primary-rgb),.09);color:var(--primary)}
    .status{border-radius:7px}
    .status.completed,.status.approved{background:rgba(47,173,104,.13);color:#76d9a3}
    .status.pending,.status.processing,.status.waiting_payment{background:rgba(216,148,47,.13);color:#efb96b}
    .status.cancelled,.status.rejected{background:rgba(217,65,77,.13);color:#f18a93}

    .bottom-nav{
      border:1px solid var(--line);border-bottom:0;
      background:rgba(17,20,25,.96);backdrop-filter:blur(18px);box-shadow:0 -12px 32px rgba(0,0,0,.2)
    }
    .nav-btn{border-radius:9px;transition:background var(--demo-fast),color var(--demo-fast),transform var(--demo-fast)}
    .nav-btn.active{background:rgba(var(--primary-rgb),.11);color:#fff}

    /* UCHIHA loader only: identity stays in the demo assets, not the whole template. */
    .uchiha-loader{padding:16px;background:transparent}
    .uchiha-loader-backdrop{background:rgba(7,8,10,.5);backdrop-filter:blur(2px)}
    .uchiha-loader-panel{
      width:124px!important;min-height:124px!important;padding:14px!important;
      display:grid!important;place-items:center!important;
      border:1px solid var(--line)!important;border-radius:18px!important;
      background:rgba(20,23,28,.97)!important;box-shadow:0 20px 55px rgba(0,0,0,.46)!important
    }
    .uchiha-loader-panel:before,.uchiha-loader-emblem,.uchiha-loader-title,.uchiha-loader-dots{display:none!important}
    .uchiha-loader-text{display:none!important}
    .demo-uchiha-loader{width:76px;height:76px;position:relative;display:grid;place-items:center}
    .demo-uchiha-loader svg{width:76px;height:76px;display:block;overflow:visible}
    .demo-loader-ring{transform-origin:center;transform-box:view-box;animation:demoLoaderSpin .9s linear infinite}
    .demo-loader-mark{filter:drop-shadow(0 0 8px rgba(var(--primary-rgb),.28))}
    @keyframes demoLoaderSpin{to{transform:rotate(360deg)}}

    .demo-enter{
      animation:demoEnter var(--demo-slow) var(--demo-ease) both;
      animation-delay:calc(var(--demo-index,0) * 36ms)
    }
    @keyframes demoEnter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

    .demo-skeleton{position:relative;overflow:hidden;background:var(--panel-2);border-radius:10px}
    .demo-skeleton:after{
      content:"";position:absolute;inset:0;transform:translateX(-100%);
      background:linear-gradient(90deg,transparent,rgba(255,255,255,.045),transparent);
      animation:demoShimmer 1.35s ease-in-out infinite
    }
    @keyframes demoShimmer{to{transform:translateX(100%)}}

    @media(min-width:620px){
      .category-grid.uchiha-root-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
      .category-grid.uchiha-sub-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
      .product-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
    }
    @media(min-width:960px){
      .category-grid.uchiha-root-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
      .category-grid.uchiha-sub-grid{grid-template-columns:repeat(5,minmax(0,1fr))}
      .product-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
    }
    @media(max-width:620px){
      .shell{width:min(100% - 20px,1180px)}
      .header{height:66px}.brand-copy small{display:none}
      .balance-pill{max-width:108px;padding-inline:9px}
      .hero{min-height:190px;aspect-ratio:auto}.slide-copy{width:78%;padding:20px}
      .slide h2{font-size:23px}.slide p{font-size:10px;line-height:1.65}
      .slide-cta{height:42px;min-height:42px;padding-inline:14px}
      .category-grid.uchiha-root-grid,.category-grid.uchiha-sub-grid{gap:9px}
      .category-name{min-height:42px!important;padding:10px!important;font-size:10px!important}
    }
    @media(prefers-reduced-motion:reduce){
      .demo-enter{animation:none!important;opacity:1;transform:none}
      .demo-loader-ring{animation-duration:2.4s}
      .demo-skeleton:after{animation:none;display:none}
    }
"""


DEMO_PARITY_JS = r'''
  function installDemoParityV1(){
    if(document.documentElement.dataset.demoParityV1==='1')return;
    document.documentElement.dataset.demoParityV1='1';

    const panel=document.querySelector('.uchiha-loader-panel');
    if(panel&&!panel.querySelector('.demo-uchiha-loader')){
      panel.insertAdjacentHTML('afterbegin',`<div class="demo-uchiha-loader" aria-hidden="true">
        <svg viewBox="0 0 76 76" fill="none">
          <circle cx="38" cy="38" r="30" stroke="rgba(255,255,255,.10)" stroke-width="3"/>
          <g class="demo-loader-ring">
            <circle cx="38" cy="38" r="30" stroke="var(--primary)" stroke-width="3"
              stroke-linecap="round" stroke-dasharray="54 132"/>
          </g>
          <g class="demo-loader-mark">
            <path d="M38 20c6.5 6.2 11 12.2 11 19 0 8.3-4.5 14-11 17.5C31.5 53 27 47.3 27 39c0-6.8 4.5-12.8 11-19Z"
              fill="var(--primary)"/>
            <path d="M38 28c-3.4 4.2-5.5 7.8-5.5 11.4 0 4.3 2.2 7.7 5.5 10 3.3-2.3 5.5-5.7 5.5-10 0-3.6-2.1-7.2-5.5-11.4Z"
              fill="#14171c"/>
            <path d="M29.5 44.5c5.8 2.7 11.2 2.7 17 0" stroke="#f6d9dc" stroke-width="2"
              stroke-linecap="round" opacity=".9"/>
          </g>
        </svg>
      </div>`);
    }

    const syncCatalogMode=()=>{
      const active=Boolean(state.category||String(state.query||'').trim());
      document.body.classList.toggle('demo-catalog-mode',active);
    };
    const decorate=(selector)=>{
      document.querySelectorAll(selector).forEach((node,index)=>{
        node.classList.remove('demo-enter');
        node.style.setProperty('--demo-index',String(Math.min(index,12)));
        void node.offsetWidth;
        node.classList.add('demo-enter');
      });
    };
    const normalizeSlides=()=>{
      document.querySelectorAll('.slide-kicker').forEach(node=>{
        node.innerHTML='<span>UCHIHA STORE</span>';
      });
    };
    const normalizeDemoCopy=()=>{
      const announcement=document.querySelector('#announcement');
      if(announcement&&!announcement.textContent.trim()){
        announcement.textContent='هذه نسخة تجريبية للمعاينة — جميع البيانات والصور قابلة للتخصيص من لوحة الإدارة.';
      }
    };

    const oldRenderCategories=renderCategories;
    renderCategories=function(){
      const result=oldRenderCategories();
      decorate('#categoryGrid .category-card');
      syncCatalogMode();
      return result;
    };
    const oldRenderProducts=renderProducts;
    renderProducts=function(){
      const result=oldRenderProducts();
      decorate('#productGrid .product-card');
      syncCatalogMode();
      return result;
    };
    const oldRenderSlides=renderSlides;
    renderSlides=function(){
      const result=oldRenderSlides();
      normalizeSlides();
      decorate('#slides .slide');
      return result;
    };
    const oldSelectCategory=selectCategory;
    selectCategory=function(id){
      document.body.classList.add('demo-catalog-mode');
      return oldSelectCategory(id);
    };
    const oldShowView=showView;
    showView=function(name){
      const result=oldShowView(name);
      if(name==='home')syncCatalogMode();
      return result;
    };

    const search=document.querySelector('.search');
    if(search){
      search.addEventListener('input',()=>requestAnimationFrame(syncCatalogMode),{passive:true});
    }
    normalizeDemoCopy();
    normalizeSlides();
    syncCatalogMode();
    decorate('#categoryGrid .category-card');
    decorate('#productGrid .product-card');
  }
  installDemoParityV1();
'''


def _inject_before_once(document: str, marker: str, content: str, name: str) -> str:
    if marker not in document:
        raise RuntimeError(f"{name} marker was not found")
    return document.replace(marker, content + marker, 1)


def patch_storefront_html(document: str) -> str:
    if "demoParityV1" in document:
        return document
    document = _inject_before_once(document, "  </style>", DEMO_PARITY_CSS + "\n", "Customer style")
    document = _inject_before_once(document, "  boot();\n  </script>", DEMO_PARITY_JS + "\n", "Customer boot")
    return document


def install(api_module: Any) -> None:
    if getattr(api_module, "_storefront_demo_parity_installed", False):
        return
    import storefront_theme

    customer = patch_storefront_html(api_module._STOREFRONT_HTML)
    api_module._STOREFRONT_HTML = customer
    storefront_theme.STOREFRONT_HTML = customer
    api_module._storefront_demo_parity_installed = True


__all__ = ["install", "patch_storefront_html"]
