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

    # Invoice accounting rows get durable identities even while offline.
    p130=app/'app/src/main/assets/app-v130.js'
    s=p130.read_text(encoding='utf-8')
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
    p130.write_text(s,encoding='utf-8')

    # Digital-store requests carry stable idempotency IDs across timeout/retry.
    p170=app/'app/src/main/assets/app-v170.js'
    d=p170.read_text(encoding='utf-8')
    d=d.replace("const VERSION='1.5.20';","const VERSION='1.5.28';",1)
    anchor="""let smm={root:null,returnPath:[],rootCategories:[],rootProducts:[],platforms:[],platform:null,sectionTrail:[],sections:[],sectionOptions:[],selectedSection:null,products:[],product:null,unitPrice:0,search:'',expanded:false,error:'',drop:'',dropSearch:''};

const el=id=>document.getElementById(id);"""
    helper="""let smm={root:null,returnPath:[],rootCategories:[],rootProducts:[],platforms:[],platform:null,sectionTrail:[],sections:[],sectionOptions:[],selectedSection:null,products:[],product:null,unitPrice:0,search:'',expanded:false,error:'',drop:'',dropSearch:''};
const requestMemo170=new Map();
function requestUuid170(){try{return crypto.randomUUID()}catch(_e){return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}}
function requestId170(scope,signature){
  const sig=String(signature||'');
  const old=requestMemo170.get(scope);
  if(old&&old.signature===sig)return old.id;
  const id='req:'+requestUuid170();requestMemo170.set(scope,{signature:sig,id});return id;
}
function clearRequest170(scope){requestMemo170.delete(scope);}

const el=id=>document.getElementById(id);"""
    d=rep(d,anchor,helper,'request memo helper')

    old_buy="""    const productId=Number(selectedProduct.id),r=await call('digital_purchase',{product_id:productId,fields,quantity});busy=false;
    if(!selectedProduct||Number(selectedProduct.id)!==productId)return;
    if(!r.ok){if(error)error.textContent=errorText(r.error);if(button){button.disabled=false;button.textContent='شراء'}return}
    wallet.balance=Number(r.balance??wallet.balance);"""
    new_buy="""    const productId=Number(selectedProduct.id),requestId=requestId170('buy',JSON.stringify([productId,quantity,fields])),r=await call('digital_purchase',{product_id:productId,fields,quantity,request_id:requestId});busy=false;
    if(!selectedProduct||Number(selectedProduct.id)!==productId)return;
    if(!r.ok){if(error)error.textContent=errorText(r.error);if(button){button.disabled=false;button.textContent='شراء'}return}
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
    sync.write_text(ss,encoding='utf-8')

    g=g.replace('versionCode 1052700','versionCode 1052800',1).replace("versionName '1.5.27'","versionName '1.5.28'",1)
    gradle.write_text(g,encoding='utf-8')

if __name__=='__main__':
    main()
