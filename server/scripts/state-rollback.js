try{require("dotenv").config();}catch{}
const fs=require("node:fs");
const path=require("node:path");
const {makeBackup}=require("../lib/backupFormat");
const {encodeBackupFile,decodeBackupKey}=require("../lib/backupCrypto");
const {
  openPostgresRecovery,closePostgresRecovery,readActiveState,readHistoryState,
  replaceActiveState,verifyActiveRecoveryState
}=require("../lib/postgresRecovery");

function saveCurrent(current){
  if(!current)return null;
  const dir=process.env.BACKUP_DIR||path.join(__dirname,"..","backups");
  fs.mkdirSync(dir,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  let payload,name;
  if(current.verification.ok){
    try{
      payload=makeBackup(current.data,{version:"1.0.0-rc.20"});
      name=`pre-state-rollback-${stamp}.json`;
    }catch{}
  }
  if(!payload){
    payload={
      format:"game-zone-forensic-state",version:"1.0.0-rc.20",createdAt:new Date().toISOString(),
      reason:current.verification.reason||"current_state_not_trusted",revision:current.revision,data:current.data
    };
    name=`pre-state-rollback-forensic-${stamp}.json`;
  }
  const file=path.join(dir,name);
  fs.writeFileSync(file,JSON.stringify(encodeBackupFile(payload),null,2),"utf8");
  console.log("Pre-rollback snapshot:",file);
  return file;
}

(async()=>{
  if(String(process.env.ALLOW_STATE_ROLLBACK||"false").toLowerCase()!=="true"){
    throw new Error("Set ALLOW_STATE_ROLLBACK=true before point-in-time state rollback");
  }
  if(String(process.env.STORAGE_DRIVER||"").toLowerCase()!=="postgres")throw new Error("state rollback requires STORAGE_DRIVER=postgres");
  if(process.env.NODE_ENV==="production"&&!decodeBackupKey(process.env.BACKUP_ENCRYPTION_KEY))throw new Error("BACKUP_ENCRYPTION_KEY is required for production rollback safety snapshots");

  const revision=Number(process.argv[2]),confirmation=String(process.argv[3]||"");
  if(!Number.isSafeInteger(revision)||revision<1||confirmation!==`ROLLBACK_TO_REVISION_${revision}`){
    throw new Error("Usage: npm run state:rollback -- <revision> ROLLBACK_TO_REVISION_<revision>");
  }

  let ctx;
  try{
    // Uses the same advisory lock as the live Server. It fails if an active writer is still running.
    ctx=await openPostgresRecovery();
    const target=await readHistoryState(ctx.client,revision);
    if(!target)throw new Error("state_revision_not_found");
    if(!target.verification.ok)throw new Error(`state_history_integrity_mismatch:${target.verification.reason}`);

    const current=await readActiveState(ctx.client);
    saveCurrent(current);

    const result=await replaceActiveState(ctx.client,target.data,{allowCorruptCurrent:true,preserveValidCurrent:true});
    const verified=await verifyActiveRecoveryState(ctx.client);
    if(!verified.ok)throw new Error(`rollback_readback_failed:${verified.error||"unknown"}`);

    console.log(`State rollback completed: history revision ${revision} -> new active revision ${result.newRevision}`);
    console.log(`Read-back SHA-256/HMAC: ${verified.hmacVerified?"verified":"SHA-256 verified; HMAC not configured"}`);
  }finally{await closePostgresRecovery(ctx)}
})().catch(e=>{console.error(e.message);process.exit(1)});
