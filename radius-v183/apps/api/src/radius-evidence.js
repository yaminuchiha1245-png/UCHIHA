/* Read-only evidence from signed connector auth/accounting ingestion.
 * A matching event proves delivery to UCHIHA, not working Internet access. */
import {PERMISSIONS} from "@uchiha-radius/contracts";
import {requirePermission} from "./guards.js";
import {notFound} from "./errors.js";
const number=v=>Number(v??0)||0;
const stamp=v=>v instanceof Date?v.toISOString():typeof v==="string"?v:null;
export class RadiusEvidenceService {
 constructor({db}){this.db=db}
 async inspect(context,deviceId=null,{now=Date.now()}={}){
  requirePermission(context,PERMISSIONS.INTEGRATION_READ);
  const since=new Date(now-24*60*60*1000).toISOString();
  const tenant=context.tenantId;
  const countAuth=async(device=null,host=null)=>this.db.get(
   "SELECT COUNT(*) AS total,"+
   "SUM(CASE WHEN result='accept' THEN 1 ELSE 0 END) AS accepted,"+
   "SUM(CASE WHEN result='reject' THEN 1 ELSE 0 END) AS rejected,"+
   "MAX(CASE WHEN result='accept' THEN occurred_at ELSE NULL END) AS last_accepted_at "+
   "FROM radius_auth_events WHERE tenant_id=? AND received_at>=?"+
   (device?" AND device_id=? AND nas_ip=?":""),
   device?[tenant,since,device,host]:[tenant,since]);
  const countAccounting=async(device=null,host=null)=>this.db.get(
   "SELECT COUNT(*) AS total,"+
   "SUM(CASE WHEN status_type='start' THEN 1 ELSE 0 END) AS starts,"+
   "MAX(CASE WHEN status_type='start' THEN occurred_at ELSE NULL END) AS last_start_at "+
   "FROM radius_accounting_events WHERE tenant_id=? AND received_at>=?"+
   (device?" AND device_id=? AND nas_ip=?":""),
   device?[tenant,since,device,host]:[tenant,since]);
  const [tenantAuth,tenantAccounting]=await Promise.all([countAuth(),countAccounting()]);
  const map=(auth,accounting)=>({
   authenticationRequests:number(auth?.total),
   accepted:number(auth?.accepted),
   rejected:number(auth?.rejected),
   accountingEvents:number(accounting?.total),
   accountingStarts:number(accounting?.starts),
   lastAcceptedAt:stamp(auth?.last_accepted_at),
   lastAccountingStartAt:stamp(accounting?.last_start_at),
   // These counts may describe different subscribers; never infer an end-to-end session.
   separateAcceptanceAndStartObserved:number(auth?.accepted)>0&&number(accounting?.starts)>0
  });
  const response={
   windowHours:24,source:"signed-radius-connector",deviceId:deviceId||null,
   tenantEvents:map(tenantAuth,tenantAccounting),deviceEvents:null,
   duplicateRegistrations:null,attribution:deviceId?"not_evaluated":"tenant_only",
   // Attributing auth to NAS does not itself verify a completed PPPoE
   // session, an active client, or access to the Internet.
   subscriberAaaVerified:false,internetConnectivityVerified:false
  };
  if(!deviceId)return response;
  const device=await this.db.get(
   "SELECT id,host,site_id FROM network_devices WHERE tenant_id=? AND id=?",
   [tenant,deviceId]);
  if(!device)throw notFound("لا يوجد هذا الراوتر ضمن شبكتك");
  const duplicates=await this.db.get(
   "SELECT COUNT(*) AS total FROM network_devices WHERE tenant_id=? AND host=?",
   [tenant,device.host]);
  response.duplicateRegistrations=number(duplicates.total);
  if(response.duplicateRegistrations!==1){
   response.attribution="ambiguous_duplicate_registration";
   return response;
  }
  // Avoid attributing historical NAS events of one duplicate to another:
  // duplicates must be resolved before a selected row is trusted.
  const [deviceAuth,deviceAccounting]=await Promise.all([
   countAuth(device.id,device.host),countAccounting(device.id,device.host)
  ]);
  response.deviceEvents=map(deviceAuth,deviceAccounting);
  response.attribution="unique_registered_endpoint";
  return response;
 }
}
