try{require("dotenv").config();}catch{}
process.env.PG_SINGLE_INSTANCE_LOCK="false";
process.env.STORE_READ_ONLY="true";
const {initStore,verifyFinancialMirrorState,closeStore}=require("../store");

(async()=>{
  await initStore();
  const r=await verifyFinancialMirrorState();
  if(!r.ok)throw new Error(`${r.error||"financial_mirror_drift"}:${JSON.stringify(r.errors||[])}`);
  console.log(`Financial mirror OK: revision=${r.actual?.stateRevision??"-"} users=${r.actual?.counts?.users??0} orders=${r.actual?.counts?.orders??0} transactions=${r.actual?.counts?.transactions??0} topups=${r.actual?.counts?.topups??0}`);
  await closeStore();
})().catch(async e=>{console.error(e.message);try{await closeStore()}catch{}process.exit(1)});
