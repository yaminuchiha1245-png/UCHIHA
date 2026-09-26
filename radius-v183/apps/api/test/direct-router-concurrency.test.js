import assert from "node:assert/strict";
import test from "node:test";
import { createTenant,devSession,headers,setup } from "./helpers.js";
import { DEMO } from "../src/seed.js";
import { encryptSecret } from "../src/security.js";

const input={host:"8.8.8.8",apiPort:8729,username:"limited-admin",
  password:"private-test-password",confirmedOwned:true,reason:"Authorized laboratory probe"};
test("a slow authenticated handshake cannot overwrite an intervening router edit",async t=>{
  let env;
  env=await setup({directRouterAllowPublic:true,
    directRouterClientFactory:()=>({
      async connect(){
        await env.db.run("UPDATE network_devices SET updated_at=? WHERE id='dev_demo_core'",
          [new Date(Date.now()+120000).toISOString()]);
      },
      async talk(){return [{name:"Verified router"}]},
      close(){}
    })
  });
  t.after(()=>env.close());
  const token=(await devSession(env.app)).token;
  const before=await env.db.get("SELECT host,secret_ciphertext FROM network_devices WHERE id='dev_demo_core'");
  const response=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/direct-connect",
    headers:headers(token),payload:input});
  assert.equal(response.statusCode,409,response.body);
  const after=await env.db.get("SELECT host,secret_ciphertext FROM network_devices WHERE id='dev_demo_core'");
  assert.deepEqual(after,before);
  assert.equal(response.body.includes(input.password),false);
});
test("rechecking the real selected ID retires same-site duplicate online claims only",async t=>{
  const env=await setup({directRouterAllowPublic:true,
    directRouterClientFactory:()=>({
      async connect(){},async talk(){return [{name:"Verified router"}]},close(){}
    })
  });
  t.after(()=>env.close());
  const token=(await devSession(env.app)).token;
  const registered=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/direct-connect",
    headers:headers(token),payload:input});
  assert.equal(registered.statusCode,200,registered.body);
  const first=await env.db.get("SELECT * FROM network_devices WHERE id='dev_demo_core'");
  const otherTenant=await createTenant(env.db,"device-concurrency");
  const now=new Date().toISOString();
  await env.db.run(`INSERT INTO network_devices
    (id,tenant_id,site_id,name,branch,host,api_port,connection_method,username,
     secret_ciphertext,status,last_seen_at,created_at,updated_at)
    VALUES (?,?,?,'Duplicate',NULL,?,?,'api',NULL,NULL,'online',?,?,?)`,
    ["dev_duplicate_same_site",DEMO.tenantId,first.site_id,first.host,first.api_port,now,now,now]);
  await env.db.run(`INSERT INTO network_devices
    (id,tenant_id,site_id,name,branch,host,api_port,connection_method,username,
     secret_ciphertext,status,last_seen_at,created_at,updated_at)
    VALUES (?, ?, NULL,'Other tenant router',NULL,?,?,'agent',NULL,NULL,'online',?,?,?)`,
    ["dev_other_tenant",otherTenant,first.host,first.api_port,now,now,now]);
  const verified=await env.app.inject({method:"POST",
    url:"/api/v1/devices/dev_demo_core/verify-direct",headers:headers(token)});
  assert.equal(verified.statusCode,200,verified.body);
  const stale=await env.db.get("SELECT status,last_seen_at FROM network_devices WHERE id='dev_duplicate_same_site'");
  const isolated=await env.db.get("SELECT status FROM network_devices WHERE id='dev_other_tenant'");
  assert.equal(stale.status,"pending");
  assert.equal(stale.last_seen_at,null);
  assert.equal(isolated.status,"online");
});
test("a failing verification cannot downgrade a newly reconfigured router",async t=>{
  let env;let connections=0;
  env=await setup({directRouterAllowPublic:true,directRouterClientFactory:()=>({
    async connect(){
      connections+=1;
      if(connections===2){
        await env.db.run("UPDATE network_devices SET host=?,status='pending' WHERE id='dev_demo_core'",["9.9.9.9"]);
        const error=new Error("Old endpoint vanished; do not overwrite new router state");
        error.code="ECONNREFUSED";throw error;
      }
    },
    async talk(){return [{name:"Authenticated Router"}]},close(){}
  })});
  t.after(()=>env.close());
  const token=(await devSession(env.app)).token;
  const register=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/direct-connect",
    headers:headers(token),payload:input});
  assert.equal(register.statusCode,200,register.body);
  const failed=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/verify-direct",
    headers:headers(token)});
  assert.equal(failed.statusCode,422,failed.body);
  assert.equal(failed.body.includes("Old endpoint"),false);
  const latest=await env.db.get("SELECT host,status FROM network_devices WHERE id='dev_demo_core'");
  assert.equal(latest.host,"9.9.9.9");
  assert.equal(latest.status,"pending");
});

