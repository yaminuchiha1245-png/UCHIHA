import assert from "node:assert/strict";
import test from "node:test";
import { checkDirectRouter, directRouterCapabilities, resolveAuthorizedRouter } from "../src/direct-router.js";
import { decryptSecret } from "../src/security.js";
import { createUserSession,devSession,headers,setup,testConfig } from "./helpers.js";

const local={host:"10.84.5.3",apiPort:8729,username:"router-user",
 password:"testing-secret-local",serverName:"router.test.private"};
const approved={...testConfig(),directRouterAllowedCidrs:["10.84.0.0/16"]};
test("direct RouterOS transport is disabled until an approved VPN or public route is configured",async()=>{
 await assert.rejects(resolveAuthorizedRouter(local,testConfig()),error=>
   error.code==="ROUTER_ROUTE_NOT_CONFIGURED");
 assert.equal(directRouterCapabilities(testConfig()).ready,false);
 assert.equal(directRouterCapabilities(approved).vpnEnabled,true);
});
test("DNS resolution is pinned and all resolved addresses must be approved",async()=>{
 const config={...approved};
 assert.deepEqual(await resolveAuthorizedRouter(local,config),{
  address:local.host,certificateHost:local.serverName
 });
 const lookup=async()=>[{address:"10.84.5.3",family:4},{address:"127.0.0.1",family:4}];
 await assert.rejects(resolveAuthorizedRouter({...local,host:"router.example.com"},config,
   {dnsLookup:lookup}),error=>error.code==="ROUTER_NETWORK_NOT_APPROVED");
 await assert.rejects(resolveAuthorizedRouter({...local,host:"169.254.169.254"},{
  ...config,directRouterAllowedCidrs:["169.254.0.0/16"]
 }),error=>error.code==="ROUTER_NETWORK_NOT_APPROVED");
 await assert.rejects(resolveAuthorizedRouter({...local,host:"192.168.44.1"},config),
  error=>error.code==="ROUTER_NETWORK_NOT_APPROVED");
});
test("public-only direct mode blocks loopback and private targets",async()=>{
 const c={...testConfig(),directRouterAllowPublic:true};
 assert.equal((await resolveAuthorizedRouter({host:"8.8.8.8"},c)).address,"8.8.8.8");
 await assert.rejects(resolveAuthorizedRouter({host:"127.0.0.1"},c));
 await assert.rejects(resolveAuthorizedRouter({host:"192.168.88.1"},c));
 await assert.rejects(resolveAuthorizedRouter({host:"100.64.1.1"},c));
});
test("TLS-authenticated identity is required and probe errors are sanitized",async()=>{
 let original;
 const clientFactory=options=>{
  original=options;
  return {async connect(){},async talk(){return[{name:"ISP CORE"}]},close(){}};
 };
 const good=await checkDirectRouter(local,approved,{clientFactory});
 assert.equal(good.identity,"ISP CORE");
 assert.equal(good.route,"vpn");
 assert.equal(original.host,"10.84.5.3");
 assert.equal(original.serverName,"router.test.private");
 const failed=()=>({async connect(){
   const error=new Error("secret password should not leak");
   error.code="ECONNREFUSED";throw error;
 },close(){}});
 await assert.rejects(checkDirectRouter(local,approved,{clientFactory:failed}),error=>
  error.code==="ROUTER_API_SSL_UNAVAILABLE"&&!String(error.message).includes("secret password"));
});
test("direct API route saves credentials only after proof and remains scoped to the owner",async t=>{
 const observed=[];
 const env=await setup({
  directRouterAllowPublic:true,
  directRouterClientFactory:options=>{
   observed.push(options);
   return {async connect(){},async talk(){return[{name:"ISP MAIN ROUTER"}]},close(){}};
  }
 });
 t.after(()=>env.close());
 const own=(await devSession(env.app,"provider")).token;
 const body={host:"8.8.8.8",apiPort:8729,username:"isp-admin",
  password:"testing-router-password",serverName:"router.isp.example",
  caPem:"-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----",
  confirmedOwned:true,reason:"ISP router direct authenticated test"};
 const original=await env.db.get("SELECT secret_ciphertext,status FROM network_devices WHERE id='dev_demo_core'");
 const resp=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/direct-connect",
  headers:headers(own),payload:body});
 assert.equal(resp.statusCode,200,resp.body);
 assert.equal(resp.json().data.identity,"ISP MAIN ROUTER");
 assert.equal(resp.json().data.connectionMethod,"api");
 assert.equal(resp.body.includes(body.password),false);
 assert.equal(observed[0].host,"8.8.8.8");
 const saved=await env.db.get("SELECT secret_ciphertext,status FROM network_devices WHERE id='dev_demo_core'");
 assert.notEqual(saved.secret_ciphertext,original.secret_ciphertext);
 assert.equal(saved.status,"online");
 assert.equal(saved.secret_ciphertext.includes(body.password),false);
 const credentials=JSON.parse(decryptSecret(saved.secret_ciphertext,env.config.encryptionKey));
 assert.equal(credentials.password,body.password);
 const check=await env.app.inject({method:"POST",
   url:"/api/v1/devices/dev_demo_core/verify-direct",headers:headers(own)});
 assert.equal(check.statusCode,200,check.body);
 assert.equal(check.body.includes(body.password),false);
 const viewer=await createUserSession(env.db,env.config,{role:"viewer"});
 const unauthorized=await env.app.inject({method:"POST",
   url:"/api/v1/devices/dev_demo_core/verify-direct",headers:headers(viewer.token)});
 assert.equal(unauthorized.statusCode,403);
});
test("failed direct connection never overwrites a registration or saves credentials",async t=>{
 const env=await setup({
  directRouterAllowPublic:true,
  directRouterClientFactory:()=>({async connect(){
   const err=new Error("transport unavailable");err.code="ETIMEDOUT";throw err;
  },close(){}})
 });
 t.after(()=>env.close());
 const own=(await devSession(env.app,"provider")).token;
 const before=await env.db.get("SELECT * FROM network_devices WHERE id='dev_demo_core'");
 const resp=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/direct-connect",
  headers:headers(own),payload:{host:"8.8.8.8",apiPort:8729,username:"isp-admin",
   password:"incorrect-password",confirmedOwned:true,reason:"Check router without saving"}});
 assert.equal(resp.statusCode,422,resp.body);
 assert.equal(resp.json().error.code,"ROUTER_CONNECT_TIMEOUT");
 const after=await env.db.get("SELECT * FROM network_devices WHERE id='dev_demo_core'");
 assert.deepEqual(after,before);
});
