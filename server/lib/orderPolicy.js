function normalizeOrderInput(value){
  return String(value??"").trim();
}
function normalizeCouponCode(value){
  return String(value??"").trim().toUpperCase();
}
function findIdempotentOrder(orders,{telegramId,clientRequestId}={}){
  const requestId=String(clientRequestId||"").trim();
  if(!requestId)return null;
  return (orders||[]).find(o=>
    String(o.telegramId)===String(telegramId) &&
    String(o.clientRequestId||"")===requestId
  )||null;
}
function canonicalCustomerData(value){
  const obj=value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  return JSON.stringify(Object.fromEntries(Object.keys(obj).sort().map(k=>[k,String(obj[k]??"").trim()])));
}
function sameOrderRequest(order,{productId,customerInput,customerData,couponCode}={}){
  if(!order)return false;
  const productSame=String(order.productId)===String(productId);
  const couponSame=normalizeCouponCode(order.couponCode)===normalizeCouponCode(couponCode);
  if(!productSame||!couponSame)return false;
  if(customerData&&typeof customerData==="object"&&!Array.isArray(customerData)){
    if(order.customerData&&typeof order.customerData==="object"&&!Array.isArray(order.customerData))return canonicalCustomerData(order.customerData)===canonicalCustomerData(customerData);
    const first=Object.keys(customerData).sort().map(k=>String(customerData[k]??"").trim()).find(Boolean)||"";
    return normalizeOrderInput(order.customerInput)===normalizeOrderInput(first);
  }
  return normalizeOrderInput(order.customerInput)===normalizeOrderInput(customerInput);
}
module.exports={normalizeOrderInput,normalizeCouponCode,findIdempotentOrder,sameOrderRequest,canonicalCustomerData};
