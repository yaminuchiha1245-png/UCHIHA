const test=require("node:test");
const assert=require("node:assert/strict");
const {adminOrderConfirmationError}=require("../lib/adminOrderPolicy");

test("failing an unrefunded order requires explicit refund confirmation",()=>{
  assert.equal(adminOrderConfirmationError({requiresManualReview:false},"failed",false,{}),"refund_confirmation_required");
  assert.equal(adminOrderConfirmationError({requiresManualReview:false},"failed",false,{confirmation:"FAIL_AND_REFUND"}),null);
});

test("provider-review terminal resolution requires manual-review confirmation too",()=>{
  const order={requiresManualReview:true};
  assert.equal(adminOrderConfirmationError(order,"completed",false,{}),"provider_review_confirmation_required");
  assert.equal(adminOrderConfirmationError(order,"completed",false,{reviewResolved:true}),null);
  assert.equal(adminOrderConfirmationError(order,"failed",false,{reviewResolved:true,confirmation:"FAIL_AND_REFUND"}),null);
});

test("nonterminal status changes need no destructive confirmation",()=>{
  assert.equal(adminOrderConfirmationError({requiresManualReview:true},"processing",false,{}),null);
});


test("explicit refunded status also requires a real wallet refund confirmation",()=>{
  assert.equal(adminOrderConfirmationError({requiresManualReview:false},"refunded",false,{}),"refund_confirmation_required");
  assert.equal(adminOrderConfirmationError({requiresManualReview:false},"refunded",false,{confirmation:"FAIL_AND_REFUND"}),null);
});
