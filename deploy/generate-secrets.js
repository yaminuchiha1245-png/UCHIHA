const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");

const args=process.argv.slice(2);
const force=args.includes("--force");
const domainIndex=args.indexOf("--domain");
const domain=domainIndex>=0?String(args[domainIndex+1]||"").trim():"";
const outIndex=args.indexOf("--out");
const output=path.resolve(outIndex>=0?String(args[outIndex+1]||"") : path.join(__dirname,".env.production.generated"));
const example=path.join(__dirname,".env.production.example");

if(!fs.existsSync(example))throw new Error("missing_env_production_example");
if(fs.existsSync(output)&&!force)throw new Error(`output_exists:${output}`);

const secret=bytes=>crypto.randomBytes(bytes).toString("base64url");
const key32=()=>crypto.randomBytes(32).toString("base64");

const generated={
  POSTGRES_PASSWORD:secret(24),
  INTERNAL_BOT_SECRET:secret(36),
  INTERNAL_BOT_ADMIN_SECRET:secret(36),
  ADMIN_PASSWORD:secret(24),
  ADMIN_SESSION_SECRET:secret(48),
  USER_SESSION_SECRET:secret(48),
  INVENTORY_ENCRYPTION_KEY:key32(),
  BACKUP_ENCRYPTION_KEY:key32(),
  PROVIDER_WEBHOOK_SECRET:secret(48),
  PAYMENT_WEBHOOK_SECRET:secret(48),
  AUDIT_HMAC_KEY:secret(48),
  STATE_HMAC_KEY:secret(48),
  FINANCIAL_JOURNAL_HMAC_KEY:secret(48),
  WALLET_AUTHORITY_HMAC_KEY:secret(48),
  BUSINESS_AUTHORITY_HMAC_KEY:secret(48)
};

let text=fs.readFileSync(example,"utf8");
for(const [key,value] of Object.entries(generated)){
  const re=new RegExp(`^${key}=.*$`,"m");
  if(re.test(text))text=text.replace(re,`${key}=${value}`);
  else text+=`\n${key}=${value}\n`;
}

if(domain){
  if(!/^[a-z0-9.-]+$/i.test(domain)||domain.includes(".."))throw new Error("invalid_domain");
  const replacements={
    DOMAIN:domain,
    PUBLIC_BASE_URL:`https://${domain}`,
    ALLOWED_ORIGINS:`https://${domain}`
  };
  for(const [key,value] of Object.entries(replacements)){
    const re=new RegExp(`^${key}=.*$`,"m");
    if(re.test(text))text=text.replace(re,`${key}=${value}`);
    else text+=`\n${key}=${value}\n`;
  }
}

fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,text,{encoding:"utf8",mode:0o600});
try{fs.chmodSync(output,0o600);}catch{}

console.log("Generated production secret file:",output);
console.log("Generated application secrets:",Object.keys(generated).join(", "));
console.log("Secret values were not printed.");
if(!domain)console.log("DOMAIN/PUBLIC_BASE_URL/ALLOWED_ORIGINS remain for manual configuration.");
console.log("Telegram/provider/payment external credentials still need manual configuration.");
