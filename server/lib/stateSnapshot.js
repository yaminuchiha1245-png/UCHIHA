const crypto=require("node:crypto");
const {dataSha256,stableStringify}=require("./backupFormat");

function normalizeRevision(value,fallback=1){
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=1?n:fallback;
}
function snapshotHash(data){
  return dataSha256(data);
}
function snapshotHmac(data,key){
  const secret=String(key||"");
  if(!secret)return null;
  return crypto.createHmac("sha256",secret).update(stableStringify(data)).digest("hex");
}
function verifySnapshotRecord({data,dataSha256:expected,dataHmac:expectedHmac,hmacKey="",requireHmac=false}={}){
  if(!data||typeof data!=="object"||Array.isArray(data))return {ok:false,reason:"state_data_invalid",actual:null};
  const actual=snapshotHash(data);
  if(expected&&String(expected)!==actual)return {ok:false,reason:"state_hash_mismatch",actual,expected:String(expected)};

  const actualHmac=snapshotHmac(data,hmacKey);
  if(actualHmac&&expectedHmac&&String(expectedHmac)!==actualHmac){
    return {ok:false,reason:"state_hmac_mismatch",actual,expected:String(expected),actualHmac,expectedHmac:String(expectedHmac)};
  }
  if(requireHmac&&hmacKey&&!expectedHmac){
    return {ok:false,reason:"state_hmac_missing",actual,actualHmac};
  }
  return {
    ok:true,reason:null,actual,expected:expected?String(expected):null,
    actualHmac,expectedHmac:expectedHmac?String(expectedHmac):null,
    hmacMissing:!!hmacKey&&!expectedHmac
  };
}
function nextRevision(value){
  const current=normalizeRevision(value,1);
  if(current>=Number.MAX_SAFE_INTEGER-1)throw new Error("state_revision_exhausted");
  return current+1;
}
function boundedHistoryLimit(value,def=200){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(5,Math.min(5000,Math.trunc(n))):def;
}
function boundedHistoryDays(value,def=90){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(1,Math.min(3650,Math.trunc(n))):def;
}
function boundedHistoryIntervalSeconds(value,def=300){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(30,Math.min(86400,Math.trunc(n))):def;
}

module.exports={
  normalizeRevision,snapshotHash,snapshotHmac,verifySnapshotRecord,nextRevision,
  boundedHistoryLimit,boundedHistoryDays,boundedHistoryIntervalSeconds
};
