const fs=require('fs'),path=require('path'),assert=require('assert/strict'),vm=require('vm');
const app=path.resolve(process.argv[2]||'work-v1528/app/src/main/assets');
const root=path.resolve(process.argv[3]||'build/debt178');

const a130=fs.readFileSync(path.join(app,'app-v130.js'),'utf8');
const a170=fs.readFileSync(path.join(app,'app-v170.js'),'utf8');
const guard=fs.readFileSync(path.join(app,'financial-guard-v178.js'),'utf8');
const base=fs.readFileSync(path.join(app,'app.js'),'utf8');
const app110=fs.readFileSync(path.join(app,'app-v110.js'),'utf8');
const sync=fs.readFileSync(path.join(app,'sync-v165.js'),'utf8');
const edge=fs.readFileSync(path.join(root,'supabase/debt-service/index.ts'),'utf8');

assert(a130.includes("invoiceRequestKeyV178=invoiceRequestKeyV178||('invoice:'+uuidV110())"),'invoice submit must reuse one request identity');
assert(a130.includes("state.invoices.some(x=>x.operationKey===invoiceOperationKey)"),'invoice callback replay must commit once');
assert(a130.includes("syncKey:'entry:'+entryRemoteId"),'invoice ledger rows need durable sync identities');
assert(a130.includes("remoteId:invoiceRemoteId"),'invoice must keep its cloud identity while offline');
assert(a130.includes("if(!can('purchase')){toast('لا توجد صلاحية تسجيل شراء');return;}"),'invoice flow must enforce purchase permission locally');
assert(a130.includes("إدارة المنتجات للمالك فقط"),'product management must be owner-only locally');
assert(guard.includes('invoiceGate'),'invoice submit requires an action gate');

for(const marker of [
  "requestId170('buy'","requestId170('smm'","requestId170('topup'","requestId170('wallet-adjust'",
  "request_id:requestId"
]) assert(a170.includes(marker),'missing client idempotency marker: '+marker);
assert(a170.includes("clearRequest170('buy')"),'purchase request id must clear only after success');
assert(a170.includes("clearRequest170('topup')"),'topup request id must clear only after success');
assert(a170.includes("clearRequest170('wallet-adjust')"),'wallet-adjust request id must clear only after success');

assert(base.includes("e.originalCurrency===currency"),'local payment FIFO must stay inside the payment currency');
assert(base.includes("new Date(a.createdAt||a.date)"),'FIFO must preserve real same-day transaction order');
assert(base.includes("Android.restoreSecureState(raw)"),'restore must use the native pre-restore checkpoint');
assert(base.includes("markRestoreLegacyV178"),'old backups must enter safe reconciliation mode');
assert(app110.includes("open[e.originalCurrency]"),'cloud FIFO rebuild must isolate currencies');
assert(app110.includes("driveSnapshot('purchase-edit'"),'purchase edits must create a full backup snapshot');
assert(a130.includes("driveSnapshot('invoice'"),'invoice registration must create a full backup snapshot');
assert(sync.includes("e.restoreLegacy!==true"),'restored legacy rows must not receive new identities before reconciliation');
assert(sync.includes("open[e.originalCurrency]"),'partner sync ledger rebuild must isolate currencies');

assert(sync.includes("SYNC_VERSION='1.5.28'"),'sync version must match release');
for(const helper of [
  'debt_digital_purchase_begin_idempotent',
  'debt_digital_topup_create_idempotent',
  'debt_digital_wallet_adjust_idempotent'
]) assert(edge.includes(helper),'edge must call '+helper);
assert(edge.includes("begin.replayed"),'purchase retry must recognize an existing order');
assert(edge.includes("order_uuid:String(begin.request_uuid)"),'provider retry must reuse the same provider order UUID');
assert(edge.includes("request_id"),'edge must accept client request IDs');


function testDurableRequestMemo(){
  const start=a170.indexOf('const requestMemo170=new Map()');
  const end=a170.indexOf('const el=id=>',start);
  assert(start>=0&&end>start,'durable request memo must exist in digital store');
  const helper=a170.slice(start,end);
  const kv=new Map();
  const localStorage={
    getItem:k=>kv.has(k)?kv.get(k):null,
    setItem:(k,v)=>kv.set(k,String(v))
  };
  let n=0;
  function boot(){
    const c={Map,Math,Date,localStorage,crypto:{randomUUID:()=>String(++n).padStart(8,'0')+'-0000-4000-8000-000000000000'}};
    vm.createContext(c);vm.runInContext(helper,c);return c;
  }
  const s1=boot();
  const signature=JSON.stringify([100,1,{username:'example-user',password:'secret-unittest-password'}]);
  const id1=vm.runInContext('requestId170("buy",'+JSON.stringify(signature)+')',s1);
  const identical=vm.runInContext('requestId170("buy",'+JSON.stringify(signature)+')',s1);
  assert.equal(identical,id1,'same action should reuse its request id');
  const other=vm.runInContext('requestId170("buy",'+JSON.stringify(JSON.stringify([101,1,{username:'else'}]))+')',s1);
  assert.notEqual(other,id1,'different action needs another request ID');
  const s2=boot();
  const afterRestart=vm.runInContext('requestId170("buy",'+JSON.stringify(signature)+')',s2);
  assert.equal(afterRestart,id1,'pending request ID must survive app restart');
  const serialized=JSON.stringify([...kv.entries()]);
  assert(!serialized.includes('secret-unittest-password'),'storage must never retain raw order credentials');
  vm.runInContext('clearRequest170("buy")',s2);
  const deliberateNew=vm.runInContext('requestId170("buy",'+JSON.stringify(signature)+')',s2);
  assert.notEqual(deliberateNew,id1,'after success, a new intentional purchase must receive a new ID');
}
testDurableRequestMemo();
assert(edge.includes("if(begin.replayed){"),'server must never resubmit an already-created request to the provider');
assert(a170.includes("if(r.outcome==='unknown')"),'unknown provider outcome must retain the original request ID');
console.log('PASS v1.5.28 financial idempotency + durable retry regression');
