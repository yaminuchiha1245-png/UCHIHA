const STATUSES=new Set(["pending","verified","rejected"]);
function sanitizeDecision(body={}){
  const status=String(body.status||"").trim();
  if(!["verified","rejected"].includes(status))throw new Error("invalid_verification_status");
  let rejectionReason=null;
  if(status==="rejected"){
    rejectionReason=String(body.rejectionReason||"").trim().replace(/\s+/g," ");
    if(rejectionReason.length>500)throw new Error("verification_reason_too_long");
  }
  return {status,rejectionReason:rejectionReason||null};
}
function publicVerification(row,{admin=false}={}){
  if(!row)return {status:"none"};
  const out={id:row.id,status:STATUSES.has(row.status)?row.status:"pending",createdAt:row.createdAt,updatedAt:row.updatedAt||row.createdAt,reviewedAt:row.reviewedAt||null,rejectionReason:row.rejectionReason||null};
  if(admin)out.telegramId=String(row.telegramId||"");
  return out;
}
module.exports={STATUSES,sanitizeDecision,publicVerification};