test("verify-direct rejects an intervening management username edit even if the password is unchanged",async t=>{
  let env;let connections=0;
  env=await setup({directRouterAllowPublic:true,directRouterClientFactory:()=>({
    async connect(){
      if(++connections===2) {
        // Deliberately do not change updated_at: this must be a credential
        // identity comparison, not a timestamp-only optimistic lock.
        await env.db.run("UPDATE network_devices SET username=?,status='pending',last_seen_at=NULL WHERE id='dev_demo_core'",
          ["replacement-admin"]);
      }
    },async talk(){return[{name:"Router for previous username"}]},close(){}
  })});
  t.after(()=>env.close());
  const token=(await devSession(env.app)).token;
  const registered=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/direct-connect",
    headers:headers(token),payload:input});
  assert.equal(registered.statusCode,200,registered.body);
  const stale=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/verify-direct",
    headers:headers(token)});
  assert.equal(stale.statusCode,409,stale.body);
  assert.equal(stale.body.includes(input.password),false);
  const saved=await env.db.get("SELECT username,status,last_seen_at FROM network_devices WHERE id='dev_demo_core'");
  assert.equal(saved.username,"replacement-admin");
  assert.equal(saved.status,"pending");
  assert.equal(saved.last_seen_at,null);
});

test("a failed verify-direct cannot mark a concurrently renamed account as errored",async t=>{
  let env;let connections=0;
  env=await setup({directRouterAllowPublic:true,directRouterClientFactory:()=>({
    async connect(){
      if(++connections===2){
        await env.db.run("UPDATE network_devices SET username=?,status='pending',last_seen_at=NULL WHERE id='dev_demo_core'",
          ["renamed-after-snapshot"]);
        const err=new Error("Do not leak old identity probe failure");
        err.code="ECONNREFUSED";throw err;
      }
    },async talk(){return[{name:"Verified original"}]},close(){}
  })});
  t.after(()=>env.close());
  const token=(await devSession(env.app)).token;
  const registered=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/direct-connect",
    headers:headers(token),payload:input});
  assert.equal(registered.statusCode,200,registered.body);
  const stale=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/verify-direct",
    headers:headers(token)});
  assert.equal(stale.statusCode,422,stale.body);
  assert.equal(stale.body.includes("Do not leak"),false);
  const saved=await env.db.get("SELECT username,status,last_seen_at FROM network_devices WHERE id='dev_demo_core'");
  assert.equal(saved.username,"renamed-after-snapshot");
  assert.equal(saved.status,"pending");
  assert.equal(saved.last_seen_at,null);
});

test("cannot verify stale TLS identity after site reassignment during the handshake",async t=>{
  let env;let connections=0;
  env=await setup({directRouterAllowPublic:true,directRouterClientFactory:()=>({
    async connect(){
      if(++connections===2) {
        const now=new Date().toISOString();
        await env.db.run(`INSERT INTO network_sites
          (id,tenant_id,name,code,address,latitude,longitude,status,created_at,updated_at)
          VALUES ('sit_reassign_during_tls',?,'Reassigned NAS','NAS',NULL,NULL,NULL,'active',?,?)`,
          [DEMO.tenantId,now,now]);
        await env.db.run("UPDATE network_devices SET site_id=?,status='pending',last_seen_at=NULL WHERE id='dev_demo_core'",
          ["sit_reassign_during_tls"]);
      }
    },async talk(){return[{name:"Old site router identity"}]},close(){}
  })});
  t.after(()=>env.close());
  const token=(await devSession(env.app)).token;
  const registration=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/direct-connect",
    headers:headers(token),payload:input});
  assert.equal(registration.statusCode,200,registration.body);
  const verified=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/verify-direct",
    headers:headers(token)});
  assert.equal(verified.statusCode,409,verified.body);
  const row=await env.db.get("SELECT site_id,status,last_seen_at FROM network_devices WHERE id='dev_demo_core'");
  assert.equal(row.site_id,"sit_reassign_during_tls");
  assert.equal(row.status,"pending");
  assert.equal(row.last_seen_at,null);
});

test("switching a router to Site Agent during an old direct probe never marks it online",async t=>{
  let env;let connections=0;
  env=await setup({directRouterAllowPublic:true,directRouterClientFactory:()=>({
    async connect(){
      if(++connections===2)await env.db.run(
        "UPDATE network_devices SET connection_method='agent',status='pending',last_seen_at=NULL WHERE id='dev_demo_core'");
    },async talk(){return[{name:"Old direct router identity"}]},close(){}
  })});
  t.after(()=>env.close());
  const token=(await devSession(env.app)).token;
  const registration=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/direct-connect",
    headers:headers(token),payload:input});
  assert.equal(registration.statusCode,200,registration.body);
  const stale=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/verify-direct",
    headers:headers(token)});
  assert.equal(stale.statusCode,409,stale.body);
  const saved=await env.db.get("SELECT connection_method,status,last_seen_at FROM network_devices WHERE id='dev_demo_core'");
  assert.equal(saved.connection_method,"agent");
  assert.equal(saved.status,"pending");
  assert.equal(saved.last_seen_at,null);
});

