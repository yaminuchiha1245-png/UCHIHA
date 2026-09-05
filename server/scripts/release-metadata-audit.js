const fs=require("node:fs");
const path=require("node:path");

const root=path.join(__dirname,"..","..");
const failures=[];
function read(rel){return fs.readFileSync(path.join(root,rel),"utf8")}
function json(rel){return JSON.parse(read(rel))}

const serverPkg=json("server/package.json"),botPkg=json("bot/package.json"),manifest=json("miniapp/manifest.webmanifest"),db=json("server/data/db.json");
if(serverPkg.version!=="1.0.0-rc.20")failures.push(`server package version: ${serverPkg.version}`);
if(botPkg.version!=="1.0.0-rc.20")failures.push(`bot package version: ${botPkg.version}`);
if(Number(db.schemaVersion)!==8)failures.push(`db schemaVersion: ${db.schemaVersion}`);

for(const [name,pkg] of [["server",serverPkg],["bot",botPkg]]){
  for(const [dep,version] of Object.entries(pkg.dependencies||{})){
    if(/^[~^*]|[<>=]|\s/.test(String(version)))failures.push(`${name} dependency ${dep} is not exactly pinned: ${version}`);
  }
}

const activeTextFiles=[
  "server/server.js","bot/bot.js","miniapp/app.js","admin/admin.js",
  "README.md","RELEASE-STATUS.md","TEST-RESULTS.md","PREVIEW.txt"
];
const forbiddenLegacyBrand=new RegExp(["uch","iha"].join(""),"i");
for(const rel of activeTextFiles){
  const txt=read(rel);
  if(forbiddenLegacyBrand.test(txt))failures.push(`${rel}: legacy-brand residue found`);
  if(/Game Zone v1\.0 RC(?:[0-9]|1[0-9])\b|Game Zone RC(?:[0-9]|1[0-9])\b/i.test(txt))failures.push(`${rel}: stale active release label found`);
}
if(!/RC20/i.test(String(manifest.description||"")))failures.push("manifest description does not identify RC20");

if(failures.length){
  console.error("Release metadata audit FAILED");
  failures.forEach(x=>console.error("-",x));
  process.exit(1);
}
console.log("Release metadata audit OK");
