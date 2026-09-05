const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");

const root=path.join(__dirname,"..");
const seed=path.join(root,"data","db.json");

test("backup worker one-shot mode runs a verified backup and exits successfully",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gz-backup-worker-"));
  const db=path.join(dir,"db.json"),backups=path.join(dir,"backups");
  fs.copyFileSync(seed,db);
  const env={
    ...process.env,
    STORAGE_DRIVER:"json",
    DB_PATH:db,
    BACKUP_DIR:backups,
    BACKUP_WORKER_ONCE:"true",
    BACKUP_ENCRYPTION_KEY:Buffer.alloc(32,11).toString("base64")
  };
  const r=spawnSync(process.execPath,["scripts/backup-worker.js"],{cwd:root,env,encoding:"utf8",timeout:15000});
  assert.equal(r.status,0,r.stderr||r.stdout);
  const status=JSON.parse(fs.readFileSync(path.join(backups,"backup-status.json"),"utf8"));
  assert.equal(status.ok,true);
  assert.equal(status.verified,true);
  assert.equal(status.encrypted,true);
  assert.ok(fs.existsSync(path.join(backups,status.file)));
});


test("backup health CLI detects corruption of the recorded latest file",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gz-backup-health-corrupt-"));
  const db=path.join(dir,"db.json"),backups=path.join(dir,"backups");
  fs.copyFileSync(seed,db);
  const key=Buffer.alloc(32,21).toString("base64");
  const env={...process.env,STORAGE_DRIVER:"json",DB_PATH:db,BACKUP_DIR:backups,BACKUP_ENCRYPTION_KEY:key,BACKUP_WORKER_ONCE:"true"};
  const worker=spawnSync(process.execPath,["scripts/backup-worker.js"],{cwd:root,env,encoding:"utf8",timeout:15000});
  assert.equal(worker.status,0,worker.stderr||worker.stdout);

  const healthy=spawnSync(process.execPath,["scripts/check-backup-health.js"],{cwd:root,env,encoding:"utf8"});
  assert.equal(healthy.status,0,healthy.stderr||healthy.stdout);
  assert.match(healthy.stdout,/content=verified/);

  const status=JSON.parse(fs.readFileSync(path.join(backups,"backup-status.json"),"utf8"));
  const file=path.join(backups,status.file);
  const payload=JSON.parse(fs.readFileSync(file,"utf8"));
  payload.ciphertext=payload.ciphertext.slice(0,-4)+"AAAA";
  fs.writeFileSync(file,JSON.stringify(payload));

  const broken=spawnSync(process.execPath,["scripts/check-backup-health.js"],{cwd:root,env,encoding:"utf8"});
  assert.notEqual(broken.status,0);
  assert.match(broken.stderr,/latest_backup_content_invalid/);
});
