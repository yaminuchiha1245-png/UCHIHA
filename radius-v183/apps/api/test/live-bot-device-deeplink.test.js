import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const script=fs.readFileSync(path.join(root,"apps/provider-v183-runtime/runtime.js"),"utf8");
const first=script.indexOf(" const miniAppParams=");
const last=script.indexOf("\n function uuid(){",first);
assert.ok(first>0 && last>first,"Mini App navigation code must be extractable");
const navigation=script.slice(first,last);
const currentDevice="dev_1234567890abcdef1234567890abcdef";
function run(search,{role="owner",canWrite=true,devices=[{id:currentDevice}]}={}){
 const navigated=[],opened=[],toasts=[],querySelectors=[];
 const state={initialLiveReady:true,me:{role,canWrite},devices};
 const fakeDocument={
  querySelector(selector){querySelectors.push(selector);
   return {click:()=>opened.push(selector)};
  }
 };
 const ctx=vm.createContext({
  state,window:{location:{search}},URLSearchParams,
  document:fakeDocument,navigate:page=>navigated.push(page),
  toast:message=>toasts.push(message),t:(ar)=>ar,toggleAdd:()=>{},
 });
 vm.runInContext(navigation+"\nopenRequestedMiniAppRoute();",ctx);
 return {navigated,opened,toasts,querySelectors};
}

test("bot registration opens exactly that tenant's router inside the web app",()=>{
 const result=run("?open=connect-mikrotik&deviceId="+currentDevice);
 assert.equal(result.navigated[0],"nas");
 assert.equal(result.opened.length,1);
 assert.equal(result.opened[0],
  '[data-v183-direct-connect="'+currentDevice+'"]');
 assert.equal(result.toasts.length,0);
});
test("other tenant ID and malformed links cannot open a direct pairing form",()=>{
 const other=run("?open=connect-mikrotik&deviceId=dev_other_tenant_1234567890",{
  devices:[{id:currentDevice}]
 });
 assert.equal(other.opened.length,0);
 assert.equal(other.navigated[0],"nas");
 assert.ok(other.toasts.length);
 const injected=run("?open=connect-mikrotik&deviceId=dev_"+encodeURIComponent('"><script>'));
 assert.equal(injected.opened.length,0);
 assert.ok(injected.toasts.length);
});
test("read-only provider and collector cannot start device pairing from a Telegram link",()=>{
 for(const role of ["viewer","collector","operator"]){
  const result=run("?open=connect-mikrotik&deviceId="+currentDevice,{
   role,canWrite:role==="operator"
  });
  assert.equal(result.opened.length,0);
  assert.ok(result.toasts.length);
 }
});
