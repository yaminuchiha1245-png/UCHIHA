const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=path.resolve(process.argv[2]||'debt-app/app/src/main/assets');
const ui=fs.readFileSync(path.join(root,'app-v121.js'),'utf8');
const app110=fs.readFileSync(path.join(root,'app-v110.js'),'utf8');
const sync=fs.readFileSync(path.join(root,'sync-v165.js'),'utf8');

for(const needle of [
  "version:'1.5.36'",
  "function rebuildCurrencyCompatibilityV192(clientId)",
  "const available=num(clientCurrencyDebtV121(p.clientId)[cur]);",
  "const available=num(clientCurrencyDebtV121(paymentClientId)[cur]);",
  "operationKey:p.operationKey||''",
  "DebtCurrencyPaymentV192?.rebuildClient",
  "DebtCurrencyPaymentV192?.rebuildAll"
]) assert(ui.includes(needle)||app110.includes(needle)||sync.includes(needle),'missing '+needle);

assert(!ui.includes("oldSubmitPaymentV121();"),'must not fall through to legacy USD validation');
assert(sync.includes("SYNC_VERSION='1.5.36'"),'sync version mismatch');

const start=ui.indexOf("function compatibilityRateToUsdV192");
const end=ui.indexOf("window.DebtCurrencyPaymentV192=",start);
assert(start>=0&&end>start,'helper block missing');
const helper=ui.slice(start,end);

const state={
  clients:[{id:'C1'}],
  entries:[
    {id:'T1',clientId:'C1',type:'purchase',originalCurrency:'TRY',originalAmount:925,usdAmount:22.02,paidUsd:0,remainingUsd:22.02,createdAt:'2026-01-01T10:00:00Z'},
    {id:'U1',clientId:'C1',type:'purchase',originalCurrency:'USD',originalAmount:50,usdAmount:50,paidUsd:0,remainingUsd:50,createdAt:'2026-01-01T10:01:00Z'},
    // Same 920 TRY payment converted at a DIFFERENT current rate (~35 TRY/USD).
    {id:'P1',clientId:'C1',type:'payment',originalCurrency:'TRY',originalAmount:920,usdAmount:26.29,paidUsd:26.29,remainingUsd:0,createdAt:'2026-01-02T10:00:00Z'}
  ]
};
const ctx={
  state,
  ledgerRows:id=>state.entries.filter(e=>e.clientId===id),
  num:v=>Number(v)||0,
  round2:v=>Math.round((Number(v)||0)*100)/100,
  nowIso:()=> '2026-01-02T10:00:00Z',
  console
};
vm.createContext(ctx);
vm.runInContext(helper,ctx);
const unallocated=vm.runInContext("rebuildCurrencyCompatibilityV192('C1')",ctx);
assert.equal(unallocated,0,'valid TRY payment must allocate fully');
const tryPurchase=state.entries.find(e=>e.id==='T1');
const usdPurchase=state.entries.find(e=>e.id==='U1');
const payment=state.entries.find(e=>e.id==='P1');
assert.equal(usdPurchase.remainingUsd,50,'TRY payment must never touch USD debt');
assert(payment.allocations.length===1&&payment.allocations[0].entryId==='T1','payment must allocate only to TRY purchase');
assert.equal(payment.allocations[0].originalAmount,920,'allocation must use original TRY amount');
assert(tryPurchase.remainingUsd>0&&tryPurchase.remainingUsd<0.2,'925 TRY - 920 TRY should leave only 5 TRY equivalent');
console.log('PASS v1.5.36 currency-native payment: 925 TRY - 920 TRY leaves 5 TRY and USD untouched');
