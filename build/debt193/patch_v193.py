#!/usr/bin/env python3
"""v1.5.37: single-stage boot UI + remove duplicate legacy sync + idle-aware sync scheduling."""
from pathlib import Path
import sys

def once(s,a,b,label):
    n=s.count(a)
    if n!=1:
        raise SystemExit(f"{label}: expected one match, got {n}")
    return s.replace(a,b,1)

def main():
    if len(sys.argv)!=2:
        raise SystemExit("usage: patch_v193.py debt-app")
    root=Path(sys.argv[1]).resolve()

    # Version.
    gradle=root/"app/build.gradle"
    g=gradle.read_text(encoding="utf-8")
    g=once(g,"versionCode 1053600","versionCode 1053700","versionCode")
    g=once(g,"versionName '1.5.36'","versionName '1.5.37'","versionName")
    gradle.write_text(g,encoding="utf-8")

    # Boot shield is active before any legacy UI script can paint.
    index=root/"app/src/main/assets/index.html"
    h=index.read_text(encoding="utf-8")
    boot='''  <script>
    window.__UCHIHA_MODERN_SYNC_BOOT=true;
    window.__uchihaLastInteraction=(window.performance&&performance.now)?performance.now():Date.now();
    document.documentElement.classList.add('uchiha-booting');
  </script>
  <style>
    html.uchiha-booting body{background:#07131d!important;overflow:hidden}
    html.uchiha-booting #app{visibility:hidden!important;opacity:0!important}
    html.uchiha-booting body::before{content:"";position:fixed;inset:0;background:#07131d;z-index:2147483000}
    html.uchiha-booting body::after{content:"";position:fixed;z-index:2147483001;width:38px;height:38px;left:50%;top:48%;margin:-19px 0 0 -19px;border:3px solid rgba(91,183,255,.16);border-top-color:#5bb7ff;border-radius:50%;animation:uchihaBootSpin .72s linear infinite}
    @keyframes uchihaBootSpin{to{transform:rotate(360deg)}}
    button,a,[onclick]{touch-action:manipulation}
  </style>
'''
    h=once(h,"  <title>دفتر الديون</title>\n","  <title>دفتر الديون</title>\n"+boot,"boot shield")
    h=once(h,'  <script src="partner-entry-v186.js"></script>\n',
           '  <script src="partner-entry-v186.js"></script>\n  <script src="runtime-v193.js"></script>\n',
           "final runtime include")
    index.write_text(h,encoding="utf-8")

    # Prevent the base UI from painting before late overrides have loaded.
    app=root/"app/src/main/assets/app.js"
    s=app.read_text(encoding="utf-8")
    s=once(s,
      """function nav(v){
  drawerOpen=false; view=v; clientSearch='';""",
      """function nav(v){
  if(v===view&&!drawerOpen)return;
  drawerOpen=false; view=v; clientSearch='';""",
      "avoid active-tab rerender")
    s=once(s,
      """document.addEventListener('visibilitychange',()=>{if(!document.hidden && sessionAccountId)ensureRatesFresh();});
render();
""",
      """document.addEventListener('visibilitychange',()=>{if(!document.hidden && sessionAccountId)ensureRatesFresh();});
if(!window.__UCHIHA_MODERN_SYNC_BOOT)render();
""",
      "base initial render gate")
    app.write_text(s,encoding="utf-8")

    # Disable the old startup/full-pull path. Modern sync owns all cloud hydration.
    v110=root/"app/src/main/assets/app-v110.js"
    s=v110.read_text(encoding="utf-8")
    old_init="""async function initCloudV110(){ensureCloudState();const ns=cloudStatusNative();if(ns.signedIn){state.cloud.userId=ns.userId||state.cloud.userId;state.cloud.email=ns.email||state.cloud.email;if(cloudLinked()){await cloudHydrateStore();if(state.cloud.pending.length)await flushCloudQueue();if(!state.cloud.pending.length)await cloudPull(false);}}else if(cloudLinked()){state.cloud.online=false;}saveState();render();}"""
    new_init="""async function initCloudV110(){
  ensureCloudState();
  const ns=cloudStatusNative();
  if(window.__UCHIHA_MODERN_SYNC_BOOT){
    if(ns.signedIn){state.cloud.userId=ns.userId||state.cloud.userId;state.cloud.email=ns.email||state.cloud.email;}
    else if(cloudLinked())state.cloud.online=false;
    return;
  }
  if(ns.signedIn){state.cloud.userId=ns.userId||state.cloud.userId;state.cloud.email=ns.email||state.cloud.email;if(cloudLinked()){await cloudHydrateStore();if(state.cloud.pending.length)await flushCloudQueue();if(!state.cloud.pending.length)await cloudPull(false);}}else if(cloudLinked()){state.cloud.online=false;}saveState();render();
}"""
    s=once(s,old_init,new_init,"disable legacy startup pull")
    s=once(s,
      """document.addEventListener('visibilitychange',()=>{if(!document.hidden&&sessionAccountId&&cloudLinked())cloudPull(false);});""",
      """document.addEventListener('visibilitychange',()=>{if(window.__UCHIHA_MODERN_SYNC_BOOT)return;if(!document.hidden&&sessionAccountId&&cloudLinked())cloudPull(false);});""",
      "disable legacy resume pull")
    v110.write_text(s,encoding="utf-8")

    # The licensing layer also used to paint before the final store UI scripts.
    v145=root/"app/src/main/assets/app-v145.js"
    s=v145.read_text(encoding="utf-8")
    s=once(s,
      """window.UCHIHA_UI_VERSION=VERSION;
render();
if(licensed())refreshStatus().then(()=>{if(!showActivation&&!page)render();});""",
      """window.UCHIHA_UI_VERSION=VERSION;
if(!window.__UCHIHA_MODERN_SYNC_BOOT)render();
if(licensed())refreshStatus().then(()=>{if(!showActivation&&!page&&(!window.__UCHIHA_MODERN_SYNC_BOOT||window.__UCHIHA_BOOT_READY))render();});""",
      "license initial paint gate")
    v145.write_text(s,encoding="utf-8")

    # Modern sync: halve passive cloud reads, avoid giant JSON allocations,
    # persist less often, and never start a heavy sync in the middle of tapping.
    sync=root/"app/src/main/assets/sync-v165.js"
    s=sync.read_text(encoding="utf-8")
    s=once(s,"const SYNC_VERSION='1.5.36';","const SYNC_VERSION='1.5.37';","sync version")
    s=once(s,
      """let lastPresenceAt=0,realtimeStartedStore='';
let legacyFlushBusy=false;""",
      """let lastPresenceAt=0,realtimeStartedStore='';
let legacyFlushBusy=false,lastPersistAt=0;""",
      "sync runtime state")

    old_safe="""function safePersist(){
  applying=true;
  try{
    if(!state.cloudSync)state.cloudSync={};
    const syncedAt=new Date().toISOString();
    state.cloudSync.version=SYNC_VERSION;
    state.cloudSync.lastSuccess=syncedAt;
    state.cloudSync.lastError='';
    if(state.cloud){
      state.cloud.online=true;
      state.cloud.lastSyncAt=syncedAt;
      state.cloud.lastError='';
    }
    saveState();
  }finally{applying=false;}
}"""
    new_safe="""function safePersist(force=false){
  if(!state.cloudSync)state.cloudSync={};
  const syncedAt=new Date().toISOString();
  state.cloudSync.version=SYNC_VERSION;
  state.cloudSync.lastSuccess=syncedAt;
  state.cloudSync.lastError='';
  if(state.cloud){
    state.cloud.online=true;
    state.cloud.lastSyncAt=syncedAt;
    state.cloud.lastError='';
  }
  if(!force&&Date.now()-lastPersistAt<60000)return;
  applying=true;
  try{saveState();lastPersistAt=Date.now();}finally{applying=false;}
}"""
    s=once(s,old_safe,new_safe,"throttled sync persistence")

    old_sig="""function screenSignature(){
  // Stable UI fields only; sync timestamps and internal cloud IDs do not
  // warrant replacing the user's active page or moving the scroll position.
  return JSON.stringify([
    (state.clients||[]).map(c=>[c.id,c.name,c.phone,c.address,c.pinned,c.debtLimit,c.maxDays]),
    (state.entries||[]).map(e=>[e.id,e.clientId,e.type,e.originalCurrency,e.originalAmount,
      e.usdAmount,e.paidUsd,e.remainingUsd,e.description,e.createdAt,e.date,
      (e.allocations||[]).map(a=>[a.entryId,a.usd])])
  ]);
}"""
    new_sig="""function screenSignature(){
  // Allocation-light signature: the old JSON.stringify of the whole ledger
  // created large temporary arrays on every sync and caused visible jank.
  let h=2166136261,count=0;
  const mix=v=>{const x=String(v??'');count++;for(let i=0;i<x.length;i++)h=Math.imul(h^x.charCodeAt(i),16777619);};
  for(const c of state.clients||[]){mix(c.id);mix(c.name);mix(c.phone);mix(c.address);mix(c.pinned?1:0);mix(c.debtLimit);mix(c.maxDays);}
  for(const e of state.entries||[]){
    mix(e.id);mix(e.clientId);mix(e.type);mix(e.originalCurrency);mix(e.originalAmount);mix(e.usdAmount);
    mix(e.paidUsd);mix(e.remainingUsd);mix(e.description);mix(e.createdAt);mix(e.date);
    for(const a of e.allocations||[]){mix(a.entryId);mix(a.usd);mix(a.originalAmount);mix(a.currency);}
  }
  return count+':'+(h>>>0).toString(16);
}"""
    s=once(s,old_sig,new_sig,"lightweight screen signature")

    # Record whether the first snapshot actually needs a convergence re-fetch.
    s=once(s,
      """    const {storeId,userId}=membership;
    state.cloudSync.storeId=storeId;state.cloudSync.userId=userId;state.cloudSync.linked=true;
    const [customers,transactions]=await Promise.all([""",
      """    const {storeId,userId}=membership;
    state.cloudSync.storeId=storeId;state.cloudSync.userId=userId;state.cloudSync.linked=true;
    const hadLocalMutations=(state.clients||[]).some(c=>!c.cloudId)||(state.entries||[]).some(e=>!e.cloudId);
    const hadLegacyPending=!!(state.cloud?.pending?.length);
    const [customers,transactions]=await Promise.all([""",
      "detect local sync mutations")

    old_final="""    const [finalCustomers,finalTransactions]=await Promise.all([
      getAll('/rest/v1/customers?select=*&store_id=eq.'+encodeURIComponent(storeId)+'&is_deleted=eq.false&order=created_at.asc',500),
      getAll('/rest/v1/transactions?select=*&store_id=eq.'+encodeURIComponent(storeId)+'&is_deleted=eq.false&order=created_at.asc',500)
    ]);
    clientMap=await syncCustomers(storeId,userId,finalCustomers);"""
    new_final="""    let finalCustomers=customers,finalTransactions=transactions;
    if(hadLocalMutations||hadLegacyPending){
      [finalCustomers,finalTransactions]=await Promise.all([
        getAll('/rest/v1/customers?select=*&store_id=eq.'+encodeURIComponent(storeId)+'&is_deleted=eq.false&order=created_at.asc',500),
        getAll('/rest/v1/transactions?select=*&store_id=eq.'+encodeURIComponent(storeId)+'&is_deleted=eq.false&order=created_at.asc',500)
      ]);
    }
    clientMap=await syncCustomers(storeId,userId,finalCustomers);"""
    s=once(s,old_final,new_final,"skip redundant passive refetch")

    s=once(s,
      """    state.cloudSync.echoesIgnored=authoritative.echoesRemoved;
    await touchMember(storeId,userId);
    safePersist();
    if(hadPriorSync&&addedRemoteIds.length""",
      """    state.cloudSync.echoesIgnored=authoritative.echoesRemoved;
    const changed=beforeScreen!==screenSignature();
    await touchMember(storeId,userId);
    safePersist(changed||hadLocalMutations||hadLegacyPending);
    if(hadPriorSync&&addedRemoteIds.length""",
      "persist only meaningful sync")
    s=once(s,
      """    maybeRender(beforeScreen!==screenSignature());""",
      """    maybeRender(changed);""",
      "reuse sync change result")

    old_sched="""function schedule(delay=700){
  clearTimeout(timer);
  timer=setTimeout(run,Math.max(100,delay));
}"""
    new_sched="""function interactionAge(){
  const now=(window.performance&&performance.now)?performance.now():Date.now();
  const last=Number(window.__uchihaLastInteraction||0);
  return last?now-last:999999;
}
function schedule(delay=700){
  clearTimeout(timer);
  const fire=()=>{
    // Keep network reconciliation off the critical path of taps, typing and
    // page transitions. It resumes automatically as soon as the UI is idle.
    if(!document.hidden&&(hasTypingFocus()||interactionAge()<1600)){
      timer=setTimeout(fire,450);
      return;
    }
    run();
  };
  timer=setTimeout(fire,Math.max(150,delay));
}"""
    s=once(s,old_sched,new_sched,"idle-aware sync scheduler")
    s=once(s,
      """  if(!applying&&initialised)schedule(900);""",
      """  if(!applying&&initialised)schedule(1100);""",
      "defer post-save sync")
    sync.write_text(s,encoding="utf-8")

    # Loaded last, after every historical override. This is the only boot reveal.
    runtime=root/"app/src/main/assets/runtime-v193.js"
    runtime.write_text(r"""/* UCHIHA Debt Store v1.5.37 — final runtime gate and interaction marker. */
(function(){
'use strict';
const now=()=>window.performance&&performance.now?performance.now():Date.now();
const mark=()=>{window.__uchihaLastInteraction=now();};
window.__uchihaLastInteraction=window.__uchihaLastInteraction||now();
document.addEventListener('pointerdown',mark,{capture:true,passive:true});
document.addEventListener('touchstart',mark,{capture:true,passive:true});
document.addEventListener('keydown',mark,{capture:true,passive:true});

function reveal(){
  window.__UCHIHA_BOOT_READY=true;
  try{if(typeof render==='function')render();}catch(_e){}
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    document.documentElement.classList.remove('uchiha-booting');
  }));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',reveal,{once:true});
else reveal();
window.UCHIHA_RUNTIME_VERSION='1.5.37';
})();
""",encoding="utf-8")

    print("Applied v1.5.37: single boot paint, no legacy duplicate pulls, idle-aware sync")

if __name__=="__main__":
    main()
