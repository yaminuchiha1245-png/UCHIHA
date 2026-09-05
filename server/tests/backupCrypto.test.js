const test=require("node:test");
const assert=require("node:assert/strict");
const {makeBackup}=require("../lib/backupFormat");
const {decodeBackupKey,encryptBackupPayload,decryptBackupPayload,encodeBackupFile,decodeBackupFile}=require("../lib/backupCrypto");

const key=Buffer.alloc(32,9).toString("base64");
const db={settings:{storeName:"Game Zone"},users:[],orders:[],transactions:[],products:[],categories:[],topups:[]};

test("backup encryption key requires exactly 32 decoded bytes",()=>{
  assert.equal(decodeBackupKey(key).length,32);
  assert.equal(decodeBackupKey("short"),null);
});

test("encrypted backup round-trips and still verifies inner SHA-256",()=>{
  const backup=makeBackup(db,{version:"1.0.0-rc.9"});
  const envelope=encryptBackupPayload(backup,key);
  assert.equal(envelope.format,"game-zone-encrypted-backup");
  assert.equal("data" in envelope,false);
  const clear=decryptBackupPayload(envelope,key);
  assert.equal(clear.version,"1.0.0-rc.9");
  const parsed=decodeBackupFile(envelope,{rawKey:key});
  assert.equal(parsed.meta.encrypted,true);
  assert.equal(parsed.meta.integrityVerified,true);
  assert.equal(parsed.db.settings.storeName,"Game Zone");
});

test("wrong backup encryption key or modified ciphertext is rejected",()=>{
  const envelope=encryptBackupPayload(makeBackup(db),key);
  const wrong=Buffer.alloc(32,7).toString("base64");
  assert.throws(()=>decryptBackupPayload(envelope,wrong),/encrypted_backup_authentication_failed/);
  envelope.ciphertext=envelope.ciphertext.slice(0,-4)+"AAAA";
  assert.throws(()=>decryptBackupPayload(envelope,key),/encrypted_backup_authentication_failed/);
});

test("unencrypted legacy standardized files remain supported",()=>{
  const backup=makeBackup(db);
  const parsed=decodeBackupFile(encodeBackupFile(backup,{encrypt:false}),{rawKey:key});
  assert.equal(parsed.meta.encrypted,false);
  assert.equal(parsed.meta.integrityVerified,true);
});
