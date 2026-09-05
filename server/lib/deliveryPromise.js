function clean(value,max=120){
  return String(value??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
}
function defaultDeliveryText(delivery){
  if(delivery==="inventory")return "فوري";
  if(delivery==="auto")return "فوري";
  return "ضمن أوقات العمل";
}
function sanitizeDeliveryText(value,delivery){
  return clean(value)||defaultDeliveryText(delivery);
}
module.exports={defaultDeliveryText,sanitizeDeliveryText};
