import { PERMISSIONS } from "@uchiha-radius/contracts";
import { checkDirectRouter, directRouterCapabilities } from "./direct-router.js";
import { decryptSecret, encryptSecret } from "./security.js";
import { forbidden, notFound, validationError } from "./errors.js";
import { requirePermission, requireWrite } from "./guards.js";
import { writeAudit } from "./audit.js";
import { nowIso } from "./utils.js";

// Direct API-SSL is independent of subscriber AAA. Never persist credentials
// on a failed handshake; old duplicate registrations stay available for audit.
export class DirectConnectionService {
 constructor({db,config}){this.db=db;this.config=config}
 capabilities(context){
  requirePermission(context,PERMISSIONS.DEVICE_READ);
  return {...directRouterCapabilities(this.config),
    radiusUdpReady:!!this.config.radiusUdpReady,
    modes:["direct-api-ssl","private-vpn","site-agent"]};
 }
 async register(context,deviceId,input){
  requireWrite(context,PERMISSIONS.DEVICE_WRITE);
  if(!["owner","admin"].includes(context.role))throw forbidden();
  const before=await this.db.get("SELECT id,site_id,name,host,api_port,connection_method FROM network_devices WHERE tenant_id=? AND id=?",
    [context.tenantId,deviceId]);
  if(!before)throw notFound("سجل الراوتر غير موجود");
  const proof=await checkDirectRouter(input,this.config,{
    dnsLookup:this.config.directRouterDnsLookup,clientFactory:this.config.directRouterClientFactory
  });
  const now=nowIso();
  const port=Number(input.apiPort||8729);
  const method=proof.route==="vpn"?"vpn":"api";
  const secret=encryptSecret(JSON.stringify({
    password:input.password,caPem:input.caPem||null,serverName:input.serverName||null
  }),this.config.encryptionKey);
  // Saving the observed identity and credentials is atomic with expiring stale
  // copies of the same endpoint. No other customer's row can be touched.
  await this.db.transaction(async tx=>{
   await tx.run("UPDATE network_devices SET host=?,api_port=?,username=?,secret_ciphertext=?,connection_method=?,status='online',last_seen_at=?,updated_at=? WHERE id=? AND tenant_id=?",
     [input.host,port,input.username,secret,method,now,now,deviceId,context.tenantId]);
   await tx.run(
     "UPDATE network_devices SET status='pending',last_seen_at=NULL,updated_at=? "+
     "WHERE tenant_id=? AND id<>? AND host=? AND api_port=? "+
     "AND ((site_id IS NULL AND ? IS NULL) OR site_id=?)",
    [now,context.tenantId,deviceId,input.host,port,before.site_id??null,before.site_id??null]);
   await writeAudit(tx,context,{action:"device.direct-connect",entityType:"network_device",entityId:deviceId,
     reason:input.reason,
     before:{host:before.host,apiPort:before.api_port,connectionMethod:before.connection_method},
     after:{host:input.host,apiPort:port,connectionMethod:method,verifiedIdentity:proof.identity,verifiedAt:now,
       usernameConfigured:!!input.username,credentialsConfigured:true}});
  });
  return {id:deviceId,identity:proof.identity,host:input.host,apiPort:port,
    connectionMethod:method,status:"online",verifiedAt:now,credentialsConfigured:true};
 }
 async verify(context,deviceId){
  requireWrite(context,PERMISSIONS.DEVICE_WRITE);
  if(!["owner","admin"].includes(context.role))throw forbidden();
  const before=await this.db.get(
   "SELECT id,site_id,host,api_port,username,secret_ciphertext,connection_method FROM network_devices WHERE tenant_id=? AND id=?",
   [context.tenantId,deviceId]);
  if(!before)throw notFound("سجل الراوتر غير موجود");
  if(!["api","vpn"].includes(before.connection_method)||!before.secret_ciphertext)
    throw validationError("اربط الجهاز مباشرةً أولاً وأكمل حقول الحساب.");
  let saved;
  try{saved=JSON.parse(decryptSecret(before.secret_ciphertext,this.config.encryptionKey))}
  catch{throw validationError("صيغة بيانات الاتصال قديمة؛ أعد الربط المباشر بأمان.");}
  if(!saved.password)throw validationError("بيانات دخول الراوتر غير مكتملة");
  const input={host:before.host,apiPort:Number(before.api_port),
    username:before.username,password:saved.password,caPem:saved.caPem,serverName:saved.serverName};
  try{
   const proof=await checkDirectRouter(input,this.config,{
     dnsLookup:this.config.directRouterDnsLookup,clientFactory:this.config.directRouterClientFactory
   });
   const now=nowIso();
   await this.db.run("UPDATE network_devices SET status='online',last_seen_at=?,updated_at=? WHERE id=? AND tenant_id=?",
     [now,now,deviceId,context.tenantId]);
   return {id:deviceId,identity:proof.identity,status:"online",verifiedAt:now};
  }catch(error){
   await this.db.run("UPDATE network_devices SET status='error',last_seen_at=NULL,updated_at=? WHERE id=? AND tenant_id=?",
    [nowIso(),deviceId,context.tenantId]);
   throw error;
  }
 }
}
