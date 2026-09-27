/* Tenant-specific first paint regression; no network, bot tokens or DB. */
"use strict";
const fs=require("fs"),vm=require("vm"),assert=require("assert");
const zlib=require("zlib"),crypto=require("crypto"),path=require("path");
const root=path.resolve(__dirname,"../../../../");
const page=fs.readFileSync(path.join(root,"apps/miniapp/index.html"),"utf8");
const current=page.match(/\/assets\/(uchiha-ui-[0-9a-f]{16}\.js)/);
assert(current,"Exactly one active immutable storefront bundle expected");
const asset=path.join(root,"apps/miniapp/assets",current[1]);
const raw=fs.readFileSync(asset);
const js=raw.toString("utf8");
assert(crypto.createHash("sha256").update(raw).digest("hex").startsWith(current[1].slice(10,26)));
assert.deepStrictEqual(zlib.gunzipSync(fs.readFileSync(asset+".gz")),raw);
assert.deepStrictEqual(zlib.brotliDecompressSync(fs.readFileSync(asset+".br")),raw);
assert(js.includes('if(url!==storeEndpoint())throw new Error("store_tenant_changed")'));
assert(js.includes('setTimeout(uchihaFirstPaint,55)'));
assert(page.includes('id="tenant-first-paint"'));
assert(page.includes('class="tenantBootText"'));
const script=page.match(/<script id="tenant-first-paint">([\s\S]*?)<\/script>/);
assert(script,"Tenant head script missing");
function headState(query){
 const active=new Set(),listeners={};
 const doc={
   documentElement:{classList:{
     add:x=>active.add(x),remove:x=>active.delete(x)
   }},
   addEventListener:(name,cb)=>{listeners[name]=cb}
 };
 const ctx={location:{search:query},URLSearchParams,document:doc};
 vm.runInNewContext(script[1],ctx,{timeout:1500});
 return {active,listeners};
}
for(const query of ["?bot_id=2","?bot=1"]){
 const a=headState(query);
 assert(a.active.has("tenant-pending"),query+" must start neutral");
 assert(a.listeners["uchiha:ui-ready"]);
 a.listeners["uchiha:ui-ready"]();
 assert(!a.active.has("tenant-pending"),query+" must retire neutral cover");
}
for(const query of ["","?bot_id=2%3Cscript%3E","?bot_id=0"]){
 const a=headState(query);
 assert(!a.active.has("tenant-pending"),query+" is not an explicit valid tenant");
}
const start=js.indexOf("function uchihaFirstPaint(){");
const end=js.indexOf("}setTimeout(uchihaFirstPaint,55)",start);
assert(start>0&&end>start,"First paint should retain the original timer anchor");
const func=js.slice(start,end+1);
function paint(requested,{meta=null,error=false}={}){
 const ui={
   painted:false,window:{UCHIHA_WEB_META:meta},
   state:{storeCatalogError:error},
   document:{getElementById:()=>ui.main,dispatchEvent:()=>{}},
   main:{innerHTML:""},renderCalls:0,hideCalls:0,
   uchihaRequestedTenant:()=>requested,
   render:()=>ui.renderCalls++,v4InitHistory:()=>{},
   v4ReplaceHistory:()=>{},hideBootLoader:()=>ui.hideCalls++,
   v2UpdateNetworkStatus:()=>{},CustomEvent:class{},
 };
 vm.createContext(ui);vm.runInContext(func,ui,{timeout:1500});
 return ui;
}
const merchant=paint("2");
merchant.uchihaFirstPaint();
assert.strictEqual(merchant.hideCalls,0,"Merchant must not paint generic startup");
assert.strictEqual(merchant.renderCalls,0);
merchant.window.UCHIHA_WEB_META={name:"Game Zone"};
merchant.uchihaFirstPaint();
assert.strictEqual(merchant.hideCalls,1);
assert.strictEqual(merchant.renderCalls,1);
const offline=paint("2",{error:true});
offline.uchihaFirstPaint();
assert.strictEqual(offline.hideCalls,1,"Network error must release the wait state");
assert.strictEqual(offline.renderCalls,1);
const landing=paint("");
landing.uchihaFirstPaint();
assert.strictEqual(landing.hideCalls,1,"Normal platform landing must keep fast startup");
assert(landing.main.innerHTML.includes("storeWaiting"));
console.log("PASS explicit tenant stays neutral until correct catalog branding or safe error");
console.log("PASS alias and malformed URLs, immutable hashes, Brotli/gzip, offline PWA unaffected");
