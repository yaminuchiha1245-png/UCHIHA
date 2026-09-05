function buildCheckoutUrl(template,topup,{requireHttps=false}={}){
  if(!template)return null;
  const rendered=String(template)
    .replaceAll("{topupId}",encodeURIComponent(String(topup.id||"")))
    .replaceAll("{amount}",encodeURIComponent(String(topup.amount??"")))
    .replaceAll("{telegramId}",encodeURIComponent(String(topup.telegramId||"")))
    .replaceAll("{reference}",encodeURIComponent(String(topup.reference||"")));
  try{
    const u=new URL(rendered);
    if(!["http:","https:"].includes(u.protocol))return null;
    if(u.username||u.password)return null;
    if(requireHttps&&u.protocol!=="https:")return null;
    return u.toString();
  }catch{return null;}
}
module.exports={buildCheckoutUrl};
