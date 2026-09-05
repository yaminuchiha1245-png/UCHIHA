try{require("dotenv").config();}catch{}
const fs=require("fs");
const path=require("path");
const {initStore,readDB,closeStore}=require("../store");
const {makeBackup}=require("../lib/backupFormat");
const {encodeBackupFile,decodeBackupFile}=require("../lib/backupCrypto");
const {writeBackupStatus,readBackupStatus}=require("../lib/backupStatus");

const dir=process.env.BACKUP_DIR||path.join(__dirname,"..","backups");

function cleanupGroup(dir,currentFile,{pattern,maxFiles,retentionDays}){
  const cutoff=Date.now()-Math.max(1,Number(retentionDays))*86400000;
  const rows=fs.readdirSync(dir)
    .filter(x=>pattern.test(x))
    .map(name=>({name,file:path.join(dir,name),stat:fs.statSync(path.join(dir,name))}))
    .sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs);
  let removed=0;
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    if(row.file===currentFile)continue;
    if(i>=Math.max(1,Number(maxFiles))||row.stat.mtimeMs<cutoff){
      fs.unlinkSync(row.file);removed++;
    }
  }
  return removed;
}

function cleanup(dir,currentFile){
  const regular=cleanupGroup(dir,currentFile,{
    pattern:/^game-zone-.*\.json$/,
    maxFiles:Number(process.env.BACKUP_MAX_FILES||30),
    retentionDays:Number(process.env.BACKUP_RETENTION_DAYS||30)
  });
  const safety=cleanupGroup(dir,null,{
    pattern:/^(pre-restore|pre-migration|pre-state-rollback)-.*\.json$/,
    maxFiles:Number(process.env.SAFETY_BACKUP_MAX_FILES||60),
    retentionDays:Number(process.env.SAFETY_BACKUP_RETENTION_DAYS||90)
  });
  return {regular,safety,total:regular+safety};
}

(async()=>{
  fs.mkdirSync(dir,{recursive:true});
  const previous=readBackupStatus(dir);
  writeBackupStatus(dir,{
    ok:previous?.ok===true,
    running:true,
    startedAt:new Date().toISOString(),
    lastSuccessAt:previous?.lastSuccessAt||previous?.completedAt||null,
    completedAt:previous?.completedAt||null,
    file:previous?.file||null,
    verified:previous?.verified===true,
    encrypted:previous?.encrypted===true,
    error:null
  });
  await initStore();
  const db=readDB();
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  const file=path.join(dir,`game-zone-${stamp}.json`);
  const backup=makeBackup(db,{version:"1.0.0-rc.20"});
  const encrypted=!!String(process.env.BACKUP_ENCRYPTION_KEY||"").trim();
  const filePayload=encodeBackupFile(backup,{encrypt:encrypted});
  const tempFile=`${file}.tmp-${process.pid}`;
  fs.writeFileSync(tempFile,JSON.stringify(filePayload,null,2),"utf8");

  // Verify the temporary bytes first, then atomically expose the completed backup.
  const verified=decodeBackupFile(JSON.parse(fs.readFileSync(tempFile,"utf8")));
  fs.renameSync(tempFile,file);
  const removed=cleanup(dir,file);
  const status=writeBackupStatus(dir,{
    ok:true,running:false,
    startedAt:null,
    completedAt:new Date().toISOString(),
    lastSuccessAt:new Date().toISOString(),
    file:path.basename(file),
    dataSha256:backup.integrity?.dataSha256||null,
    verified:verified.meta.integrityVerified===true,
    encrypted:verified.meta.encrypted===true,
    removedOldBackups:removed,
    error:null
  });

  console.log(file);
  console.log("Backup integrity: SHA-256 verified");
  console.log("Old backups removed:",removed.total,`(regular=${removed.regular}, safety=${removed.safety})`);
  await closeStore();
})().catch(async e=>{
  try{
    fs.mkdirSync(dir,{recursive:true});
    const previous=readBackupStatus(dir);
    writeBackupStatus(dir,{
      ok:false,running:false,failedAt:new Date().toISOString(),
      lastSuccessAt:previous?.lastSuccessAt||previous?.completedAt||null,
      file:previous?.file||null,verified:previous?.verified===true,encrypted:previous?.encrypted===true,
      error:String(e?.message||e)
    });
  }catch{}
  try{await closeStore();}catch{}
  console.error(e);
  process.exit(1);
});
