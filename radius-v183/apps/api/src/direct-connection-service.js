import { PERMISSIONS } from "@uchiha-radius/contracts";
import { checkDirectRouter, preflightDirectRouter, directRouterCapabilities } from "./direct-router.js";
import { decryptSecret, encryptSecret } from "./security.js";
import { AppError, forbidden, notFound, validationError } from "./errors.js";
import { requirePermission, requireWrite } from "./guards.js";
import { writeAudit } from "./audit.js";
import { nowIso } from "./utils.js";
import { lockDeviceEndpoint } from "./device-endpoint-lock.js";

// Direct API-SSL is independent of subscriber AAA. Never persist credentials
// on a failed handshake; old duplicate registrations stay available for audit.
export class DirectConnectionService {
 constructor({db,config}){this.db=db;this.config=config}
 capabilities(context){
  requirePermission(context,PERMISSIONS.DEVICE_READ);
  return {...directRouterCapabilities(this.config),
    radiusUdpReady:!!this.config.radiusUdpReady,
    modes:["direct-api-ssl","direct-rest-https","private-vpn","site-agent"]};
 }
 async preflight(context,deviceId,input){
  requireWrite(context,PERMISSIONS.DEVICE_WRITE);
  if(!["owner","admin"].includes(context.role))throw forbidden();
  const row=await this.db.get("SELECT id FROM network_devices WHERE tenant_id=? AND id=?",
    [context.tenantId,deviceId]);
  if(!row)throw notFound("سجل الراوتر غير موجود");
  const result=await preflightDirectRouter(input,this.config,{
   dnsLookup:this.config.directRouterDnsLookup,
   tlsProbe:this.config.directRouterTlsProbe
  });
  return {id:deviceId,...result};
 }
 async register(context,deviceId,input){
  requireWrite(context,PERMISSIONS.DEVICE_WRITE);
  if(!["owner","admin"].includes(context.role))throw forbidden();
  const before=await this.db.get("SELECT id,site_id,name,host,api_port,connection_method,updated_at FROM network_devices WHERE tenant_id=? AND id=?",
    [context.tenantId,deviceId]);
  if(!before)throw notFound("سجل الراوتر غير موجود");
  const proof=await checkDirectRouter(input,this.config,{
    dnsLookup:this.config.directRouterDnsLookup,clientFactory:this.config.directRouterClientFactory,
    restProbe:this.config.directRouterRestProbe
  });
  const now=nowIso();
  const port=Number(input.apiPort||(proof.transport==="rest-https"?443:8729));
  const host=String(input.host).toLowerCase();
  const method=proof.route==="vpn"?"vpn":"api";
  const secret=encryptSecret(JSON.stringify({
    password:input.password,caPem:input.caPem||null,serverName:input.serverName||null,
    transport:proof.transport
  }),this.config.encryptionKey);
  // Saving the observed identity and credentials is atomic with expiring stale
  // copies of the same endpoint. No other customer's row can be touched.
  await this.db.transaction(async tx=>{
   await lockDeviceEndpoint(tx,context.tenantId,before.site_id,host,port);
   // A TLS probe can take seconds. Do not overwrite an edit or another
   // successful registration that arrived while this handshake was running.
   const applied=await tx.run("UPDATE network_devices SET host=?,api_port=?,username=?,secret_ciphertext=?,connection_method=?,status='online',last_seen_at=?,updated_at=? WHERE id=? AND tenant_id=? AND updated_at=?",
     [host,port,input.username,secret,method,now,now,deviceId,context.tenantId,before.updated_at]);
   if(applied.changes!==1)throw new AppError(409,"CONFLICT","تغير سجل الراوتر أثناء الفحص؛ أعد المحاولة دون إرسال كلمة المرور إلى Telegram.");
   await tx.run(
     "UPDATE network_devices SET status='pending',last_seen_at=NULL,updated_at=? "+
     "WHERE tenant_id=? AND id<>? AND LOWER(host)=LOWER(?) AND api_port=? "+
     "AND ((site_id IS NULL AND ? IS NULL) OR site_id=?)",
    [now,context.tenantId,deviceId,host,port,before.site_id??null,before.site_id??null]);
   await writeAudit(tx,context,{action:"device.direct-connect",entityType:"network_device",entityId:deviceId,
     reason:input.reason,
     before:{host:before.host,apiPort:before.api_port,connectionMethod:before.connection_method},
     after:{host,apiPort:port,connectionMethod:method,transport:proof.transport,verifiedIdentity:proof.identity,verifiedAt:now,
       usernameConfigured:!!input.username,credentialsConfigured:true}});
  });
  return {id:deviceId,identity:proof.identity,host,apiPort:port,
    transport:proof.transport,connectionMethod:method,status:"online",verifiedAt:now,credentialsConfigured:true};
 }
 async verify(context,deviceId){
  requireWrite(context,PERMISSIONS.DEVICE_WRITE);
  if(!["owner","admin"].includes(context.role))throw forbidden();
  const before=await this.db.get(
   "SELECT id,site_id,host,api_port,username,secret_ciphertext,connection_method FROM network_devices WHERE tenant_id=? AND id=?",
   [context.tenantId,deviceId]);
  if(!before)throw notFound("سجل الراوتر غير موجود");
  if(!["api","vpn"].includes(before.connection_method)||!before.secret_ciphertext||!before.username)
    throw validationError("اربط الجهاز مباشرةً أولاً وأكمل حقول الحساب.");
  let saved;
  try{saved=JSON.parse(decryptSecret(before.secret_ciphertext,this.config.encryptionKey))}
  catch{throw validationError("صيغة بيانات الاتصال قديمة؛ أعد الربط المباشر بأمان.");}
  if(!saved.password)throw validationError("بيانات دخول الراوتر غير مكتملة");
  const input={host:before.host,apiPort:Number(before.api_port),
    username:before.username,password:saved.password,caPem:saved.caPem,serverName:saved.serverName,
    transport:saved.transport||"api-ssl"};
  try{
   const proof=await checkDirectRouter(input,this.config,{
     dnsLookup:this.config.directRouterDnsLookup,clientFactory:this.config.directRouterClientFactory,
     restProbe:this.config.directRouterRestProbe
   });
   const now=nowIso();
   await this.db.transaction(async tx=>{
    await lockDeviceEndpoint(tx,context.tenantId,before.site_id,before.host,before.api_port);
    // A username edit with the same saved password is still a different
    // management identity. Do not re-mark that unverified account online.
    const updated=await tx.run("UPDATE network_devices SET status='online',last_seen_at=?,updated_at=? WHERE id=? AND tenant_id=? AND secret_ciphertext=? AND host=? AND api_port=? AND username=?",
      [now,now,deviceId,context.tenantId,before.secret_ciphertext,before.host,before.api_port,before.username]);
    if(updated.changes!==1)throw new AppError(409,"CONFLICT","تغير إعداد الراوتر خلال الفحص؛ أعد المحاولة.");
    await tx.run("UPDATE network_devices SET status='pending',last_seen_at=NULL,updated_at=? WHERE tenant_id=? AND id<>? AND LOWER(host)=LOWER(?) AND api_port=? AND ((site_id IS NULL AND ? IS NULL) OR site_id=?)",
      [now,context.tenantId,deviceId,before.host,before.api_port,before.site_id??null,before.site_id??null]);
   });
   return {id:deviceId,identity:proof.identity,status:"online",verifiedAt:now};
  }catch(error){
   if(error.code!=="CONFLICT")await this.db.run("UPDATE network_devices SET status='error',last_seen_at=NULL,updated_at=? WHERE id=? AND tenant_id=? AND secret_ciphertext=? AND host=? AND api_port=? AND username=?",
    [nowIso(),deviceId,context.tenantId,before.secret_ciphertext,before.host,before.api_port,before.username]);
   throw error;
  }
 }
}