test("failed old direct probe cannot mark a newly switched Site Agent as errored",async t=>{
  let env;let connections=0;
  env=await setup({directRouterAllowPublic:true,directRouterClientFactory:()=>({
    async connect(){
      if(++connections===2){
        await env.db.run(
          "UPDATE network_devices SET connection_method='agent',status='pending',last_seen_at=NULL WHERE id='dev_demo_core'");
        const error=new Error("Sensitive old direct probe failure");
        error.code="ECONNREFUSED";throw error;
      }
    },async talk(){return[{name:"Former direct router"}]},close(){}
  })});
  t.after(()=>env.close());
  const token=(await devSession(env.app)).token;
  const registration=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/direct-connect",
    headers:headers(token),payload:input});
  assert.equal(registration.statusCode,200,registration.body);
  const stale=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/verify-direct",
    headers:headers(token)});
  assert.equal(stale.statusCode,422,stale.body);
  assert.equal(stale.body.includes("Sensitive old direct probe"),false);
  const saved=await env.db.get("SELECT connection_method,status,last_seen_at FROM network_devices WHERE id='dev_demo_core'");
  assert.equal(saved.connection_method,"agent");
  assert.equal(saved.status,"pending");
  assert.equal(saved.last_seen_at,null);
});

test("registration cannot overwrite a site move when updated_at stays unchanged",async t=>{
 let env;env=await setup({directRouterAllowPublic:true,directRouterClientFactory:()=>({
  async connect(){
   const now=new Date().toISOString();
   await env.db.run(`INSERT INTO network_sites
     (id,tenant_id,name,code,address,latitude,longitude,status,created_at,updated_at)
     VALUES ('sit_register_reassigned',?,'Reassigned','RRC',NULL,NULL,NULL,'active',?,?)`,
     [DEMO.tenantId,now,now]);
   await env.db.run("UPDATE network_devices SET site_id=?,status='pending' WHERE id='dev_demo_core'",
     ["sit_register_reassigned"]);
  },async talk(){return[{name:"Stale TLS proof"}]},close(){}
 })});t.after(()=>env.close());
 const token=(await devSession(env.app)).token;
 const before=await env.db.get("SELECT host,secret_ciphertext,updated_at FROM network_devices WHERE id='dev_demo_core'");
 const response=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/direct-connect",
  headers:headers(token),payload:input});
 assert.equal(response.statusCode,409,response.body);
 assert.equal(response.body.includes(input.password),false);
 const saved=await env.db.get("SELECT site_id,host,secret_ciphertext,updated_at,status FROM network_devices WHERE id='dev_demo_core'");
 assert.equal(saved.site_id,"sit_register_reassigned");
 assert.equal(saved.host,before.host);
 assert.equal(saved.secret_ciphertext,before.secret_ciphertext);
 assert.equal(saved.updated_at,before.updated_at);
 assert.equal(saved.status,"pending");
});

test("registration cannot replace newer management identity and connection mode",async t=>{
 let env;let latestCipher;
 env=await setup({directRouterAllowPublic:true,directRouterClientFactory:()=>({
  async connect(){
   latestCipher=encryptSecret("new-test-credential",env.config.encryptionKey);
   await env.db.run("UPDATE network_devices SET username=?,secret_ciphertext=?,connection_method='vpn',status='pending' WHERE id='dev_demo_core'",
     ["new-management-account",latestCipher]);
  },async talk(){return[{name:"Earlier account proof"}]},close(){}
 })});t.after(()=>env.close());
 const token=(await devSession(env.app)).token;
 const original=await env.db.get("SELECT updated_at FROM network_devices WHERE id='dev_demo_core'");
 const result=await env.app.inject({method:"POST",url:"/api/v1/devices/dev_demo_core/direct-connect",
  headers:headers(token),payload:input});
 assert.equal(result.statusCode,409,result.body);
 assert.equal(result.body.includes(input.password),false);
 const current=await env.db.get("SELECT username,secret_ciphertext,connection_method,status,updated_at FROM network_devices WHERE id='dev_demo_core'");
 assert.equal(current.username,"new-management-account");
 assert.equal(current.secret_ciphertext,latestCipher);
 assert.equal(current.connection_method,"vpn");
 assert.equal(current.updated_at,original.updated_at);
 assert.equal(current.status,"pending");
});
