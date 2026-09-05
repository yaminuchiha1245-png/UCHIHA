try{require("dotenv").config();}catch{}
process.env.PG_SINGLE_INSTANCE_LOCK="false";
process.env.STORE_READ_ONLY="true";
const {initStore,verifyPersistedState,verifyStoreHistory,closeStore}=require("../store");

(async()=>{
  await initStore();
  const result=await verifyPersistedState(),history=await verifyStoreHistory(500);
  if(!result.ok)throw new Error(result.error||"state_verify_failed");
  if(!history.ok)throw new Error(`state_history_integrity_failed:${history.errors.map(x=>x.revision).join(",")}`);
  console.log(`PostgreSQL state OK: revision=${result.revision??"-"} sha256=${result.dataSha256||"-"}`);
  console.log(`Business authority OK: orders=${result.businessAuthority?.orderCount??0} topups=${result.businessAuthority?.topupCount??0}`);
  console.log(`Financial mirror OK: revision=${result.financialMirror?.actual?.stateRevision??"-"}`);
  console.log(`Financial journal OK: entries=${result.financialJournal?.entryCount??0} revision=${result.financialJournal?.lastStateRevision??"-"}`);
  console.log(`Wallet authority OK: active=${result.walletAuthority?.activeAccountCount??0} total=${Number(result.walletAuthority?.totalBalance||0).toFixed(6)} revision=${result.walletAuthority?.stateRevision??"-"}`);
  console.log(`Recovery history OK: ${history.checked} snapshots verified`);
  await closeStore();
})().catch(async e=>{console.error(e.message);try{await closeStore()}catch{}process.exit(1)});
