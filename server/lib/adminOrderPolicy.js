function adminOrderConfirmationError(order,status,refunded,body={}){
  if(order?.requiresManualReview&&["completed","failed","cancelled","refunded"].includes(status)&&body.reviewResolved!==true){
    return "provider_review_confirmation_required";
  }
  if(["failed","cancelled","refunded"].includes(status)&&!refunded&&String(body.confirmation||"")!=="FAIL_AND_REFUND"){
    return "refund_confirmation_required";
  }
  return null;
}
module.exports={adminOrderConfirmationError};
