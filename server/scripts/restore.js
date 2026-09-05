try{require("dotenv").config();}catch{}
const fs=require("fs");
const path=require("path");
const {makeBackup,dataSha256}=require("../lib/backupFormat");
const {decodeBackupFile,encodeBackupFile,decodeBackupKey}=require("../lib/backupCrypto");
const {scanDatabaseIntegrity}=require("../lib/integrity");
const {migrateDatabase}=require("../lib/migrations");

function writeSafetyCopy(current,{valid=true,reason=null,revision=null}={}){
  if(!current||String(process.env.SKIP_PRE_RESTORE_BACKUP||"false").toLowerCase()==="true")return null;
  const dir=process.env.BACKUP_DIR||path.join(__dirname,"..","backups");
  fs.mkdirSync(dir,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  let payload,name;
  if(valid){
    try{
      payload=makeBackup(current,{version:"1.0.0-rc.20"});
      name=`pre-restore-${stamp}.json`;
    }catch(e){
      valid=false;reason=reason||e.message;
    }
  }
  if(!valid){
    payload={
      format:"game-zone-forensic-state",
      version:"1.0.0-rc.20",
      createdAt:new Date().toISOString(),
      reason:reason||"current_state_not_trusted",
      revision,
      data:current
    };
    name=`pre-restore-forensic-${stamp}.json`;
  }
  const file=path.join(dir,name);
  fs.writeFileSync(file,JSON.stringify(encodeBackupFile(payload),null,2),"utf8");
  console.log(valid?"Pre-restore safety backup:":"Pre-restore forensic snapshot:",file);
  return file;
}

async function restoreJson(db){
  process.env.ALLOW_UNJOURNALED_STATE_REPLACE="true";
  const {initStore,readDB,writeDB,flushStore,closeStore}=require("../store");
  await initStore();
  try{
    writeSafetyCopy(readDB(),{valid:true});
    writeDB(db);
    await flushStore({throwOnError:true});
    const persisted=readDB();
    if(dataSha256(persisted)!==dataSha256(db))throw new Error("restore_readback_hash_mismatch");
    return {revision:null,hmacVerified:false};
  }finally{await closeStore()}
}

async function restorePostgres(db){
  const {
    openPostgresRecovery,closePostgresRecovery,readActiveState,
    replaceActiveState,verifyActiveRecoveryState
  }=require("../lib/postgresRecovery");

  let ctx;
  try{
    ctx=await openPostgresRecovery();
    const current=await readActiveState(ctx.client);
    if(current){
      writeSafetyCopy(current.data,{
        valid:current.verification.ok,
        reason:current.verification.ok?null:current.verification.reason,
        revision:current.revision
      });
    }
    const replaced=await replaceActiveState(ctx.client,db,{allowCorruptCurrent:true,preserveValidCurrent:true});
    const verified=await verifyActiveRecoveryState(ctx.client);
    if(!verified.ok)throw new Error(`restore_readback_integrity_failed:${verified.error||"unknown"}`);
    const row=await readActiveState(ctx.client);
    if(dataSha256(row.data)!==dataSha256(db))throw new Error("restore_readback_hash_mismatch");
    return {revision:replaced.newRevision,hmacVerified:verified.hmacVerified,priorStateValid:replaced.priorStateValid};
  }finally{await closePostgresRecovery(ctx)}
}

(async()=>{
  const file=process.argv[2];
  if(!file)throw new Error("Usage: node scripts/restore.js /path/to/backup.json");
  if(String(process.env.ALLOW_RESTORE||"false").toLowerCase()!=="true"){
    throw new Error("Set ALLOW_RESTORE=true to enable restore");
  }
  if(process.env.NODE_ENV==="production"&&!decodeBackupKey(process.env.BACKUP_ENCRYPTION_KEY)){
    throw new Error("BACKUP_ENCRYPTION_KEY is required for encrypted production recovery safety snapshots");
  }

  const resolved=path.resolve(file);
  const payload=JSON.parse(fs.readFileSync(resolved,"utf8"));
  const {db,meta}=decodeBackupFile(payload);
  const migration=migrateDatabase(db);
  const integrity=scanDatabaseIntegrity(db);
  if(integrity.counts.critical>0&&String(process.env.ALLOW_RESTORE_WITH_CRITICAL_INTEGRITY||"false").toLowerCase()!=="true"){
    throw new Error(`restore_blocked_by_data_integrity:${integrity.counts.critical}`);
  }

  const driver=String(process.env.STORAGE_DRIVER||"json").toLowerCase();
  const restored=driver==="postgres"?await restorePostgres(db):await restoreJson(db);

  console.log("Restore completed:",resolved);
  console.log("Backup format:",meta.legacy?"legacy-raw":"game-zone-backup",meta.version||"",meta.encrypted?"encrypted":"plain");
  console.log("Schema migration:",migration.from,"->",migration.to,migration.changed?`(${migration.changes.length} changes)`:"(already current)");
  console.log("Incoming integrity after migration:",integrity.counts.critical,"critical /",integrity.counts.warning,"warning");
  console.log("Read-back SHA-256: verified");
  if(driver==="postgres")console.log("PostgreSQL recovery revision:",restored.revision,"HMAC:",restored.hmacVerified?"verified":"not configured");
})().catch(e=>{console.error(e.message);process.exit(1)});
