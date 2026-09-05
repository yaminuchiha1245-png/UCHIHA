const test=require("node:test");
const assert=require("node:assert/strict");
const {
  projectFinancialState,financialMirrorSummary,verifyFinancialMirrorSummary
}=require("../lib/financialMirror");

const db={
  users:[{telegramId:"2",balance:5,currency:"USD"},{telegramId:"1",balance:10,currency:"USD"}],
  orders:[{id:"o2",orderNo:"GZ2",telegramId:"2",status:"completed",finalPrice:2,profit:1},{id:"o1",orderNo:"GZ1",telegramId:"1",status:"failed",finalPrice:3,profit:0}],
  transactions:[{id:"t1",telegramId:"1",type:"credit",amount:10,currency:"USD"}],
  topups:[{id:"tp1",telegramId:"1",amount:10,currency:"USD",method:"manual",status:"approved"}]
};

test("financial mirror projection is deterministic and normalized",()=>{
  const p=projectFinancialState(db);
  assert.deepEqual(p.users.map(x=>x.telegramId),["1","2"]);
  assert.deepEqual(p.orders.map(x=>x.id),["o1","o2"]);
  assert.equal(p.users[0].payloadSha256.length,64);
  assert.equal(p.transactions[0].payloadSha256.length,64);
});

test("financial mirror summary contains stable counts totals and digests",()=>{
  const a=financialMirrorSummary(db),b=financialMirrorSummary(JSON.parse(JSON.stringify(db)));
  assert.deepEqual(a,b);
  assert.equal(a.counts.users,2);
  assert.equal(a.totals.userBalances,15);
  assert.equal(a.totals.orderRevenue,5);
  assert.equal(a.digests.orders.length,64);
});

test("financial mirror summary drift is detected",()=>{
  const expected=financialMirrorSummary(db);
  const changed=JSON.parse(JSON.stringify(expected));
  changed.counts.orders++;
  changed.digests.users="bad";
  const result=verifyFinancialMirrorSummary(expected,changed);
  assert.equal(result.ok,false);
  assert.ok(result.errors.some(x=>x.section==="counts"&&x.key==="orders"));
  assert.ok(result.errors.some(x=>x.section==="digests"&&x.key==="users"));
});
