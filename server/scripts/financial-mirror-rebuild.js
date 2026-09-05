try{require("dotenv").config();}catch{}
const {
  openPostgresRecovery,closePostgresRecovery,readActiveState
}=require("../lib/postgresRecovery");
const {syncFinancialMirror,verifyFinancialMirror}=require("../lib/financialMirror");

(async()=>{
  if(String(process.env.ALLOW_FINANCIAL_MIRROR_REBUILD||"false").toLowerCase()!=="true"){
    throw new Error("Set ALLOW_FINANCIAL_MIRROR_REBUILD=true before rebuilding the financial mirror");
  }
  if(String(process.env.STORAGE_DRIVER||"").toLowerCase()!=="postgres")throw new Error("financial mirror rebuild requires STORAGE_DRIVER=postgres");

  let ctx;
  try{
    ctx=await openPostgresRecovery();
    const current=await readActiveState(ctx.client);
    if(!current)throw new Error("state_row_missing");
    if(!current.verification.ok)throw new Error(`active_state_not_trusted:${current.verification.reason}`);

    await ctx.client.query("BEGIN");
    try{
      await syncFinancialMirror(ctx.client,current.data,current.revision);
      await ctx.client.query("COMMIT");
    }catch(e){
      try{await ctx.client.query("ROLLBACK")}catch{}
      throw e;
    }

    const verified=await verifyFinancialMirror(ctx.client,current.data,current.revision);
    if(!verified.ok)throw new Error(`financial_mirror_rebuild_verify_failed:${JSON.stringify(verified.errors||[])}`);
    console.log(`Financial mirror rebuilt and verified at state revision ${current.revision}`);
  }finally{await closePostgresRecovery(ctx)}
})().catch(e=>{console.error(e.message);process.exit(1)});
