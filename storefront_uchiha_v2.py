"""UCHIHA v2 storefront skin: premium dark UI, circular loader and smooth entry motion."""
from __future__ import annotations

from typing import Any


UCHIHA_V2_CSS = r"""
    /* UCHIHA v2 — visual tokens based on the approved dark storefront direction. */
    :root{
      --bg:#0d0d10;--bg-2:#131318;--panel:#17171d;--panel-2:#1d1d24;--panel-3:#22222a;
      --text:#f2f2f5;--muted:#a5a5b0;--line:rgba(255,255,255,.08);
      --primary:#c02a35;--secondary:#8f1f29;--accent:#b05a3c;
      --primary-rgb:192,42,53;--secondary-rgb:143,31,41;
      --gold:#d5d5dc;--danger:#d9414d;
      --shadow:0 18px 50px rgba(0,0,0,.38);--radius:18px;
      --uchiha-fast:160ms;--uchiha-base:220ms;--uchiha-slow:320ms;
      --uchiha-ease:cubic-bezier(.16,1,.3,1)
    }
    html{background:var(--bg)}
    body{
      background:
        radial-gradient(circle at 88% -12%,rgba(var(--primary-rgb),.12),transparent 27%),
        radial-gradient(circle at -12% 42%,rgba(176,90,60,.07),transparent 25%),
        linear-gradient(180deg,#0d0d10 0%,#0b0b0e 100%);
      font-family:"IBM Plex Sans Arabic",Tahoma,"Segoe UI",Arial,sans-serif
    }
    .top-accent{height:2px;background:linear-gradient(90deg,transparent,var(--primary),var(--accent),transparent)}
    .header{height:72px;border-bottom-color:var(--line);background:rgba(13,13,16,.92);backdrop-filter:blur(16px)}
    .header-inner{gap:10px}
    .logo{width:42px;height:42px;border-radius:50%;border:1px solid rgba(var(--primary-rgb),.34);box-shadow:0 8px 24px rgba(var(--primary-rgb),.16)}
    .brand-copy b{font-size:15px;letter-spacing:.2px}.brand-copy small{font-size:8px;color:var(--primary)}
    .icon-btn,.balance-pill{border-color:var(--line);background:rgba(23,23,29,.9);transition:transform var(--uchiha-fast) var(--uchiha-ease),border-color var(--uchiha-fast),background var(--uchiha-fast)}
    .icon-btn:hover{border-color:rgba(var(--primary-rgb),.36);background:var(--panel-2)}
    .icon-btn:active,.nav-btn:active,.category-card:active,.product-card:active,.primary-btn:active,.outline-btn:active{transform:scale(.97)}
    .balance-pill{background:rgba(var(--primary-rgb),.08);border-color:rgba(var(--primary-rgb),.24)}
    .balance-pill i{box-shadow:0 0 0 4px rgba(var(--primary-rgb),.1)}
    .main{padding-top:16px}
    .hero{min-height:190px;border-radius:18px;border-color:rgba(var(--primary-rgb),.22);background:
      radial-gradient(circle at 22% 35%,rgba(var(--primary-rgb),.19),transparent 22%),
      linear-gradient(135deg,#17171d,#0f0f13);box-shadow:0 18px 50px rgba(0,0,0,.34)}
    .hero:before{content:"";position:absolute;inset:0;z-index:0;pointer-events:none;opacity:.32;background-image:radial-gradient(circle at center,rgba(255,255,255,.16) 0 1px,transparent 1.5px);background-size:26px 26px;mask-image:linear-gradient(90deg,transparent,#000 45%,transparent)}
    .slide:after{background:linear-gradient(90deg,rgba(13,13,16,.12),rgba(13,13,16,.62) 53%,rgba(13,13,16,.96))}
    .slide img{filter:saturate(.76) contrast(1.07) brightness(.72)}
    .slide-copy{position:relative;z-index:1;padding:26px}
    .slide-kicker{border-color:rgba(var(--primary-rgb),.3);background:rgba(var(--primary-rgb),.1);color:#f1c7cb}
    .slide h2{font-size:clamp(23px,4vw,40px)}
    .slide-cta,.primary-btn{background:linear-gradient(135deg,var(--primary),var(--secondary));box-shadow:0 10px 25px rgba(var(--primary-rgb),.2);transition:transform var(--uchiha-fast) var(--uchiha-ease),filter var(--uchiha-fast)}
    .slide-cta:hover,.primary-btn:hover{filter:brightness(1.08)}
    .ticker,.search,.page-card{border-color:var(--line);background:rgba(23,23,29,.88)}
    .ticker{border-radius:14px}.ticker i{box-shadow:0 0 0 4px rgba(var(--primary-rgb),.1)}
    .search{height:52px;border-radius:14px;transition:border-color var(--uchiha-fast),box-shadow var(--uchiha-fast)}
    .search:focus{border-color:rgba(var(--primary-rgb),.5);box-shadow:0 0 0 3px rgba(var(--primary-rgb),.09)}
    .section-head h2{font-size:19px}.section-head p{font-size:10px}
    .category-grid.uchiha-root-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .category-grid.uchiha-root-grid .category-card{border-radius:16px;box-shadow:none}
    .category-grid.uchiha-root-grid .category-img{aspect-ratio:4/3}
    .category-grid.uchiha-sub-grid{gap:10px}
    .category-card,.product-card{border-color:var(--line);background:linear-gradient(155deg,#1b1b21,#141419);transition:transform var(--uchiha-base) var(--uchiha-ease),border-color var(--uchiha-base),background var(--uchiha-base)}
    .category-card:hover,.product-card:hover{transform:translateY(-3px);border-color:rgba(var(--primary-rgb),.34);background:linear-gradient(155deg,#202027,#16161b)}
    .category-img,.product-img{background:linear-gradient(145deg,#202027,#15151a)}
    .category-img img,.product-img img{filter:saturate(.82) contrast(1.03);transition:transform var(--uchiha-slow) var(--uchiha-ease),filter var(--uchiha-slow)}
    .category-card:hover img,.product-card:hover img{transform:scale(1.035);filter:saturate(.95) contrast(1.06)}
    .category-count,.provider-tag{border:1px solid rgba(255,255,255,.1);background:rgba(13,13,16,.78);backdrop-filter:blur(8px)}
    .buy-mini{background:linear-gradient(135deg,var(--primary),var(--secondary));box-shadow:none}
    .bottom-nav{border-color:var(--line);background:rgba(15,15,19,.94);backdrop-filter:blur(18px)}
    .nav-btn{transition:transform var(--uchiha-fast) var(--uchiha-ease),color var(--uchiha-fast),background var(--uchiha-fast)}
    .nav-btn.active{color:#fff;background:rgba(var(--primary-rgb),.11)}
    .drawer,.modal-card{border-color:var(--line);background:#17171d;box-shadow:0 24px 70px rgba(0,0,0,.52)}
    .input,.select,.textarea{border-color:var(--line);background:#121217}
    .status.completed,.status.approved{background:rgba(47,173,104,.13);color:#75d8a2}
    .status.pending,.status.processing,.status.waiting_payment{background:rgba(224,145,47,.13);color:#f0b96c}
    .status.cancelled,.status.rejected{background:rgba(217,65,77,.13);color:#f18a93}

    /* The home page remains clean: products appear only after choosing a category or searching. */
    body:not(.uchiha-catalog-mode) .product-section{display:none!important}

    /* One-time, GPU-friendly staggered entrance. */
    .uchiha-v2-enter{animation:uchihaV2Enter var(--uchiha-slow) var(--uchiha-ease) both;animation-delay:calc(var(--uchiha-i,0) * 42ms)}
    @keyframes uchihaV2Enter{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}

    /* Approved circular loader: SVG/CSS only, no GIF and no emoji. */
    .uchiha-loader{padding:16px;background:transparent;transition:opacity var(--uchiha-base),visibility var(--uchiha-base)}
    .uchiha-loader-backdrop{background:rgba(7,7,10,.46);backdrop-filter:blur(2px)}
    .uchiha-loader-panel{width:170px!important;min-height:150px!important;padding:18px!important;border:1px solid var(--line)!important;border-radius:18px!important;background:rgba(19,19,24,.96)!important;box-shadow:0 20px 60px rgba(0,0,0,.48)!important}
    .uchiha-loader-panel:before,.uchiha-loader-emblem,.uchiha-loader-dots{display:none!important}
    .uchiha-loader-title{display:none!important}
    .uchiha-loader-text{display:block!important;margin:12px 0 0!important;color:var(--muted)!important;font-size:11px!important;line-height:1.6!important;text-align:center}
    .uchiha-v2-spinner{position:relative;width:64px;height:64px;margin:auto;display:grid;place-items:center}
    .uchiha-v2-spinner svg{width:64px;height:64px;display:block;overflow:visible}
    .uchiha-v2-spinner-ring{transform-origin:center;transform-box:view-box;animation:uchihaV2Spin .9s linear infinite}
    .uchiha-v2-spinner-core{filter:drop-shadow(0 0 8px rgba(var(--primary-rgb),.28))}
    @keyframes uchihaV2Spin{to{transform:rotate(360deg)}}

    /* Lightweight skeleton utility for dynamically generated placeholders. */
    .uchiha-v2-skeleton{position:relative;overflow:hidden;background:var(--panel-2);border-radius:12px}
    .uchiha-v2-skeleton:after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.05),transparent);animation:uchihaV2Shimmer 1.4s ease-in-out infinite}
    @keyframes uchihaV2Shimmer{to{transform:translateX(100%)}}

    @media(min-width:620px){.category-grid.uchiha-root-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}}
    @media(min-width:980px){.category-grid.uchiha-root-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}}
    @media(max-width:620px){
      .shell{width:min(100% - 22px,1120px)}.header{height:68px}.brand-copy small{display:none}
      .balance-pill{max-width:108px;padding-inline:9px}.slide-copy{width:76%;padding:20px}.slide p{font-size:11px}
      .hero{border-radius:16px}.category-grid.uchiha-root-grid{gap:10px}
    }
    @media(prefers-reduced-motion:reduce){
      .uchiha-v2-enter{animation:none!important;opacity:1;transform:none}
      .uchiha-v2-spinner-ring{animation-duration:2.4s}
      .uchiha-v2-skeleton:after{animation:none;display:none}
    }
"""


