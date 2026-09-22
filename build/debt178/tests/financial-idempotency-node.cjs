const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const app=path.resolve(process.argv[2]||'work-v1528/app/src/main/assets');
const root=path.resolve(process.argv[3]||'build/debt178');

const a130=fs.readFileSync(path.join(app,'app-v130.js'),'utf8');
const a170=fs.readFileSync(path.join(app,'app-v170.js'),'utf8');
const guard=fs.readFileSync(path.join(app,'financial-guard-v178.js'),'utf8');
const sync=fs.readFileSync(path.join(app,'sync-v165.js'),'utf8');
const edge=fs.readFileSync(path.join(root,'supabase/debt-service/index.ts'),'utf8');

assert(a130.includes("invoiceOperationKey='invoice:'+invoiceRemoteId"),'invoice needs a durable operation identity');
assert(a130.includes("syncKey:'entry:'+entryRemoteId"),'invoice ledger rows need durable sync identities');
assert(a130.includes("remoteId:invoiceRemoteId"),'invoice must keep its cloud identity while offline');
assert(guard.includes('invoiceGate'),'invoice submit requires an action gate');

for(const marker of [
  "requestId170('buy'","requestId170('smm'","requestId170('topup'","requestId170('wallet-adjust'",
  "request_id:requestId"
]) assert(a170.includes(marker),'missing client idempotency marker: '+marker);
assert(a170.includes("clearRequest170('buy')"),'purchase request id must clear only after success');
assert(a170.includes("clearRequest170('topup')"),'topup request id must clear only after success');
assert(a170.includes("clearRequest170('wallet-adjust')"),'wallet-adjust request id must clear only after success');

assert(sync.includes("SYNC_VERSION='1.5.28'"),'sync version must match release');
for(const helper of [
  'debt_digital_purchase_begin_idempotent',
  'debt_digital_topup_create_idempotent',
  'debt_digital_wallet_adjust_idempotent'
]) assert(edge.includes(helper),'edge must call '+helper);
assert(edge.includes("begin.replayed"),'purchase retry must recognize an existing order');
assert(edge.includes("order_uuid:String(begin.request_uuid)"),'provider retry must reuse the same provider order UUID');
assert(edge.includes("request_id"),'edge must accept client request IDs');

console.log('PASS v1.5.28 financial idempotency static regression');
