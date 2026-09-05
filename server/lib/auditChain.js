const crypto=require("node:crypto");
const {stableStringify}=require("./backupFormat");

function auditMaterial(entry){
  return {
    id:entry.id,
    action:entry.action,
    meta:entry.meta||{},
    ip:entry.ip||"",
    requestId:entry.requestId||undefined,
    createdAt:entry.createdAt
  };
}
function hashAudit(prevHash,entry,secretOverride=undefined){
  const material=`${String(prevHash||"GENESIS")}\n${stableStringify(auditMaterial(entry))}`;
  const secret=String(secretOverride===undefined?process.env.AUDIT_HMAC_KEY||"":secretOverride||"");
  return secret
    ? crypto.createHmac("sha256",secret).update(material).digest("hex")
    : crypto.createHash("sha256").update(material).digest("hex");
}
function appendAuditEntry(list,entry){
  const rows=Array.isArray(list)?list:[];
  const prevHash=rows[0]?.hash||"GENESIS";
  const next={...entry,prevHash,hash:hashAudit(prevHash,entry)};
  rows.unshift(next);
  return next;
}
function backfillAuditChain(list,{secret=undefined}={}){
  const rows=Array.isArray(list)?list:[];
  let prevHash="GENESIS",changed=false;
  for(let i=rows.length-1;i>=0;i--){
    const row=rows[i],expected=hashAudit(prevHash,row,secret);
    if(row.prevHash!==prevHash||row.hash!==expected){
      row.prevHash=prevHash;row.hash=expected;changed=true;
    }
    prevHash=row.hash;
  }
  return {changed,count:rows.length};
}
function verifyAuditChain(list,{secret=undefined}={}){
  const rows=Array.isArray(list)?list:[];
  if(!rows.length)return {ok:true,count:0,brokenAt:null};
  for(let i=rows.length-1;i>=0;i--){
    const row=rows[i];
    const prev=i===rows.length-1?(row.prevHash||"GENESIS"):rows[i+1].hash;
    if(i!==rows.length-1&&row.prevHash!==prev)return {ok:false,count:rows.length,brokenAt:row.id||i,reason:"prev_hash_mismatch"};
    if(!row.hash||hashAudit(row.prevHash||"GENESIS",row,secret)!==row.hash)return {ok:false,count:rows.length,brokenAt:row.id||i,reason:"hash_mismatch"};
  }
  return {ok:true,count:rows.length,brokenAt:null};
}
module.exports={auditMaterial,hashAudit,appendAuditEntry,backfillAuditChain,verifyAuditChain};
