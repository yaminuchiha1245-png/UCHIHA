const fs=require("node:fs");
const path=require("node:path");

const root=path.join(__dirname,"..","..");
const failures=[];
const forbiddenNames=[
  path.join("deploy",".env.production"),
  path.join("deploy",".env.production.generated"),
  path.join("server",".env"),
  path.join("bot",".env")
];
for(const rel of forbiddenNames){
  if(fs.existsSync(path.join(root,rel)))failures.push(`${rel}: runtime secret file must not be in release`);
}

const forbiddenExtensions=new Set([".pem",".key",".p12",".jks",".keystore"]);
const skipDirs=new Set(["node_modules",".git","history","previews"]);
const botToken=/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g;
const privateKey=/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;

function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(skipDirs.has(entry.name))continue;
    const full=path.join(dir,entry.name),rel=path.relative(root,full);
    if(entry.isDirectory()){walk(full);continue;}
    if(forbiddenExtensions.has(path.extname(entry.name).toLowerCase()))failures.push(`${rel}: signing/private-key file present`);
    let text;
    try{text=fs.readFileSync(full,"utf8")}catch{continue}
    if(privateKey.test(text))failures.push(`${rel}: private key material present`);
    const matches=text.match(botToken)||[];
    if(matches.length)failures.push(`${rel}: value resembles a live Telegram bot token`);
  }
}
walk(root);

if(failures.length){
  console.error("Release secret scan FAILED");
  failures.forEach(x=>console.error("-",x));
  process.exit(1);
}
console.log("Release secret scan OK");
