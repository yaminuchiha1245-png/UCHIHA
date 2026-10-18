#!/usr/bin/env python3
"""v1.5.36: currency-native payments; never compare/allocate TRY through USD exchange rates."""
from pathlib import Path
import sys

def once(s,a,b,label):
    n=s.count(a)
    if n!=1:
        raise SystemExit(f"{label}: expected one match, got {n}")
    return s.replace(a,b,1)

def between(s,start,end,new,label):
    i=s.find(start)
    if i<0: raise SystemExit(f"{label}: start marker missing")
    j=s.find(end,i)
    if j<0: raise SystemExit(f"{label}: end marker missing")
    return s[:i]+new+s[j:]

def main():
    if len(sys.argv)!=2:
        raise SystemExit("usage: patch_v192.py debt-app")
    root=Path(sys.argv[1]).resolve()

    gradle=root/"app/build.gradle"
    g=gradle.read_text(encoding="utf-8")
    g=once(g,"versionCode 1053500","versionCode 1053600","versionCode")
    g=once(g,"versionName '1.5.35'","versionName '1.5.36'","versionName")
    gradle.write_text(g,encoding="utf-8")

    app121=root/"app/src/main/assets/app-v121.js"
    s=app121.read_text(encoding="utf-8")
    new_payment=r'''function compatibilityRateToUsdV192(e){
  const original=num(e?.originalAmount),usd=num(e?.usdAmount);
  if(original>0&&usd>=0)return usd/original;
  if(e?.originalCurrency==='USD')return 1;
  if(e?.originalCurrency==='TRY'&&num(e?.rateUsdTry)>0)return 1/num(e.rateUsdTry);
  if(e?.originalCurrency==='SYP'&&num(e?.rateUsdSyp)>0)return 1/num(e.rateUsdSyp);
  return 0;
}
function rebuildCurrencyCompatibilityV192(clientId){
  const rows=ledgerRows(clientId).slice().sort((a,b)=>{
    const ta=new Date(a.createdAt||a.date||0).getTime()||0,tb=new Date(b.createdAt||b.date||0).getTime()||0;
    if(ta!==tb)return ta-tb;
    if(a.type!==b.type)return a.type==='payment'?1:-1;
    return String(a.syncKey||a.cloudId||a.remoteId||a.id||'').localeCompare(String(b.syncKey||b.cloudId||b.remoteId||b.id||''));
  });
  const open={USD:[],TRY:[],SYP:[]};
  let unallocated=0;
  for(const e of rows){
    const cur=e.originalCurrency||'USD';
    if(['purchase','opening'].includes(e.type)){
      e.paidUsd=0;
      e.remainingUsd=round2(num(e.usdAmount));
      e.allocations=[];
      delete e.settledAt;
      (open[cur]||(open[cur]=[])).push({e,left:num(e.originalAmount)});
      continue;
    }
    if(e.type!=='payment')continue;
    let left=num(e.originalAmount);
    e.paidUsd=num(e.usdAmount);
    e.remainingUsd=0;
    e.allocations=[];
    for(const slot of (open[cur]||[])){
      if(left<=0.0001)break;
      if(slot.left<=0.0001)continue;
      const takeOriginal=Math.min(left,slot.left);
      const takeUsd=round2(takeOriginal*compatibilityRateToUsdV192(slot.e));
      slot.left=Math.max(0,slot.left-takeOriginal);
      slot.e.paidUsd=round2(num(slot.e.paidUsd)+takeUsd);
      slot.e.remainingUsd=round2(Math.max(0,num(slot.e.usdAmount)-num(slot.e.paidUsd)));
      if(slot.left<=0.0001||slot.e.remainingUsd<=0.005){
        slot.left=0;
        slot.e.remainingUsd=0;
        slot.e.settledAt=e.createdAt||nowIso();
      }
      e.allocations.push({entryId:slot.e.id,usd:takeUsd,originalAmount:round2(takeOriginal),currency:cur});
      left=Math.max(0,left-takeOriginal);
    }
    if(left>0.0001)unallocated+=left;
  }
  return unallocated;
}
function rebuildAllCurrencyCompatibilityV192(){
  let unallocated=0;
  for(const c of state.clients||[])unallocated+=rebuildCurrencyCompatibilityV192(c.id);
  return unallocated;
}
window.DebtCurrencyPaymentV192={
  version:'1.5.36',
  rebuildClient:rebuildCurrencyCompatibilityV192,
  rebuildAll:rebuildAllCurrencyCompatibilityV192,
  balance:clientCurrencyDebtV121
};

window.commitPayment=function(p,authMethod='pin'){
  p=p||{};
  const amount=num(p.amount),cur=p.currency||paymentDraft.currency;
  if(!p.clientId||amount<=0||!['USD','TRY'].includes(cur)){toast('بيانات الدفعة غير صحيحة');return;}
  const available=num(clientCurrencyDebtV121(p.clientId)[cur]);
  if(amount>available+0.0001){toast(`الدفعة أكبر من رصيد ${cur}`);return;}
  const cv=convert(amount,cur);
  if(!cv){toast('حدّث سعر الصرف أولًا');return;}
  const payment={
    id:uid('PAY'),
    clientId:p.clientId,
    type:'payment',
    date:today(),
    createdAt:nowIso(),
    description:p.description||'دفعة',
    originalAmount:amount,
    originalCurrency:cur,
    usdAmount:cv.usd,
    tryAmount:cv.try,
    sypAmount:0,
    rateUsdTry:num(state.rates?.usdTry)||0,
    rateUsdSyp:0,
    paidUsd:cv.usd,
    remainingUsd:0,
    allocations:[],
    createdBy:currentAccount()?.name||'',
    authMethod,
    operationKey:p.operationKey||''
  };
  state.entries.push(payment);
  rebuildCurrencyCompatibilityV192(p.clientId);
  saveState();
  audit('تسجيل دفعة',`${state.clients.find(c=>c.id===p.clientId)?.name||''} — ${amount} ${cur}`);
  try{driveSnapshot('payment',payment.id);}catch(_e){}
  toast(`تم تسجيل الدفعة ${fmtFlex(amount)} ${cur} ✓`);
  paymentDraft={amount:'',currency:cur,description:'دفعة'};
  selectedClientId=p.clientId;
  view='client';
  render();
};
window.submitPayment=function(){
  const amount=num(paymentDraft.amount);
  if(!paymentClientId||amount<=0){toast('اكتب مبلغًا صحيحًا');return;}
  if(!hasRates()){toast('حدّث سعر الصرف أولًا');return;}
  const cur=paymentDraft.currency;
  const available=num(clientCurrencyDebtV121(paymentClientId)[cur]);
  if(amount>available+0.0001){toast(`الدفعة أكبر من رصيد ${cur}`);return;}
  const payload={clientId:paymentClientId,amount,currency:cur,description:'دفعة'};
  requireSensitive(state.settings.requireBiometricPayment,'تسجيل دفعة',method=>commitPayment(payload,method));
};

'''
    s=between(
      s,
      "const oldSubmitPaymentV121=window.submitPayment;",
      "window.renderStats=function(){",
      new_payment,
      "currency-native payment block"
    )
    app121.write_text(s,encoding="utf-8")

    app110=root/"app/src/main/assets/app-v110.js"
    q=app110.read_text(encoding="utf-8")
    marker="function rebuildFifoForClientV110(clientId){"
    i=q.find(marker)
    j=q.find("function rebuildAllFifoV110()",i)
    if i<0 or j<0: raise SystemExit("app-v110 FIFO markers missing")
    old=q[i:j]
    hooked=old.replace(
      marker,
      marker+"if(window.DebtCurrencyPaymentV192?.rebuildClient)return window.DebtCurrencyPaymentV192.rebuildClient(clientId);",
      1
    )
    q=q[:i]+hooked+q[j:]
    app110.write_text(q,encoding="utf-8")

    sync=root/"app/src/main/assets/sync-v165.js"
    z=sync.read_text(encoding="utf-8")
    z=once(z,"const SYNC_VERSION='1.5.35';","const SYNC_VERSION='1.5.36';","sync version")
    marker2="function rebuildLedger(){"
    i=z.find(marker2)
    j=z.find("function ensureNewSyncKeys(){",i)
    if i<0 or j<0: raise SystemExit("sync rebuild markers missing")
    old2=z[i:j]
    hooked2=old2.replace(
      marker2,
      marker2+"\n  if(window.DebtCurrencyPaymentV192?.rebuildAll){window.DebtCurrencyPaymentV192.rebuildAll();return;}\n",
      1
    )
    z=z[:i]+hooked2+z[j:]
    sync.write_text(z,encoding="utf-8")

    print("Applied v1.5.36 currency-native payment validation and FIFO")

if __name__=="__main__":
    main()
