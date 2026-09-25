import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const code=fs.readFileSync(path.join(root,"apps/provider-v183-runtime/live-direct-connect.js"),"utf8");
function fixture(responder){
 const events={},requests=[],errors=[];
 const controls={
  '[type="submit"]':{disabled:true},
  '#v183-direct-credentials':{hidden:true,style:{display:"none"}},
  '#v183-direct-preflight-result':{textContent:""},
  '[name="password"]':{value:""},
  '[name="port"]':{value:"8729"},
  '#v183-direct-advanced':{open:false}
 };
 const fields={transport:"api-ssl",host:"router.example.org",port:"8729",
   serverName:"",caPem:"",owned:"on"};
 const form={
  dataset:{id:"dev_test_main_1234567",preflightChecked:""},
  querySelector:selector=>controls[selector]??null,
  fields
 };
 class StubFormData{
  constructor(form){this.fields={...form.fields,port:controls['[name="port"]'].value}}
  get(key){return this.fields[key]??null}
  has(key){return Object.hasOwn(this.fields,key)}
 }
 const context=vm.createContext({
  state:{me:{role:"owner",canWrite:true},devices:[],directConnectInstalled:false},
  t:ar=>ar,esc:s=>String(s),FormData:StubFormData,HTMLFormElement:class{},
  document:{addEventListener:(name,fn)=>events[name]=fn},
  v183CanCreate:()=>true,
  workspaceDialog:()=>{},art:()=>"",reportError:error=>errors.push(error),
  setBusy:()=>{},refresh:async()=>{},
  apiRequest:async(route,options)=>{requests.push({route,options});return responder(route,options)}
 });
 vm.runInContext(code+
  "\ninstallV183DirectConnect(state,apiRequest,refresh,reportError,setBusy);",context);
 const button={dataset:{v183DirectPreflight:""},closest:()=>form};
 const submitEvent={target:{closest:()=>button},preventDefault(){},stopImmediatePropagation(){}};
 return {
  controls,form,requests,errors,
  click:()=>events.click(submitEvent),
  input:name=>events.input({target:{name,closest:()=>form}}),
  changeTransport:value=>{
   fields.transport=value;
   events.change({target:{name:"transport",value,closest:()=>form}});
   fields.port=controls['[name="port"]'].value;
  }
 };
}

test("verified TLS reveals credential fields only after a safe, unauthenticated read",async()=>{
 const h=fixture(async()=>({tlsVerified:true}));
 assert.equal(h.controls['#v183-direct-credentials'].hidden,true);
 await h.click();
 assert.equal(h.requests.length,1);
 assert.match(h.requests[0].route,/\/direct-preflight$/);
 assert.equal(h.requests[0].options.method,"POST");
 assert.equal(h.requests[0].options.body.host,"router.example.org");
 assert.equal("username" in h.requests[0].options.body,false);
 assert.equal("password" in h.requests[0].options.body,false);
 assert.equal(h.controls['#v183-direct-credentials'].hidden,false);
 assert.equal(h.controls['#v183-direct-credentials'].style.display,"");
 assert.equal(h.controls['[type="submit"]'].disabled,false);
 assert.equal(h.form.dataset.preflightChecked,"yes");
 h.controls['[name="password"]'].value="temporary-input";
 h.form.fields.host="another-router.example.org";
 h.input("host");
 assert.equal(h.controls['#v183-direct-credentials'].hidden,true);
 assert.equal(h.controls['[type="submit"]'].disabled,true);
 assert.equal(h.controls['[name="password"]'].value,"");
 assert.equal(h.form.dataset.preflightChecked,"");
});
test("endpoint modified during the outstanding TLS request never authorizes credential entry",async()=>{
 let done;
 const h=fixture(async()=>new Promise(resolve=>{done=resolve}));
 const request=h.click();
 await Promise.resolve();
 h.form.fields.host="changed.example.org";
 h.input("host");
 done({tlsVerified:true});
 await request;
 assert.equal(h.form.dataset.preflightChecked,"");
 assert.equal(h.controls['#v183-direct-credentials'].hidden,true);
 assert.equal(h.controls['[type="submit"]'].disabled,true);
 assert.match(h.controls['#v183-direct-preflight-result'].textContent,/تغيّر العنوان/);
});
test("failed TLS preflight gives an on-site fallback without ever displaying credentials",async()=>{
 const h=fixture(async()=>{throw Error("ROUTER_CONNECT_TIMEOUT")});
 await h.click();
 assert.equal(h.requests.length,1);
 assert.equal(h.controls['#v183-direct-credentials'].hidden,true);
 assert.equal(h.controls['[type="submit"]'].disabled,true);
 assert.match(h.controls['#v183-direct-preflight-result'].textContent,/Site Agent/);
});
test("changing the connection method resets TLS proof and picks the correct encrypted port",async()=>{
 const h=fixture(async()=>({tlsVerified:true}));
 await h.click();
 h.changeTransport("rest-https");
 assert.equal(h.form.fields.port,"443");
 assert.equal(h.controls['#v183-direct-credentials'].hidden,true);
 assert.equal(h.form.dataset.preflightChecked,"");
 assert.equal(h.controls['[type="submit"]'].disabled,true);
});
