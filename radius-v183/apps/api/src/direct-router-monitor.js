/* Recheck successful direct API-SSL registrations every 40s.
 * Central status is never "online" on the strength of a saved IP alone. */
import { checkDirectRouter, directRouterCapabilities } from "./direct-router.js";
import { decryptSecret } from "./security.js";
import { nowIso } from "./utils.js";

export async function sweepDirectRouters(db,config,{logger=null,probe=checkDirectRouter}={}){
 const caps=directRouterCapabilities(config);
 if(!caps.ready||!config.directRouterMonitorEnabled)return {checked:0,online:0,failed:0};
 const records=await db.withContext({tenantId:"",platformAccess:true},
  ()=>db.all("SELECT id,tenant_id,site_id,host,api_port,username,secret_ciphertext,connection_method,"+
    "status,last_seen_at,updated_at FROM network_devices "+
    "WHERE connection_method IN ('api','vpn') AND secret_ciphertext IS NOT NULL "+
    "ORDER BY updated_at DESC LIMIT 100"));
 // A duplicated old registration is not a second physical router. Monitor
 // exactly ONE authenticated device ID per tenant+site+endpoint.
 records.sort((a,b)=>
   Number(b.status==="online"&&!!b.last_seen_at)-Number(a.status==="online"&&!!a.last_seen_at)||
   String(b.updated_at).localeCompare(String(a.updated_at))||String(a.id).localeCompare(String(b.id)));
 const selected=[],seen=new Set();
 for(const row of records){
  const key=JSON.stringify([row.tenant_id,row.site_id??null,row.host,Number(row.api_port)]);
  if(seen.has(key)){
   if(row.status==="online")await db.withContext({tenantId:row.tenant_id},()=>db.run(
     "UPDATE network_devices SET status='pending',last_seen_at=NULL,updated_at=? WHERE tenant_id=? AND id=? AND secret_ciphertext=?",
     [nowIso(),row.tenant_id,row.id,row.secret_ciphertext]));
   continue;
  }
  seen.add(key);selected.push(row);
 }
 let online=0,failed=0;
 const chunks=[];
 for(let i=0;i<selected.length;i+=4)chunks.push(selected.slice(i,i+4));
 for(const items of chunks){
  await Promise.all(items.map(async row=>{
   const changed={tenantId:row.tenant_id};
   let verified=false;
   try{
    const stored=JSON.parse(decryptSecret(row.secret_ciphertext,config.encryptionKey));
    if(!stored.password)throw Error("incomplete saved connection");
    const input={host:row.host,apiPort:Number(row.api_port),username:row.username,
      password:stored.password,caPem:stored.caPem||null,serverName:stored.serverName||null,
      transport:stored.transport||"api-ssl"};
    // DNS addresses are re-authorized on every probe. A changed hostname can
    // never route through 127.0.0.1 or link-local metadata on a DNS rebinding.
    await probe(input,config,{
      dnsLookup:config.directRouterDnsLookup,clientFactory:config.directRouterClientFactory,
      restProbe:config.directRouterRestProbe
    });
    verified=true;
   }catch(error){
    logger?.warn?.({event:"direct_router_probe_failed",
      errorCode:/^ROUTER_[A-Z_]+$/.test(error?.code||"")?error.code:"ROUTER_PROBE_FAILED"});
   }
   const stamp=nowIso();
   // Compare the original encrypted configuration to avoid resurrecting a
   // device edited or rotated while this network probe was in flight.
   const result=await db.withContext(changed,()=>db.run(
     "UPDATE network_devices SET status=?,last_seen_at=?,updated_at=? "+
     "WHERE id=? AND tenant_id=? AND host=? AND api_port=? AND secret_ciphertext=? "+
     "AND connection_method IN ('api','vpn')",
     [verified?"online":"error",verified?stamp:null,stamp,row.id,row.tenant_id,
      row.host,row.api_port,row.secret_ciphertext]));
   if(result.changes===1){if(verified)online++;else failed++}
  }));
 }
 return {checked:selected.length,online,failed};
}
export class DirectRouterMonitor {
 constructor({db,config,logger}){
  this.db=db;this.config=config;this.logger=logger;
  this.timer=null;this.running=null;
 }
 async start(){
  if(!this.config.directRouterMonitorEnabled||
      !directRouterCapabilities(this.config).ready)return;
  if(this.timer)return;
  await this.tick();
  this.timer=setInterval(()=>{void this.tick()},40_000);
  this.timer.unref?.();
 }
 async tick(){
  if(this.running)return this.running;
  const run=async()=>{
   try{return await sweepDirectRouters(this.db,this.config,{logger:this.logger})}
   catch(error){
    this.logger?.warn?.({event:"direct_router_monitor_cycle_failed",
      errorCode:error?.code==="42501"?"DB_PERMISSION":"MONITOR_FAILURE"});
    return {checked:0,online:0,failed:0};
   }
  };
  this.running=run().finally(()=>{this.running=null});
  return this.running;
 }
 async stop(){
  if(this.timer)clearInterval(this.timer);
  this.timer=null;
  if(this.running)await this.running;
 }
}
