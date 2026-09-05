const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");

test("STORE_READ_ONLY blocks accidental database writes in utility processes",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gz-store-readonly-"));
  const source=path.join(__dirname,"..","data","db.json"),copy=path.join(dir,"db.json");
  fs.copyFileSync(source,copy);
  const before=fs.readFileSync(copy,"utf8");
  const code=`
    process.env.STORAGE_DRIVER="json";
    process.env.STORE_READ_ONLY="true";
    process.env.DB_PATH=${JSON.stringify(copy)};
    const s=require("./store");
    s.initStore().then(()=>{
      const db=s.readDB();db.settings.readOnlyTest=true;
      try{s.writeDB(db);process.exit(2)}catch(e){
        if(e.message!=="store_read_only")process.exit(3);
        process.exit(0);
      }
    }).catch(()=>process.exit(4));
  `;
  const r=spawnSync(process.execPath,["-e",code],{cwd:path.join(__dirname,".."),encoding:"utf8"});
  assert.equal(r.status,0,r.stderr||r.stdout);
  assert.equal(fs.readFileSync(copy,"utf8"),before);
});
