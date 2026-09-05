const test=require("node:test");
const assert=require("node:assert/strict");
const {makeProviderReviewError,shouldAvoidFinancialCompensation}=require("../lib/providerOutcomePolicy");

test("post-accept provider processing errors become manual-review outcomes",()=>{
  const e=makeProviderReviewError({providerUsed:"supplier-a",providerOrderId:"P-1"},"provider_order_id_missing");
  assert.equal(e.code,"provider_outcome_uncertain");
  assert.equal(e.providerId,"supplier-a");
  assert.equal(e.providerOrderId,"P-1");
  assert.equal(e.localReason,"provider_order_id_missing");
  assert.equal(e.providerAccepted,true);
});

test("uncertain or storage-persist errors must not trigger automatic refund compensation",()=>{
  assert.equal(shouldAvoidFinancialCompensation({code:"provider_outcome_uncertain"}),true);
  assert.equal(shouldAvoidFinancialCompensation({message:"storage_persist_failed"}),true);
  assert.equal(shouldAvoidFinancialCompensation(new Error("provider_http_400")),false);
});
