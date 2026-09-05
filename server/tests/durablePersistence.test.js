const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");

test("writeDBDurable persists JSON state before resolving",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gz-durable-json-"));
  const source=path.join(__dirname,"..","data","db.json"),copy=path.join(dir,"db.json");
  fs.copyFileSync(source,copy);
  const code=`
    process.env.STORAGE_DRIVER="json";
    process.env.DB_PATH=${JSON.stringify(copy)};
    const s=require("./store");
    (async()=>{
      await s.initStore();
      if(typeof s.writeDBDurable!=="function")process.exit(2);
      const db=s.readDB();
      db.settings=db.settings||{};
      db.settings.durablePersistenceTest="committed";
      await s.writeDBDurable(db);
      const disk=JSON.parse(require("fs").readFileSync(${JSON.stringify(copy)},"utf8"));
      if(disk.settings.durablePersistenceTest!=="committed")process.exit(3);
      if(s.getStoreInfo().durableAcknowledgementAvailable!==true)process.exit(4);
      await s.closeStore();
      process.exit(0);
    })().catch(e=>{console.error(e);process.exit(5)});
  `;
  const r=spawnSync(process.execPath,["-e",code],{cwd:path.join(__dirname,".."),encoding:"utf8"});
  assert.equal(r.status,0,r.stderr||r.stdout);
});

test("critical persistence path awaits writeDBDurable",()=>{
  const server=fs.readFileSync(path.join(__dirname,"..","server.js"),"utf8");
  assert.match(server,/async function persistCritical\(db\)\{[\s\S]*?await writeDBDurable\(db\)/);
});
