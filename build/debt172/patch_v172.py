#!/usr/bin/env python3
"""Apply v1.5.22 partner-ledger sync hardening on top of v1.5.21."""
from pathlib import Path
import sys

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"marker not found: {label}")
    return text.replace(old, new, 1)

def main():
    if len(sys.argv)!=2:
        raise SystemExit("usage: patch_v172.py <debt-app>")
    app=Path(sys.argv[1]).resolve()
    build_path=app/"app"/"build.gradle"
    build=build_path.read_text(encoding="utf-8")
    if "versionCode 1052100" not in build or "versionName '1.5.21'" not in build:
        raise SystemExit("unexpected v1.5.21 baseline")

    sync_path=app/"app"/"src"/"main"/"assets"/"sync-v165.js"
    s=sync_path.read_text(encoding="utf-8")

    s=replace_once(s,"const SYNC_VERSION='1.5.15';","const SYNC_VERSION='1.5.22';","sync version")

    s=replace_once(
        s,
        "let seq=0,running=false,rerun=false,timer=null,applying=false,initialised=false;",
        "let seq=0,running=false,rerun=false,timer=null,applying=false,initialised=false;\n"
        "const legacyClientIds=new Set((state.clients||[]).filter(c=>!c.cloudId&&!c.remoteId&&!c.syncKey).map(c=>c.id));\n"
        "const legacyEntryIds=new Set((state.entries||[]).filter(e=>!e.cloudId&&!e.remoteId&&!e.syncKey).map(e=>e.id));",
        "legacy identity sets"
    )

    s=replace_once(
        s,
        "function localClientByCloudId(id){return (state.clients||[]).find(c=>c.cloudId===id)||null;}",
        "function localClientByCloudId(id){return (state.clients||[]).find(c=>c.cloudId===id||c.remoteId===id)||null;}",
        "legacy customer remote id"
    )

    old_best="""function bestCloudTx(e,clientCloudId,rows,used){
  if(e.cloudId){
    const direct=rows.find(r=>r.id===e.cloudId&&!used.has(r.id));if(direct)return direct;
  }
  if(e.syncKey){
    const direct=rows.find(r=>r.source_key===e.syncKey&&!used.has(r.id));if(direct)return direct;
  }
  const fp=txFingerprintLocal(e,clientCloudId);
  const candidates=rows.filter(r=>!used.has(r.id)&&txFingerprintCloud(r)===fp);
  if(!candidates.length)return null;
  const lt=ts(e.createdAt||e.date);
  candidates.sort((a,b)=>Math.abs(ts(a.created_at)-lt)-Math.abs(ts(b.created_at)-lt));
  if(!lt)return candidates[0];
  const d=Math.abs(ts(candidates[0].created_at)-lt);
  return d<=86400000?candidates[0]:null;
}"""
    new_best="""function bestCloudTx(e,clientCloudId,rows,used){
  const remoteId=e.cloudId||e.remoteId;
  if(remoteId){
    const direct=rows.find(r=>r.id===remoteId&&!used.has(r.id));if(direct)return direct;
  }
  if(e.syncKey){
    const direct=rows.find(r=>r.source_key===e.syncKey&&!used.has(r.id));
    return direct||null;
  }
  // Legacy-only recovery path. New records always get a unique syncKey before
  // persistence, so equal amounts/descriptions from two partners are never merged.
  const fp=txFingerprintLocal(e,clientCloudId);
  const candidates=rows.filter(r=>!used.has(r.id)&&txFingerprintCloud(r)===fp);
  if(!candidates.length)return null;
  const lt=ts(e.createdAt||e.date);if(!lt)return null;
  candidates.sort((a,b)=>Math.abs(ts(a.created_at)-lt)-Math.abs(ts(b.created_at)-lt));
  const d=Math.abs(ts(candidates[0].created_at)-lt);
  return d<=10000?candidates[0]:null;
}"""
    s=replace_once(s,old_best,new_best,"transaction matching")

    s=replace_once(
        s,
        "    cloudId:row.id,\n    syncKey:row.source_key||('cloud-entry:'+row.id),",
        "    cloudId:row.id,\n    remoteId:row.id,\n    syncKey:row.source_key||('cloud-entry:'+row.id),",
        "cloud transaction legacy id"
    )

    old_sort="""    rows.sort((a,b)=>(ts(a.createdAt||a.date)-ts(b.createdAt||b.date))||String(a.id).localeCompare(String(b.id)));"""
    new_sort="""    rows.sort((a,b)=>{
      const byTime=ts(a.createdAt||a.date)-ts(b.createdAt||b.date);if(byTime)return byTime;
      const pa=(a.type==='payment'?1:0),pb=(b.type==='payment'?1:0);if(pa!==pb)return pa-pb;
      const ka=txt(a.syncKey||a.cloudId||a.remoteId||a.id),kb=txt(b.syncKey||b.cloudId||b.remoteId||b.id);
      return ka.localeCompare(kb);
    });"""
    s=replace_once(s,old_sort,new_sort,"deterministic ledger order")

    s=replace_once(
        s,
        "      c.cloudId=row.id;\n      c.syncKey=row.source_key||c.syncKey||('cloud-client:'+row.id);",
        "      c.cloudId=row.id;\n      c.remoteId=c.remoteId||row.id;\n      c.syncKey=row.source_key||c.syncKey||('cloud-client:'+row.id);",
        "matched customer ids"
    )

    s=replace_once(
        s,
        "        cloudId:row.id,\n        syncKey:row.source_key||('cloud-client:'+row.id),",
        "        cloudId:row.id,\n        remoteId:row.id,\n        syncKey:row.source_key||('cloud-client:'+row.id),",
        "new cloud customer ids"
    )

    s=replace_once(
        s,
        "      const row=firstRow(r);if(row){c.cloudId=row.id;c.syncKey=row.source_key||c.syncKey;}",
        "      const row=firstRow(r);if(row){c.cloudId=row.id;c.remoteId=c.remoteId||row.id;c.syncKey=row.source_key||c.syncKey;}",
        "posted customer ids"
    )

    s=replace_once(
        s,
        "      usedCloud.add(row.id);e.cloudId=row.id;e.syncKey=row.source_key||e.syncKey||('cloud-entry:'+row.id);",
        "      usedCloud.add(row.id);e.cloudId=row.id;e.remoteId=e.remoteId||row.id;e.syncKey=row.source_key||e.syncKey||('cloud-entry:'+row.id);",
        "matched transaction ids"
    )

    s=replace_once(
        s,
        "      const row=firstRow(r);if(row){e.cloudId=row.id;e.syncKey=row.source_key||e.syncKey;}",
        "      const row=firstRow(r);if(row){e.cloudId=row.id;e.remoteId=e.remoteId||row.id;e.syncKey=row.source_key||e.syncKey;}",
        "posted transaction ids"
    )

    insert_marker="""function safePersist(){
  applying=true;"""
    insert_code="""function ensureNewSyncKeys(){
  for(const c of state.clients||[]){
    if(!c.cloudId&&!c.remoteId&&!c.syncKey&&!legacyClientIds.has(c.id))c.syncKey=sourceKey('client',c.id);
  }
  for(const e of state.entries||[]){
    if(!e.cloudId&&!e.remoteId&&!e.syncKey&&!legacyEntryIds.has(e.id))e.syncKey=sourceKey('entry',e.id);
  }
}
function safePersist(){
  applying=true;"""
    s=replace_once(s,insert_marker,insert_code,"new sync identity")

    old_save="""saveState=function(){
  const result=originalSave.apply(this,arguments);
  if(!applying&&initialised)schedule(900);
  return result;
};"""
    new_save="""saveState=function(){
  if(!applying&&initialised)ensureNewSyncKeys();
  const result=originalSave.apply(this,arguments);
  if(!applying&&initialised)schedule(900);
  return result;
};"""
    s=replace_once(s,old_save,new_save,"pre-save sync identity")

    sync_path.write_text(s,encoding="utf-8")

    build=build.replace("versionCode 1052100","versionCode 1052200",1)
    build=build.replace("versionName '1.5.21'","versionName '1.5.22'",1)
    build_path.write_text(build,encoding="utf-8")

if __name__=="__main__":
    main()
