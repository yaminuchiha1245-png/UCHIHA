"""Customer UI patch for recursive category browsing."""

from __future__ import annotations


CATEGORY_CSS = r"""
    .category-hero{position:relative;min-height:155px;margin:0 0 14px;overflow:hidden;border:1px solid rgba(var(--primary-rgb),.22);border-radius:22px;background:var(--panel);isolation:isolate}.category-hero:after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(90deg,rgba(8,9,13,.12),rgba(8,9,13,.78) 58%,rgba(8,9,13,.96))}.category-hero img{position:absolute;inset:0;z-index:-2;width:100%;height:100%;object-fit:cover}.category-hero-copy{height:100%;min-height:155px;display:flex;flex-direction:column;justify-content:center;padding:22px;width:min(72%,620px)}.category-hero-copy span{width:max-content;padding:5px 9px;border-radius:99px;background:rgba(var(--primary-rgb),.13);color:#ffc3c8;font-size:9px;font-weight:900}.category-hero-copy h2{margin:10px 0 5px;font-size:24px}.category-hero-copy p{margin:0;color:#c8c0c3;font-size:10px;line-height:1.8}
    .category-breadcrumbs{display:flex;align-items:center;gap:6px;overflow:auto;padding:2px 0 11px;scrollbar-width:none}.category-breadcrumbs::-webkit-scrollbar{display:none}.crumb{flex:0 0 auto;border:1px solid var(--line);border-radius:11px;background:var(--panel);padding:8px 10px;color:var(--muted);font-size:9px;cursor:pointer}.crumb.active{color:#fff;border-color:rgba(var(--primary-rgb),.3);background:rgba(var(--primary-rgb),.08)}.crumb-separator{color:#665e61;font-size:11px}
    .category-card{isolation:isolate}.category-icon{position:absolute;right:9px;bottom:43px;width:38px;height:38px;padding:5px;border:1px solid rgba(255,255,255,.16);border-radius:12px;background:rgba(8,9,13,.8);object-fit:contain;backdrop-filter:blur(8px)}.category-badge{position:absolute;right:8px;top:8px;padding:5px 7px;border-radius:8px;background:var(--primary);color:#fff;font-size:8px;font-weight:900}.category-summary{display:flex;align-items:center;justify-content:space-between;gap:7px;padding:0 10px 11px;color:var(--muted);font-size:8px}.category-summary b{color:#d9d3d5;font-size:8px}.category-empty-note{grid-column:1/-1;padding:26px 17px;border:1px dashed rgba(255,255,255,.12);border-radius:18px;background:rgba(18,18,24,.5);text-align:center;color:var(--muted);font-size:11px;line-height:1.8}
    @media(max-width:680px){.category-hero-copy{width:86%;padding:18px}.category-hero-copy h2{font-size:21px}.category-icon{width:34px;height:34px;bottom:39px}}
"""

OLD_CATEGORY_MARKUP = r'''        <div class="section-head" id="categories"><div><h2>أقسام المتجر</h2><p>اختر القسم المناسب لك</p></div><button class="text-btn" id="allProducts">عرض الكل</button></div>
        <div class="category-grid" id="categoryGrid"><div class="loading">جاري تحميل الأقسام...</div></div>'''

NEW_CATEGORY_MARKUP = r'''        <div class="category-hero" id="categoryHero" hidden></div>
        <nav class="category-breadcrumbs" id="categoryBreadcrumbs" aria-label="مسار الأقسام"></nav>
        <div class="section-head" id="categories"><div><h2 id="categoryTitle">أقسام المتجر</h2><p id="categorySubtitle">اختر القسم المناسب لك</p></div><button class="text-btn" id="allProducts">العودة للرئيسية</button></div>
        <div class="category-grid" id="categoryGrid"><div class="loading">جاري تحميل الأقسام...</div></div>'''

OLD_RENDER = """  function renderCategories(){const roots=state.categories.filter(c=>!c.parent_id&&c.product_count>0);$('#categoryGrid').innerHTML=roots.length?roots.map(c=>`<button class=\"category-card\" style=\"--card-accent:${esc(c.accent)}\" data-category=\"${c.id}\"><div class=\"category-img\"><img src=\"${esc(c.image_url)}\" loading=\"lazy\" alt=\"${esc(c.name)}\"></div><span class=\"category-count\">${c.product_count}</span><div class=\"category-name\">${esc(c.name)}</div></button>`).join(''):'<div class=\"empty\">لا توجد أقسام مفعّلة حاليًا.</div>';$$('[data-category]').forEach(b=>b.onclick=()=>selectCategory(b.dataset.category))}
"""

