function topupActionConfirmationError(action,body={}){
  if(action==="approve"&&String(body.confirmation||"")!=="APPROVE_TOPUP")return "topup_approval_confirmation_required";
  if(action==="reject"&&String(body.confirmation||"")!=="REJECT_TOPUP")return "topup_rejection_confirmation_required";
  return null;
}
function topupApprovalEvidenceError(topup={}){
  if(topup.requiresReceipt===true&&!topup.receiptFileName)return "topup_receipt_required";
  return null;
}
module.exports={topupActionConfirmationError,topupApprovalEvidenceError};
