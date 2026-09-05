const test=require("node:test");
const assert=require("node:assert/strict");
const {adminTopupView}=require("../lib/adminTopupView");

test("admin top-up view derives uploaded receipt from stored file safely",()=>{
  const v=adminTopupView({id:"t1",telegramId:"123",amount:20,method:"manual",requiresReceipt:true,receiptFileName:"secret-internal-name.webp",receiptUploadedAt:"2026-09-05T00:00:00Z",status:"pending"});
  assert.equal(v.requiresReceipt,true);
  assert.equal(v.receiptUploaded,true);
  assert.equal(v.receiptUploadedAt,"2026-09-05T00:00:00Z");
  assert.equal(Object.hasOwn(v,"receiptFileName"),false);
});

test("admin top-up view reports missing optional receipt clearly",()=>{
  const v=adminTopupView({id:"t2",telegramId:"456",amount:5,status:"pending"});
  assert.equal(v.requiresReceipt,false);
  assert.equal(v.receiptUploaded,false);
});
