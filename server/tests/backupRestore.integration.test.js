const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
const {makeBackup}=require("../lib/backupFormat");

const root=path.join(__dirname,"..");
const seed=path.join(root,"data","db.json");

test("backup CLI verifies output and restore creates safety backup/readback verification",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gz-backup-restore-"));
  const source=path.join(dir,"source.json"),target=path.join(dir,"target.json"),backups=path.join(dir,"backups");
  fs.copyFileSync(seed,source);fs.copyFileSync(seed,target);

  const env={...process.env,STORAGE_DRIVER:"json",DB_PATH:source,BACKUP_DIR:backups,BACKUP_RETENTION_DAYS:"30",BACKUP_MAX_FILES:"30"};
  const b=spawnSync(process.execPath,["scripts/backup.js"],{cwd:root,env,encoding:"utf8"});
  assert.equal(b.status,0,b.stderr||b.stdout);
  assert.match(b.stdout,/Backup integrity: SHA-256 verified/);
  const file=b.stdout.split(/\r?\n/).find(x=>x.trim().endsWith(".json"));
  assert.ok(file&&fs.existsSync(file));

  const restoreEnv={...process.env,STORAGE_DRIVER:"json",DB_PATH:target,BACKUP_DIR:backups,ALLOW_RESTORE:"true"};
  const r=spawnSync(process.execPath,["scripts/restore.js",file],{cwd:root,env:restoreEnv,encoding:"utf8"});
  assert.equal(r.status,0,r.stderr||r.stdout);
  assert.match(r.stdout,/Pre-restore safety backup:/);
  assert.match(r.stdout,/Read-back SHA-256: verified/);
  assert.ok(fs.readdirSync(backups).some(x=>x.startsWith("pre-restore-")));
});

test("restore CLI blocks a checksum-valid backup with critical financial integrity errors",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gz-restore-integrity-"));
  const target=path.join(dir,"target.json"),badFile=path.join(dir,"bad.json");
  fs.copyFileSync(seed,target);
  const db=JSON.parse(fs.readFileSync(seed,"utf8"));
  db.users.push({telegramId:"999",balance:10,currency:"USD",sessionVersion:1});
  db.topups.push({id:"top_bad",telegramId:"999",amount:10,currency:"USD",method:"manual",reference:"X",status:"approved",createdAt:"x",updatedAt:"x"});
  // No corresponding topup transaction => critical integrity violation.
  fs.writeFileSync(badFile,JSON.stringify(makeBackup(db,{version:"1.0.0-rc.9"}),null,2));

  const env={...process.env,STORAGE_DRIVER:"json",DB_PATH:target,BACKUP_DIR:dir,ALLOW_RESTORE:"true"};
  const r=spawnSync(process.execPath,["scripts/restore.js",badFile],{cwd:root,env,encoding:"utf8"});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/restore_blocked_by_data_integrity/);
});


test("backup CLI encrypts at rest and restore decrypts with the same key",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gz-backup-encrypted-"));
  const source=path.join(dir,"source.json"),target=path.join(dir,"target.json"),backups=path.join(dir,"backups");
  fs.copyFileSync(seed,source);fs.copyFileSync(seed,target);
  const key=Buffer.alloc(32,12).toString("base64");

  const env={...process.env,STORAGE_DRIVER:"json",DB_PATH:source,BACKUP_DIR:backups,BACKUP_ENCRYPTION_KEY:key};
  const b=spawnSync(process.execPath,["scripts/backup.js"],{cwd:root,env,encoding:"utf8"});
  assert.equal(b.status,0,b.stderr||b.stdout);
  const file=b.stdout.split(/\r?\n/).find(x=>x.trim().endsWith(".json"));
  const envelope=JSON.parse(fs.readFileSync(file,"utf8"));
  assert.equal(envelope.format,"game-zone-encrypted-backup");
  assert.equal("data" in envelope,false);

  const validate=spawnSync(process.execPath,["scripts/validate-backup.js",file],{cwd:root,env,encoding:"utf8"});
  assert.equal(validate.status,0,validate.stderr||validate.stdout);
  assert.match(validate.stdout,/Encrypted: yes/);

  const restoreEnv={...env,DB_PATH:target,ALLOW_RESTORE:"true"};
  const r=spawnSync(process.execPath,["scripts/restore.js",file],{cwd:root,env:restoreEnv,encoding:"utf8"});
  assert.equal(r.status,0,r.stderr||r.stdout);
  assert.match(r.stdout,/encrypted/);
  assert.match(r.stdout,/Read-back SHA-256: verified/);
});


test("restore migrates an older minimal backup before integrity validation",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gz-restore-migrate-"));
  const target=path.join(dir,"target.json"),file=path.join(dir,"legacy.json");
  fs.copyFileSync(seed,target);
  const legacy={
    settings:{storeName:"Game Zone"},
    users:[],orders:[],transactions:[],products:[],categories:[],topups:[]
  };
  fs.writeFileSync(file,JSON.stringify(makeBackup(legacy,{version:"0.9.0"}),null,2));
  const env={...process.env,STORAGE_DRIVER:"json",DB_PATH:target,BACKUP_DIR:dir,ALLOW_RESTORE:"true"};
  const r=spawnSync(process.execPath,["scripts/restore.js",file],{cwd:root,env,encoding:"utf8"});
  assert.equal(r.status,0,r.stderr||r.stdout);
  assert.match(r.stdout,/Schema migration: .*0.* -> .*8/);
  const restored=JSON.parse(fs.readFileSync(target,"utf8"));
  assert.equal(restored.schemaVersion,8);
  assert.ok(Array.isArray(restored.couponUsages));
  assert.ok(Array.isArray(restored.inventoryCodes));
});
