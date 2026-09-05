const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {writeBackupStatus,readBackupStatus,listBackupFiles,backupHealth}=require("../lib/backupStatus");

test("backup status writes atomically and reads back",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gz-backup-status-"));
  const saved=writeBackupStatus(dir,{ok:true,completedAt:"2026-08-30T00:00:00Z",file:"game-zone-a.json"});
  assert.equal(saved.ok,true);
  assert.equal(readBackupStatus(dir).file,"game-zone-a.json");
});

test("backup health detects missing failed stale and fresh status",()=>{
  assert.equal(backupHealth(null).reason,"backup_status_missing");
  assert.equal(backupHealth({ok:false,error:"disk_full"}).reason,"last_backup_failed");
  assert.equal(backupHealth({ok:false,running:true}).reason,"backup_running_no_success");
  const now=Date.parse("2026-08-30T12:00:00Z");
  assert.equal(backupHealth({ok:true,completedAt:"2026-08-27T00:00:00Z"},{maxAgeHours:48,nowMs:now}).reason,"backup_too_old");
  assert.equal(backupHealth({ok:true,completedAt:"2026-08-30T00:00:00Z"},{maxAgeHours:48,nowMs:now}).ok,true);
});

test("backup listing returns backup and safety files newest first",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gz-backup-list-"));
  fs.writeFileSync(path.join(dir,"game-zone-a.json"),"{}");
  fs.writeFileSync(path.join(dir,"pre-restore-b.json"),"{}");
  fs.writeFileSync(path.join(dir,"pre-state-rollback-c.json"),"{}");
  fs.writeFileSync(path.join(dir,"ignore.txt"),"x");
  const rows=listBackupFiles(dir);
  assert.equal(rows.length,3);
  assert.ok(rows.every(x=>["backup","pre-restore","pre-migration","pre-state-rollback"].includes(x.type)));
});


test("running backup remains healthy when the previous success is still fresh",()=>{
  const now=Date.parse("2026-08-30T12:00:00Z");
  const r=backupHealth({ok:true,running:true,lastSuccessAt:"2026-08-30T00:00:00Z"},{maxAgeHours:48,nowMs:now});
  assert.equal(r.ok,true);
  assert.equal(r.ageHours,12);
});


test("backup health fails when the last-success file was removed",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gz-backup-missing-file-"));
  const status={ok:true,file:"game-zone-missing.json",completedAt:new Date().toISOString()};
  const r=backupHealth(status,{dir,maxAgeHours:48});
  assert.equal(r.ok,false);
  assert.equal(r.reason,"backup_file_missing");
});
