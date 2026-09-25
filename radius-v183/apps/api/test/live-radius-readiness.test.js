import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const script=fs.readFileSync(path.join(root,"apps/provider-v183-runtime/live-radius-readiness.js"),"utf8");
const result={
 routerIdentity:"ISP-CCR",transport:"api-ssl",aaaServerConfigured:false,
 radiusServers:[{address:"198.51.100.55",authenticationPort:1812,accountingPort:1813,
  services:["ppp","hotspot"],enabled:true}],
 pppoe:{useRadius:true},hotspot:{useRadius:false},
 issues:["AAA_SERVER_NOT_ENABLED","HOTSPOT_RADIUS_DISABLED"],
 aaaEndToEndVerified:false
};
function harness({devices=[{id:"dev_router123",name:"ISP MAIN",host:"10.0.0.1",
 connection_method:"api"}],report=result}={}){
 const dialogs=[],requests=[],listeners=[],errors=[];
 const state={me:{role:"owner",canWrite:true},devices};
 const ctx=vm.createContext({
  state,t:(ar)=>ar,esc:v=>String(v).replace(/&/g,"&amp;")
    .replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),
  document:{addEventListener:(name,callback)=>listeners.push([name,callback])},
  workspaceDialog:(title,html)=>dialogs.push({title,html}),
  v183CanCreate:s=>s.me?.canWrite && s.me?.role==="owner",
  apiRequest:async (route,options)=>{requests.push({route,options});return report},
  reportError:err=>errors.push(err),setBusy:()=>{}
 });
 vm.runInContext(script+"\ninstallV183RadiusReadiness(state,apiRequest,reportError,setBusy)",ctx);
 const click=async dataset=>listeners.find(x=>x[0]==="click")[1]({
  target:{closest:()=>({dataset})},
  preventDefault(){},stopImmediatePropagation(){}
 });
 return {state,click,dialogs,requests,errors};
}
test("read-only AAA inspection runs only for a directly paired saved router",async()=>{
 const h=harness();
 await h.click({v183AaaChoose:""});
 assert.match(h.dialogs.at(-1).html,/ISP MAIN/);
 await h.click({v183AaaCheck:"dev_router123"});
 assert.equal(h.requests.length,1);
 assert.equal(h.requests[0].route,"/devices/dev_router123/radius-readiness");
 assert.equal(h.requests[0].options.method,"POST");
 const html=h.dialogs.at(-1).html;
 assert.match(html,/ISP-CCR/);
 assert.match(html,/خدمة FreeRADIUS المركزية غير مفعّلة/);
 assert.match(html,/198\.51\.100\.55:1812 \/ 1813/);
 assert.match(html,/PPPoE/);
 assert.match(html,/Hotspot/);
 assert.match(html,/لا نعتبر PPPoE أو Hotspot فعّالًا دون تسجيل طلب مصادقة حقيقي/);
});
test("saved duplicate agent-only records are not presented as directly paired routers",async()=>{
 const h=harness({devices:[{id:"dev_one",name:"Original",connection_method:"agent"},
  {id:"dev_duplicate",name:"Repeated attempt",connection_method:"agent"}]});
 await h.click({v183AaaChoose:""});
 assert.match(h.dialogs.at(-1).html,/لا يوجد راوتر موصول مباشرةً/);
 await h.click({v183AaaCheck:"dev_one"});
 assert.equal(h.requests.length,0);
});
test("readiness UI escapes only the explicitly returned safe source fields",async()=>{
 const evil={...result,routerIdentity:"<script>alert(1)</script>",
  radiusServers:[{...result.radiusServers[0],address:"<img src=x onerror=alert(2)>"}]};
 const h=harness({report:evil});
 await h.click({v183AaaCheck:"dev_router123"});
 const html=h.dialogs.at(-1).html;
 assert.ok(html.includes("&lt;script&gt;"));
 assert.ok(html.includes("&lt;img"));
 assert.ok(!html.includes("<script>"));
 assert.ok(!html.includes("<img"));
});
