/* Authorized, TLS-verified RouterOS management from the central API.
 * This never reaches loopback, metadata services or a private target unless
 * the operator has explicitly approved the target's VPN CIDR. */
import { lookup as systemLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import tls from "node:tls";
import { AppError, validationError } from "./errors.js";
import { RouterOsApi, routerProbeErrorCode } from "../../radius-agent/src/routeros.js";
import { routerRestIdentity } from "./direct-rest.js";

const blocked = new BlockList();
for (const [addr,bits] of [
 ["0.0.0.0",8],["127.0.0.0",8],["169.254.0.0",16],
 ["224.0.0.0",4],["240.0.0.0",4],["100.64.0.0",10],
 ["192.0.0.0",24],["192.0.2.0",24],["198.18.0.0",15],
 ["198.51.100.0",24],["203.0.113.0",24]
]) blocked.addSubnet(addr,bits,"ipv4");
const privateRanges=new BlockList();
for(const [addr,bits] of [
 ["10.0.0.0",8],["172.16.0.0",12],["192.168.0.0",16]
]) privateRanges.addSubnet(addr,bits,"ipv4");
const msg={
 ROUTER_ROUTE_NOT_CONFIGURED:"الربط المباشر غير مفعّل على الخادم. يلزم مسار VPN معتمد أو Site Agent محلي.",
 ROUTER_NETWORK_NOT_APPROVED:"العنوان خارج الشبكات المصرّح بربطها. لا تفتح منفذ الراوتر للإنترنت؛ استخدم VPN أو Site Agent.",
 ROUTER_DNS_UNAVAILABLE:"تعذر تحديد عنوان الراوتر؛ راجع اسم المضيف أو إعداد DNS.",
 ROUTER_API_SSL_UNAVAILABLE:"منفذ API-SSL لا يستجيب. تحقق من عنوان الإدارة ومن تفعيل المنفذ المشفّر.",
 ROUTER_TLS_CERTIFICATE_FAILED:"شهادة الراوتر غير موثوقة أو لا تطابق اسمه. ثبت شهادة CA الصحيحة دون تعطيل التحقق.",
 ROUTER_CONNECT_TIMEOUT:"لم يستجب الراوتر ضمن المهلة. تحقق من عنوانه والمنفذ وجدار الحماية أو مسار VPN.",
 ROUTER_NO_ROUTE:"لا يوجد مسار شبكة معتمد من الخادم إلى عنوان الراوتر. استخدم VPN أو Site Agent داخل شبكة المزود.",
 ROUTER_TLS_HANDSHAKE_FAILED:"المنفذ لا يقدم API-SSL صحيحًا أو أغلق اتصال TLS. تحقق من تفعيل الخدمة والمنفذ على MikroTik.",
 ROUTER_LOGIN_FAILED:"فشل تسجيل الدخول أو لا تسمح صلاحيات الحساب بقراءة هوية RouterOS.",
 ROUTER_REST_UNAVAILABLE:"خدمة REST عبر HTTPS غير متاحة على هذا الراوتر. تتطلب RouterOS v7 وتفعيل www-ssl؛ جرّب API-SSL بدلًا منها.",
 ROUTER_PROBE_FAILED:"تعذر إثبات الاتصال الفعلي بجهاز MikroTik؛ افحص عنوان الإدارة والاتصال المحلي."
};
function issue(code,status=422){return new AppError(status,code,msg[code]);}
function approvedV4(address,config){
 if(isIP(address)!==4 || blocked.check(address,"ipv4"))return false;
 const approved=new BlockList();
 for(const cidr of config.directRouterAllowedCidrs??[]){
  const [ip,prefix]=String(cidr).split("/");
  if(isIP(ip)!==4 || !Number.isInteger(Number(prefix))||Number(prefix)<8||Number(prefix)>32)
   throw new Error("DIRECT_ROUTER_ALLOWED_CIDRS must use explicit IPv4 subnets /8 or narrower");
  approved.addSubnet(ip,Number(prefix),"ipv4");
 }
 if(approved.check(address,"ipv4"))return true;
 return !!config.directRouterAllowPublic && !privateRanges.check(address,"ipv4");
}
export async function resolveAuthorizedRouter(input,config,{dnsLookup=systemLookup}={}){
 if(!config.directRouterAllowPublic && !(config.directRouterAllowedCidrs?.length))
  throw issue("ROUTER_ROUTE_NOT_CONFIGURED",503);
 const address=String(input.host||"").trim();
 if(!/^[A-Za-z0-9.:-]{3,253}$/.test(address))throw validationError("عنوان الراوتر غير صالح");
 if(isIP(address)===6)throw issue("ROUTER_NETWORK_NOT_APPROVED");
 let ips;
 if(isIP(address))ips=[{address,family:isIP(address)}];
 else {
  try{ips=await dnsLookup(address,{all:true,verbatim:true})}
  catch{throw issue("ROUTER_DNS_UNAVAILABLE")}
 }
 if(!ips?.length || ips.some(record=>!approvedV4(record.address,config)))
  throw issue("ROUTER_NETWORK_NOT_APPROVED");
 return {address:ips[0].address,certificateHost:input.serverName||address};
}
const normalizeReason=error=>{
 if(error?.code==="ROUTER_REST_AUTH")return "ROUTER_LOGIN_FAILED";
 if(error?.code==="ROUTER_REST_NOT_FOUND")return "ROUTER_REST_UNAVAILABLE";
 switch(routerProbeErrorCode(error)){
  case "API_SSL_UNAVAILABLE":return "ROUTER_API_SSL_UNAVAILABLE";
  case "DNS_LOOKUP_FAILED":return "ROUTER_DNS_UNAVAILABLE";
  case "CONNECT_TIMEOUT":return "ROUTER_CONNECT_TIMEOUT";
  case "NO_NETWORK_ROUTE":return "ROUTER_NO_ROUTE";
  case "TLS_HANDSHAKE_FAILED":return "ROUTER_TLS_HANDSHAKE_FAILED";
  case "TLS_CERTIFICATE_FAILED":return "ROUTER_TLS_CERTIFICATE_FAILED";
  case "ROUTEROS_LOGIN_OR_PERMISSION":return "ROUTER_LOGIN_FAILED";
  default:return "ROUTER_PROBE_FAILED";
 }
};
export async function preflightDirectRouter(input,config,{dnsLookup,tlsProbe}={}){
 const dest=await resolveAuthorizedRouter(input,config,{dnsLookup});
 const port=Number(input.apiPort||(input.transport==="rest-https"?443:8729));
 if(!Number.isInteger(port)||(port<1024 && !(input.transport==="rest-https"&&port===443))||port>65535)
  throw validationError("اختر منفذًا مشفّرًا صالحًا (8729 للـAPI-SSL أو 443 للـREST)");
 if(input.caPem && (!input.caPem.includes("-----BEGIN CERTIFICATE-----")||
                    input.caPem.length>20_000))
  throw validationError("شهادة CA غير صالحة");
 const options={
  host:dest.address,port,
  ca:input.caPem||undefined,
  rejectUnauthorized:true,minVersion:"TLSv1.2",
  ...(!isIP(dest.certificateHost)?{servername:dest.certificateHost}:{}),
  checkServerIdentity:(_host,cert)=>tls.checkServerIdentity(dest.certificateHost,cert)
 };
 const probe=tlsProbe??(opts=>new Promise((resolve,reject)=>{
  const socket=tls.connect(opts);
  const finish=fn=>value=>{socket.destroy();fn(value)};
  socket.once("secureConnect",finish(resolve));
  socket.once("error",finish(reject));
  socket.setTimeout(6_500,()=>{
   const error=new Error("TLS probe timed out");error.code="ETIMEDOUT";
   socket.destroy(error);
  });
 }));
 try{
  await probe(options);
  return {
   transport:input.transport==="rest-https"?"rest-https":"api-ssl",
   tlsVerified:true,
   reachabilityVerified:true,
   loginVerified:false,
   routerIdentityVerified:false,
   route:privateRanges.check(dest.address,"ipv4")?"vpn":"api",
   port,checkedAt:new Date().toISOString()
  };
 }catch(error){throw issue(normalizeReason(error))}
}
export async function checkDirectRouter(input,config,{dnsLookup,clientFactory,restProbe}={}){
 const dest=await resolveAuthorizedRouter(input,config,{dnsLookup});
 const transport=input.transport==="rest-https"?"rest-https":"api-ssl";
 const port=Number(input.apiPort||(transport==="rest-https"?443:8729));
 if(!Number.isInteger(port)||(port<1024 && !(input.transport==="rest-https"&&port===443))||port>65535)
  throw validationError("اختر منفذ API-SSL المشفّر الصالح (عادة 8729)");
 if(!input.username||!input.password)throw validationError("يلزم حساب RouterOS للتجربة");
 if(input.caPem && (!input.caPem.includes("-----BEGIN CERTIFICATE-----")||
                   input.caPem.length>20_000))
  throw validationError("شهادة CA غير صالحة");
 const options={
  host:dest.address,port,username:input.username,password:input.password,
  caPem:input.caPem||null,serverName:dest.certificateHost,timeoutMs:6500
 };
 if(transport==="rest-https"){
  try{
   const checked=await (restProbe??routerRestIdentity)(options);
   if(!checked?.identity||typeof checked.identity!=="string")
    throw new Error("RouterOS identity not returned");
   return {identity:checked.identity.slice(0,100),checkedAt:new Date().toISOString(),
     transport,route:privateRanges.check(dest.address,"ipv4")?"vpn":"api"};
  }catch(error){throw issue(normalizeReason(error))}
 }
 const client=clientFactory?clientFactory(options):new RouterOsApi(options);
 try{
  await client.connect();
  const result=await client.talk(["/system/identity/print","=.proplist=name"]);
  const identity=result?.find(row=>typeof row.name==="string"&&row.name.trim())?.name;
  if(!identity)throw new Error("RouterOS identity not returned");
  return {identity:identity.slice(0,100),checkedAt:new Date().toISOString(),
    transport,route:privateRanges.check(dest.address,"ipv4")?"vpn":"api"};
 }catch(error){throw issue(normalizeReason(error))}
 finally{client.close()}
}
export function directRouterCapabilities(config){
 return {apiSsl:true,restHttps:true,publicEnabled:!!config.directRouterAllowPublic,
  vpnEnabled:!!config.directRouterAllowedCidrs?.length,
  ready:!!config.directRouterAllowPublic||!!config.directRouterAllowedCidrs?.length,
  securePortDefault:8729};
}
