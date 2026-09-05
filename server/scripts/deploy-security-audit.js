const fs=require("node:fs");
const path=require("node:path");

const root=path.join(__dirname,"..","..");
const compose=fs.readFileSync(path.join(root,"deploy","docker-compose.yml"),"utf8");
const serverDocker=fs.readFileSync(path.join(root,"deploy","server.Dockerfile"),"utf8");
const botDocker=fs.readFileSync(path.join(root,"deploy","bot.Dockerfile"),"utf8");
const backupSh=fs.readFileSync(path.join(root,"deploy","backup.sh"),"utf8");
const restoreSh=fs.readFileSync(path.join(root,"deploy","restore.sh"),"utf8");
const stateRollbackSh=fs.readFileSync(path.join(root,"deploy","state-rollback.sh"),"utf8");
const businessAuthorityVerifySh=fs.readFileSync(path.join(root,"deploy","business-authority-verify.sh"),"utf8");
const financialMirrorVerifySh=fs.readFileSync(path.join(root,"deploy","financial-mirror-verify.sh"),"utf8");
const financialMirrorRebuildSh=fs.readFileSync(path.join(root,"deploy","financial-mirror-rebuild.sh"),"utf8");
const financialJournalVerifySh=fs.readFileSync(path.join(root,"deploy","financial-journal-verify.sh"),"utf8");
const walletAuthorityVerifySh=fs.readFileSync(path.join(root,"deploy","wallet-authority-verify.sh"),"utf8");
const ciWorkflow=fs.readFileSync(path.join(root,".github","workflows","ci.yml"),"utf8");
const failures=[];

function serviceBlock(name){
  const marker=`  ${name}:`;
  const start=compose.indexOf(marker);
  if(start<0)return "";
  const rest=compose.slice(start+marker.length);
  const match=rest.match(/\n  [A-Za-z0-9_-]+:/);
  return compose.slice(start,match?start+marker.length+match.index:compose.length);
}
function requireIn(block,value,label){
  if(!block.includes(value))failures.push(label);
}

