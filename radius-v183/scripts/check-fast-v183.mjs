import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";

const root = process.cwd(), dir=path.join(root,"dist","fast-v183"),
  assets=path.join(dir,"assets");
const html=fs.readFileSync(path.join(dir,"index.html"),"utf8");
const compressed=fs.readFileSync(path.join(dir,"index.html.gz"));
assert.equal(zlib.gunzipSync(compressed).toString(), html, "HTML gzip mismatch");
assert.ok(Buffer.byteLength(html)<40_000,"HTML must be under 40KB");
assert.ok(compressed.length<10_000,"HTML transfer must be under 10KB");
assert.equal((html.match(/<link rel="stylesheet"/g)||[]).length,4,"All four CSS blocks preserved");
assert.equal((html.match(/<script src="/g)||[]).length,1,"Exactly one interactive V1-83 runtime");
assert.ok(html.includes('src="https://telegram.org/js/telegram-web-app.js"'),
  "Official Telegram Mini App SDK must load before the V1-83 runtime");
assert.ok(!html.includes("data:image/webp;base64"),"No embedded bitmap atlas");
assert.ok(!html.includes("/provider/assets/"),"No old prefix");
assert.ok(html.includes("<title>أوتشيها راديوس | UCHIHA RADIUS</title>"),"Release product name mismatch");
assert.ok(html.includes("أوتشيها راديوس — إدارة شبكتك"),"Official entrance name missing");
assert.ok(fs.readdirSync(assets).some(name=>name.endsWith(".css")&&
  fs.readFileSync(path.join(assets,name),"utf8").includes('body:not([data-runtime="live"]) .main')),
  "Unverified fixture pages could be visible");
assert.ok(!html.includes("بيانات تجريبية · 11 أيلول 2026"),"Old demo note leaked");
assert.ok(!html.includes("Provider V1-83 · Connected"),"Outdated preview branding leaked");
const listed=fs.readdirSync(assets).filter(p=>!p.endsWith(".gz"));
assert.equal(listed.filter(p=>p.endsWith(".webp")).length,2,"Two original atlases");
assert.equal(listed.filter(p=>p.endsWith(".woff2")).length,4,"Four original font files");
assert.equal(listed.filter(p=>p.endsWith(".css")).length,4,"Four CSS styles");
assert.equal(listed.filter(p=>p.endsWith(".js")).length,1,"One original runtime");
const hash=data=>crypto.createHash("sha256").update(data).digest("hex");
for(const name of listed){
 const data=fs.readFileSync(path.join(assets,name)), suffix=name.match(/([a-f0-9]{16})\.(?:webp|woff2|svg|css|js)$/)?.[1];
 assert.ok(suffix && hash(data).startsWith(suffix),"Unfingerprinted asset "+name);
 assert.ok(html.includes("/v183/assets/"+name)||listed.some(f=>f.endsWith(".css")&&fs.readFileSync(path.join(assets,f),"utf8").includes("/v183/assets/"+name)),"Unreferenced asset "+name);
 if(name.endsWith(".css")||name.endsWith(".js")){
  const zip=fs.readFileSync(path.join(assets,name+".gz"));
  assert.deepEqual(zlib.gunzipSync(zip),data,"Gzip mismatch "+name);
 }
}
const legacy=fs.readFileSync(path.join(root,"reference","UCHIHA-RADIUS-UI-V1-83.html"));
assert.equal(hash(legacy),"bdfea1a81d3a82e96330d1a287bc1120046c53af59eca68bb1a3afd452756237");
console.log(JSON.stringify({ok:true,source:"LOCKED V1-83",htmlBytes:Buffer.byteLength(html),htmlGzipBytes:compressed.length,hashedAssets:listed.length,notes:"Build and source integrity only; not production API readiness."}));
