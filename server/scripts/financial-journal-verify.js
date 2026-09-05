try{require('dotenv').config()}catch{}
process.env.PG_SINGLE_INSTANCE_LOCK='false';
process.env.STORE_READ_ONLY='true';
const {initStore,verifyFinancialJournalState,closeStore}=require('../store');
(async()=>{
  await initStore();
  const r=await verifyFinancialJournalState();
  if(!r.ok)throw new Error(`${r.error||'financial_journal_drift'}:${JSON.stringify(r.errors||[])}`);
  console.log(`Financial journal OK: entries=${r.entryCount} stateTransactions=${r.currentStateTransactions} cutoverRevision=${r.cutoverRevision} stateRevision=${r.lastStateRevision}`);
  await closeStore();
})().catch(async e=>{console.error(e.message);try{await closeStore()}catch{};process.exit(1)});