for(const name of ["server","bot","backup","provider-simulator"]){
  const block=serviceBlock(name);
  if(!block){failures.push(`${name}: service missing`);continue;}
  requireIn(block,"read_only: true",`${name}: root filesystem must be read-only`);
  requireIn(block,"no-new-privileges:true",`${name}: no-new-privileges missing`);
  requireIn(block,"cap_drop:",`${name}: cap_drop missing`);
  requireIn(block,"- ALL",`${name}: all Linux capabilities must be dropped`);
}
for(const name of ["postgres","server"]){
  const block=serviceBlock(name);
  if(/\n\s+ports:\s*\n/.test(block))failures.push(`${name}: must not publish a host port`);
}
requireIn(serviceBlock("server"),"/api/health/ready","server: readiness healthcheck missing");
requireIn(serviceBlock("backup"),"scripts/check-backup-health.js","backup: healthcheck missing");
requireIn(serviceBlock("backup"),'["node","scripts/backup-worker.js"]',"backup: resilient worker command missing");
if(!/\bUSER node\b/.test(serverDocker))failures.push("server.Dockerfile: must run as node user");
if(!/\bUSER node\b/.test(botDocker))failures.push("bot.Dockerfile: must run as node user");
if(!serviceBlock("caddy").includes('"80:80"')||!serviceBlock("caddy").includes('"443:443"'))failures.push("caddy: expected public HTTP/HTTPS ports missing");
if(!backupSh.includes("PG_SINGLE_INSTANCE_LOCK=false"))failures.push("backup.sh: manual read-only backup must bypass active writer advisory lock");
if(!backupSh.includes("STORE_READ_ONLY=true"))failures.push("backup.sh: manual backup must enforce read-only Store mode");
if(!serviceBlock("backup").includes('STORE_READ_ONLY: "true"'))failures.push("backup service: STORE_READ_ONLY must be true");
const stateVerifySh=fs.readFileSync(path.join(root,"deploy","state-verify.sh"),"utf8");
const stateHistorySh=fs.readFileSync(path.join(root,"deploy","state-history.sh"),"utf8");
if(!stateVerifySh.includes("PG_SINGLE_INSTANCE_LOCK=false"))failures.push("state-verify.sh: read-only verification must not contend for the active writer lock");
if(!stateHistorySh.includes("PG_SINGLE_INSTANCE_LOCK=false"))failures.push("state-history.sh: read-only history listing must not contend for the active writer lock");
if(!restoreSh.includes("stop bot caddy server"))failures.push("restore.sh: restore must stop public writer services first");
if(!restoreSh.includes("ALLOW_RESTORE=true"))failures.push("restore.sh: explicit restore enable flag missing");
if(restoreSh.includes("PG_SINGLE_INSTANCE_LOCK=false"))failures.push("restore.sh: recovery must not bypass the PostgreSQL writer advisory lock");
if(!restoreSh.includes("run --rm"))failures.push("restore.sh: restore should use an isolated one-off container");
if(!stateRollbackSh.includes("stop bot caddy server"))failures.push("state-rollback.sh: point-in-time rollback must stop active public writer services");
if(!stateRollbackSh.includes("ALLOW_STATE_ROLLBACK=true"))failures.push("state-rollback.sh: explicit rollback enable flag missing");
if(!stateRollbackSh.includes("PG_SINGLE_INSTANCE_LOCK=true"))failures.push("state-rollback.sh: rollback must acquire the active writer lock");
if(!businessAuthorityVerifySh.includes("STORE_READ_ONLY=true"))failures.push("business-authority-verify.sh: verification must enforce read-only Store mode");
if(!businessAuthorityVerifySh.includes("PG_SINGLE_INSTANCE_LOCK=false"))failures.push("business-authority-verify.sh: read-only verification must not contend for writer lock");
if(!serviceBlock("server").includes("PG_BUSINESS_AUTHORITY"))failures.push("server service: PG_BUSINESS_AUTHORITY production setting missing");
if(!financialMirrorVerifySh.includes("STORE_READ_ONLY=true"))failures.push("financial-mirror-verify.sh: verification must enforce read-only Store mode");
if(!financialMirrorVerifySh.includes("PG_SINGLE_INSTANCE_LOCK=false"))failures.push("financial-mirror-verify.sh: read-only verification must not contend for writer lock");
if(!financialMirrorRebuildSh.includes("stop bot caddy server"))failures.push("financial-mirror-rebuild.sh: rebuild must stop active public writer services");
if(!financialMirrorRebuildSh.includes("ALLOW_FINANCIAL_MIRROR_REBUILD=true"))failures.push("financial-mirror-rebuild.sh: explicit rebuild enable flag missing");
if(!serviceBlock("server").includes("PG_FINANCIAL_MIRROR"))failures.push("server service: PG_FINANCIAL_MIRROR production setting missing");
if(!financialJournalVerifySh.includes("STORE_READ_ONLY=true"))failures.push("financial-journal-verify.sh: verification must enforce read-only Store mode");
if(!financialJournalVerifySh.includes("PG_SINGLE_INSTANCE_LOCK=false"))failures.push("financial-journal-verify.sh: read-only verification must not contend for writer lock");
if(!walletAuthorityVerifySh.includes("STORE_READ_ONLY=true"))failures.push("wallet-authority-verify.sh: verification must enforce read-only Store mode");
if(!walletAuthorityVerifySh.includes("PG_SINGLE_INSTANCE_LOCK=false"))failures.push("wallet-authority-verify.sh: read-only verification must not contend for writer lock");
if(!serviceBlock("server").includes("PG_FINANCIAL_JOURNAL"))failures.push("server service: PG_FINANCIAL_JOURNAL production setting missing");
if(!serviceBlock("server").includes("PG_WALLET_AUTHORITY"))failures.push("server service: PG_WALLET_AUTHORITY production setting missing");
if(!ciWorkflow.includes("postgres:16-alpine")||!ciWorkflow.includes("npm run postgres-e2e"))failures.push("ci.yml: PostgreSQL 16 E2E service/job missing");

if(failures.length){
  console.error("Deploy security audit FAILED");
  failures.forEach(x=>console.error("-",x));
  process.exit(1);
}
console.log("Deploy security audit OK");
