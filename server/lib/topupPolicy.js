function money(n){return Number(Number(n||0).toFixed(2));}
function normalizePaymentReference(value){return String(value??"").trim();}
function paymentReferenceIdentity(method,reference){
  const ref=normalizePaymentReference(reference);
  return ref?`${String(method||"").toLowerCase()}:${ref.toLowerCase()}`:"";
}
function findDuplicatePaymentReference(topups,{method,reference,excludeId=null}={}){
  const identity=paymentReferenceIdentity(method,reference);
  if(!identity)return null;
  return (topups||[]).find(x=>String(x.id)!==String(excludeId||"")&&paymentReferenceIdentity(x.method,x.reference)===identity)||null;
}
function findIdempotentTopup(topups,{telegramId,clientRequestId}={}){
  const requestId=String(clientRequestId||"").trim();
  if(!requestId)return null;
  return (topups||[]).find(x=>String(x.telegramId)===String(telegramId)&&String(x.clientRequestId||"")===requestId)||null;
}
function sameTopupRequest(topup,{amount,method,reference}={}){
  if(!topup)return false;
  return money(topup.amount)===money(amount)&&
    String(topup.method)===String(method)&&
    normalizePaymentReference(topup.reference).toLowerCase()===normalizePaymentReference(reference).toLowerCase();
}
module.exports={normalizePaymentReference,paymentReferenceIdentity,findDuplicatePaymentReference,findIdempotentTopup,sameTopupRequest};
