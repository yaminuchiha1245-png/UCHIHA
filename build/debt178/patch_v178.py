#!/usr/bin/env python3
from pathlib import Path
import sys

def rep(s,a,b,label):
    if a not in s:
        raise SystemExit(f"marker not found: {label}")
    return s.replace(a,b,1)

def main():
    if len(sys.argv)!=2:
        raise SystemExit("usage: patch_v178.py <debt-app>")
    app=Path(sys.argv[1]).resolve()
    gradle=app/'app/build.gradle'
    g=gradle.read_text(encoding='utf-8')
    if "versionCode 1052700" not in g or "versionName '1.5.27'" not in g:
        raise SystemExit("unexpected v1.5.27 baseline")

    # Restore old backups without turning them into new cloud rows, and use the
    # native pre-restore checkpoint before replacing current data.
    pbase=app/'app/src/main/assets/app.js'
    b=pbase.read_text(encoding='utf-8')
    old_check="const incoming=JSON.parse(text);if(!incoming.setupDone||!Array.isArray(incoming.clients)||!Array.isArray(incoming.entries))throw new Error('invalid');"
    new_check="const incoming=normalizeState(JSON.parse(text));if(!window.DebtDataGuard?.valid(incoming))throw new Error('invalid');"
    b=rep(b,old_check,new_check,'backup validation')
    old_restore="function confirmRestoreBackup(jsonString){try{state=JSON.parse(jsonString);saveState();driveSnapshot('restore','restore-'+Date.now());sessionAccountId=null;closeModal();render();toast('تمت الاستعادة');}catch(e){toast('تعذر الاستعادة');}}"
    new_restore="""function markRestoreLegacyV178(incoming){for(const c of incoming.clients||[]){if(!c.cloudId&&!c.remoteId&&!c.syncKey)c.restoreLegacy=true;}for(const e of incoming.entries||[]){if(!e.cloudId&&!e.remoteId&&!e.syncKey)e.restoreLegacy=true;}return incoming;}
function confirmRestoreBackup(jsonString){try{const incoming=markRestoreLegacyV178(normalizeState(JSON.parse(jsonString)));if(!window.DebtDataGuard?.valid(incoming))throw new Error('invalid');driveSnapshot('pre-restore','pre-restore-'+Date.now());const raw=JSON.stringify(incoming);if(window.Android?.restoreSecureState){if(!Android.restoreSecureState(raw))throw new Error('native restore failed');state=incoming;}else{state=incoming;saveState();}driveSnapshot('restore','restore-'+Date.now());sessionAccountId=null;closeModal();render();toast('تمت الاستعادة');}catch(e){toast('تعذر الاستعادة');}}"""
    b=rep(b,old_restore,new_restore,'safe backup restore')
    b=rep(b,"function fifoPreview(clientId,paymentUsd){\n  let left=paymentUsd;const arr=[];const debts=state.entries.filter(e=>e.clientId===clientId&&['purchase','opening'].includes(e.type)&&num(e.remainingUsd)>.005).sort((a,b)=>new Date(a.date||a.createdAt)-new Date(b.date||b.createdAt));","function fifoPreview(clientId,paymentUsd,currency=paymentDraft.currency){\n  let left=paymentUsd;const arr=[];const debts=state.entries.filter(e=>e.clientId===clientId&&['purchase','opening'].includes(e.type)&&e.originalCurrency===currency&&num(e.remainingUsd)>.005).sort((a,b)=>new Date(a.createdAt||a.date)-new Date(b.createdAt||b.date));",'currency isolated payment fifo')
    b=b.replace("fifoPreview(paymentClientId,cv.usd)","fifoPreview(paymentClientId,cv.usd,paymentDraft.currency)",1)
    b=b.replace("preview=fifoPreview(p.clientId,cv.usd)","preview=fifoPreview(p.clientId,cv.usd,p.currency)",1)
    b=b.replace("function saveDeferred(){const type=", "function saveDeferred(){const type=",1)
    b=b.replace("audit('إضافة مؤجل',type);closeModal();render();toast('تم الحفظ في المؤجل');", "audit('إضافة مؤجل',type);driveSnapshot('deferred','deferred-'+Date.now());closeModal();render();toast('تم الحفظ في المؤجل');",1)
    b=b.replace("function removeDeferred(id){state.deferred=state.deferred.filter(x=>x.id!==id);saveState();render();}", "function removeDeferred(id){state.deferred=state.deferred.filter(x=>x.id!==id);saveState();driveSnapshot('deferred-delete',id);render();}",1)
    b=b.replace("state.shortages.unshift({id:uid('SH'),name,qty:$('shortQty').value.trim(),status:'needed',createdAt:nowIso(),createdBy:currentAccount().name});saveState();closeModal();render();toast('تمت الإضافة');", "state.shortages.unshift({id:uid('SH'),name,qty:$('shortQty').value.trim(),status:'needed',createdAt:nowIso(),createdBy:currentAccount().name});saveState();driveSnapshot('shortage','shortage-'+Date.now());closeModal();render();toast('تمت الإضافة');",1)
    pbase.write_text(b,encoding='utf-8')

    # Cloud-aware mutations must create the same full-state Drive snapshots as
    # their local equivalents, including edits and deletions.
    p110=app/'app/src/main/assets/app-v110.js'
    a=p110.read_text(encoding='utf-8')
    a=rep(a,"state.clients.push(c);saveState();audit('إضافة عميل',name);if(cloudLinked())","state.clients.push(c);saveState();audit('إضافة عميل',name);driveSnapshot('client',c.id);if(cloudLinked())",'cloud client backup')
    a=rep(a,"saveState();audit('تعديل عميل',name);if(cloudLinked()&&c.remoteId)","saveState();audit('تعديل عميل',name);driveSnapshot('client-edit',id);if(cloudLinked()&&c.remoteId)",'cloud client edit backup')
    a=rep(a,"saveState();audit('تعديل شراء',`${amount} ${currency}`);if(cloudLinked()&&e.remoteId)","saveState();audit('تعديل شراء',`${amount} ${currency}`);driveSnapshot('purchase-edit',id);if(cloudLinked()&&e.remoteId)",'purchase edit backup')
    a=rep(a,"saveState();audit('حذف شراء',`${e.originalAmount} ${e.originalCurrency}`);if(cloudLinked()&&e.remoteId)","saveState();audit('حذف شراء',`${e.originalAmount} ${e.originalCurrency}`);driveSnapshot('purchase-delete',id);if(cloudLinked()&&e.remoteId)",'purchase delete backup')
    a=rep(a,"saveState();audit('حذف عميل',c.name);if(cloudLinked()&&c.remoteId)","saveState();audit('حذف عميل',c.name);driveSnapshot('client-delete',id);if(cloudLinked()&&c.remoteId)",'client delete backup')
    a=rep(a,"const open=[];let unallocated=0;","const open={USD:[],TRY:[],SYP:[]};let unallocated=0;",'cloud fifo currency buckets')
    a=rep(a,"open.push(e);","(open[e.originalCurrency]||(open[e.originalCurrency]=[])).push(e);",'cloud fifo purchase bucket')
    a=rep(a,"for(const p of open){","for(const p of (open[e.originalCurrency]||[])){",'cloud fifo payment bucket')
    a=a.replace("m.can_record_purchases!==false","m.can_record_purchases===true").replace("m.can_record_payments!==false","m.can_record_payments===true").replace("m.can_add_clients!==false","m.can_add_clients===true").replace("m.can_edit_purchases!==false","m.can_edit_purchases===true")
    p110.write_text(a,encoding='utf-8')

    # Invoice accounting rows get durable identities even while offline.
    p130=app/'app/src/main/assets/app-v130.js'
    s=p130.read_text(encoding='utf-8')
    s=rep(s,"let productSearchV130='';","let productSearchV130='';\nlet invoiceRequestKeyV178='';",'invoice request key state')
    old="""function commitInvoiceV130(authMethod='none'){
  const c=state.clients.find(x=>x.id===invoiceDraftV130.clientId);if(!c)return;const totals=invoiceTotalsV130(invoiceDraftV130.items),createdAt=nowIso();
  const inv={id:uid('INV'),remoteId:cloudLinked()?uuidV110():null,number:invoiceNumberV130(),clientId:c.id,status:'active',note:invoiceDraftV130.note||'',items:invoiceDraftV130.items.map(it=>({...it,id:uid('ITI')})),totals,createdAt,createdBy:currentAccount()?.name||''};
  state.invoices.push(inv);
  const newEntries=[];
  for(const cur of CURS130){const amount=num(totals[cur]);if(amount<=0)continue;const cv=invoiceCvV130(amount,cur);if(!cv){state.invoices=state.invoices.filter(x=>x!==inv);toast('تعذر حساب الفاتورة');return;}const e={id:uid('PUR'),remoteId:cloudLinked()?uuidV110():null,clientId:c.id,type:'purchase',date:today(),createdAt,description:`فاتورة ${inv.number}`,originalAmount:amount,originalCurrency:cur,usdAmount:cv.usd,tryAmount:cv.try,sypAmount:0,rateUsdTry:num(state.rates?.usdTry)||0,rateUsdSyp:0,paidUsd:0,remainingUsd:cv.usd,allocations:[],createdBy:currentAccount()?.name||'',authMethod,invoiceId:inv.id,invoiceRemoteId:inv.remoteId};state.entries.push(e);newEntries.push(e);}"""
    new="""function commitInvoiceV130(authMethod='none'){
  const c=state.clients.find(x=>x.id===invoiceDraftV130.clientId);if(!c)return;const totals=invoiceTotalsV130(invoiceDraftV130.items),createdAt=nowIso();
  const invoiceRemoteId=uuidV110(),invoiceOperationKey='invoice:'+invoiceRemoteId;
  const inv={id:uid('INV'),remoteId:invoiceRemoteId,operationKey:invoiceOperationKey,number:invoiceNumberV130(),clientId:c.id,status:'active',note:invoiceDraftV130.note||'',items:invoiceDraftV130.items.map(it=>({...it,id:uid('ITI')})),totals,createdAt,createdBy:currentAccount()?.name||''};
  state.invoices.push(inv);
  const newEntries=[];
  for(const cur of CURS130){const amount=num(totals[cur]);if(amount<=0)continue;const cv=invoiceCvV130(amount,cur);if(!cv){state.invoices=state.invoices.filter(x=>x!==inv);toast('تعذر حساب الفاتورة');return;}const entryRemoteId=uuidV110();const e={id:uid('PUR'),remoteId:entryRemoteId,syncKey:'entry:'+entryRemoteId,operationKey:invoiceOperationKey+':'+cur,clientId:c.id,type:'purchase',date:today(),createdAt,description:`فاتورة ${inv.number}`,originalAmount:amount,originalCurrency:cur,usdAmount:cv.usd,tryAmount:cv.try,sypAmount:0,rateUsdTry:num(state.rates?.usdTry)||0,rateUsdSyp:0,paidUsd:0,remainingUsd:cv.usd,allocations:[],createdBy:currentAccount()?.name||'',authMethod,invoiceId:inv.id,invoiceRemoteId:inv.remoteId};state.entries.push(e);newEntries.push(e);}"""
    s=rep(s,old,new,'invoice stable identities')
    s=rep(s,
        "function startInvoiceV130(clientId=null,scanNow=false){resetInvoiceDraftV130(clientId);view='invoiceCart';render();if(scanNow)setTimeout(()=>requestBarcodeScanV130('cart'),80);}",
        "function startInvoiceV130(clientId=null,scanNow=false){if(!can('purchase')){toast('لا توجد صلاحية تسجيل شراء');return;}resetInvoiceDraftV130(clientId);view='invoiceCart';render();if(scanNow)setTimeout(()=>requestBarcodeScanV130('cart'),80);}",
        'invoice start permission')
    s=rep(s,"function submitInvoiceV130(){","function submitInvoiceV130(){if(!can('purchase')){toast('لا توجد صلاحية تسجيل شراء');return;}",'invoice submit permission')
    s=rep(s,"requireSensitive(state.settings.requireBiometricPurchase,'تسجيل فاتورة منتجات',method=>commitInvoiceV130(method));","invoiceRequestKeyV178=invoiceRequestKeyV178||('invoice:'+uuidV110());requireSensitive(state.settings.requireBiometricPurchase,'تسجيل فاتورة منتجات',method=>commitInvoiceV130(method,invoiceRequestKeyV178));",'invoice submit idempotency key')
    s=rep(s,"function commitInvoiceV130(authMethod='none'){\n  const c=","function commitInvoiceV130(authMethod='none',operationKey=''){\n  if(!can('purchase')){toast('لا توجد صلاحية تسجيل شراء');return;}\n  const c=",'invoice commit permission')
    s=rep(s,"  const invoiceRemoteId=uuidV110(),invoiceOperationKey='invoice:'+invoiceRemoteId;","  const invoiceOperationKey=operationKey||invoiceRequestKeyV178||('invoice:'+uuidV110());if(state.invoices.some(x=>x.operationKey===invoiceOperationKey)){invoiceRequestKeyV178='';return;}const invoiceRemoteId=invoiceOperationKey.startsWith('invoice:')?invoiceOperationKey.slice(8):uuidV110();",'invoice commit idempotency')
    s=rep(s,"  saveState();logClientWarnings(c.id,true);selectedInvoiceIdV130=inv.id;selectedClientId=c.id;resetInvoiceDraftV130();view='invoiceDetail';render();toast('تم تسجيل الفاتورة ✓');","  saveState();logClientWarnings(c.id,true);selectedInvoiceIdV130=inv.id;selectedClientId=c.id;invoiceRequestKeyV178='';resetInvoiceDraftV130();view='invoiceDetail';render();toast('تم تسجيل الفاتورة ✓');",'invoice request key clear')
    s=rep(s,"function openRegisterProductV130(barcode='',addAfter=false){","function openRegisterProductV130(barcode='',addAfter=false){if(!isOwner()){toast('إدارة المنتجات للمالك فقط');return;}",'product register permission')
    s=rep(s,"function saveNewProductV130(){","function saveNewProductV130(){if(!isOwner()){toast('إدارة المنتجات للمالك فقط');return;}",'product save permission')
    s=rep(s,"function openProductEditV130(id){","function openProductEditV130(id){if(!isOwner()){toast('إدارة المنتجات للمالك فقط');return;}",'product edit open permission')
    s=rep(s,"function saveProductEditV130(id){","function saveProductEditV130(id){if(!isOwner()){toast('إدارة المنتجات للمالك فقط');return;}",'product edit save permission')
    s=rep(s,"function disableProductV130(id){","function disableProductV130(id){if(!isOwner()){toast('إدارة المنتجات للمالك فقط');return;}",'product disable permission')
    s=s.replace("state.products.push(p);saveState();audit('إضافة منتج',`${name} — ${barcode}`);","state.products.push(p);saveState();audit('إضافة منتج',`${name} — ${barcode}`);driveSnapshot('product',p.id);",1)
    s=s.replace("saveState();audit('تعديل منتج',name);if(cloudLinked())","saveState();audit('تعديل منتج',name);driveSnapshot('product-edit',id);if(cloudLinked())",1)
    s=s.replace("saveState();audit('إخفاء منتج',p.name);if(cloudLinked()&&p.remoteId)","saveState();audit('إخفاء منتج',p.name);driveSnapshot('product-disable',id);if(cloudLinked()&&p.remoteId)",1)
    s=s.replace("saveState();audit('تسجيل فاتورة منتجات',`${c.name} — ${inv.number} — ${invoiceTotalsTextV130(totals)}`);","saveState();audit('تسجيل فاتورة منتجات',`${c.name} — ${inv.number} — ${invoiceTotalsTextV130(totals)}`);driveSnapshot('invoice',inv.id);",1)
    p130.write_text(s,encoding='utf-8')

    # Digital-store requests carry stable idempotency IDs across timeout/retry.
    p170=app/'app/src/main/assets/app-v170.js'
    d=p170.read_text(encoding='utf-8')
    d=d.replace("const VERSION='1.5.20';","const VERSION='1.5.28';",1)
    anchor="""let smm={root:null,returnPath:[],rootCategories:[],rootProducts:[],platforms:[],platform:null,sectionTrail:[],sections:[],sectionOptions:[],selectedSection:null,products:[],product:null,unitPrice:0,search:'',expanded:false,error:'',drop:'',dropSearch:''};

const el=id=>document.getElementById(id);"""
    helper="""let smm={root:null,returnPath:[],rootCategories:[],rootProducts:[],platforms:[],platform:null,sectionTrail:[],sections:[],sectionOptions:[],selectedSection:null,products:[],product:null,unitPrice:0,search:'',expanded:false,error:'',drop:'',dropSearch:''};
const requestMemo170=new Map(),activeRequest170=new Map();
const REQUEST_STORAGE170='uchiha-pending-financial-requests-v178';
function requestUuid170(){try{return crypto.randomUUID()}catch(_e){return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}}
function requestFingerprint170(signature){
  // Persist a salted fingerprint, never the order's credentials or proof image.
  let salt='';
  try{salt=localStorage.getItem(REQUEST_STORAGE170+':salt')||'';if(!salt){salt=requestUuid170();localStorage.setItem(REQUEST_STORAGE170+':salt',salt)}}catch(_e){salt='session-only'}
  const value=salt+':'+String(signature||'');let h1=2166136261,h2=0x9e3779b9;
  for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);h1=Math.imul(h1^c,16777619);h2=Math.imul(h2^(c+17),2246822519)}
  return (h1>>>0).toString(16)+':'+(h2>>>0).toString(16)+':'+value.length;
}
function persistRequestMemo170(){
  try{localStorage.setItem(REQUEST_STORAGE170,JSON.stringify(Array.from(requestMemo170.entries()).slice(-50)))}catch(_e){}
}
try{
  const saved=JSON.parse(localStorage.getItem(REQUEST_STORAGE170)||'[]');
  if(Array.isArray(saved))for(const pair of saved){
    if(Array.isArray(pair)&&typeof pair[0]==='string'&&pair[1]&&typeof pair[1].id==='string'&&pair[1].id.startsWith('req:'))requestMemo170.set(pair[0],pair[1]);
  }
}catch(_e){}
function requestId170(scope,signature){
  const key=scope+':'+requestFingerprint170(signature);activeRequest170.set(scope,key);
  const old=requestMemo170.get(key);
  if(old)return old.id;
  const id='req:'+requestUuid170();requestMemo170.set(key,{id,createdAt:Date.now()});persistRequestMemo170();return id;
}
function clearRequest170(scope){
  const key=activeRequest170.get(scope);if(key)requestMemo170.delete(key);
  activeRequest170.delete(scope);persistRequestMemo170();
}

const el=id=>document.getElementById(id);"""
    d=rep(d,anchor,helper,'request memo helper')

    old_buy="""    const productId=Number(selectedProduct.id),r=await call('digital_purchase',{product_id:productId,fields,quantity});busy=false;
    if(!selectedProduct||Number(selectedProduct.id)!==productId)return;
    if(!r.ok){if(error)error.textContent=errorText(r.error);if(button){button.disabled=false;button.textContent='شراء'}return}
    wallet.balance=Number(r.balance??wallet.balance);"""
    new_buy="""    const productId=Number(selectedProduct.id),requestId=requestId170('buy',JSON.stringify([productId,quantity,fields])),r=await call('digital_purchase',{product_id:productId,fields,quantity,request_id:requestId});busy=false;
    if(!selectedProduct||Number(selectedProduct.id)!==productId)return;
    if(!r.ok){if(error)error.textContent=errorText(r.error);if(button){button.disabled=false;button.textContent='شراء'}return}
    if(r.outcome==='replayed'){
      wallet.balance=Number(r.balance??wallet.balance);
      if(!r.needs_review)clearRequest170('buy');
      notify(r.needs_review?'طلبك السابق مسجّل وقيد التحقق. لا تعِد الشراء قبل مراجعة حالة الطلب.':'تم العثور على طلبك المسجّل سابقًا. راجع حالة الطلب.');
      selectedProduct=null;selectedSchema=null;mode='store';await loadWallet().catch(()=>null);storeScreen();return;
    }
    if(r.outcome==='unknown'){
      wallet.balance=Number(r.balance??wallet.balance);
      notify('نتيجة الطلب غير مؤكدة. الطلب مسجّل برقم ثابت؛ راجع حالته ولا تُعد الشراء قبل التحقق.',true);
      selectedProduct=null;selectedSchema=null;mode='store';await loadWallet().catch(()=>null);storeScreen();return;
    }
    clearRequest170('buy');
    wallet.balance=Number(r.balance??wallet.balance);"""
    d=rep(d,old_buy,new_buy,'digital purchase request id')

    old_smm="""    const r=await call('digital_purchase',{product_id:Number(p.id),fields,quantity});
    busy=false;
    if(!r.ok){notify(errorText(r.error),true);return;}
    wallet.balance=Number(r.balance??wallet.balance);"""
    new_smm="""    const productId=Number(p.id),requestId=requestId170('smm',JSON.stringify([productId,quantity,fields]));
    const r=await call('digital_purchase',{product_id:productId,fields,quantity,request_id:requestId});
    busy=false;
    if(!r.ok){notify(errorText(r.error),true);return;}
    if(r.outcome==='replayed'){
      wallet.balance=Number(r.balance??wallet.balance);
      if(!r.needs_review)clearRequest170('smm');
      notify(r.needs_review?'طلب الرشق السابق مسجّل وقيد التحقق. لا تُعد إرسال الطلب قبل المراجعة.':'تم العثور على طلب الرشق السابق. راجع حالة الطلب.');
      smm.product=null;smm.unitPrice=0;await loadWallet().catch(()=>null);smmScreen();return;
    }
    if(r.outcome==='unknown'){
      wallet.balance=Number(r.balance??wallet.balance);
      notify('نتيجة طلب الرشق غير مؤكدة. انتظر تحديث حالته ولا تُعد الشراء قبل التحقق.',true);
      smm.product=null;smm.unitPrice=0;await loadWallet().catch(()=>null);smmScreen();return;
    }
    clearRequest170('smm');
    wallet.balance=Number(r.balance??wallet.balance);"""
    d=rep(d,old_smm,new_smm,'smm purchase request id')

    old_topup="""  async submitTopup(){const amount=Number(el('digitalTopupAmount')?.value||0);if(!(amount>0)){notify('اكتب المبلغ الذي حولته',true);return;}if(!proofData){notify('أرفق صورة إثبات التحويل',true);return;}if(busy)return;busy=true;const keepMode=mode;const r=await call('digital_topup_create',{amount,proof_data:proofData});busy=false;if(!r.ok){notify(errorText(r.error),true);return;}proofData='';proofName='';topupOpen=false;notify('تم إرسال طلب الشحن للإدارة');await loadWallet();mode=keepMode==='smm'?'smm':'store';render()},"""
    new_topup="""  async submitTopup(){const amount=Number(el('digitalTopupAmount')?.value||0);if(!(amount>0)){notify('اكتب المبلغ الذي حولته',true);return;}if(!proofData){notify('أرفق صورة إثبات التحويل',true);return;}if(busy)return;busy=true;const keepMode=mode,proofSig=proofData.length+':'+proofData.slice(0,48)+':'+proofData.slice(-48),requestId=requestId170('topup',JSON.stringify([amount,proofSig]));const r=await call('digital_topup_create',{amount,proof_data:proofData,request_id:requestId});busy=false;if(!r.ok){notify(errorText(r.error),true);return;}clearRequest170('topup');proofData='';proofName='';topupOpen=false;notify('تم إرسال طلب الشحن للإدارة');await loadWallet();mode=keepMode==='smm'?'smm':'store';render()},"""
    d=rep(d,old_topup,new_topup,'topup request id and text fix')

    old_adjust="""  async adjustWallet(id,label){const raw=prompt('أدخل المبلغ للتعديل. مثال 10 للإضافة أو -5 للخصم\\n'+label,'');if(raw===null)return;const amount=Number(raw);if(!amount){notify('المبلغ غير صحيح',true);return;}const reason=prompt('سبب التعديل','تعديل يدوي من الإدارة')||'تعديل يدوي';const r=await call('owner_digital_wallet_adjust',{license_id:id,amount,reason});if(!r.ok){notify(errorText(r.error),true);return;}notify('تم تحديث الرصيد');await this.loadAdmin()},"""
    new_adjust="""  async adjustWallet(id,label){if(busy)return;const raw=prompt('أدخل المبلغ للتعديل. مثال 10 للإضافة أو -5 للخصم\\n'+label,'');if(raw===null)return;const amount=Number(raw);if(!amount){notify('المبلغ غير صحيح',true);return;}const reason=prompt('سبب التعديل','تعديل يدوي من الإدارة')||'تعديل يدوي',requestId=requestId170('wallet-adjust',JSON.stringify([id,amount,reason]));busy=true;const r=await call('owner_digital_wallet_adjust',{license_id:id,amount,reason,request_id:requestId});busy=false;if(!r.ok){notify(errorText(r.error),true);return;}clearRequest170('wallet-adjust');notify('تم تحديث الرصيد');await this.loadAdmin()},"""
    d=rep(d,old_adjust,new_adjust,'wallet adjust request id')
    p170.write_text(d,encoding='utf-8')

    guard=r"""/* UCHIHA Debt Store v1.5.28 — remaining financial-action guard. */
(function(){'use strict';
let invoiceGate=false;
const baseInvoice=window.submitInvoiceV130;
if(typeof baseInvoice==='function'){
  window.submitInvoiceV130=function(){
    if(invoiceGate){try{toast('الفاتورة قيد التسجيل — انتظر لحظة');}catch(_e){}return;}
    invoiceGate=true;
    const before=(state.invoices||[]).length,pendingBefore=pendingSensitive;
    try{
      const out=baseInvoice.apply(this,arguments);
      if((state.invoices||[]).length===before&&pendingSensitive===pendingBefore)invoiceGate=false;
      setTimeout(()=>{invoiceGate=false;},2500);
      return out;
    }catch(e){invoiceGate=false;throw e;}
  };
}
window.DebtFinancialGuardV178={version:'1.5.28'};
})();
"""
    gp=app/'app/src/main/assets/financial-guard-v178.js'
    gp.write_text(guard,encoding='utf-8')
    ip=app/'app/src/main/assets/index.html'
    h=ip.read_text(encoding='utf-8')
    h=rep(h,'  <script src="ledger-guard-v177.js"></script>','  <script src="ledger-guard-v177.js"></script>\n  <script src="financial-guard-v178.js"></script>','v178 guard include')
    ip.write_text(h,encoding='utf-8')

    sync=app/'app/src/main/assets/sync-v165.js'
    ss=sync.read_text(encoding='utf-8').replace("const SYNC_VERSION='1.5.27';","const SYNC_VERSION='1.5.28';",1)
    ss=rep(ss,"const legacy=(state.clients||[]).filter(x=>legacyClientIds.has(x.id)&&!used.has(x.id));","const legacy=(state.clients||[]).filter(x=>(legacyClientIds.has(x.id)||x.restoreLegacy===true)&&!used.has(x.id));",'restored legacy customers')
    ss=rep(ss,"if(!legacyEntryIds.has(e.id))return null;","if(!legacyEntryIds.has(e.id)&&e.restoreLegacy!==true)return null;",'restored legacy transactions')
    ss=rep(ss,"if(!c.cloudId&&!c.remoteId&&!c.syncKey&&!legacyClientIds.has(c.id))c.syncKey=sourceKey('client',c.id);","if(!c.cloudId&&!c.remoteId&&!c.syncKey&&!legacyClientIds.has(c.id)&&c.restoreLegacy!==true)c.syncKey=sourceKey('client',c.id);",'restore customer key guard')
    ss=rep(ss,"if(!e.cloudId&&!e.remoteId&&!e.syncKey&&!legacyEntryIds.has(e.id))e.syncKey=sourceKey('entry',e.id);","if(!e.cloudId&&!e.remoteId&&!e.syncKey&&!legacyEntryIds.has(e.id)&&e.restoreLegacy!==true)e.syncKey=sourceKey('entry',e.id);",'restore transaction key guard')
    ss=rep(ss,"    const open=[];","    const open={USD:[],TRY:[],SYP:[]};",'sync fifo currency buckets')
    ss=rep(ss,"if(e.type==='purchase'||e.type==='opening'){open.push(e);continue;}","if(e.type==='purchase'||e.type==='opening'){(open[e.originalCurrency]||(open[e.originalCurrency]=[])).push(e);continue;}",'sync fifo purchase bucket')
    ss=rep(ss,"for(const d of open){","for(const d of (open[e.originalCurrency]||[])){",'sync fifo payment bucket')
    ss=rep(ss,"c.syncKey=row.source_key||c.syncKey||('cloud-client:'+row.id);\n      c.pinned=", "c.syncKey=row.source_key||c.syncKey||('cloud-client:'+row.id);delete c.restoreLegacy;\n      c.pinned=",'clear restored customer match')
    ss=rep(ss,"if(row){c.cloudId=row.id;c.remoteId=c.remoteId||row.id;c.syncKey=row.source_key||c.syncKey;}","if(row){c.cloudId=row.id;c.remoteId=c.remoteId||row.id;c.syncKey=row.source_key||c.syncKey;delete c.restoreLegacy;}",'clear restored customer upload')
    ss=rep(ss,"usedCloud.add(row.id);e.cloudId=row.id;e.remoteId=e.remoteId||row.id;e.syncKey=row.source_key||e.syncKey||('cloud-entry:'+row.id);","usedCloud.add(row.id);e.cloudId=row.id;e.remoteId=e.remoteId||row.id;e.syncKey=row.source_key||e.syncKey||('cloud-entry:'+row.id);delete e.restoreLegacy;",'clear restored transaction match')
    ss=rep(ss,"if(row){e.cloudId=row.id;e.remoteId=e.remoteId||row.id;e.syncKey=row.source_key||e.syncKey;}","if(row){e.cloudId=row.id;e.remoteId=e.remoteId||row.id;e.syncKey=row.source_key||e.syncKey;delete e.restoreLegacy;}",'clear restored transaction upload')
    sync.write_text(ss,encoding='utf-8')

    g=g.replace('versionCode 1052700','versionCode 1052800',1).replace("versionName '1.5.27'","versionName '1.5.28'",1)
    gradle.write_text(g,encoding='utf-8')

if __name__=='__main__':
    main()
