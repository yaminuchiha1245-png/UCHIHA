const test=require("node:test");
const assert=require("node:assert/strict");
const {scanDatabaseIntegrity,repairSafeIntegrity,reconcileWalletBalances}=require("../lib/integrity");

function db(){
  return {
    users:[{telegramId:"1",balance:5}],
    orders:[{id:"o1",orderNo:"GZ-1",telegramId:"1",productId:"p1",status:"completed",finalPrice:5}],
    transactions:[
      {id:"t1",telegramId:"1",type:"topup",amount:10,reference:"top1"},
      {id:"t2",telegramId:"1",type:"purchase",amount:-5,reference:"GZ-1"}
    ],
    products:[{id:"p1",categoryId:"c1",active:true,delivery:"manual"}],
    categories:[{id:"c1"}],
    topups:[{id:"top1",telegramId:"1",amount:10,status:"approved"}],
    coupons:[{code:"GZ10",uses:0}],
    couponUsages:[],
    favorites:[],notifications:[],supportTickets:[],
    orderEvents:[{id:"e1",orderNo:"GZ-1",status:"completed"}],
    inventoryCodes:[],providers:[]
  };
}

test("integrity scan accepts a consistent financial state",()=>{
  const r=scanDatabaseIntegrity(db());
  assert.equal(r.counts.critical,0);
  assert.equal(r.ok,true);
});

test("integrity scan catches wallet and duplicate refund corruption",()=>{
  const x=db();
  x.users[0].balance=99;
  x.transactions.push({id:"t3",telegramId:"1",type:"refund",amount:5,reference:"GZ-1"});
  x.transactions.push({id:"t4",telegramId:"1",type:"refund",amount:5,reference:"GZ-1"});
  const r=scanDatabaseIntegrity(x);
  assert.ok(r.issues.some(i=>i.code==="wallet_ledger_mismatch"));
  assert.ok(r.issues.some(i=>i.code==="duplicate_order_refund"));
  assert.ok(r.issues.some(i=>i.code==="completed_order_refunded"));
});

test("safe repair fixes coupon counters and orphan account-scoped rows",()=>{
  const x=db();
  x.coupons[0].uses=99;
  x.couponUsages.push({code:"GZ10",telegramId:"1",orderNo:"GZ-1"});
  x.favorites.push({telegramId:"missing",productId:"p1"});
  x.notifications.push({id:"n1",telegramId:"missing"});
  x.supportTickets.push({id:"s1",telegramId:"missing"});
  const r=repairSafeIntegrity(x);
  assert.ok(r.count>=4);
  assert.equal(x.coupons[0].uses,1);
  assert.equal(x.favorites.length,0);
  assert.equal(x.notifications.length,0);
  assert.equal(x.supportTickets.length,0);
});

test("wallet reconciliation rebuilds active balances from the immutable ledger",()=>{
  const x=db();x.users[0].balance=123;
  const r=reconcileWalletBalances(x);
  assert.equal(r.count,1);
  assert.equal(x.users[0].balance,5);
});


test("integrity scan catches duplicate payment references",()=>{
  const x=db();
  x.topups.push({id:"top2",telegramId:"1",amount:10,status:"pending",method:"manual",reference:"TX-ABC"});
  x.topups[0].method="manual";x.topups[0].reference="tx-abc";
  const r=scanDatabaseIntegrity(x);
  assert.ok(r.issues.some(i=>i.code==="duplicate_payment_reference"&&i.severity==="critical"));
});


test("integrity scan treats broken admin audit chain as critical",()=>{
  const x=db();
  x.adminAudit=[
    {id:"a2",action:"two",meta:{value:2},ip:"x",createdAt:"2"},
    {id:"a1",action:"one",meta:{value:1},ip:"x",createdAt:"1"}
  ];
  const {backfillAuditChain}=require("../lib/auditChain");
  backfillAuditChain(x.adminAudit);
  x.adminAudit[0].meta.value=999;
  const r=scanDatabaseIntegrity(x);
  assert.ok(r.issues.some(i=>i.code==="admin_audit_chain_broken"&&i.severity==="critical"));
});
