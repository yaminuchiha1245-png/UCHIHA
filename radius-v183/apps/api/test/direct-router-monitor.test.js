import assert from "node:assert/strict";
import test from "node:test";
import { sweepDirectRouters } from "../src/direct-router-monitor.js";
import { encryptSecret } from "../src/security.js";
import { setup, testConfig } from "./helpers.js";

async function configuredDevice(env) {
 const saved=encryptSecret(JSON.stringify({
  password:"monitor-test-pass",caPem:null,serverName:"isp.private.test"
 }),env.config.encryptionKey);
 await env.db.run(
  "UPDATE network_devices SET host=?,api_port=?,username=?,secret_ciphertext=?,connection_method='vpn',status='pending',last_seen_at=NULL WHERE id='dev_demo_core'",
  ["10.84.2.2",8729,"isp-test",saved]);
 return saved;
}
test("direct connections remain live only after repeated real authenticated probes",async t=>{
 let identity="ISP CORE";
 const env=await setup({
  directRouterAllowedCidrs:["10.84.0.0/16"],directRouterMonitorEnabled:true,
  directRouterClientFactory:()=>({
   async connect(){if(identity===null){const err=new Error("unreachable");err.code="ETIMEDOUT";throw err}},
   async talk(){return [{name:identity}]},close(){}
  })
 });
 t.after(()=>env.close());
 await configuredDevice(env);
 const first=await sweepDirectRouters(env.db,env.config);
 assert.equal(first.checked,1);
 assert.equal(first.online,1);
 const online=await env.db.get("SELECT status,last_seen_at FROM network_devices WHERE id='dev_demo_core'");
 assert.equal(online.status,"online");
 assert.ok(online.last_seen_at);
 identity=null;
 const failed=await sweepDirectRouters(env.db,env.config);
 assert.equal(failed.failed,1);
 const offline=await env.db.get("SELECT status,last_seen_at FROM network_devices WHERE id='dev_demo_core'");
 assert.equal(offline.status,"error");
 assert.equal(offline.last_seen_at,null);
});
test("monitor does not resurrect a router whose credentials changed during TLS probe",async t=>{
 const env=await setup({
  directRouterAllowedCidrs:["10.84.0.0/16"],directRouterMonitorEnabled:true
 });
 t.after(()=>env.close());
 const old=await configuredDevice(env);
 const next=encryptSecret(JSON.stringify({password:"new-password",caPem:null}),
  env.config.encryptionKey);
 const result=await sweepDirectRouters(env.db,env.config,{
  probe:async()=>{
   await env.db.run("UPDATE network_devices SET secret_ciphertext=? WHERE id='dev_demo_core'",[next]);
   return {identity:"ISP CORE"};
  }
 });
 assert.equal(result.checked,1);
 assert.equal(result.online,0);
 const current=await env.db.get("SELECT secret_ciphertext,status FROM network_devices WHERE id='dev_demo_core'");
 assert.equal(current.secret_ciphertext,next);
 assert.equal(current.status,"pending");
 assert.notEqual(current.secret_ciphertext,old);
});
test("monitor never attempts a connection without an approved route",async t=>{
 const env=await setup({directRouterMonitorEnabled:true});
 t.after(()=>env.close());
 await configuredDevice(env);
 let probed=false;
 const result=await sweepDirectRouters(env.db,env.config,{probe:async()=>{probed=true}});
 assert.equal(result.checked,0);
 assert.equal(probed,false);
});
test("duplicate direct registrations at one site never become two online routers",async t=>{
 const env=await setup({directRouterAllowedCidrs:["10.84.0.0/16"],
  directRouterMonitorEnabled:true});
 t.after(()=>env.close());
 const ciphertext=await configuredDevice(env);
 const stamp=new Date().toISOString();
 await env.db.run(
  "INSERT INTO network_devices (id,tenant_id,site_id,name,host,api_port,connection_method,"+
  "username,secret_ciphertext,status,last_seen_at,created_at,updated_at) "+
  "VALUES (?,'ten_demo_isp',NULL,?,?,?,'api',?,?,'pending',NULL,?,?)",
  ["dev_duplicate_main_12345","Repeated registration","10.84.2.2",8729,
   "isp-test",ciphertext,stamp,stamp]);
 let probes=0;
 const result=await sweepDirectRouters(env.db,env.config,{
  probe:async()=>{probes++;return {identity:"MAIN ISP ROUTER"}}
 });
 assert.equal(probes,1);
 assert.equal(result.checked,1);
 const rows=await env.db.all("SELECT id,status FROM network_devices "+
  "WHERE id IN ('dev_demo_core','dev_duplicate_main_12345')");
 assert.equal(rows.filter(row=>row.status==="online").length,1);
});
