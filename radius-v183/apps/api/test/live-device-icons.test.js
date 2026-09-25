import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const code=fs.readFileSync(path.join(root,"apps/provider-v183-runtime/live-views.js"),"utf8");
const reference=fs.readFileSync(path.join(root,"reference/UCHIHA-RADIUS-UI-V1-83.html"),"utf8");
function render(){
 const state={
  me:{role:"owner",canWrite:true},secondaryFailures:[],
  sites:[],plans:[],invoices:[],devices:[{
   id:"dev_isp_main_123456",name:"ISP MAIN",host:"192.168.88.1",api_port:8729,
   connection_method:"api",site_id:null,status:"pending"
  }],
  diagnostics:{total:1,uniqueEndpoints:1,verifiedOnline:0,
   requireSiteSeparation:false,items:[{id:"dev_isp_main_123456",issues:[],
    verifiedOnline:false}]},
  overview:{credentialConfigured:false,last24Hours:{authenticationRequests:0,
   accepted:0,rejected:0},agentsOnline:0,agentsTotal:0},
  authEvents:[],integrations:[],resellers:[]
 };
 const escape=x=>String(x??"—").replace(/[&<>"']/g,
   ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
 const ctx=vm.createContext({
  state,providerPages:{},domainPages:{},t:(ar)=>ar,esc:escape,
  art:(name)=>'<span class="art art-'+escape(name)+'" aria-hidden="true"></span>',
  workspaceLine:(name,value)=>"<p>"+name+": "+value+"</p>",
  v183RepairCandidates:()=>null,installV183LiveIntegrations:()=>{}
 });
 vm.runInContext(code+"\ninstallV183LiveWorkspaces(state,async()=>{})",ctx);
 return {nas:vm.runInContext("domainPages.nas()",ctx),
  radius:vm.runInContext("domainPages.radius()",ctx),
  sites:vm.runInContext("providerPages.providers()",ctx),
  plans:vm.runInContext("providerPages.plans()",ctx)};
}
test("mobile MikroTik actions have distinct purpose-specific icons rather than one reused graphic",()=>{
 const {nas,radius,sites,plans}=render();
 const checks=[
  [nas,'data-v183-create="device"','art-router'],
  [nas,'data-v183-direct-choose','art-auth-key'],
  [nas,'data-v183-direct-connect','art-link'],
  [nas,'data-v183-direct-verify','art-connected'],
  [nas,'data-v183-aaa-check','art-policies'],
  [nas,'data-v183-aaa-evidence','art-audit'],
  [nas,'data-v183-agent-template','art-routing'],
  [nas,'data-v183-edit-device','art-edit'],
  [radius,'data-v183-agent-setup','art-agents'],
  [radius,'data-v183-aaa-choose','art-policies'],
  [radius,'data-v183-aaa-evidence','art-audit'],
  [sites,'data-v183-create="site"','art-site-add'],
  [plans,'data-v183-create="plan"','art-plan-add']
 ];
 for(const [html,control,icon] of checks){
  const start=html.indexOf(control);
  assert.ok(start!==-1,"Missing control "+control);
  const tagStart=html.lastIndexOf("<button",start);
  const tagEnd=html.indexOf("</button>",start);
  const segment=html.slice(tagStart,tagEnd);
  assert.ok(segment.includes(icon),control+" should use "+icon);
  assert.ok(reference.includes("."+icon),icon+" is missing from locked design icon library");
 }
});
test("the on-site route and direct connection remain visibly separate actions",()=>{
 const {nas}=render();
 assert.match(nas,/data-v183-direct-connect="dev_isp_main_123456"/);
 assert.match(nas,/data-v183-agent-template data-v183-device-id="dev_isp_main_123456"/);
 assert.match(nas,/v183-device-tools/);
 assert.doesNotMatch(nas,/3 sample NAS|atlas\.example/);
});
