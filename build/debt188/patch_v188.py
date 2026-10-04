#!/usr/bin/env python3
"""v1.5.32: authoritative post-upload ledger snapshot for owner/partner convergence."""
from pathlib import Path
import sys

def once(s,a,b,label):
    n=s.count(a)
    if n!=1: raise SystemExit(f"{label}: expected one match, got {n}")
    return s.replace(a,b,1)

def main():
    if len(sys.argv)!=2: raise SystemExit("usage: patch_v188.py debt-app")
    root=Path(sys.argv[1]).resolve()

    gradle=root/"app/build.gradle"
    g=gradle.read_text(encoding="utf-8")
    g=once(g,"versionCode 1053100","versionCode 1053200","versionCode")
    g=once(g,"versionName '1.5.31'","versionName '1.5.32'","versionName")
    gradle.write_text(g,encoding="utf-8")

    p=root/"app/src/main/assets/sync-v165.js"
    s=p.read_text(encoding="utf-8")
    s=once(s,"const SYNC_VERSION='1.5.31';","const SYNC_VERSION='1.5.32';","sync version")

    anchor="""function cloudRowToLocal(row,localClientId){
  const usd=n(row.usd_amount),rt=n(row.rate_usd_try),rs=n(row.rate_usd_syp);
  return {
    id:'CLD-'+String(row.id).replace(/-/g,'').slice(0,20).toUpperCase(),
    cloudId:row.id,
    remoteId:row.id,
    syncKey:row.source_key||('cloud-entry:'+row.id),
    clientId:localClientId,
    type:kindCloudToLocal(row.kind),
    date:txt(row.created_at).slice(0,10),
    createdAt:row.created_at||new Date().toISOString(),
    description:row.description|| (row.kind==='payment'?'دفعة':'شراء'),
    originalAmount:n(row.original_amount),
    originalCurrency:txt(row.original_currency||'USD').toUpperCase(),
    usdAmount:usd,
    tryAmount:rt>0?usd*rt:(row.original_currency==='TRY'?n(row.original_amount):0),
    sypAmount:rs>0?usd*rs:(row.original_currency==='SYP'?n(row.original_amount):0),
    rateUsdTry:rt,
    rateUsdSyp:rs,
    paidUsd:row.kind==='payment'?usd:n(row.paid_from_row_usd),
    remainingUsd:row.kind==='payment'?0:n(row.remaining_usd),
    allocations:[],
    createdBy:row.recorded_by_name||'شريك',
    authMethod:row.auth_method||'cloud'
  };
}
"""
    helper=anchor+"""function echoFingerprintV188(row){
  return [
    txt(row.customer_id),txt(row.kind),txt(row.original_currency).toUpperCase(),
    n(row.original_amount).toFixed(4),n(row.usd_amount).toFixed(4),
    txt(row.description),txt(row.recorded_by_name),txt(row.created_at)
  ].join('|');
}
function removeLegacyEchoRowsV188(rows){
  const canonical=new Set();
  for(const r of rows||[]){
    const key=txt(r.source_key);
    if(key.startsWith('entry:'))canonical.add(echoFingerprintV188(r));
  }
  return (rows||[]).filter(r=>{
    const key=txt(r.source_key);
    const selfEcho=key==='cloud-entry:'+txt(r.id);
    return !(selfEcho&&canonical.has(echoFingerprintV188(r)));
  });
}
function mergeCloudLocalMetadataV188(base,old){
  if(!old)return base;
  const keep=['id','operationKey','invoiceId','invoiceRemoteId'];
  for(const k of keep)if(old[k]!=null&&old[k]!=='')base[k]=old[k];
  return base;
}
function authoritativeLedgerV188(cloudRows,clientMap){
  const rows=Array.isArray(cloudRows)?cloudRows:[];
  const oldEntries=Array.isArray(state.entries)?state.entries:[];
  const byCloud=new Map(),byKey=new Map();
  for(const e of oldEntries){
    if(e.cloudId)byCloud.set(txt(e.cloudId),e);
    if(e.syncKey)byKey.set(txt(e.syncKey),e);
  }
  // Preserve only genuinely unconfirmed local operations. Anything with cloudId
  // must be represented by the final server snapshot or it is stale/deleted.
  const unsynced=oldEntries.filter(e=>!e.cloudId);
  const authoritative=[];
  for(const row of rows){
    const localClientId=clientMap.get(row.customer_id);
    if(!localClientId)continue;
    const old=byCloud.get(txt(row.id))||byKey.get(txt(row.source_key));
    authoritative.push(mergeCloudLocalMetadataV188(cloudRowToLocal(row,localClientId),old));
  }
  const cloudKeys=new Set(authoritative.map(e=>txt(e.syncKey)).filter(Boolean));
  const cloudIds=new Set(authoritative.map(e=>txt(e.cloudId)).filter(Boolean));
  const pendingOnly=unsynced.filter(e=>!cloudKeys.has(txt(e.syncKey))&&!cloudIds.has(txt(e.remoteId)));
  state.entries=[...authoritative,...pendingOnly];
  return {cloudCount:authoritative.length,pendingCount:pendingOnly.length,echoesRemoved:(cloudRows||[]).length-rows.length};
}
"""
    s=once(s,anchor,helper,"authoritative ledger helpers")

    old="""    const clientMap=await syncCustomers(storeId,userId,customers);
    const addedRemoteIds=await syncTransactions(storeId,userId,transactions,clientMap);
    rebuildLedger();
    // Old releases could leave duplicate POSTs in state.cloud.pending after an
    // offline period. Drop one only after the same local row has a cloudId.
    reconcileLegacyPending();
    await touchMember(storeId,userId);
    safePersist();
    retryLegacyRemainder();
"""
    new="""    let clientMap=await syncCustomers(storeId,userId,customers);
    const addedRemoteIds=await syncTransactions(storeId,userId,transactions,clientMap);
    // Old releases could leave duplicate POSTs in state.cloud.pending after an
    // offline period. Remove only POSTs whose local row is now cloud-confirmed,
    // then finish all remaining legacy PATCH/DELETE operations before snapshot.
    reconcileLegacyPending();
    await retryLegacyRemainder();

    // v1.5.32 convergence barrier: uploads happen first, then BOTH devices rebuild
    // their synced ledger from the same final server snapshot. Local rows survive
    // only while they are genuinely unconfirmed (no cloudId).
    const [finalCustomers,finalTransactions]=await Promise.all([
      getAll('/rest/v1/customers?select=*&store_id=eq.'+encodeURIComponent(storeId)+'&is_deleted=eq.false&order=created_at.asc',500),
      getAll('/rest/v1/transactions?select=*&store_id=eq.'+encodeURIComponent(storeId)+'&is_deleted=eq.false&order=created_at.asc',500)
    ]);
    clientMap=await syncCustomers(storeId,userId,finalCustomers);
    const authoritative=authoritativeLedgerV188(finalTransactions,clientMap);
    rebuildLedger();
    if(!state.cloudSync)state.cloudSync={};
    state.cloudSync.authoritativeCloudCount=authoritative.cloudCount;
    state.cloudSync.pendingLocalCount=authoritative.pendingCount;
    state.cloudSync.echoesIgnored=authoritative.echoesRemoved;
    await touchMember(storeId,userId);
    safePersist();
"""
    s=once(s,old,new,"run convergence barrier")
    p.write_text(s,encoding="utf-8")
    print("Applied v1.5.32 authoritative owner/partner ledger convergence")

if __name__=="__main__":
    main()
