function makeProviderReviewError(result,reason="provider_post_accept_processing_failed"){
  const err=new Error("provider_outcome_uncertain");
  err.code="provider_outcome_uncertain";
  err.providerId=result?.providerUsed||result?.providerId||null;
  err.providerOrderId=result?.providerOrderId||null;
  err.localReason=String(reason||"provider_post_accept_processing_failed");
  err.providerAccepted=true;
  return err;
}

function shouldAvoidFinancialCompensation(error){
  return error?.code==="provider_outcome_uncertain"||
    error?.message==="provider_outcome_uncertain"||
    error?.message==="storage_persist_failed";
}

module.exports={makeProviderReviewError,shouldAvoidFinancialCompensation};
