const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");

const script=path.join(__dirname,"..","..","deploy","preflight.js");
function writeEnv(overrides={}){
  const values={
    DOMAIN:"gamezone.test.invalid",
    POSTGRES_PASSWORD:"postgres-password-123456",
    BOT_TOKEN:"123456:TEST-BOT-TOKEN-ABC",
    BOT_USERNAME:"GameZoneTestBot",
    INTERNAL_BOT_SECRET:"internal-bot-secret-aaaaaaaa",
    INTERNAL_BOT_ADMIN_SECRET:"bot-admin-secret-bbbbbbbbbbbbbbbb",
    ADMIN_PASSWORD:"admin-password-very-strong",
    ADMIN_SESSION_SECRET:"admin-session-cccccccccccc",
    USER_SESSION_SECRET:"user-session-ddddddddddddd",
    INVENTORY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString("base64"),
    BACKUP_ENCRYPTION_KEY:Buffer.alloc(32,8).toString("base64"),
    PROVIDER_WEBHOOK_SECRET:"provider-webhook-eeeeeeeeee",
    PAYMENT_WEBHOOK_SECRET:"payment-webhook-fffffffffff",
    AUDIT_HMAC_KEY:"audit-hmac-gggggggggggggggggggggggggggggggg",
    STATE_HMAC_KEY:"state-hmac-hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh",
    FINANCIAL_JOURNAL_HMAC_KEY:"financial-journal-iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii",
    WALLET_AUTHORITY_HMAC_KEY:"wallet-authority-jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj",
    BUSINESS_AUTHORITY_HMAC_KEY:"business-authority-kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk",
    ALLOWED_ORIGINS:"https://gamezone.test.invalid",
    PUBLIC_BASE_URL:"https://gamezone.test.invalid",
    ALLOW_LEGACY_ADMIN_KEY:"false",
    PG_SINGLE_INSTANCE_LOCK:"true",
    STORAGE_FAIL_FAST:"true",
    STORAGE_DRIVER:"postgres",
    PG_FINANCIAL_MIRROR:"true",
    PG_FINANCIAL_JOURNAL:"true",
    PG_WALLET_AUTHORITY:"true",
    PG_BUSINESS_AUTHORITY:"true",
    ...overrides
  };
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gz-preflight-"));
  const file=path.join(dir,".env.production");
  fs.writeFileSync(file,Object.entries(values).map(([k,v])=>`${k}=${v}`).join("\n"));
  return file;
}

test("production preflight accepts a strong distinct configuration",()=>{
  const file=writeEnv();
  const r=spawnSync(process.execPath,[script,file],{encoding:"utf8"});
  assert.equal(r.status,0,r.stderr||r.stdout);
  assert.match(r.stdout,/production preflight OK/);
});

test("production preflight rejects duplicate security secrets",()=>{
  const duplicate="same-secret-xxxxxxxxxxxxxxxx";
  const file=writeEnv({INTERNAL_BOT_ADMIN_SECRET:duplicate,USER_SESSION_SECRET:duplicate});
  const r=spawnSync(process.execPath,[script,file],{encoding:"utf8"});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/must all be distinct/);
});


test("production preflight rejects disabled single-instance lock",()=>{
  const file=writeEnv({PG_SINGLE_INSTANCE_LOCK:"false"});
  const r=spawnSync(process.execPath,[script,file],{encoding:"utf8"});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/PG_SINGLE_INSTANCE_LOCK must be true/);
});


test("production preflight rejects reuse of inventory key for backups",()=>{
  const same=Buffer.alloc(32,7).toString("base64");
  const file=writeEnv({INVENTORY_ENCRYPTION_KEY:same,BACKUP_ENCRYPTION_KEY:same});
  const r=spawnSync(process.execPath,[script,file],{encoding:"utf8"});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/BACKUP_ENCRYPTION_KEY must be different/);
});


test("production preflight rejects JSON storage",()=>{
  const file=writeEnv({STORAGE_DRIVER:"json"});
  const r=spawnSync(process.execPath,[script,file],{encoding:"utf8"});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/STORAGE_DRIVER must be postgres/);
});

test("production preflight rejects dangerously short snapshot history settings",()=>{
  const file=writeEnv({PG_STATE_HISTORY_MAX:"5",PG_STATE_HISTORY_RETENTION_DAYS:"2",PG_STATE_HISTORY_MIN_INTERVAL_SECONDS:"1",STATE_VERIFY_INTERVAL_MS:"1000"});
  const r=spawnSync(process.execPath,[script,file],{encoding:"utf8"});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/PG_STATE_HISTORY_MAX/);
  assert.match(r.stderr,/PG_STATE_HISTORY_RETENTION_DAYS/);
  assert.match(r.stderr,/PG_STATE_HISTORY_MIN_INTERVAL_SECONDS/);
  assert.match(r.stderr,/STATE_VERIFY_INTERVAL_MS/);
});


test("production preflight rejects disabled financial mirror",()=>{
  const file=writeEnv({PG_FINANCIAL_MIRROR:"false"});
  const r=spawnSync(process.execPath,[script,file],{encoding:"utf8"});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/PG_FINANCIAL_MIRROR must be true/);
});


test("production preflight rejects a one-connection pool with the dedicated writer lock",()=>{
  const file=writeEnv({PG_POOL_MAX:"1"});
  const r=spawnSync(process.execPath,[script,file],{encoding:"utf8"});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/PG_POOL_MAX must be at least 2/);
});


test("production preflight rejects disabled financial journal",()=>{
  const file=writeEnv({PG_FINANCIAL_JOURNAL:"false"});
  const r=spawnSync(process.execPath,[script,file],{encoding:"utf8"});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/PG_FINANCIAL_JOURNAL must be true/);
});


test("production preflight rejects disabled wallet authority",()=>{
  const file=writeEnv({PG_WALLET_AUTHORITY:"false"});
  const r=spawnSync(process.execPath,[script,file],{encoding:"utf8"});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/PG_WALLET_AUTHORITY must be true/);
});


test("production preflight rejects disabled business authority",()=>{
  const file=writeEnv({PG_BUSINESS_AUTHORITY:"false"});
  const r=spawnSync(process.execPath,[script,file],{encoding:"utf8"});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/PG_BUSINESS_AUTHORITY must be true/);
});
