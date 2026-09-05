const {verifyAuditChain,backfillAuditChain}=require("../lib/auditChain");
const test=require("node:test");
const assert=require("node:assert/strict");
const {anonymizeAndDeleteAccount}=require("../lib/accountLifecycle");

test("account deletion removes profile data and anonymizes financial history",()=>{
  const db={
    users:[{telegramId:"123",username:"player"}],
    orders:[{telegramId:"123",orderNo:"GZ-1",customerInput:"player-id"}],
    transactions:[{telegramId:"123",amount:-5}],
    topups:[{telegramId:"123",amount:10}],
    favorites:[{telegramId:"123",productId:"p1"}],
    notifications:[{telegramId:"123",id:"n1"}],
    supportTickets:[{telegramId:"123",id:"t1"}],
    verificationRequests:[{telegramId:"123",id:"verify1"}],
    devicePairs:[{telegramId:"123",id:"pair1"}],
    coupons:[{code:"GZ10",uses:1}],
    couponUsages:[{telegramId:"123",code:"GZ10",orderNo:"GZ-1"}],
    adminAudit:[{id:"a1",action:"balance_update",meta:{telegramId:"123"},ip:"x",createdAt:"2026-01-01T00:00:00Z"}],
    deletedAccounts:[]
  };
  const r=anonymizeAndDeleteAccount(db,"123",{anonymousId:"anon_test",deletedAt:"2026-08-30T00:00:00.000Z",deletionId:"del_1"});
  assert.equal(db.users.length,0);
  assert.equal(db.orders[0].telegramId,"anon_test");
  assert.equal(db.orders[0].customerInput,"[deleted]");
  assert.equal(db.transactions[0].telegramId,"anon_test");
  assert.equal(db.topups[0].telegramId,"anon_test");
  assert.equal(db.favorites.length,0);
  assert.equal(db.notifications.length,0);
  assert.equal(db.supportTickets.length,0);
  assert.equal(db.verificationRequests.length,0);
  assert.equal(db.devicePairs.length,0);
  assert.equal(db.couponUsages.length,0);
  assert.equal(db.coupons[0].uses,0);
  assert.equal(db.adminAudit[0].meta.telegramId,"anon_test");
  assert.equal(verifyAuditChain(db.adminAudit).ok,true);
  assert.equal(db.deletedAccounts[0].anonymousId,"anon_test");
  assert.equal(r.orderCount,1);
});