NEW_RENDER = r'''  function currentCategory(){return state.categories.find(c=>String(c.id)===String(state.category||''))||null}
  function categoryChildren(parentId){const parent=Number(parentId||0);return state.categories.filter(c=>Number(c.parent_id||0)===parent&&Number(c.product_count||0)>0).sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)||String(a.name).localeCompare(String(b.name),'ar'))}
  function categoryPath(){const path=[];let current=currentCategory(),seen=new Set();while(current&&!seen.has(current.id)){seen.add(current.id);path.unshift(current);current=state.categories.find(c=>Number(c.id)===Number(current.parent_id||0))||null}return path}
  function renderCategoryChrome(){const cat=currentCategory(),path=categoryPath(),children=categoryChildren(cat?.id||0);$('#categoryTitle').textContent=cat?`داخل ${cat.name}`:'أقسام المتجر';$('#categorySubtitle').textContent=children.length?`${children.length} أقسام داخلية • اختر القسم المناسب`:(cat?'المنتجات المتوفرة في هذا القسم':'اختر القسم المناسب لك');$('#allProducts').hidden=!cat;$('#categoryBreadcrumbs').innerHTML=[`<button class="crumb ${cat?'':'active'}" data-crumb="">الرئيسية</button>`,...path.flatMap((c,i)=>[(i?'<span class="crumb-separator">‹</span>':''),`<button class="crumb ${i===path.length-1?'active':''}" data-crumb="${c.id}">${esc(c.name)}</button>`])].join('');$$('[data-crumb]').forEach(b=>b.onclick=()=>selectCategory(b.dataset.crumb));const hero=$('#categoryHero');if(cat){hero.hidden=false;hero.innerHTML=`<img src="${esc(cat.banner_url||cat.image_url)}" alt=""><div class="category-hero-copy">${cat.badge?`<span>${esc(cat.badge)}</span>`:''}<h2>${esc(cat.name)}</h2><p>${esc(cat.description||`${cat.product_count||0} منتج متوفر ضمن هذا القسم`)}</p></div>`}else{hero.hidden=true;hero.innerHTML=''};$('#products').hidden=Boolean(children.length&&!state.query)}
  function renderCategories(){const parent=currentCategory()?.id||0,rows=categoryChildren(parent);$('#categoryGrid').innerHTML=rows.length?rows.map(c=>`<button class="category-card" style="--card-accent:${esc(c.accent)}" data-category="${c.id}"><div class="category-img"><img src="${esc(c.image_url)}" loading="lazy" alt="${esc(c.name)}"></div>${c.badge?`<span class="category-badge">${esc(c.badge)}</span>`:''}<img class="category-icon" src="${esc(c.icon_url||c.image_url)}" loading="lazy" alt=""><span class="category-count">${c.product_count}</span><div class="category-name">${esc(c.name)}</div><div class="category-summary"><span>${c.child_count?`${c.child_count} أقسام`:'منتجات مباشرة'}</span><b>فتح ‹</b></div></button>`).join(''):(currentCategory()?.has_children?'<div class="category-empty-note">لا توجد أقسام ظاهرة هنا حاليًا.</div>':'');$$('[data-category]').forEach(b=>b.onclick=()=>selectCategory(b.dataset.category));renderCategoryChrome()}
'''

OLD_LOAD = """  async function loadCatalog(append=false){if(!append){state.page=1;$('#productGrid').innerHTML='<div class=\"loading\">جاري تحميل المنتجات...</div>'}const params=new URLSearchParams({page:String(state.page),limit:'48'});if(state.category)params.set('category_id',state.category);if(state.query)params.set('q',state.query);try{const data=await api('/v1/storefront/public-catalog?'+params);state.store=data.store||state.store;state.banners=data.banners||[];state.categories=data.categories||[];state.pages=data.products?.pages||0;state.total=data.products?.total||0;const batch=data.products?.items||[];state.products=append?[...state.products,...batch]:batch;document.title=state.store.name||'Uchiha Store';applyTheme();$('#announcement').textContent=state.store.announcement||'';renderSlides();renderCategories();renderProducts();renderSupport();updateAccountUI()}catch(e){$('#productGrid').innerHTML=`<div class=\"empty\">${esc(e.message)}</div>`;toast(e.message,true)}}
  function selectCategory(id){state.category=String(id||'');const cat=state.categories.find(c=>String(c.id)===state.category);$('#productsTitle').textContent=cat?.name||'كل المنتجات';loadCatalog(false).then(()=>$('#products').scrollIntoView({behavior:'smooth'}))}
"""

NEW_LOAD = r'''  async function loadCatalog(append=false){if(!append){state.page=1;$('#productGrid').innerHTML='<div class="loading">جاري تحميل المنتجات...</div>'}const params=new URLSearchParams({page:String(state.page),limit:'48'});if(state.category)params.set('category_id',state.category);if(state.query)params.set('q',state.query);try{const data=await api('/v1/storefront/public-catalog?'+params);state.store=data.store||state.store;state.banners=data.banners||[];state.categories=data.categories||[];state.pages=data.products?.pages||0;state.total=data.products?.total||0;const batch=data.products?.items||[];state.products=append?[...state.products,...batch]:batch;document.title=state.store.name||'Uchiha Store';applyTheme();$('#announcement').textContent=state.store.announcement||'';renderSlides();renderCategories();renderProducts();renderSupport();updateAccountUI()}catch(e){$('#productGrid').innerHTML=`<div class="empty">${esc(e.message)}</div>`;toast(e.message,true)}}
  function selectCategory(id){state.category=String(id||'');state.query='';$('#searchInput').value='';const cat=state.categories.find(c=>String(c.id)===state.category);$('#productsTitle').textContent=cat?.name||'كل المنتجات';loadCatalog(false).then(()=>$('#categories').scrollIntoView({behavior:'smooth',block:'start'}))}
'''


def patch_storefront_html(document: str) -> str:
    if "categoryBreadcrumbs" in document:
        return document
    if OLD_CATEGORY_MARKUP not in document:
        raise RuntimeError("Category markup marker was not found")
    if OLD_RENDER not in document:
        raise RuntimeError("Category render marker was not found")
    if OLD_LOAD not in document:
        raise RuntimeError("Catalog marker was not found")
    document = document.replace(OLD_CATEGORY_MARKUP, NEW_CATEGORY_MARKUP, 1)
    document = document.replace("  </style>", CATEGORY_CSS + "\n  </style>", 1)
    document = document.replace(OLD_RENDER, NEW_RENDER, 1)
    document = document.replace(OLD_LOAD, NEW_LOAD, 1)
    document = document.replace("$('#allProducts').onclick=()=>selectCategory('');", "$('#allProducts').onclick=()=>selectCategory('');", 1)
    return document


__all__ = ["patch_storefront_html"]
