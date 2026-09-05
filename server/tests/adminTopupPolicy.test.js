const test=require("node:test");
const assert=require("node:assert/strict");
const {topupActionConfirmationError,topupApprovalEvidenceError}=require("../lib/adminTopupPolicy");

test("Admin top-up approval requires explicit backend confirmation",()=>{
  assert.equal(topupActionConfirmationError("approve",{}),"topup_approval_confirmation_required");
  assert.equal(topupActionConfirmationError("approve",{confirmation:"APPROVE_TOPUP"}),null);
});

test("Admin top-up rejection requires explicit backend confirmation",()=>{
  assert.equal(topupActionConfirmationError("reject",{}),"topup_rejection_confirmation_required");
  assert.equal(topupActionConfirmationError("reject",{confirmation:"REJECT_TOPUP"}),null);
});


test("required receipt blocks approval until evidence is uploaded",()=>{
  assert.equal(topupApprovalEvidenceError({requiresReceipt:true}),"topup_receipt_required");
  assert.equal(topupApprovalEvidenceError({requiresReceipt:true,receiptFileName:"receipt.webp"}),null);
  assert.equal(topupApprovalEvidenceError({requiresReceipt:false}),null);
});
