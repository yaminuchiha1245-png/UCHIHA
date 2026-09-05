const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizePaymentReference,paymentReferenceIdentity,findDuplicatePaymentReference,findIdempotentTopup,sameTopupRequest}=require("../lib/topupPolicy");

test("payment reference identity is trimmed and case-insensitive per method",()=>{
  assert.equal(normalizePaymentReference("  Tx-AbC "),"Tx-AbC");
  assert.equal(paymentReferenceIdentity("USDT","  Tx-AbC "),"usdt:tx-abc");
  assert.notEqual(paymentReferenceIdentity("manual","TX"),paymentReferenceIdentity("usdt","TX"));
});

test("duplicate payment reference excludes the current top-up",()=>{
  const rows=[{id:"a",method:"usdt",reference:"TX-1"},{id:"b",method:"manual",reference:"TX-1"}];
  assert.equal(findDuplicatePaymentReference(rows,{method:"usdt",reference:"tx-1"})?.id,"a");
  assert.equal(findDuplicatePaymentReference(rows,{method:"usdt",reference:"tx-1",excludeId:"a"}),null);
});

test("top-up request idempotency requires identical financial request details",()=>{
  const rows=[{id:"a",telegramId:"1",clientRequestId:"req-1",amount:10,method:"usdt",reference:"TX-1"}];
  const topup=findIdempotentTopup(rows,{telegramId:"1",clientRequestId:"req-1"});
  assert.equal(topup.id,"a");
  assert.equal(sameTopupRequest(topup,{amount:10,method:"usdt",reference:"tx-1"}),true);
  assert.equal(sameTopupRequest(topup,{amount:20,method:"usdt",reference:"tx-1"}),false);
});
