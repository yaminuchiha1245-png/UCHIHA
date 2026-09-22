#!/usr/bin/env python3
"""Apply v1.5.27 financial idempotency + partner-sync hardening on top of v1.5.26."""
from pathlib import Path
import sys

def rep(s, a, b, label):
    if a not in s:
        raise SystemExit(f"marker not found: {label}")
    return s.replace(a, b, 1)

def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_v177.py <debt-app>")
    app = Path(sys.argv[1]).resolve()
    buildp = app / "app" / "build.gradle"
    build = buildp.read_text(encoding="utf-8")
    if "versionCode 1052600" not in build or "versionName '1.5.26'" not in build:
        raise SystemExit("unexpected v1.5.26 baseline")

    # ---- Shared cloud layer: every local record gets one stable cloud identity. ----
    p110 = app / "app" / "src" / "main" / "assets" / "app-v110.js"
    s = p110.read_text(encoding="utf-8")

    s = rep(
        s,
        """function uuidV110(){try{return crypto.randomUUID()}catch(e){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16)})}}
function encodeQ(v){return encodeURIComponent(String(v??''));}""",
        """function uuidV110(){try{return crypto.randomUUID()}catch(e){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16)})}}
function ensureCloudIdentityV177(row,prefix){
  if(!row.remoteId)row.remoteId=row.cloudId||uuidV110();
  if(!row.syncKey)row.syncKey=prefix+':'+row.remoteId;
  return row;
}
function encodeQ(v){return encodeURIComponent(String(v??''));}""",
        "stable cloud identity helper",
    )

    old_customer = """function remoteCustomerBody(c){if(!c.remoteId)c.remoteId=uuidV110();return {id:c.remoteId,store_id:state.cloud.storeId,name:c.name,phone:c.phone||null,address:c.address||null,location_type:c.area==='outside'?'outside':'inside',debt_limit_usd:num(c.debtLimit)||null,due_days:num(c.maxDays)||30,pinned:!!c.pinned,is_deleted:false,created_by:state.cloud.userId||null,created_by_name:c.createdBy||currentAccount()?.name||''};}"""
    new_customer = """function remoteCustomerBody(c){ensureCloudIdentityV177(c,'client');return {id:c.remoteId,store_id:state.cloud.storeId,source_key:c.syncKey,name:c.name,phone:c.phone||null,address:c.address||null,location_type:c.area==='outside'?'outside':'inside',debt_limit_usd:num(c.debtLimit)||null,due_days:num(c.maxDays)||30,pinned:!!c.pinned,is_deleted:false,created_by:state.cloud.userId||null,created_by_name:c.createdBy||currentAccount()?.name||''};}"""
    s = rep(s, old_customer, new_customer, "customer identity payload")

    old_entry = """function remoteEntryBody(e){if(!e.remoteId)e.remoteId=uuidV110();const c=state.clients.find(x=>x.id===e.clientId);if(c&&!c.remoteId)c.remoteId=uuidV110();return {id:e.remoteId,store_id:state.cloud.storeId,customer_id:c?.remoteId,kind:remoteKind(e),description:e.description||'',original_currency:e.originalCurrency,original_amount:num(e.originalAmount),usd_amount:num(e.usdAmount),rate_to_usd:rateToUsdFor(e),rate_usd_try:num(e.rateUsdTry)||null,rate_usd_syp:num(e.rateUsdSyp)||null,paid_from_row_usd:num(e.paidUsd),remaining_usd:num(e.remainingUsd),recorded_by:state.cloud.userId||null,recorded_by_name:e.createdBy||currentAccount()?.name||'',auth_method:e.authMethod||null,is_deleted:false,created_at:e.createdAt||nowIso(),updated_at:nowIso()};}"""
    new_entry = """function remoteEntryBody(e){ensureCloudIdentityV177(e,'entry');const c=state.clients.find(x=>x.id===e.clientId);if(c)ensureCloudIdentityV177(c,'client');return {id:e.remoteId,store_id:state.cloud.storeId,customer_id:c?.remoteId,source_key:e.syncKey,kind:remoteKind(e),description:e.description||'',original_currency:e.originalCurrency,original_amount:num(e.originalAmount),usd_amount:num(e.usdAmount),rate_to_usd:rateToUsdFor(e),rate_usd_try:num(e.rateUsdTry)||null,rate_usd_syp:num(e.rateUsdSyp)||null,paid_from_row_usd:num(e.paidUsd),remaining_usd:num(e.remainingUsd),recorded_by:state.cloud.userId||null,recorded_by_name:e.createdBy||currentAccount()?.name||'',auth_method:e.authMethod||null,is_deleted:false,created_at:e.createdAt||nowIso(),updated_at:nowIso()};}"""
    s = rep(s, old_entry, new_entry, "transaction identity payload")

    old_new_client = """window.saveNewClient=function(){const area=$('newClientArea').value,name=$('newClientName').value.trim(),phone=$('newClientPhone').value.trim();if(!name){toast('الاسم مطلوب');return;}if(area==='outside'&&!phone){toast('رقم الهاتف مطلوب للعميل من الخارج');return;}if(state.clients.some(c=>c.name.trim().toLowerCase()===name.toLowerCase()||(phone&&c.phone===phone))){toast('يوجد عميل بنفس الاسم أو الهاتف');return;}const c={id:uid('CLI'),remoteId:cloudLinked()?uuidV110():null,name,phone,address:$('newClientAddress').value.trim(),area,debtLimit:num($('newClientLimit').value),maxDays:num($('newClientDays').value)||30,notes:'',pinned:false,createdAt:nowIso(),createdBy:currentAccount().name};state.clients.push(c);saveState();audit('إضافة عميل',name);if(cloudLinked())cloudQueue('POST','/rest/v1/customers?on_conflict=id',remoteCustomerBody(c));closeModal();render();toast('تمت إضافة العميل ✓');};"""
    new_new_client = """window.saveNewClient=function(){const area=$('newClientArea').value,name=$('newClientName').value.trim(),phone=$('newClientPhone').value.trim();if(!name){toast('الاسم مطلوب');return;}if(area==='outside'&&!phone){toast('رقم الهاتف مطلوب للعميل من الخارج');return;}if(state.clients.some(c=>c.name.trim().toLowerCase()===name.toLowerCase()||(phone&&c.phone===phone))){toast('يوجد عميل بنفس الاسم أو الهاتف');return;}const c={id:uid('CLI'),remoteId:uuidV110(),syncKey:null,name,phone,address:$('newClientAddress').value.trim(),area,debtLimit:num($('newClientLimit').value),maxDays:num($('newClientDays').value)||30,notes:'',pinned:false,createdAt:nowIso(),createdBy:currentAccount().name};ensureCloudIdentityV177(c,'client');state.clients.push(c);saveState();audit('إضافة عميل',name);if(cloudLinked())cloudQueue('POST','/rest/v1/customers?on_conflict=id',remoteCustomerBody(c));closeModal();render();toast('تمت إضافة العميل ✓');};"""
    s = rep(s, old_new_client, new_new_client, "new customer identity")

    old_wrap = """const commitPurchaseV103=window.commitPurchase;
window.commitPurchase=function(p,authMethod='none'){const before=state.entries.length;commitPurchaseV103(p,authMethod);const e=state.entries[state.entries.length-1];if(state.entries.length>before&&e?.type==='purchase'&&cloudLinked()){e.remoteId=e.remoteId||uuidV110();saveState();cloudQueue('POST','/rest/v1/transactions?on_conflict=id',remoteEntryBody(e));}};
const commitPurchaseSilentV103=window.commitPurchaseSilent;
window.commitPurchaseSilent=function(p,authMethod='none'){const before=state.entries.length;commitPurchaseSilentV103(p,authMethod);const e=state.entries[state.entries.length-1];if(state.entries.length>before&&e?.type==='purchase'&&cloudLinked()){e.remoteId=e.remoteId||uuidV110();saveState();cloudQueue('POST','/rest/v1/transactions?on_conflict=id',remoteEntryBody(e));}};
const commitPaymentV103=window.commitPayment;
window.commitPayment=function(p,authMethod='pin'){const before=state.entries.length;commitPaymentV103(p,authMethod);const e=state.entries[state.entries.length-1];if(state.entries.length>before&&e?.type==='payment'&&cloudLinked()){e.remoteId=e.remoteId||uuidV110();saveState();cloudQueue('POST','/rest/v1/transactions?on_conflict=id',remoteEntryBody(e));}};"""
    new_wrap = """const commitPurchaseV103=window.commitPurchase;
window.commitPurchase=function(p,authMethod='none'){const before=state.entries.length;commitPurchaseV103(p,authMethod);const e=state.entries[state.entries.length-1];if(state.entries.length>before&&e?.type==='purchase'){ensureCloudIdentityV177(e,'entry');if(p?.operationKey&&!e.operationKey)e.operationKey=p.operationKey;saveState();if(cloudLinked())cloudQueue('POST','/rest/v1/transactions?on_conflict=id',remoteEntryBody(e));}};
const commitPurchaseSilentV103=window.commitPurchaseSilent;
window.commitPurchaseSilent=function(p,authMethod='none'){const before=state.entries.length;commitPurchaseSilentV103(p,authMethod);const e=state.entries[state.entries.length-1];if(state.entries.length>before&&e?.type==='purchase'){ensureCloudIdentityV177(e,'entry');if(p?.operationKey&&!e.operationKey)e.operationKey=p.operationKey;saveState();if(cloudLinked())cloudQueue('POST','/rest/v1/transactions?on_conflict=id',remoteEntryBody(e));}};
const commitPaymentV103=window.commitPayment;
window.commitPayment=function(p,authMethod='pin'){const before=state.entries.length;commitPaymentV103(p,authMethod);const e=state.entries[state.entries.length-1];if(state.entries.length>before&&e?.type==='payment'){ensureCloudIdentityV177(e,'entry');if(p?.operationKey&&!e.operationKey)e.operationKey=p.operationKey;saveState();if(cloudLinked())cloudQueue('POST','/rest/v1/transactions?on_conflict=id',remoteEntryBody(e));}};"""
    s = rep(s, old_wrap, new_wrap, "cloud-aware transaction wrappers")
    s = rep(
        s,
        "window.can=function(permission){const a=currentAccount();if(!a)return false;if(a.role==='owner')return true;return a.permissions?.[permission]!==false;};",
        "window.can=function(permission){const a=currentAccount();if(!a)return false;if(a.role==='owner')return true;return a.permissions?.[permission]===true;};",
        "partner permissions default deny",
    )
    p110.write_text(s, encoding="utf-8")

    # ---- Additive sync: force the same primary ID used by the legacy queue and sync engine. ----
    syncp = app / "app" / "src" / "main" / "assets" / "sync-v165.js"
    sync = syncp.read_text(encoding="utf-8")
    sync = rep(sync, "const SYNC_VERSION='1.5.26';", "const SYNC_VERSION='1.5.27';", "sync version")
    sync = rep(
        sync,
        """function findLocalClientForCloud(row, used){
  let c=localClientByCloudId(row.id);
  if(c&&!used.has(c.id))return c;
  if(row.source_key){
    c=(state.clients||[]).find(x=>x.syncKey===row.source_key&&!used.has(x.id));
    if(c)return c;
  }
  const rp=phone(row.phone);
  if(rp){
    c=(state.clients||[]).find(x=>phone(x.phone)===rp&&!used.has(x.id));
    if(c)return c;
  }
  const rn=norm(row.name),ra=norm(row.address);
  return (state.clients||[]).find(x=>norm(x.name)===rn&&(!ra||!norm(x.address)||norm(x.address)===ra)&&!used.has(x.id))||null;
}""",
        """function findLocalClientForCloud(row, used){
  let c=localClientByCloudId(row.id);
  if(c&&!used.has(c.id))return c;
  if(row.source_key){
    c=(state.clients||[]).find(x=>x.syncKey===row.source_key&&!used.has(x.id));
    if(c)return c;
  }
  // Legacy migration only: never merge two customers by name alone. Exact phone,
  // or exact non-empty address, must identify exactly one legacy local customer.
  const legacy=(state.clients||[]).filter(x=>legacyClientIds.has(x.id)&&!used.has(x.id));
  const rp=phone(row.phone),rn=norm(row.name),ra=norm(row.address);
  let candidates=[];
  if(rp)candidates=legacy.filter(x=>phone(x.phone)===rp&&(!rn||norm(x.name)===rn));
  else if(ra)candidates=legacy.filter(x=>norm(x.address)===ra&&(!rn||norm(x.name)===rn));
  else return null;
  return candidates.length===1?candidates[0]:null;
}""",
        "safe legacy customer matching",
    )
    sync = rep(
        sync,
        """  if(e.syncKey){
    const direct=rows.find(r=>r.source_key===e.syncKey&&!used.has(r.id));
    return direct||null;
  }
  // Legacy-only recovery path. New records always get a unique syncKey before
  // persistence, so equal amounts/descriptions from two partners are never merged.
  const fp=txFingerprintLocal(e,clientCloudId);""",
        """  if(e.syncKey){
    const direct=rows.find(r=>r.source_key===e.syncKey&&!used.has(r.id));
    return direct||null;
  }
  // Legacy-only recovery path. A non-legacy row without identity is never matched
  // heuristically, so an intentional equal-value operation cannot disappear.
  if(!legacyEntryIds.has(e.id))return null;
  const fp=txFingerprintLocal(e,clientCloudId);""",
        "legacy transaction matching scope",
    )
    sync = rep(
        sync,
        """function sourceKey(prefix,id){return prefix+':'+txt(id||('legacy-'+Date.now()+'-'+Math.random().toString(36).slice(2)));}
function clientHash(c){return JSON.stringify([txt(c.name),txt(c.phone),txt(c.address),txt(c.area),n(c.debtLimit),n(c.maxDays),!!c.pinned]);}""",
        """function sourceKey(prefix,id){return prefix+':'+txt(id||('legacy-'+Date.now()+'-'+Math.random().toString(36).slice(2)));}
function uuidV177(){try{return crypto.randomUUID()}catch(_e){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16);});}}
function stableCloudIdentity(row,prefix){
  if(!row.remoteId&&!row.cloudId)row.remoteId=uuidV177();
  const id=txt(row.cloudId||row.remoteId);
  if(!row.syncKey)row.syncKey=sourceKey(prefix,id||row.id);
  return id;
}
function clientHash(c){return JSON.stringify([txt(c.name),txt(c.phone),txt(c.address),txt(c.area),n(c.debtLimit),n(c.maxDays),!!c.pinned]);}""",
        "sync stable identity helper",
    )

    sync = rep(
        sync,
        """  return {
    store_id:storeId,
    source_key:c.syncKey||sourceKey('client',c.id),""",
        """  const stableId=stableCloudIdentity(c,'client');
  return {
    id:stableId,
    store_id:storeId,
    source_key:c.syncKey,""",
        "customer stable post id",
    )
    sync = rep(
        sync,
        """  return {
    store_id:storeId,
    customer_id:customerCloudId,
    source_key:e.syncKey||sourceKey('entry',e.id),""",
        """  const stableId=stableCloudIdentity(e,'entry');
  return {
    id:stableId,
    store_id:storeId,
    customer_id:customerCloudId,
    source_key:e.syncKey,""",
        "transaction stable post id",
    )
    syncp.write_text(sync, encoding="utf-8")

    # ---- UI/action idempotency guard. Same user action may commit once; a new action gets a new key. ----
    guard = r"""/* UCHIHA Debt Store v1.5.27 — ledger action idempotency guard. */
(function(){'use strict';
const gates={purchase:false,payment:false};
let activePurchaseKey='',activePaymentKey='';
function uuid(){try{return crypto.randomUUID()}catch(_e){return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}}
function opKey(kind){return kind+':'+uuid();}
function seen(key){return !!key&&(state.entries||[]).some(e=>e.operationKey===key);}
function release(kind,delay=850){setTimeout(()=>{gates[kind]=false;},Math.max(0,delay));}
function take(kind){
  if(gates[kind]){try{toast('العملية قيد التسجيل — انتظر لحظة');}catch(_e){}return false;}
  gates[kind]=true;return true;
}
function stampLast(before,key){
  if((state.entries||[]).length<=before)return;
  const e=state.entries[state.entries.length-1];
  if(e&&!e.operationKey){e.operationKey=key;try{saveState();}catch(_e){}}
}
const baseCommitPurchase=window.commitPurchase;
window.commitPurchase=function(p,authMethod='none'){
  p=p||{};p.operationKey=p.operationKey||activePurchaseKey||opKey('purchase');
  if(seen(p.operationKey)){release('purchase',0);return;}
  const before=(state.entries||[]).length;
  const out=baseCommitPurchase(p,authMethod);
  stampLast(before,p.operationKey);release('purchase');return out;
};
const baseCommitPayment=window.commitPayment;
window.commitPayment=function(p,authMethod='pin'){
  p=p||{};p.operationKey=p.operationKey||activePaymentKey||opKey('payment');
  if(seen(p.operationKey)){release('payment',0);return;}
  const before=(state.entries||[]).length;
  const out=baseCommitPayment(p,authMethod);
  stampLast(before,p.operationKey);release('payment');return out;
};
const baseCommitSilent=window.commitPurchaseSilent;
window.commitPurchaseSilent=function(p,authMethod='none'){
  p=p||{};p.operationKey=p.operationKey||opKey('calculator');
  if(seen(p.operationKey))return;
  const before=(state.entries||[]).length;
  const out=baseCommitSilent(p,authMethod);
  stampLast(before,p.operationKey);return out;
};
const baseSubmitPurchase=window.submitPurchase;
window.submitPurchase=function(){
  if(!take('purchase'))return;
  activePurchaseKey=opKey('purchase');
  const before=(state.entries||[]).length,pendingBefore=pendingSensitive;
  try{
    const out=baseSubmitPurchase.apply(this,arguments);
    if((state.entries||[]).length===before&&pendingSensitive===pendingBefore)release('purchase',0);
    return out;
  }catch(e){release('purchase',0);throw e;}
};
const baseSubmitPayment=window.submitPayment;
window.submitPayment=function(){
  if(!take('payment'))return;
  activePaymentKey=opKey('payment');
  const before=(state.entries||[]).length,pendingBefore=pendingSensitive;
  try{
    const out=baseSubmitPayment.apply(this,arguments);
    if((state.entries||[]).length===before&&pendingSensitive===pendingBefore)release('payment',0);
    return out;
  }catch(e){release('payment',0);throw e;}
};
const baseClose=window.closeModal;
window.closeModal=function(){gates.purchase=false;gates.payment=false;return baseClose.apply(this,arguments);};
window.DebtLedgerGuardV177={
  version:'1.5.27',
  identities:()=>({entries:(state.entries||[]).map(e=>({id:e.id,operationKey:e.operationKey||'',remoteId:e.remoteId||'',syncKey:e.syncKey||''}))})
};
})();
"""
    guardp = app / "app" / "src" / "main" / "assets" / "ledger-guard-v177.js"
    guardp.write_text(guard, encoding="utf-8")

    indexp = app / "app" / "src" / "main" / "assets" / "index.html"
    index = indexp.read_text(encoding="utf-8")
    index = rep(index, '  <script src="sync-v165.js"></script>', '  <script src="sync-v165.js"></script>\n  <script src="ledger-guard-v177.js"></script>', "guard script include")
    indexp.write_text(index, encoding="utf-8")

    build = build.replace("versionCode 1052600", "versionCode 1052700", 1)
    build = build.replace("versionName '1.5.26'", "versionName '1.5.27'", 1)
    buildp.write_text(build, encoding="utf-8")

if __name__ == "__main__":
    main()
