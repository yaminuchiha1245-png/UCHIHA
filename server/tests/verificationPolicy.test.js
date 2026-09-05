const test=require("node:test");
const assert=require("node:assert/strict");
const {sanitizeDecision,publicVerification}=require("../lib/verificationPolicy");
test("verification decision only allows reviewed terminal states",()=>{
  assert.deepEqual(sanitizeDecision({status:"verified"}),{status:"verified",rejectionReason:null});
  assert.throws(()=>sanitizeDecision({status:"pending"}),/invalid_verification_status/);
});
test("customer verification view does not expose telegram id",()=>{
  const row={id:"v1",telegramId:"123",status:"pending",createdAt:"2026-01-01T00:00:00Z"};
  assert.equal(publicVerification(row).telegramId,undefined);
  assert.equal(publicVerification(row,{admin:true}).telegramId,"123");
});
