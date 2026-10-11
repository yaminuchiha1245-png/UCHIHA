#!/usr/bin/env python3
"""v1.5.34: make customer sorting visible in the real app-v121 clients screen."""
from pathlib import Path
import sys

def once(s,a,b,label):
    n=s.count(a)
    if n!=1:
        raise SystemExit(f"{label}: expected one match, got {n}")
    return s.replace(a,b,1)

def main():
    if len(sys.argv)!=2:
        raise SystemExit("usage: patch_v190.py debt-app")
    root=Path(sys.argv[1]).resolve()

    gradle=root/"app/build.gradle"
    g=gradle.read_text(encoding="utf-8")
    g=once(g,"versionCode 1053300","versionCode 1053400","versionCode")
    g=once(g,"versionName '1.5.33'","versionName '1.5.34'","versionName")
    gradle.write_text(g,encoding="utf-8")

    sync=root/"app/src/main/assets/sync-v165.js"
    q=sync.read_text(encoding="utf-8")
    q=once(q,"const SYNC_VERSION='1.5.33';","const SYNC_VERSION='1.5.34';","sync version")
    sync.write_text(q,encoding="utf-8")

    p=root/"app/src/main/assets/app-v121.js"
    s=p.read_text(encoding="utf-8")

    old="""window.renderClients=function(){
  const q=clientSearch.trim().toLowerCase();
  const list=[...state.clients].sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||a.name.localeCompare(b.name,'ar')).filter(c=>!q||c.name.toLowerCase().includes(q)||(c.phone||'').includes(q));
  const items=list.map(c=>{const b=clientCurrencyDebtV121(c.id);return `<div class="client-item client-item-v121" onclick="openClient('${c.id}')"><div class="avatar">${esc(initials(c.name))}</div><div class="grow"><div class="name">${esc(c.name)} ${c.pinned?'⭐':''}</div><div class="small muted">${c.phone?esc(c.phone):c.area==='outside'?'خارج القرية':'ضمن القرية'}</div><div class="client-currency-line-v121">${curInlineV121(b)}</div></div><span>‹</span></div>`;}).join('');
  const body=`<div class="row"><div class="grow"><div class="section-title" style="margin-top:4px">العملاء</div></div><button class="btn primary" onclick="openAddClient()">＋ عميل</button></div><div class="searchbox"><input class="input" placeholder="ابحث بالاسم أو الهاتف" value="${esc(clientSearch)}" oninput="searchRenderV125('clients',this.value)"></div><div id="clientResultsV125" class="card" style="padding:4px 12px">${items||`<div class="empty"><div class="emoji">👥</div><b>لا يوجد عملاء</b>أضف أول عميل للبدء</div>`}</div>`;
  return shell('العملاء',body);
};
"""

    new="""function clientSortModeV190(){
  const raw=String(state.settings?.clientSort||'pinned_name');
  const legacy={debt_desc:'usd_desc',debt_asc:'usd_asc',purchase_desc:'usd_desc',purchase_asc:'usd_asc'};
  const key=legacy[raw]||raw;
  return ['pinned_name','usd_desc','usd_asc','try_desc','try_asc','oldest','newest','name'].includes(key)?key:'pinned_name';
}
function clientSortLabelV190(key=clientSortModeV190()){
  return ({
    pinned_name:'المثبتون أولًا',
    usd_desc:'الأعلى دينًا USD',
    usd_asc:'الأقل دينًا USD',
    try_desc:'الأعلى دينًا TRY',
    try_asc:'الأقل دينًا TRY',
    oldest:'الأقدم إضافة',
    newest:'الأحدث إضافة',
    name:'الاسم أ–ي'
  })[key]||'المثبتون أولًا';
}
function compareClientsV190(a,b,key=clientSortModeV190()){
  const aa=clientCurrencyDebtV121(a.id),bb=clientCurrencyDebtV121(b.id);
  let d=0;
  if(key==='usd_desc')d=bb.USD-aa.USD;
  else if(key==='usd_asc')d=aa.USD-bb.USD;
  else if(key==='try_desc')d=bb.TRY-aa.TRY;
  else if(key==='try_asc')d=aa.TRY-bb.TRY;
  else if(key==='oldest')d=(new Date(a.createdAt||0).getTime()||0)-(new Date(b.createdAt||0).getTime()||0);
  else if(key==='newest')d=(new Date(b.createdAt||0).getTime()||0)-(new Date(a.createdAt||0).getTime()||0);
  else if(key==='pinned_name')d=(b.pinned?1:0)-(a.pinned?1:0);
  if(Math.abs(d)>0.000001)return d;
  return String(a.name||'').localeCompare(String(b.name||''),'ar');
}
window.openClientSortV190=function(){
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
};
window.setClientSortV190=function(key){
  if(!['pinned_name','usd_desc','usd_asc','try_desc','try_asc','oldest','newest','name'].includes(key))return;
  state.settings.clientSort=key;
  saveState();
  closeModal();
  render();
};
window.renderClients=function(){
  const q=clientSearch.trim().toLowerCase();
  const list=state.clients.filter(c=>!q||c.name.toLowerCase().includes(q)||(c.phone||'').includes(q)).sort((a,b)=>compareClientsV190(a,b));
  const items=list.map(c=>{const b=clientCurrencyDebtV121(c.id);return `<div class="client-item client-item-v121" onclick="openClient('${c.id}')"><div class="avatar">${esc(initials(c.name))}</div><div class="grow"><div class="name">${esc(c.name)} ${c.pinned?'⭐':''}</div><div class="small muted">${c.phone?esc(c.phone):c.area==='outside'?'خارج القرية':'ضمن القرية'}</div><div class="client-currency-line-v121">${curInlineV121(b)}</div></div><span>‹</span></div>`;}).join('');
  const body=`<div class="row"><div class="grow"><div class="section-title" style="margin-top:4px">العملاء</div></div><button class="btn primary" onclick="openAddClient()">＋ عميل</button></div>
  <div class="row" style="gap:8px;align-items:stretch;margin:0 0 8px"><div class="searchbox grow" style="margin:0;min-width:0"><input class="input" placeholder="ابحث بالاسم أو الهاتف" value="${esc(clientSearch)}" oninput="searchRenderV125('clients',this.value)"></div><button class="btn" style="min-width:94px;white-space:nowrap" onclick="openClientSortV190()">↕ ترتيب</button></div>
  <div class="small muted" style="margin:0 4px 10px">حسب: <b>${esc(clientSortLabelV190())}</b> · ${list.length} عميل</div>
  <div id="clientResultsV125" class="card" style="padding:4px 12px">${items||`<div class="empty"><div class="emoji">👥</div><b>لا يوجد عملاء</b>أضف أول عميل للبدء</div>`}</div>`;
  return shell('العملاء',body);
};
"""
    s=once(s,old,new,"real v121 clients screen")
    p.write_text(s,encoding="utf-8")

    print("Applied v1.5.34 visible customer sorting to app-v121")

if __name__=="__main__":
    main()
