try{require("dotenv").config();}catch{}
process.env.PG_SINGLE_INSTANCE_LOCK="false";
process.env.STORE_READ_ONLY="true";
const {initStore,verifyBusinessAuthorityState,closeStore}=require("../store");

(async()=>{
  await initStore();
  const r=await verifyBusinessAuthorityState();
  if(!r.ok)throw new Error(`${r.error||"business_authority_drift"}:${JSON.stringify(r.errors||[])}`);
  console.log(`Business authority OK: revision=${r.stateRevision??"-"} orders=${r.orderCount??0} topups=${r.topupCount??0}`);
  await closeStore();
})().catch(async e=>{console.error(e.message);try{await closeStore()}catch{}process.exit(1)});