UCHIHA_V2_JS = r'''
  function installUchihaV2(){
    if(document.documentElement.dataset.uchihaV2==='1')return;
    document.documentElement.dataset.uchihaV2='1';

    const loaderPanel=document.querySelector('.uchiha-loader-panel');
    if(loaderPanel&&!loaderPanel.querySelector('.uchiha-v2-spinner')){
      loaderPanel.insertAdjacentHTML('afterbegin',`<div class="uchiha-v2-spinner" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="25" stroke="rgba(255,255,255,.10)" stroke-width="3"/><g class="uchiha-v2-spinner-ring"><circle cx="32" cy="32" r="25" stroke="var(--primary)" stroke-width="3" stroke-linecap="round" stroke-dasharray="48 110"/></g><g class="uchiha-v2-spinner-core" fill="var(--primary)"><path d="M32 17c5 5 9 10 9 16 0 7-4 12-9 15-5-3-9-8-9-15 0-6 4-11 9-16Zm0 9c-2 3-4 6-4 9 0 3 1.7 5.7 4 7.4 2.3-1.7 4-4.4 4-7.4 0-3-2-6-4-9Z"/></g></svg></div>`);
    }

    const syncCatalogMode=()=>{
      const active=Boolean(state.category||String(state.query||'').trim());
      document.body.classList.toggle('uchiha-catalog-mode',active);
    };
    const decorate=(selector)=>{
      document.querySelectorAll(selector).forEach((node,index)=>{
        node.classList.remove('uchiha-v2-enter');
        node.style.setProperty('--uchiha-i',String(Math.min(index,10)));
        void node.offsetWidth;
        node.classList.add('uchiha-v2-enter');
      });
    };
    const replaceKicker=()=>{
      document.querySelectorAll('.slide-kicker').forEach(node=>{
        node.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6"/><path d="M12 6c2.2 2 4 4.2 4 6.7 0 2.7-1.7 4.7-4 6-2.3-1.3-4-3.3-4-6C8 10.2 9.8 8 12 6Z" fill="currentColor"/></svg><span>هوية UCHIHA</span>';
      });
    };

    const oldRenderCategories=renderCategories;
    renderCategories=function(){const result=oldRenderCategories();decorate('#categoryGrid .category-card');syncCatalogMode();return result};
    const oldRenderProducts=renderProducts;
    renderProducts=function(){const result=oldRenderProducts();decorate('#productGrid .product-card');syncCatalogMode();return result};
    const oldRenderSlides=renderSlides;
    renderSlides=function(){const result=oldRenderSlides();replaceKicker();decorate('#slides .slide');return result};
    const oldSelectCategory=selectCategory;
    selectCategory=function(id){document.body.classList.add('uchiha-catalog-mode');return oldSelectCategory(id)};
    const oldShowView=showView;
    showView=function(name){const result=oldShowView(name);if(name==='home')syncCatalogMode();return result};

    const search=document.querySelector('.search');
    if(search){search.addEventListener('input',()=>requestAnimationFrame(syncCatalogMode),{passive:true})}
    const categoryGrid=document.querySelector('#categoryGrid');
    const productGrid=document.querySelector('#productGrid');
    const observer=new MutationObserver(records=>{
      if(records.some(record=>record.addedNodes.length)){
        if(categoryGrid)decorate('#categoryGrid .category-card');
        if(productGrid)decorate('#productGrid .product-card');
      }
    });
    if(categoryGrid)observer.observe(categoryGrid,{childList:true});
    if(productGrid)observer.observe(productGrid,{childList:true});
    syncCatalogMode();
  }
  installUchihaV2();
'''


def _inject_before_once(document: str, marker: str, content: str, name: str) -> str:
    if marker not in document:
        raise RuntimeError(f"{name} marker was not found")
    return document.replace(marker, content + marker, 1)


def patch_storefront_html(document: str) -> str:
    """Apply the v2 storefront skin once without changing API contracts."""
    if "installUchihaV2" in document:
        return document
    document = _inject_before_once(document, "  </style>", UCHIHA_V2_CSS + "\n", "Customer style")
    document = _inject_before_once(document, "  boot();\n  </script>", UCHIHA_V2_JS + "\n", "Customer boot")
    return document


def install(api_module: Any) -> None:
    if getattr(api_module, "_storefront_uchiha_v2_installed", False):
        return
    import storefront_theme

    customer = patch_storefront_html(api_module._STOREFRONT_HTML)
    api_module._STOREFRONT_HTML = customer
    storefront_theme.STOREFRONT_HTML = customer
    api_module._storefront_uchiha_v2_installed = True


__all__ = ["install", "patch_storefront_html"]
