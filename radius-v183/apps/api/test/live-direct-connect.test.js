import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const script=fs.readFileSync(path.join(root,"apps/provider-v183-runtime/live-direct-connect.js"),"utf8");
function harness(capabilities,{savedPort=8728}={}){
 const dialogs=[],listeners=[],apiCalls=[];
 const state={me:{role:"owner",canWrite:true},devices:[{
  id:"dev_test_main_1234567",name:"Core ISP",host:"11.5.50.0",
  api_port:savedPort,connection_method:"agent",username:""
 }],directConnectInstalled:false};
 const context=vm.createContext({state,HTMLFormElement:class {},
  t:(ar)=>ar,art:name=>'<span class="art art-'+name+'"></span>',
  esc:x=>String(x).replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;"),
  document:{addEventListener:(event,fn)=>listeners.push([event,fn])},
  v183CanCreate:s=>s.me?.canWrite&&s.me?.role==="owner",
  workspaceDialog:(heading,html)=>dialogs.push({heading,html}),
  apiRequest:async route=>{apiCalls.push(route);return capabilities},
  reportError:()=>{},setBusy:()=>{},refresh:async()=>{}});
 vm.runInContext(script+"\ninstallV183DirectConnect(state,apiRequest,refresh,reportError,setBusy)",context);
 const click=async dataset=>listeners.find(([event])=>event==="click")[1]({
  target:{closest:()=>({dataset})},preventDefault(){},stopImmediatePropagation(){}
 });
 return {click,dialogs,apiCalls};
}
test("main router direct form defaults to SSL port and never includes a saved password",async()=>{
 const ui=harness({ready:true,publicEnabled:true,vpnEnabled:false,restHttps:true});
 await ui.click({v183DirectChoose:""});
 assert.match(ui.dialogs.at(-1).html,/Core ISP/);
 await ui.click({v183DirectConnect:"dev_test_main_1234567"});
 const html=ui.dialogs.at(-1).html;
 assert.match(html,/name="password" type="password"/);
 assert.match(html,/<details id="v183-direct-advanced">/);
 assert.match(html,/<div id="v183-direct-credentials" hidden style="display:none">/);
 assert.ok(html.indexOf('data-v183-direct-preflight')<html.indexOf('id="v183-direct-credentials"'),
   "Do not show the RouterOS password before the TLS preflight step");
 assert.match(html,/name="port" type="number" required min="443" max="65535" value="8729"/);
 assert.match(html,/name="host" type="text" dir="ltr" required/);
 assert.match(html,/data-id="dev_test_main_1234567"/);
 assert.match(html,/شهادة CA الموثوقة/);
 assert.match(html,/REST HTTPS · RouterOS v7 · 443/);
 assert.match(html,/option value="api-ssl" selected/);
 assert.match(html,/العنوان المحفوظ ينتهي بـ .0/);
 assert.match(html,/name="host"[^>]*value="" placeholder="11.5.50.0"/);
 assert.doesNotMatch(html,/name="password"[^>]*value=/);
 assert.match(html,/<button type="submit" class="btn btn-primary" disabled>/);
 assert.match(html,/data-v183-agent-template data-v183-device-id="dev_test_main_1234567"/);
 assert.deepEqual(ui.apiCalls,["/devices/direct-capabilities"]);
});
test("direct UI blocks connection when the server has no approved route",async()=>{
 const ui=harness({ready:false,publicEnabled:false,vpnEnabled:false});
 await ui.click({v183DirectConnect:"dev_test_main_1234567"});
 assert.match(ui.dialogs.at(-1).html,/مسار VPN مصرحًا/);
 assert.match(ui.dialogs.at(-1).html,/disabled/);
});

test("saved RouterOS v7 HTTPS port selects REST HTTPS and correct port automatically",async()=>{
 const ui=harness({ready:true,publicEnabled:true,vpnEnabled:false,restHttps:true},{savedPort:443});
 await ui.click({v183DirectConnect:"dev_test_main_1234567"});
 const html=ui.dialogs.at(-1).html;
 assert.match(html,/option value="rest-https" selected/);
 assert.match(html,/name="port" type="number" required min="443" max="65535" value="443"/);
 assert.match(html,/id="v183-direct-credentials" hidden style="display:none"/);
});
