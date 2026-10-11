#!/usr/bin/env python3
"""v1.5.35 premium customer sort trigger + bottom sheet."""
from pathlib import Path
import sys

def once(s,a,b,label):
    n=s.count(a)
    if n!=1: raise SystemExit(f"{label}: expected one match, got {n}")
    return s.replace(a,b,1)

def main():
    if len(sys.argv)!=2: raise SystemExit("usage: patch_v191.py debt-app")
    root=Path(sys.argv[1]).resolve()

    gradle=root/"app/build.gradle"
    g=gradle.read_text(encoding="utf-8")
    g=once(g,"versionCode 1053400","versionCode 1053500","versionCode")
    g=once(g,"versionName '1.5.34'","versionName '1.5.35'","versionName")
    gradle.write_text(g,encoding="utf-8")

    sync=root/"app/src/main/assets/sync-v165.js"
    q=sync.read_text(encoding="utf-8")
    q=once(q,"const SYNC_VERSION='1.5.34';","const SYNC_VERSION='1.5.35';","sync version")
    sync.write_text(q,encoding="utf-8")

    app=root/"app/src/main/assets/app.js"
    s=app.read_text(encoding="utf-8")
    s=once(s,
      "function closeModal(){ $('modal').classList.add('hidden'); $('modalCard').innerHTML=''; }",
      "function closeModal(){ $('modal').classList.remove('client-sort-sheet-open'); $('modal').classList.add('hidden'); $('modalCard').innerHTML=''; }",
      "modal close cleanup")
    app.write_text(s,encoding="utf-8")

    ui=root/"app/src/main/assets/app-v121.js"
    s=ui.read_text(encoding="utf-8")

    old_open="""window.openClientSortV190=function(){
  const current=clientSortModeV190();
  const options=[
    ['usd_desc','↓','الأعلى دينًا بالدولار'],
    ['usd_asc','↑','الأقل دينًا بالدولار'],
    ['try_desc','↓','الأعلى دينًا بالتركي'],
    ['try_asc','↑','الأقل دينًا بالتركي'],
    ['oldest','◷','الأقدم إضافة'],
    ['newest','◴','الأحدث إضافة'],
    ['name','أ','الاسم أ–ي'],
    ['pinned_name','★','المثبتون أولًا']
  ];
  openModal(`<h3>ترتيب العملاء</h3><div class="small muted" style="margin:-4px 0 12px">الترتيب يعمل على نفس الأرصدة الظاهرة في قائمة العملاء</div><div style="display:grid;gap:8px">${options.map(([key,icon,title])=>`<button class="card row" style="width:100%;text-align:right;cursor:pointer;${key===current?'outline:2px solid var(--primary);':''}" onclick="setClientSortV190('${key}')"><span style="font-size:20px;min-width:28px;text-align:center">${icon}</span><span class="grow"><b>${title}</b></span>${key===current?'<span class="badge green">محدد</span>':'<span>‹</span>'}</button>`).join('')}</div><div class="modal-actions"><button class="btn ghost" onclick="closeModal()">إغلاق</button></div>`);
};"""
    new_open="""window.openClientSortV190=function(){
  const current=clientSortModeV190();
  const options=[
    ['usd_desc','USD','الأعلى دينًا','الأكبر أولًا'],
    ['usd_asc','USD','الأقل دينًا','الأصغر أولًا'],
    ['try_desc','TRY','الأعلى دينًا','الأكبر أولًا'],
    ['try_asc','TRY','الأقل دينًا','الأصغر أولًا'],
    ['oldest','⌛','الأقدم إضافة','العملاء الأقدم أولًا'],
    ['newest','✨','الأحدث إضافة','الجدد أولًا'],
    ['name','أ–ي','الاسم','ترتيب أبجدي'],
    ['pinned_name','★','المثبتون أولًا','ثم الاسم']
  ];
  $('modal').classList.add('client-sort-sheet-open');
  openModal(`<div class="client-sort-sheet-v191">
    <div class="client-sort-handle-v191"></div>
    <div class="client-sort-head-v191"><div><h3>ترتيب العملاء</h3><p>اختر الطريقة المناسبة لعرض القائمة</p></div><button class="client-sort-close-v191" onclick="closeModal()">×</button></div>
    <div class="client-sort-grid-v191">${options.map(([key,tag,title,sub])=>`<button class="client-sort-option-v191 ${key===current?'active':''}" onclick="setClientSortV190('${key}')"><span class="client-sort-icon-v191">${tag}</span><span class="client-sort-copy-v191"><b>${title}</b><small>${sub}</small></span><span class="client-sort-check-v191">${key===current?'✓':''}</span></button>`).join('')}</div>
  </div>`);
};"""
    s=once(s,old_open,new_open,"sort sheet")

    old_row="""  <div class="row" style="gap:8px;align-items:stretch;margin:0 0 8px"><div class="searchbox grow" style="margin:0;min-width:0"><input class="input" placeholder="ابحث بالاسم أو الهاتف" value="${esc(clientSearch)}" oninput="searchRenderV125('clients',this.value)"></div><button class="btn" style="min-width:94px;white-space:nowrap" onclick="openClientSortV190()">↕ ترتيب</button></div>
  <div class="small muted" style="margin:0 4px 10px">حسب: <b>${esc(clientSortLabelV190())}</b> · ${list.length} عميل</div>"""
    new_row="""  <div class="client-search-sort-row-v191"><div class="searchbox client-search-v191"><input class="input" placeholder="ابحث بالاسم أو الهاتف" value="${esc(clientSearch)}" oninput="searchRenderV125('clients',this.value)"></div><button class="client-sort-trigger-v191" onclick="openClientSortV190()" aria-label="ترتيب العملاء"><span class="client-sort-trigger-icon-v191"><i></i><i></i><i></i></span><span>ترتيب</span><b>⌄</b></button></div>
  <div class="client-list-meta-v191"><span>${list.length} عميل</span><span class="client-sort-current-v191">↕ ${esc(clientSortLabelV190())}</span></div>"""
    s=once(s,old_row,new_row,"sort trigger row")
    ui.write_text(s,encoding="utf-8")

    css=root/"app/src/main/assets/client-sort-v191.css"
    css.write_text(r'''
.client-search-sort-row-v191{display:flex;gap:10px;align-items:center;margin:0 0 8px}
.client-search-v191{flex:1;margin:0!important;min-width:0}
.client-search-v191 .input{min-height:54px;border-radius:18px}
.client-sort-trigger-v191{height:54px;min-width:104px;padding:0 14px;border-radius:18px;border:1px solid rgba(91,183,255,.34);background:linear-gradient(180deg,rgba(18,41,61,.96),rgba(10,27,42,.96));color:#e9f6ff;display:flex;align-items:center;justify-content:center;gap:9px;font:inherit;font-weight:800;box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 8px 22px rgba(0,0,0,.14);transition:.18s ease}
.client-sort-trigger-v191:active{transform:scale(.97);border-color:#5bb7ff;background:linear-gradient(180deg,#173c5b,#0d2b43)}
.client-sort-trigger-v191>b{font-size:13px;color:#79c8ff;line-height:1}
.client-sort-trigger-icon-v191{width:22px;height:22px;display:grid;align-content:center;gap:4px}
.client-sort-trigger-icon-v191 i{height:2px;border-radius:99px;background:#70c9ff;display:block;position:relative}
.client-sort-trigger-icon-v191 i:nth-child(1){width:18px}.client-sort-trigger-icon-v191 i:nth-child(2){width:13px}.client-sort-trigger-icon-v191 i:nth-child(3){width:8px}
.client-list-meta-v191{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:2px 4px 12px;color:#8fa8bf;font-size:11px}
.client-sort-current-v191{display:inline-flex;align-items:center;gap:5px;border:1px solid #203d57;background:#0c1f30;padding:5px 9px;border-radius:999px;color:#9fcfff;max-width:68%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.client-sort-sheet-open{align-items:flex-end!important;padding:0!important}
.client-sort-sheet-open .modal-card{width:100%!important;max-width:680px!important;max-height:78vh!important;margin:0 auto!important;border-radius:28px 28px 0 0!important;padding:0!important;background:linear-gradient(180deg,#102536 0%,#0b1b29 100%)!important;border:1px solid #25435d!important;border-bottom:0!important;box-shadow:0 -24px 80px rgba(0,0,0,.45)!important;overflow:auto!important;animation:clientSheetUpV191 .22s cubic-bezier(.2,.8,.2,1)}
@keyframes clientSheetUpV191{from{transform:translateY(24px);opacity:.3}to{transform:translateY(0);opacity:1}}
.client-sort-sheet-v191{padding:10px 16px calc(18px + env(safe-area-inset-bottom))}
.client-sort-handle-v191{width:46px;height:5px;border-radius:99px;background:#4c6578;margin:2px auto 14px;opacity:.72}
.client-sort-head-v191{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
.client-sort-head-v191 h3{margin:0 0 4px;font-size:20px;color:#f5fbff}.client-sort-head-v191 p{margin:0;color:#819bb0;font-size:12px}
.client-sort-close-v191{width:38px;height:38px;border-radius:13px;border:1px solid #28475e;background:#122c40;color:#a9c8db;font-size:24px;line-height:1}
.client-sort-grid-v191{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.client-sort-option-v191{min-height:72px;border:1px solid #203f57;border-radius:18px;background:linear-gradient(180deg,#0e2638,#0b1f2f);color:#eaf6ff;padding:11px 12px;display:flex;align-items:center;gap:10px;text-align:right;font:inherit;position:relative;box-shadow:inset 0 1px 0 rgba(255,255,255,.025)}
.client-sort-option-v191.active{border-color:#48aefc;background:linear-gradient(180deg,rgba(24,78,118,.92),rgba(13,48,75,.96));box-shadow:0 0 0 2px rgba(72,174,252,.12),inset 0 1px 0 rgba(255,255,255,.06)}
.client-sort-icon-v191{min-width:42px;height:42px;border-radius:13px;background:#132f45;border:1px solid #294e69;display:flex;align-items:center;justify-content:center;color:#71c9ff;font-weight:900;font-size:12px}
.client-sort-option-v191.active .client-sort-icon-v191{background:#154d77;border-color:#3ea8f7;color:#fff}
.client-sort-copy-v191{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}.client-sort-copy-v191 b{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.client-sort-copy-v191 small{font-size:10px;color:#7893a8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.client-sort-option-v191.active .client-sort-copy-v191 small{color:#a9d8f8}
.client-sort-check-v191{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;background:#1599ed;font-size:12px;font-weight:900;flex:none}
@media(max-width:390px){.client-sort-trigger-v191{min-width:92px;padding:0 11px}.client-sort-grid-v191{gap:7px}.client-sort-option-v191{min-height:68px;padding:9px}.client-sort-icon-v191{min-width:38px;height:38px}.client-sort-copy-v191 b{font-size:12px}}
''',encoding="utf-8")

    index=root/"app/src/main/assets/index.html"
    x=index.read_text(encoding="utf-8")
    if 'client-sort-v191.css' not in x:
        x=x.replace('</head>','  <link rel="stylesheet" href="client-sort-v191.css">\n</head>')
    index.write_text(x,encoding="utf-8")
    print("Applied v1.5.35 premium customer sort UI")

if __name__=="__main__":
    main()
