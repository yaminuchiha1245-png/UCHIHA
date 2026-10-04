#!/usr/bin/env python3
"""v1.5.31: converge owner/partner devices and safely retire stale legacy POST backlog."""
from pathlib import Path
import re,sys

def once(text,before,after,label):
    n=text.count(before)
    if n!=1: raise RuntimeError(f"{label}: expected one match, got {n}")
    return text.replace(before,after,1)

def main():
    if len(sys.argv)!=2: raise SystemExit("usage: patch_v187.py debt-app")
    app=Path(sys.argv[1]).resolve()

    gradle=app/"app/build.gradle"
    s=gradle.read_text(encoding="utf-8")
    s=once(s,"versionCode 1053000","versionCode 1053100","versionCode")
    s=once(s,"versionName '1.5.30'","versionName '1.5.31'","versionName")
    gradle.write_text(s,encoding="utf-8")

    legacy=app/"app/src/main/assets/app-v110.js"
    s=legacy.read_text(encoding="utf-8")
    old="function cloudQueue(method,path,body){if(!cloudLinked())return;ensureCloudState();state.cloud.pending.push({id:uuidV110(),method,path,body,at:nowIso()});saveState();flushCloudQueue();}"
    new="""function cloudQueue(method,path,body){
  if(!cloudLinked())return;
  // v1.5.31: DebtCloudSync owns creation of new customers/ledger rows.
  // Keep the legacy queue only for edits, deletes and store settings.
  if(window.DebtCloudSync&&method==='POST'&&(/^\\/rest\\/v1\\/customers\\?/.test(path)||/^\\/rest\\/v1\\/transactions\\?/.test(path))){
    try{window.DebtCloudSync.schedule?.(120);}catch(_e){}
    return;
  }
  ensureCloudState();state.cloud.pending.push({id:uuidV110(),method,path,body,at:nowIso()});saveState();flushCloudQueue();
}"""
    s=once(s,old,new,"legacy create queue")
    legacy.write_text(s,encoding="utf-8")

    sync=app/"app/src/main/assets/sync-v165.js"
    s=sync.read_text(encoding="utf-8")
    s=once(s,"const SYNC_VERSION='1.5.29';","const SYNC_VERSION='1.5.31';","sync version")
    s=once(s,
      "let lastPresenceAt=0,realtimeStartedStore='';",
      "let lastPresenceAt=0,realtimeStartedStore='';\nlet legacyFlushBusy=false;",
      "legacy flush gate")

    marker="""function safePersist(){
  applying=true;"""
    helper="""function reconcileLegacyPending(){
  const q=state.cloud?.pending;
  if(!Array.isArray(q)||!q.length)return 0;
  const syncedCustomers=new Set((state.clients||[]).filter(c=>c.cloudId).map(c=>txt(c.syncKey)).filter(Boolean));
  const syncedEntries=new Set((state.entries||[]).filter(e=>e.cloudId).map(e=>txt(e.syncKey)).filter(Boolean));
  const before=q.length;
  state.cloud.pending=q.filter(op=>{
    if(!op||op.method!=='POST')return true;
    const key=txt(op.body?.source_key);
    if(!key)return true;
    const path=txt(op.path);
    if(path.startsWith('/rest/v1/customers?'))return !syncedCustomers.has(key);
    if(path.startsWith('/rest/v1/transactions?'))return !syncedEntries.has(key);
    return true;
  });
  return before-state.cloud.pending.length;
}
async function retryLegacyRemainder(){
  if(legacyFlushBusy||!state.cloud?.pending?.length||typeof flushCloudQueue!=='function')return;
  legacyFlushBusy=true;
  try{await flushCloudQueue();}catch(_e){}finally{legacyFlushBusy=false;}
}
function safePersist(){
  applying=true;"""
    s=once(s,marker,helper,"pending reconciliation")

    old="""    if(!state.cloudSync)state.cloudSync={};
    state.cloudSync.version=SYNC_VERSION;
    state.cloudSync.lastSuccess=new Date().toISOString();
    state.cloudSync.lastError='';
    saveState();"""
    new="""    if(!state.cloudSync)state.cloudSync={};
    const syncedAt=new Date().toISOString();
    state.cloudSync.version=SYNC_VERSION;
    state.cloudSync.lastSuccess=syncedAt;
    state.cloudSync.lastError='';
    if(state.cloud){
      state.cloud.online=true;
      state.cloud.lastSyncAt=syncedAt;
      state.cloud.lastError='';
    }
    saveState();"""
    s=once(s,old,new,"legacy visible sync status")

    old="""    const addedRemoteIds=await syncTransactions(storeId,userId,transactions,clientMap);
    rebuildLedger();
    await touchMember(storeId,userId);
    safePersist();"""
    new="""    const addedRemoteIds=await syncTransactions(storeId,userId,transactions,clientMap);
    rebuildLedger();
    // Old releases could leave duplicate POSTs in state.cloud.pending after an
    // offline period. Drop one only after the same local row has a cloudId.
    reconcileLegacyPending();
    await touchMember(storeId,userId);
    safePersist();
    retryLegacyRemainder();"""
    s=once(s,old,new,"post-sync pending repair")
    sync.write_text(s,encoding="utf-8")

    print("Applied v1.5.31 owner/partner convergence and stale pending repair")

if __name__=="__main__":
    main()
