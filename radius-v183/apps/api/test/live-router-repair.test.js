import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source=fs.readFileSync(path.join(root,"apps/provider-v183-runtime/live-router-repair.js"),"utf8");
const first={id:"dev_abc1234567890def",name:"First",host:"11.5.50.0",port:8728,siteId:null,
 issues:["DUPLICATE_IN_SITE","API_SSL_PORT"],verifiedOnline:false,agentOnline:false};
const second={id:"dev_def1234567890abc",name:"Second",host:"11.5.50.0",port:8728,siteId:null,
 issues:["DUPLICATE_IN_SITE","API_SSL_PORT"],verifiedOnline:false,agentOnline:false};
function harness(overrides={},approve=true){
 const calls=[],dialogs=[],errors=[],listeners=[];
 const state={me:{role:"owner",canWrite:true},devices:[{id:first.id},{id:second.id}],
  diagnostics:{requireSiteSeparation:true,items:[{...first},{...second}]},sites:[],...overrides};
 const apiRequest=async(url,options)=>{
  calls.push({url,...options});
  if(url==="/sites")return {id:"sit_test_"+calls.filter(c=>c.url==="/sites").length,
   name:options.body.name,code:options.body.code};
  if(url.startsWith("/devices/"))return {id:url.slice("/devices/".length)};
  throw Error("Unexpected API path");
 };
 const context=vm.createContext({state,apiRequest,window:{confirm:()=>approve},
  t:(ar)=>ar,esc:x=>String(x).replace(/&/g,"&amp;").replace(/</g,"&lt;")
       .replace(/>/g,"&gt;").replace(/"/g,"&quot;"),
  document:{addEventListener:(_,callback)=>listeners.push(callback)},
  v183CanCreate:s=>s.me?.canWrite===true && s.me?.role==="owner",
  workspaceDialog:(title,html)=>dialogs.push({title,html}),$:()=>({close(){}})});
 vm.runInContext(source+"\ninstallV183RouterRepair(state,apiRequest,refresh,reportError,setBusy);",ctxWithCallbacks());
 function ctxWithCallbacks(){
  context.refresh=async()=>{state.diagnostics.requireSiteSeparation=state.diagnostics.items.some(r=>r.issues.includes("DUPLICATE_IN_SITE"));};
  context.reportError=error=>errors.push(error.message);
  context.setBusy=()=>{};
  return context;
 }
 async function click(key){
  const button={dataset:{[key]:""},disabled:false};
  await listeners[0]({target:{closest:()=>button},preventDefault(){},stopImmediatePropagation(){}});
 }
 return {state,calls,dialogs,errors,click,context};
}

test("real two-site repair requires explicit choice, then uses two scoped site records",async()=>{
 const h=harness();
 assert.ok(vm.runInContext("v183RepairCandidates(state)",h.context));
 await h.click("v183RepairDuplicates");
 assert.match(h.dialogs.at(-1).html,/لا يمكن للتطبيق معرفة/);
 assert.equal(h.calls.length,0);
 await h.click("v183RepairTwoSites");
 assert.deepEqual(h.calls.map(x=>x.url),["/sites","/devices/"+first.id,"/sites","/devices/"+second.id]);
 const patches=h.calls.filter(c=>c.url.startsWith("/devices/"));
 assert.notEqual(patches[0].body.siteId,patches[1].body.siteId);
 assert.ok(patches.every(c=>!Object.hasOwn(c.body,"host")&&!Object.hasOwn(c.body,"apiPort")));
 assert.match(h.dialogs.at(-1).html,/لم نغيّر العنوان أو المنفذ/);
 assert.equal(h.errors.length,0);
});
test("user can choose uncertainty without writing or deleting devices",async()=>{
 const h=harness();
 await h.click("v183RepairDuplicates");
 await h.click("v183RepairUncertain");
 assert.equal(h.calls.length,0);
 assert.match(h.dialogs.at(-1).html,/لن نحذف أي جهاز/);
});
test("refused confirmation makes no API changes",async()=>{
 const h=harness({},false);
 await h.click("v183RepairTwoSites");
 assert.equal(h.calls.length,0);
});
test("partial prior assignment reuses deterministic site on retry",async()=>{
 const code="R"+first.id.replace(/[^A-Za-z0-9]/g,"").slice(-18).toUpperCase();
 const h=harness({sites:[{id:"sit_existing",code,name:"شبكة First"}],
  diagnostics:{requireSiteSeparation:false,
   items:[{...first,siteId:"sit_existing",issues:["ROUTER_NOT_VERIFIED"]},
          {...second,issues:["ROUTER_NOT_VERIFIED"]}]}});
 assert.ok(vm.runInContext("v183RepairCandidates(state)",h.context));
 await h.click("v183RepairTwoSites");
 assert.equal(h.calls.filter(c=>c.url==="/sites").length,1);
 assert.equal(h.calls.find(c=>c.url==="/devices/"+first.id).body.siteId,"sit_existing");
});
test("one-site actual router and verified online records never auto-separated",async()=>{
 const h=harness({diagnostics:{items:[{...first,verifiedOnline:true},{...second}]}});
 assert.equal(vm.runInContext("v183RepairCandidates(state)",h.context),null);
 await h.click("v183RepairTwoSites");
 assert.equal(h.calls.length,0);
 assert.equal(h.errors.length,1);
});

test("single ISP router choice does not create extra site or change either registration",async()=>{
 const h=harness();
 await h.click("v183RepairDuplicates");
 assert.match(h.dialogs.at(-1).html,/راوتر المزود الرئيسي/);
 await h.click("v183SingleRouter");
 assert.equal(h.calls.length,0);
 const dialog=h.dialogs.at(-1).html;
 assert.match(dialog,/سجلًا واحدًا/);
 assert.match(dialog,/data-v183-agent-template data-v183-device-id="dev_abc1234567890def"/);
 assert.match(dialog,/data-v183-agent-template data-v183-device-id="dev_def1234567890abc"/);
 assert.doesNotMatch(dialog,/data-v183-repair-two-sites/);
});
