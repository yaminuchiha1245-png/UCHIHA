const fs=require("fs");
const path=require("path");
const {decodeBackupFile}=require("../lib/backupCrypto");

const file=process.argv[2];
if(!file){console.error("Usage: node scripts/validate-backup.js /path/to/backup.json");process.exit(1);}
try{
  const payload=JSON.parse(fs.readFileSync(path.resolve(file),"utf8"));
  const {db,meta}=decodeBackupFile(payload);
  console.log("Backup validation OK");
  console.log("Format:",meta.legacy?"legacy-raw":"game-zone-backup");
  console.log("Version:",meta.version||"unknown");
  console.log("Encrypted:",meta.encrypted?"yes":"no");
  console.log("Integrity:",meta.integrityVerified?"SHA-256 verified":meta.integrityPresent?"integrity present":"legacy/no checksum");
  console.log("Users:",db.users.length);
  console.log("Orders:",db.orders.length);
  console.log("Transactions:",db.transactions.length);
  console.log("Products:",db.products.length);
  console.log("Topups:",db.topups.length);
}catch(e){
  console.error("Backup validation FAILED:",e.message);
  process.exit(1);
}
