const crypto=require("node:crypto");
const {parseBackup}=require("./backupFormat");

function decodeBackupKey(raw=process.env.BACKUP_ENCRYPTION_KEY||""){
  const value=String(raw||"").trim();
  if(!value)return null;
  try{
    const b=Buffer.from(value,"base64");
    if(b.length===32)return b;
  }catch{}
  if(/^[a-f0-9]{64}$/i.test(value)){
    const b=Buffer.from(value,"hex");
    if(b.length===32)return b;
  }
  return null;
}

function encryptBackupPayload(backup,rawKey=process.env.BACKUP_ENCRYPTION_KEY||""){
  const key=decodeBackupKey(rawKey);
  if(!key)throw new Error("backup_encryption_key_invalid");
  const iv=crypto.randomBytes(12);
  const plaintext=Buffer.from(JSON.stringify(backup),"utf8");
  const cipher=crypto.createCipheriv("aes-256-gcm",key,iv);
  const aad=Buffer.from("game-zone-encrypted-backup:v1","utf8");
  cipher.setAAD(aad);
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  const tag=cipher.getAuthTag();
  return {
    format:"game-zone-encrypted-backup",
    envelopeVersion:1,
    algorithm:"aes-256-gcm",
    createdAt:new Date().toISOString(),
    backupVersion:backup?.version||null,
    iv:iv.toString("base64"),
    tag:tag.toString("base64"),
    ciphertext:ciphertext.toString("base64")
  };
}

function decryptBackupPayload(payload,rawKey=process.env.BACKUP_ENCRYPTION_KEY||""){
  if(!payload||payload.format!=="game-zone-encrypted-backup")throw new Error("encrypted_backup_format_invalid");
  if(Number(payload.envelopeVersion)!==1||payload.algorithm!=="aes-256-gcm")throw new Error("encrypted_backup_version_unsupported");
  const key=decodeBackupKey(rawKey);
  if(!key)throw new Error("backup_encryption_key_invalid");
  try{
    const decipher=crypto.createDecipheriv("aes-256-gcm",key,Buffer.from(String(payload.iv||""),"base64"));
    decipher.setAAD(Buffer.from("game-zone-encrypted-backup:v1","utf8"));
    decipher.setAuthTag(Buffer.from(String(payload.tag||""),"base64"));
    const clear=Buffer.concat([
      decipher.update(Buffer.from(String(payload.ciphertext||""),"base64")),
      decipher.final()
    ]).toString("utf8");
    return JSON.parse(clear);
  }catch(e){
    if(e?.message==="backup_encryption_key_invalid")throw e;
    throw new Error("encrypted_backup_authentication_failed");
  }
}

function encodeBackupFile(backup,{rawKey=process.env.BACKUP_ENCRYPTION_KEY||"",encrypt=!!rawKey}={}){
  return encrypt?encryptBackupPayload(backup,rawKey):backup;
}

function decodeBackupFile(payload,{rawKey=process.env.BACKUP_ENCRYPTION_KEY||""}={}){
  const encrypted=payload?.format==="game-zone-encrypted-backup";
  const decoded=encrypted?decryptBackupPayload(payload,rawKey):payload;
  const parsed=parseBackup(decoded);
  return {...parsed,meta:{...parsed.meta,encrypted}};
}

module.exports={decodeBackupKey,encryptBackupPayload,decryptBackupPayload,encodeBackupFile,decodeBackupFile};
