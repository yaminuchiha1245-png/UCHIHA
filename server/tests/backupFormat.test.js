const test=require("node:test");
const assert=require("node:assert/strict");
const {makeBackup,parseBackup,validateDatabaseShape}=require("../lib/backupFormat");

function db(){
  return {settings:{storeName:"Game Zone"},users:[],orders:[],transactions:[],products:[],categories:[],topups:[]};
}

test("standard backup round-trips through shared format",()=>{
  const source=db(),backup=makeBackup(source,{version:"1.0.0-rc.9",createdAt:"2026-08-30T00:00:00Z"});
  assert.equal(backup.format,"game-zone-backup");
  assert.match(backup.integrity.dataSha256,/^[a-f0-9]{64}$/);
  const parsed=parseBackup(backup);
  assert.equal(parsed.meta.legacy,false);
  assert.equal(parsed.meta.integrityVerified,true);
  assert.equal(parsed.meta.version,"1.0.0-rc.9");
  assert.deepEqual(parsed.db,source);
});

test("legacy raw backups remain restorable",()=>{
  const source=db(),parsed=parseBackup(source);
  assert.equal(parsed.meta.legacy,true);
  assert.deepEqual(parsed.db,source);
});

test("invalid backup is rejected before restore",()=>{
  assert.equal(validateDatabaseShape({}).ok,false);
  assert.throws(()=>parseBackup({format:"game-zone-backup",data:{settings:{}}}),/backup_collection_missing/);
});


test("tampered standardized backup fails checksum verification",()=>{
  const backup=makeBackup(db(),{version:"1.0.0-rc.9"});
  backup.data.settings.storeName="Tampered";
  assert.throws(()=>parseBackup(backup),/backup_integrity_hash_mismatch/);
});
