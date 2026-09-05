try{require('dotenv').config()}catch{}
process.env.PG_SINGLE_INSTANCE_LOCK='false';
process.env.STORE_READ_ONLY='true';
const {initStore,verifyWalletAuthorityState,closeStore}=require('../store');
(async()=>{
  await initStore();
  const r=await verifyWalletAuthorityState();
  if(!r.ok)throw new Error(`${r.error||'wallet_authority_drift'}:${JSON.stringify(r.errors||[])}`);
  console.log(`Wallet authority OK: active=${r.activeAccountCount} total=${Number(r.totalBalance||0).toFixed(6)} cutoverRevision=${r.cutoverRevision} stateRevision=${r.stateRevision}`);
  await closeStore();
})().catch(async e=>{console.error(e.message);try{await closeStore()}catch{};process.exit(1)});
