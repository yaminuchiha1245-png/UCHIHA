#!/usr/bin/env python3
"""v1.5.33: customer sorting beside search with persisted sort selection."""
from pathlib import Path
import sys

def once(s,a,b,label):
    n=s.count(a)
    if n!=1:
        raise SystemExit(f"{label}: expected one match, got {n}")
    return s.replace(a,b,1)

def main():
    if len(sys.argv)!=2:
        raise SystemExit("usage: patch_v189.py debt-app")
    root=Path(sys.argv[1]).resolve()

    gradle=root/"app/build.gradle"
    g=gradle.read_text(encoding="utf-8")
    g=once(g,"versionCode 1053200","versionCode 1053300","versionCode")
    g=once(g,"versionName '1.5.32'","versionName '1.5.33'","versionName")
    gradle.write_text(g,encoding="utf-8")

    app=root/"app/src/main/assets/app.js"
    s=app.read_text(encoding="utf-8")

    s=once(
        s,
        "      lockMinutes:5\n",
        "      lockMinutes:5, clientSort:'pinned_name'\n",
        "default client sort"
    )

    old_card="""function clientCard(c,action='open'){
  const f=clientFlags(c), warn=f.overLimit||f.overdue;
  return `<div class="client-item" onclick="${action==='purchase'?`choosePurchaseClient('${c.id}')`:action==='payment'?`choosePaymentClient('${c.id}')`:`openClient('${c.id}')`}"><div class="avatar">${esc(initials(c.name))}</div><div class="grow"><div class="name">${esc(c.name)} ${c.pinned?'⭐':''}</div><div class="small muted">${c.phone?esc(c.phone):c.area==='outside'?'خارج القرية':'ضمن القرية'} ${warn?'· ⚠️':''}</div></div><div class="debt ${warn?'danger-text':''}">$${fmt(f.debt)}</div><span>‹</span></div>`;
}
function renderClients(){
  const q=clientSearch.trim().toLowerCase();
  const list=[...state.clients].sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||a.name.localeCompare(b.name,'ar')).filter(c=>!q||c.name.toLowerCase().includes(q)||(c.phone||'').includes(q));
  const body=`<div class="row"><div class="grow"><div class="section-title" style="margin-top:4px">العملاء</div></div><button class="btn primary" onclick="openAddClient()">＋ عميل</button></div>
  <div class="searchbox"><input class="input" placeholder="ابحث بالاسم أو الهاتف" value="${esc(clientSearch)}" oninput="clientSearch=this.value;render()"></div>
  <div class="card" style="padding:4px 12px">${list.length?list.map(c=>clientCard(c)).join(''):`<div class="empty"><div class="emoji">👥</div><b>لا يوجد عملاء</b>أضف أول عميل للبدء</div>`}</div>`;
  return shell('العملاء',body);
}
"""
    new_card="""function clientPurchaseTotal(id){
  return round2(state.entries.filter(e=>e.clientId===id&&['purchase','opening'].includes(e.type)).reduce((sum,e)=>sum+num(e.usdAmount),0));
}
function clientCreatedTime(c){
  const t=new Date(c?.createdAt||0).getTime();
  return Number.isFinite(t)?t:0;
}
function clientSortKey(){
  const key=String(state.settings?.clientSort||'pinned_name');
  return ['pinned_name','debt_desc','debt_asc','purchase_desc','purchase_asc','oldest','newest','name'].includes(key)?key:'pinned_name';
}
function clientSortLabel(key=clientSortKey()){
  return ({
    pinned_name:'المثبتون أولًا',
    debt_desc:'الأعلى دينًا',
    debt_asc:'الأقل دينًا',
    purchase_desc:'الأكثر شراءً',
    purchase_asc:'الأقل شراءً',
    oldest:'الأقدم إضافة',
    newest:'الأحدث إضافة',
    name:'الاسم أ–ي'
  })[key]||'المثبتون أولًا';
}
function compareClientsForSort(a,b,key=clientSortKey()){
  let d=0;
  if(key==='debt_desc')d=clientDebt(b.id)-clientDebt(a.id);
  else if(key==='debt_asc')d=clientDebt(a.id)-clientDebt(b.id);
  else if(key==='purchase_desc')d=clientPurchaseTotal(b.id)-clientPurchaseTotal(a.id);
  else if(key==='purchase_asc')d=clientPurchaseTotal(a.id)-clientPurchaseTotal(b.id);
  else if(key==='oldest')d=clientCreatedTime(a)-clientCreatedTime(b);
  else if(key==='newest')d=clientCreatedTime(b)-clientCreatedTime(a);
  else if(key==='pinned_name')d=(b.pinned?1:0)-(a.pinned?1:0);
  if(Math.abs(d)>0.000001)return d;
  return String(a.name||'').localeCompare(String(b.name||''),'ar');
}
function clientSortHint(c){
  const key=clientSortKey();
  if(key==='purchase_desc'||key==='purchase_asc')return 'مشتريات $'+fmt(clientPurchaseTotal(c.id));
  if(key==='oldest'||key==='newest')return 'أضيف '+dateFmt(c.createdAt);
  return '';
}
function openClientSort(){
  const current=clientSortKey();
  const options=[
    ['debt_desc','↓','الأعلى دينًا','أكبر رصيد دين أولًا'],
    ['debt_asc','↑','الأقل دينًا','أصغر رصيد دين أولًا'],
    ['purchase_desc','↓','الأكثر شراءً','أعلى إجمالي مشتريات'],
    ['purchase_asc','↑','الأقل شراءً','أقل إجمالي مشتريات'],
    ['oldest','◷','الأقدم إضافة','أقدم عميل في الدفتر أولًا'],
    ['newest','◴','الأحدث إضافة','آخر عميل أُضيف أولًا'],
    ['name','أ','الاسم أ–ي','ترتيب أبجدي'],
    ['pinned_name','★','المثبتون أولًا','ثم ترتيب الاسم']
  ];
  openModal(`<h3>ترتيب العملاء</h3><div class="small muted" style="margin:-4px 0 12px">اختر طريقة ترتيب قائمة العملاء</div>
    <div style="display:grid;gap:8px">${options.map(([key,icon,title,sub])=>`<button class="card row" style="width:100%;text-align:right;cursor:pointer;${key===current?'outline:2px solid var(--primary);':''}" onclick="setClientSort('${key}')"><span style="font-size:20px;min-width:28px;text-align:center">${icon}</span><span class="grow"><b>${title}</b><span class="small muted" style="display:block;margin-top:3px">${sub}</span></span>${key===current?'<span class="badge green">محدد</span>':'<span>‹</span>'}</button>`).join('')}</div>
    <div class="modal-actions"><button class="btn ghost" onclick="closeModal()">إغلاق</button></div>`);
}
function setClientSort(key){
  if(!['pinned_name','debt_desc','debt_asc','purchase_desc','purchase_asc','oldest','newest','name'].includes(key))return;
  state.settings.clientSort=key;
  saveState();
  closeModal();
  render();
}
function clientCard(c,action='open'){
  const f=clientFlags(c), warn=f.overLimit||f.overdue, hint=action==='open'?clientSortHint(c):'';
  return `<div class="client-item" onclick="${action==='purchase'?`choosePurchaseClient('${c.id}')`:action==='payment'?`choosePaymentClient('${c.id}')`:`openClient('${c.id}')`}"><div class="avatar">${esc(initials(c.name))}</div><div class="grow"><div class="name">${esc(c.name)} ${c.pinned?'⭐':''}</div><div class="small muted">${c.phone?esc(c.phone):c.area==='outside'?'خارج القرية':'ضمن القرية'} ${warn?'· ⚠️':''}${hint?` · ${esc(hint)}`:''}</div></div><div class="debt ${warn?'danger-text':''}">$${fmt(f.debt)}</div><span>‹</span></div>`;
}
function renderClients(){
  const q=clientSearch.trim().toLowerCase();
  const list=state.clients.filter(c=>!q||c.name.toLowerCase().includes(q)||(c.phone||'').includes(q)).sort((a,b)=>compareClientsForSort(a,b));
  const body=`<div class="row"><div class="grow"><div class="section-title" style="margin-top:4px">العملاء</div></div><button class="btn primary" onclick="openAddClient()">＋ عميل</button></div>
  <div class="row" style="gap:8px;align-items:stretch;margin:0 0 8px"><div class="searchbox grow" style="margin:0;min-width:0"><input class="input" placeholder="ابحث بالاسم أو الهاتف" value="${esc(clientSearch)}" oninput="clientSearch=this.value;render()"></div><button class="btn" style="white-space:nowrap;min-width:88px" onclick="openClientSort()">↕ ترتيب</button></div>
  <div class="small muted" style="margin:0 4px 10px">الترتيب: <b>${esc(clientSortLabel())}</b> · ${list.length} عميل</div>
  <div class="card" style="padding:4px 12px">${list.length?list.map(c=>clientCard(c)).join(''):`<div class="empty"><div class="emoji">👥</div><b>لا يوجد عملاء</b>أضف أول عميل للبدء</div>`}</div>`;
  return shell('العملاء',body);
}
"""
    s=once(s,old_card,new_card,"customer sort UI")
    app.write_text(s,encoding="utf-8")

    sync=root/"app/src/main/assets/sync-v165.js"
    q=sync.read_text(encoding="utf-8")
    q=once(q,"const SYNC_VERSION='1.5.32';","const SYNC_VERSION='1.5.33';","sync version")
    old_existing="""      c.cloudId=row.id;
      c.remoteId=c.remoteId||row.id;
      c.syncKey=row.source_key||c.syncKey||('cloud-client:'+row.id);delete c.restoreLegacy;
      c.pinned=!!c.pinned||!!row.pinned;
      if(!txt(c.phone)&&row.phone)c.phone=row.phone;
      if(!txt(c.address)&&row.address)c.address=row.address;
"""
    new_existing="""      c.cloudId=row.id;
      c.remoteId=c.remoteId||row.id;
      c.syncKey=row.source_key||c.syncKey||('cloud-client:'+row.id);delete c.restoreLegacy;
      c.pinned=!!c.pinned||!!row.pinned;
      // Keep customer age identical on owner and partner devices.
      if(row.created_at)c.createdAt=row.created_at;
      if(row.created_by_name)c.createdBy=row.created_by_name;
      if(!txt(c.phone)&&row.phone)c.phone=row.phone;
      if(!txt(c.address)&&row.address)c.address=row.address;
"""
    q=once(q,old_existing,new_existing,"customer createdAt convergence")
    sync.write_text(q,encoding="utf-8")

    print("Applied v1.5.33 customer sorting beside search")

if __name__=="__main__":
    main()
