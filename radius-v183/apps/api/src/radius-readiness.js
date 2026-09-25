/* Read-only MikroTik subscriber AAA readiness report.
 * A successful management connection does not prove PPPoE or Hotspot works.
 * Never return a RADIUS shared secret, RouterOS password, or raw RouterOS row. */
import { PERMISSIONS } from "@uchiha-radius/contracts";
import { RouterOsApi, routerProbeErrorCode } from "../../radius-agent/src/routeros.js";
import { decryptSecret } from "./security.js";
import { routerRestRead } from "./direct-rest.js";
import { resolveAuthorizedRouter } from "./direct-router.js";
import { requireWrite } from "./guards.js";
import { forbidden, notFound, validationError, AppError } from "./errors.js";

const yes=value=>["yes","true","1"].includes(String(value??"").toLowerCase());
const safeText=(value,max=120)=>typeof value==="string"?value.slice(0,max):"";
const rows=value=>Array.isArray(value)?value:value&&typeof value==="object"?[value]:[];
const permittedServices=new Set(["ppp","hotspot","login","wireless","dhcp","dot1x","ipsec"]);
export function summarizeRadiusReadiness({identity,radiusRows,pppRows,hotspotRows,aaaServerReady=false,transport}){
 const servers=radiusRows===null?null:rows(radiusRows).slice(0,40).map(row=>{
  const services=String(row.service??"").toLowerCase().split(",").map(x=>x.trim())
   .filter(x=>permittedServices.has(x));
  return {
   address:safeText(row.address,100),services,enabled:!yes(row.disabled),
   authenticationPort:Number(row["authentication-port"]||1812),
   accountingPort:Number(row["accounting-port"]||1813),
   protocol:safeText(row.protocol,20)||"udp"
  };
 });
 const pppUseRadius=pppRows===null?null:rows(pppRows).some(row=>yes(row["use-radius"]));
 const hotspotProfiles=hotspotRows===null?null:rows(hotspotRows);
 const hotspotUseRadius=hotspotProfiles===null?null:hotspotProfiles.some(row=>yes(row["use-radius"]));
 const activeServers=servers?.filter(server=>server.enabled)??null;
 const issues=[];
 if(!aaaServerReady)issues.push("AAA_SERVER_NOT_ENABLED");
 if(servers===null)issues.push("ROUTER_RADIUS_SETTINGS_UNAVAILABLE");
 else if(!activeServers?.length)issues.push("ROUTER_RADIUS_SERVER_NOT_CONFIGURED");
 if(pppUseRadius===null)issues.push("PPPOE_SETTINGS_UNAVAILABLE");
 else if(!pppUseRadius)issues.push("PPPOE_RADIUS_DISABLED");
 if(hotspotUseRadius===null)issues.push("HOTSPOT_SETTINGS_UNAVAILABLE");
 else if(!hotspotUseRadius)issues.push("HOTSPOT_RADIUS_DISABLED");
 const anyRadiusProfile=Boolean(pppUseRadius||hotspotUseRadius);
 const relevant=Boolean(activeServers?.some(server=>server.services.includes("ppp")&&pppUseRadius||
  server.services.includes("hotspot")&&hotspotUseRadius));
 if(activeServers?.length && anyRadiusProfile && !relevant)
  issues.push("ROUTER_RADIUS_SERVICE_MISMATCH");
 return {
  routerIdentity:safeText(identity,100),managementVerified:true,
  transport,checkedAt:new Date().toISOString(),
  aaaServerConfigured:!!aaaServerReady,
  // Even a matching config does NOT prove real NAS RADIUS packets arrived.
  aaaEndToEndVerified:false,
  radiusServers:servers,
  pppoe:{useRadius:pppUseRadius},
  hotspot:{useRadius:hotspotUseRadius,profilesChecked:hotspotProfiles?.length??null},
  configurationLooksReady:!!aaaServerReady&&!!relevant,
  issues
 };
}
const safeError=error=>{
 const code=routerProbeErrorCode(error);
 return new AppError(422,"ROUTER_AAA_READ_FAILED",{
  "API_SSL_UNAVAILABLE":"تعذر الوصول إلى منفذ إدارة MikroTik المشفّر.",
  "CONNECT_TIMEOUT":"انتهت مهلة الاتصال؛ تحقق من الشبكة أو VPN.",
  "TLS_CERTIFICATE_FAILED":"شهادة RouterOS غير موثوقة أو لا تطابق الاسم.",
  "ROUTEROS_LOGIN_OR_PERMISSION":"حساب RouterOS لا يملك صلاحية قراءة إعدادات RADIUS.",
  "NO_NETWORK_ROUTE":"لا يوجد مسار معتمد إلى شبكة الراوتر."
 }[code]||"تعذر فحص إعدادات RADIUS على الراوتر.");
};
export class RadiusReadinessService {
 constructor({db,config}){this.db=db;this.config=config}
 async inspect(context,deviceId){
  requireWrite(context,PERMISSIONS.DEVICE_WRITE);
  if(!["owner","admin"].includes(context.role))throw forbidden();
  const device=await this.db.get("SELECT id,host,api_port,username,secret_ciphertext,connection_method "+
    "FROM network_devices WHERE id=? AND tenant_id=?",[deviceId,context.tenantId]);
  if(!device)throw notFound("الراوتر غير موجود ضمن شبكتك");
  if(!["api","vpn"].includes(device.connection_method)||!device.secret_ciphertext)
   throw validationError("اربط الراوتر أولًا عبر API-SSL أو REST-HTTPS لتفعيل فحص إعدادات RADIUS.");
  let secret;
  try{secret=JSON.parse(decryptSecret(device.secret_ciphertext,this.config.encryptionKey))}
  catch{throw validationError("بيانات إدارة الراوتر غير مكتملة؛ أعد الربط المشفّر.");}
  if(!secret.password)throw validationError("بيانات الإدارة ناقصة؛ أعد الربط.");
  const transport=secret.transport==="rest-https"?"rest-https":"api-ssl";
  const input={
   host:device.host,apiPort:Number(device.api_port),username:device.username,
   password:secret.password,caPem:secret.caPem||null,serverName:secret.serverName||null,
   transport
  };
  const destination=await resolveAuthorizedRouter(input,this.config,{
   dnsLookup:this.config.directRouterDnsLookup
  });
  const options={
   host:destination.address,port:input.apiPort,username:input.username,
   password:input.password,caPem:input.caPem,
   serverName:destination.certificateHost,timeoutMs:6500
  };
  let identity,settings,ppp,hotspot;
  if(transport==="rest-https"){
   const reader=this.config.radiusReadinessRestReader??routerRestRead;
   const read=async path=>{
    try{return await reader({...options,path})}
    catch{return null}
   };
   try{
    const result=await reader({...options,path:"/rest/system/identity"});
    identity=rows(result)[0]?.name;
    if(typeof identity!=="string"||!identity.trim())
     throw new Error("RouterOS identity not returned");
   }catch(error){throw safeError(error)}
   [settings,ppp,hotspot]=await Promise.all([
    read("/rest/radius"),read("/rest/ppp/aaa"),read("/rest/ip/hotspot/profile")
   ]);
  }else{
   const factory=this.config.radiusReadinessClientFactory??(args=>new RouterOsApi(args));
   const client=factory(options);
   try{
    await client.connect();
    const result=await client.talk(["/system/identity/print","=.proplist=name"]);
    identity=rows(result)[0]?.name;
    if(typeof identity!=="string"||!identity.trim())
     throw new Error("RouterOS identity not returned");
    const read=async command=>{
     try{return await client.talk(command)}
     catch{return null}
    };
    // Limit requested properties; do not read the RADIUS shared secret.
    // RouterOsApi.talk owns one reply stream; requests MUST be sequential.
    settings=await read(["/radius/print","=.proplist=address,service,disabled,authentication-port,accounting-port,protocol"]);
    ppp=await read(["/ppp/aaa/print","=.proplist=use-radius"]);
    hotspot=await read(["/ip/hotspot/profile/print","=.proplist=use-radius"]);
   }catch(error){throw safeError(error)}
   finally{client.close()}
  }
  return {deviceId,...summarizeRadiusReadiness({
   identity,radiusRows:settings,pppRows:ppp,hotspotRows:hotspot,
   aaaServerReady:this.config.radiusUdpReady,transport
  })};
 }
}
