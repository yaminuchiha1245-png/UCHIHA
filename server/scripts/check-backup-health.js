try{require("dotenv").config();}catch{}
const fs=require("node:fs");
const path=require("node:path");
const {readBackupStatus,backupHealth}=require("../lib/backupStatus");
const {decodeBackupFile}=require("../lib/backupCrypto");

const dir=process.env.BACKUP_DIR||path.join(__dirname,"..","backups");
const maxAgeHours=Math.max(1,Number(process.env.BACKUP_MAX_AGE_HOURS||48));
const status=readBackupStatus(dir);
const health=backupHealth(status,{maxAgeHours,dir});
if(!health.ok){
  console.error("Backup health FAILED:",health.reason,status?.error||"");
  process.exit(1);
}

try{
  const file=path.join(dir,String(status.file||""));
  const payload=JSON.parse(fs.readFileSync(file,"utf8"));
  const parsed=decodeBackupFile(payload);
  if(parsed.meta.integrityPresent&&!parsed.meta.integrityVerified)throw new Error("backup_inner_integrity_unverified");
  console.log(`Backup health OK: age=${health.ageHours}h file=${status.file} encrypted=${parsed.meta.encrypted?"yes":"no"} content=verified`);
}catch(e){
  console.error("Backup health FAILED: latest_backup_content_invalid",e.message);
  process.exit(1);
}
