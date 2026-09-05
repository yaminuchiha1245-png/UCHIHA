const crypto=require("node:crypto");
const REQUIRED_ARRAYS=["users","orders","transactions","products","categories","topups"];

function validateDatabaseShape(db){
  if(!db||typeof db!=="object"||Array.isArray(db))return {ok:false,reason:"backup_db_not_object"};
  if(!db.settings||typeof db.settings!=="object"||Array.isArray(db.settings))return {ok:false,reason:"backup_settings_missing"};
  for(const key of REQUIRED_ARRAYS){
    if(!Array.isArray(db[key]))return {ok:false,reason:`backup_collection_missing:${key}`};
  }
  return {ok:true};
}

function stableValue(value){
  if(Array.isArray(value))return value.map(stableValue);
  if(value&&typeof value==="object"){
    const out={};
    for(const k of Object.keys(value).sort())out[k]=stableValue(value[k]);
    return out;
  }
  return value;
}
function stableStringify(value){return JSON.stringify(stableValue(value));}
function dataSha256(db){return crypto.createHash("sha256").update(stableStringify(db)).digest("hex");}

function makeBackup(db,{version="unknown",createdAt=new Date().toISOString()}={}){
  const valid=validateDatabaseShape(db);
  if(!valid.ok)throw new Error(valid.reason);
  return {
    format:"game-zone-backup",
    version,
    createdAt,
    integrity:{algorithm:"sha256",dataSha256:dataSha256(db)},
    data:db
  };
}

function parseBackup(payload){
  let db,meta={legacy:false,version:null,createdAt:null,integrityVerified:false,integrityPresent:false};
  if(payload&&payload.format==="game-zone-backup"&&payload.data){
    db=payload.data;
    meta.version=payload.version||null;
    meta.createdAt=payload.createdAt||null;
    if(payload.integrity?.dataSha256){
      meta.integrityPresent=true;
      const actual=dataSha256(db);
      if(actual!==String(payload.integrity.dataSha256))throw new Error("backup_integrity_hash_mismatch");
      meta.integrityVerified=true;
    }
  }else{
    db=payload;
    meta.legacy=true;
  }
  const valid=validateDatabaseShape(db);
  if(!valid.ok)throw new Error(valid.reason);
  return {db,meta};
}

module.exports={REQUIRED_ARRAYS,validateDatabaseShape,stableStringify,dataSha256,makeBackup,parseBackup};
