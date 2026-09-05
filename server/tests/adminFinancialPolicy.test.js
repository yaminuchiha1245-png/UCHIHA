const test=require("node:test");
const assert=require("node:assert/strict");
const {findAdminAdjustment,sameAdminAdjustment}=require("../lib/adminFinancialPolicy");

test("Admin balance idempotency is scoped by user and request id",()=>{
  const rows=[{id:"t1",telegramId:"1",type:"admin_credit",amount:10,adminRequestId:"r1"}];
  assert.equal(findAdminAdjustment(rows,{telegramId:"1",clientRequestId:"r1"}).id,"t1");
  assert.equal(findAdminAdjustment(rows,{telegramId:"2",clientRequestId:"r1"}),null);
});

test("Admin balance idempotency conflicts on a different amount",()=>{
  const tx={amount:10};
  assert.equal(sameAdminAdjustment(tx,{amount:10}),true);
  assert.equal(sameAdminAdjustment(tx,{amount:-10}),false);
  assert.equal(sameAdminAdjustment(tx,{amount:20}),false);
});
