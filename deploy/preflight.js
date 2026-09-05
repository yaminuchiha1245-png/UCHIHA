const fs=require("fs");
const path=require("path");

const envFile=process.argv[2]||path.join(__dirname,".env.production");
if(!fs.existsSync(envFile)){
  console.error("Missing env file:",envFile);
  process.exit(1);
}
const values={};
for(const raw of fs.readFileSync(envFile,"utf8").split(/\r?\n/)){
  const line=raw.trim();
  if(!line||line.startsWith("#"))continue;
  const i=line.indexOf("=");
  if(i<1)continue;
  values[line.slice(0,i).trim()]=line.slice(i+1).trim();
}
const required=[
  "DOMAIN","POSTGRES_PASSWORD","BOT_TOKEN","BOT_USERNAME","INTERNAL_BOT_SECRET","INTERNAL_BOT_ADMIN_SECRET",
  "ADMIN_PASSWORD","ADMIN_SESSION_SECRET","USER_SESSION_SECRET",
  "INVENTORY_ENCRYPTION_KEY","BACKUP_ENCRYPTION_KEY","PROVIDER_WEBHOOK_SECRET","PAYMENT_WEBHOOK_SECRET","AUDIT_HMAC_KEY","STATE_HMAC_KEY","FINANCIAL_JOURNAL_HMAC_KEY","WALLET_AUTHORITY_HMAC_KEY","BUSINESS_AUTHORITY_HMAC_KEY","ALLOWED_ORIGINS","PUBLIC_BASE_URL",
  "PG_SINGLE_INSTANCE_LOCK","STORAGE_FAIL_FAST","STORAGE_DRIVER","PG_FINANCIAL_MIRROR","PG_FINANCIAL_JOURNAL","PG_WALLET_AUTHORITY","PG_BUSINESS_AUTHORITY"
];
const failures=[];
const placeholder=/PUT_|CHANGE_|GENERATE_|example\.com|YOUR_|not configured/i;
for(const key of required){
  const value=values[key]||"";
  if(!value)failures.push(`${key}: missing`);
  else if(placeholder.test(value))failures.push(`${key}: placeholder value`);
}
if(values.DOMAIN&&/^https?:\/\//i.test(values.DOMAIN))failures.push("DOMAIN: use hostname only, without https://");
if(values.ALLOWED_ORIGINS&&values.DOMAIN&&!values.ALLOWED_ORIGINS.split(",").map(x=>x.trim()).includes(`https://${values.DOMAIN}`)){
  failures.push("ALLOWED_ORIGINS: should include https://DOMAIN");
}
if(values.PUBLIC_BASE_URL&&!/^https:\/\//i.test(values.PUBLIC_BASE_URL))failures.push("PUBLIC_BASE_URL: must be https://...");

if(values.INVENTORY_ENCRYPTION_KEY){
  try{
    const b=Buffer.from(values.INVENTORY_ENCRYPTION_KEY,"base64");
    if(b.length!==32)failures.push("INVENTORY_ENCRYPTION_KEY: must decode to exactly 32 bytes");
  }catch{failures.push("INVENTORY_ENCRYPTION_KEY: invalid base64")}
}
if(values.BACKUP_ENCRYPTION_KEY){
  try{
    const b=Buffer.from(values.BACKUP_ENCRYPTION_KEY,"base64");
    if(b.length!==32)failures.push("BACKUP_ENCRYPTION_KEY: must decode to exactly 32 bytes");
  }catch{failures.push("BACKUP_ENCRYPTION_KEY: invalid base64")}
}
if(values.INVENTORY_ENCRYPTION_KEY&&values.BACKUP_ENCRYPTION_KEY&&values.INVENTORY_ENCRYPTION_KEY===values.BACKUP_ENCRYPTION_KEY){
  failures.push("BACKUP_ENCRYPTION_KEY must be different from INVENTORY_ENCRYPTION_KEY");
}
for(const key of ["INTERNAL_BOT_SECRET","INTERNAL_BOT_ADMIN_SECRET","ADMIN_SESSION_SECRET","USER_SESSION_SECRET","PROVIDER_WEBHOOK_SECRET","PAYMENT_WEBHOOK_SECRET"]){
  if(values[key]&&values[key].length<24)failures.push(`${key}: too short`);
}
for(const key of ["AUDIT_HMAC_KEY","STATE_HMAC_KEY","FINANCIAL_JOURNAL_HMAC_KEY","WALLET_AUTHORITY_HMAC_KEY","BUSINESS_AUTHORITY_HMAC_KEY"]){
  if(values[key]&&values[key].length<32)failures.push(`${key}: use at least 32 characters`);
}
const securitySecrets=["INTERNAL_BOT_SECRET","INTERNAL_BOT_ADMIN_SECRET","ADMIN_SESSION_SECRET","USER_SESSION_SECRET","PROVIDER_WEBHOOK_SECRET","PAYMENT_WEBHOOK_SECRET","AUDIT_HMAC_KEY","STATE_HMAC_KEY","FINANCIAL_JOURNAL_HMAC_KEY","WALLET_AUTHORITY_HMAC_KEY","BUSINESS_AUTHORITY_HMAC_KEY","INVENTORY_ENCRYPTION_KEY","BACKUP_ENCRYPTION_KEY"].map(k=>values[k]).filter(Boolean);
if(new Set(securitySecrets).size!==securitySecrets.length)failures.push("Security secrets must all be distinct");
if(values.ADMIN_PASSWORD&&values.ADMIN_PASSWORD.length<12)failures.push("ADMIN_PASSWORD: use at least 12 characters");
if(values.POSTGRES_PASSWORD&&values.POSTGRES_PASSWORD.length<16)failures.push("POSTGRES_PASSWORD: use at least 16 characters");
if(values.PUBLIC_BASE_URL&&values.DOMAIN){
  try{
    const u=new URL(values.PUBLIC_BASE_URL);
    if(u.hostname!==values.DOMAIN)failures.push("PUBLIC_BASE_URL host must match DOMAIN");
  }catch{failures.push("PUBLIC_BASE_URL: invalid URL")}
}
if(values.ALLOW_LEGACY_ADMIN_KEY&&values.ALLOW_LEGACY_ADMIN_KEY.toLowerCase()!=="false")failures.push("ALLOW_LEGACY_ADMIN_KEY must be false");
if(String(values.PG_SINGLE_INSTANCE_LOCK||"").toLowerCase()!=="true")failures.push("PG_SINGLE_INSTANCE_LOCK must be true for the production Server");
if(String(values.STORAGE_FAIL_FAST||"").toLowerCase()!=="true")failures.push("STORAGE_FAIL_FAST must be true in production");
if(String(values.STORAGE_DRIVER||"").toLowerCase()!=="postgres")failures.push("STORAGE_DRIVER must be postgres in production");
if(String(values.PG_FINANCIAL_MIRROR||"true").toLowerCase()!=="true")failures.push("PG_FINANCIAL_MIRROR must be true in production");
if(String(values.PG_FINANCIAL_JOURNAL||"true").toLowerCase()!=="true")failures.push("PG_FINANCIAL_JOURNAL must be true in production");
if(String(values.PG_WALLET_AUTHORITY||"true").toLowerCase()!=="true")failures.push("PG_WALLET_AUTHORITY must be true in production");
if(String(values.PG_BUSINESS_AUTHORITY||"true").toLowerCase()!=="true")failures.push("PG_BUSINESS_AUTHORITY must be true in production");
if(values.PG_STATE_HISTORY_MAX&&Number(values.PG_STATE_HISTORY_MAX)<20)failures.push("PG_STATE_HISTORY_MAX should be at least 20");
if(values.PG_STATE_HISTORY_RETENTION_DAYS&&Number(values.PG_STATE_HISTORY_RETENTION_DAYS)<7)failures.push("PG_STATE_HISTORY_RETENTION_DAYS should be at least 7");
if(values.PG_STATE_HISTORY_MIN_INTERVAL_SECONDS&&Number(values.PG_STATE_HISTORY_MIN_INTERVAL_SECONDS)<30)failures.push("PG_STATE_HISTORY_MIN_INTERVAL_SECONDS must be at least 30");
if(values.STATE_VERIFY_INTERVAL_MS&&Number(values.STATE_VERIFY_INTERVAL_MS)<60000)failures.push("STATE_VERIFY_INTERVAL_MS must be at least 60000");
if(values.PG_POOL_MAX&&Number(values.PG_POOL_MAX)<2)failures.push("PG_POOL_MAX must be at least 2 when PG_SINGLE_INSTANCE_LOCK=true");

if(failures.length){
  console.error("Game Zone production preflight FAILED");
  failures.forEach(x=>console.error("-",x));
  process.exit(1);
}
console.log("Game Zone production preflight OK");
console.log("Domain:",values.DOMAIN);
console.log("Bot username:",values.BOT_USERNAME);
console.log("Allowed origin configured: yes");
console.log("Secrets validated without printing them.");
