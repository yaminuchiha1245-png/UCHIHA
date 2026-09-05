const [methodId,topupId,status="paid",amountArg="",reference="STAGING-TX"] = process.argv.slice(2);
const base=String(process.env.PUBLIC_BASE_URL||"").replace(/\/$/,"");
const secret=process.env.PAYMENT_WEBHOOK_SECRET||"";

if(!methodId||!topupId){
  console.error("Usage: node scripts/send-payment-webhook.js METHOD_ID TOPUP_ID [paid|failed] [amount] [reference]");
  process.exit(1);
}
if(!base||!/^https?:\/\//i.test(base)){
  console.error("Set PUBLIC_BASE_URL=http(s)://...");
  process.exit(1);
}
if(!secret){
  console.error("Set PAYMENT_WEBHOOK_SECRET in the environment");
  process.exit(1);
}

const payload={topupId,status,reference};
if(amountArg!=="")payload.amount=Number(amountArg);

(async()=>{
  const r=await fetch(`${base}/api/payment-webhook/${encodeURIComponent(methodId)}`,{
    method:"POST",
    headers:{"content-type":"application/json","x-payment-webhook-secret":secret},
    body:JSON.stringify(payload)
  });
  const data=await r.json().catch(()=>({}));
  console.log("HTTP",r.status);
  console.log(JSON.stringify(data,null,2));
  if(!r.ok)process.exit(1);
})().catch(e=>{console.error(e.message);process.exit(1)});
