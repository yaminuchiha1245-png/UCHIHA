try{require("dotenv").config();}catch{}
process.env.PG_SINGLE_INSTANCE_LOCK="false";
process.env.STORE_READ_ONLY="true";
const {initStore,listStoreHistory,closeStore}=require("../store");

(async()=>{
  const limit=Math.max(1,Math.min(100,Number(process.argv[2]||20)));
  await initStore();
  const rows=await listStoreHistory(limit);
  if(!rows.length)console.log("No PostgreSQL state-history snapshots yet.");
  else{
    console.log("revision\tcreatedAt\tdataBytes\tsha256");
    for(const row of rows)console.log(`${row.revision}\t${row.createdAt}\t${row.dataBytes}\t${row.dataSha256}`);
  }
  await closeStore();
})().catch(async e=>{console.error(e.message);try{await closeStore()}catch{}process.exit(1)});
