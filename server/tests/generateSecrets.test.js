const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");

const script=path.join(__dirname,"..","..","deploy","generate-secrets.js");

function parseEnv(file){
  const out={};
  for(const raw of fs.readFileSync(file,"utf8").split(/\r?\n/)){
    if(!raw||raw.trim().startsWith("#"))continue;
    const i=raw.indexOf("=");if(i<1)continue;
    out[raw.slice(0,i)]=raw.slice(i+1);
  }
  return out;
}

test("secret generator creates strong distinct app secrets without printing values",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gz-secrets-")),out=path.join(dir,"prod.env");
  const r=spawnSync(process.execPath,[script,"--domain","gamezone.test.invalid","--out",out],{encoding:"utf8"});
  assert.equal(r.status,0,r.stderr||r.stdout);
  const env=parseEnv(out);
  assert.equal(env.DOMAIN,"gamezone.test.invalid");
  assert.equal(env.PUBLIC_BASE_URL,"https://gamezone.test.invalid");
  assert.equal(Buffer.from(env.INVENTORY_ENCRYPTION_KEY,"base64").length,32);
  assert.equal(Buffer.from(env.BACKUP_ENCRYPTION_KEY,"base64").length,32);
  assert.notEqual(env.INVENTORY_ENCRYPTION_KEY,env.BACKUP_ENCRYPTION_KEY);
  const values=["INTERNAL_BOT_SECRET","INTERNAL_BOT_ADMIN_SECRET","ADMIN_SESSION_SECRET","USER_SESSION_SECRET","PROVIDER_WEBHOOK_SECRET","PAYMENT_WEBHOOK_SECRET","AUDIT_HMAC_KEY","STATE_HMAC_KEY","FINANCIAL_JOURNAL_HMAC_KEY","WALLET_AUTHORITY_HMAC_KEY","BUSINESS_AUTHORITY_HMAC_KEY"].map(k=>env[k]);
  assert.equal(new Set(values).size,values.length);
  for(const value of values)assert.ok(value.length>=32);
  const sensitive=["POSTGRES_PASSWORD","INTERNAL_BOT_SECRET","INTERNAL_BOT_ADMIN_SECRET","ADMIN_PASSWORD","ADMIN_SESSION_SECRET","USER_SESSION_SECRET","INVENTORY_ENCRYPTION_KEY","BACKUP_ENCRYPTION_KEY","PROVIDER_WEBHOOK_SECRET","PAYMENT_WEBHOOK_SECRET","AUDIT_HMAC_KEY","STATE_HMAC_KEY","FINANCIAL_JOURNAL_HMAC_KEY","WALLET_AUTHORITY_HMAC_KEY","BUSINESS_AUTHORITY_HMAC_KEY"];
  for(const key of sensitive)assert.equal(r.stdout.includes(env[key]),false,`${key} leaked to stdout`);
});

test("secret generator refuses to overwrite an existing output without force",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gz-secrets-existing-")),out=path.join(dir,"prod.env");
  fs.writeFileSync(out,"existing=true");
  const r=spawnSync(process.execPath,[script,"--out",out],{encoding:"utf8"});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/output_exists/);
  assert.equal(fs.readFileSync(out,"utf8"),"existing=true");
});
