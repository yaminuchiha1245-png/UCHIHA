from pathlib import Path


def must_replace(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)

# New encrypted provider credential helper.
cred = Path("server/lib/providerCredential.js")
cred.write_text(r'''const { encryptValue, decryptValue } = require("./inventoryCrypto");

function storedSecret(provider, field) {
  const item = provider?.[field];
  if (!item || typeof item !== "object") return "";
  try { return String(decryptValue(item) || ""); } catch { return ""; }
}

function envSecret(provider, field) {
  const name = String(provider?.[field] || "").trim();
  return name ? String(process.env[name] || "") : "";
}

function resolveProviderSecret(provider) {
  return storedSecret(provider, "apiCredential") || envSecret(provider, "secretEnv");
}

function resolveProviderWebhookSecret(provider) {
  return storedSecret(provider, "webhookCredential") || envSecret(provider, "webhookSecretEnv");
}

function encryptedSecret(value) {
  const secret = String(value || "").trim();
  if (!secret) return null;
  if (secret.length > 4096) throw new Error("provider_secret_too_long");
  const encrypted = encryptValue(secret);
  if (process.env.NODE_ENV === "production" && !encrypted.encrypted) {
    throw new Error("provider_secret_encryption_unavailable");
  }
  return encrypted;
}

function setProviderSecrets(provider, body = {}) {
  if (!provider || typeof provider !== "object") throw new Error("provider_required");
  if (body.clearApiSecret === true) delete provider.apiCredential;
  if (body.clearWebhookSecret === true) delete provider.webhookCredential;
  if (Object.prototype.hasOwnProperty.call(body, "apiSecret")) {
    const next = encryptedSecret(body.apiSecret);
    if (next) provider.apiCredential = next;
  }
  if (Object.prototype.hasOwnProperty.call(body, "webhookSecret")) {
    const next = encryptedSecret(body.webhookSecret);
    if (next) provider.webhookCredential = next;
  }
  return provider;
}

function providerSecretConfigured(provider) {
  if (String(provider?.authMode || "bearer").toLowerCase() === "none") return true;
  return !!resolveProviderSecret(provider);
}

function providerWebhookSecretConfigured(provider) {
  if (!provider?.webhookCredential && !provider?.webhookSecretEnv) return true;
  return !!resolveProviderWebhookSecret(provider);
}

function publicProvider(provider) {
  const safe = { ...(provider || {}) };
  delete safe.apiCredential;
  delete safe.webhookCredential;
  delete safe.apiSecret;
  delete safe.webhookSecret;
  safe.secretConfigured = providerSecretConfigured(provider);
  safe.webhookSecretConfigured = providerWebhookSecretConfigured(provider);
  return safe;
}

module.exports = {
  resolveProviderSecret,
  resolveProviderWebhookSecret,
  setProviderSecrets,
  providerSecretConfigured,
  providerWebhookSecretConfigured,
  publicProvider
};
''')

# Provider HTTP runtime uses the encrypted admin-managed credential first, with ENV fallback.
http = Path("server/providers/http.js")
h = http.read_text()
h = must_replace(
    h,
    'const { assertSafeOutboundUrl } = require("../lib/outboundPolicy");',
    'const { assertSafeOutboundUrl } = require("../lib/outboundPolicy");\nconst { resolveProviderSecret } = require("../lib/providerCredential");',
    "http credential import",
)
h = must_replace(
    h,
    '  const token = config?.secretEnv ? process.env[config.secretEnv] : "";',
    '  const token = resolveProviderSecret(config);',
    "http credential resolver",
)
http.write_text(h)

# Server routes store credentials encrypted and never expose ciphertext/plaintext.
server = Path("server/server.js")
s = server.read_text()
s = must_replace(
    s,
    'const { applyCatalogMediaDefaults } = require("./lib/catalogMediaDefaults");',
    'const { applyCatalogMediaDefaults } = require("./lib/catalogMediaDefaults");\nconst { resolveProviderWebhookSecret, setProviderSecrets, providerSecretConfigured, providerWebhookSecretConfigured, publicProvider } = require("./lib/providerCredential");',
    "server credential import",
)
s = must_replace(
    s,
    '  const specific=provider?.webhookSecretEnv?String(process.env[provider.webhookSecretEnv]||""):"";',
    '  const specific=provider?resolveProviderWebhookSecret(provider):"";',
    "provider webhook secret resolver",
)
s = must_replace(
    s,
    'app.get("/api/admin/providers",adminOnly,(req,res)=>res.json(readDB().providers||[]));',
    'app.get("/api/admin/providers",adminOnly,(req,res)=>res.json((readDB().providers||[]).map(publicProvider)));',
    "provider public list",
)
s = must_replace(
    s,
    '  db.providers.push(p);pushAudit(db,req,"provider_create",{providerId:p.id});writeDB(db);res.json({ok:true,provider:p});',
    '  try{setProviderSecrets(p,b);}catch(e){return res.status(400).json({error:e.message});}\n  db.providers.push(p);pushAudit(db,req,"provider_create",{providerId:p.id});writeDB(db);res.json({ok:true,provider:publicProvider(p)});',
    "provider create vault",
)
s = must_replace(
    s,
    '  pushAudit(db,req,"provider_update",{providerId:p.id});writeDB(db);res.json({ok:true,provider:p});',
    '  try{setProviderSecrets(p,b);}catch(e){return res.status(400).json({error:e.message});}\n  pushAudit(db,req,"provider_update",{providerId:p.id});writeDB(db);res.json({ok:true,provider:publicProvider(p)});',
    "provider update vault",
)
s = must_replace(
    s,
    '  add("provider_secrets",realHttpProviders.every(p=>!p.secretEnv||!!process.env[p.secretEnv]),"أسرار المزودين","كل secretEnv لمزود فعال يجب أن يملك قيمة في بيئة التشغيل.");',
    '  add("provider_secrets",realHttpProviders.every(providerSecretConfigured),"أسرار المزودين","أدخل توكن/API Secret من لوحة الإدارة لكل مزود يحتاج مصادقة.");',
    "provider readiness",
)
s = must_replace(
    s,
    '  add("provider_webhook_secrets",realHttpProviders.every(p=>!p.webhookSecretEnv||!!process.env[p.webhookSecretEnv]),"أسرار Webhook للمزودين","كل webhookSecretEnv لمزود فعال يجب أن يملك قيمة في بيئة التشغيل.");',
    '  add("provider_webhook_secrets",realHttpProviders.every(providerWebhookSecretConfigured),"أسرار Webhook للمزودين","إذا كان المزود يستخدم Webhook Secret فأدخله من لوحة الإدارة.");',
    "provider webhook readiness",
)
server.write_text(s)

# Admin UI: owner pastes secrets directly; blank edit means keep existing.
admin = Path("admin/admin.js")
a = admin.read_text()
a = a.replace('secretEnv:null,baseUrl:null', 'secretEnv:null,secretConfigured:false,baseUrl:null')
a = must_replace(
    a,
    '<th>Secret ENV</th>',
    '<th>توكن API</th>',
    "provider table header",
)
a = must_replace(
    a,
    '${esc(p.secretEnv||"-")}</td><td>${p.active?',
    '${p.secretConfigured?\'<span class="pill ok">🔒 محفوظ</span>\':(p.authMode==="none"?\'<span class="pill ok">غير مطلوب</span>\':\'<span class="pill warn">غير مضبوط</span>\')}</td><td>${p.active?',
    "provider table secret status",
)
a = must_replace(
    a,
    '<div class="field full"><label>اسم متغير سر API في ENV</label><input id="prSecret" placeholder="SUPPLIER_TOKEN"></div>\n <div class="field full"><label>اسم متغير سر Webhook في ENV (اختياري)</label><input id="prWebhookSecret" placeholder="SUPPLIER_WEBHOOK_SECRET"></div>',
    '<div class="field full"><label>API Token / Secret</label><input id="prSecret" type="password" autocomplete="new-password" placeholder="ألصق التوكن هنا — سيُشفّر بعد الحفظ"></div>\n <div class="field full"><label>Webhook Secret (اختياري)</label><input id="prWebhookSecret" type="password" autocomplete="new-password" placeholder="ألصقه هنا إذا كان المزود يستخدم Webhook"></div>',
    "provider add secret fields",
)
a = must_replace(
    a,
    'secretEnv:$("#prSecret").value.trim()||null,webhookSecretEnv:$("#prWebhookSecret").value.trim()||null,authMode,',
    'apiSecret:$("#prSecret").value.trim()||undefined,webhookSecret:$("#prWebhookSecret").value.trim()||undefined,authMode,',
    "provider add payload",
)
a = must_replace(
    a,
    '<div class="field full"><label>API Secret ENV</label><input id="peSecret" value="${attr(p.secretEnv||"")}"></div>\n <div class="field full"><label>Webhook Secret ENV</label><input id="peWebhookSecret" value="${attr(p.webhookSecretEnv||"")}"></div>',
    '<div class="field full"><label>API Token / Secret</label><input id="peSecret" type="password" autocomplete="new-password" placeholder="${p.secretConfigured?"محفوظ 🔒 — اتركه فارغًا للإبقاء عليه":"ألصق التوكن هنا"}"></div>\n <div class="field full"><label>Webhook Secret (اختياري)</label><input id="peWebhookSecret" type="password" autocomplete="new-password" placeholder="${p.webhookSecretConfigured?"محفوظ 🔒 — اتركه فارغًا للإبقاء عليه":"ألصقه هنا عند الحاجة"}"></div>',
    "provider edit secret fields",
)
a = must_replace(
    a,
    'secretEnv:$("#peSecret").value||null,webhookSecretEnv:$("#peWebhookSecret").value||null,authMode,',
    'apiSecret:$("#peSecret").value.trim()||undefined,webhookSecret:$("#peWebhookSecret").value.trim()||undefined,authMode,',
    "provider edit payload",
)
admin.write_text(a)

# Test that no secret is ever returned and encrypted storage resolves correctly.
test = Path("server/tests/providerCredential.test.js")
test.write_text(r'''const test = require("node:test");
const assert = require("node:assert/strict");

process.env.INVENTORY_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const {
  resolveProviderSecret,
  resolveProviderWebhookSecret,
  setProviderSecrets,
  providerSecretConfigured,
  publicProvider
} = require("../lib/providerCredential");

test("admin-managed provider credentials are encrypted and never exposed", () => {
  const p = { id:"supplier", authMode:"bearer" };
  setProviderSecrets(p,{apiSecret:"owner-api-token",webhookSecret:"owner-webhook-token"});
  assert.equal(p.apiCredential.encrypted,true);
  assert.equal(p.apiCredential.value,null);
  assert.notEqual(p.apiCredential.valueEnc,"owner-api-token");
  assert.equal(resolveProviderSecret(p),"owner-api-token");
  assert.equal(resolveProviderWebhookSecret(p),"owner-webhook-token");
  assert.equal(providerSecretConfigured(p),true);
  const safe=publicProvider(p);
  assert.equal(safe.secretConfigured,true);
  assert.equal(safe.webhookSecretConfigured,true);
  assert.equal("apiCredential" in safe,false);
  assert.equal("webhookCredential" in safe,false);
  assert.equal(JSON.stringify(safe).includes("owner-api-token"),false);
});

test("blank edit keeps the current provider credential", () => {
  const p={id:"supplier",authMode:"bearer"};
  setProviderSecrets(p,{apiSecret:"first-secret"});
  const before=p.apiCredential.valueEnc;
  setProviderSecrets(p,{apiSecret:""});
  assert.equal(p.apiCredential.valueEnc,before);
  assert.equal(resolveProviderSecret(p),"first-secret");
});

test("legacy ENV credential remains supported as a fallback", () => {
  process.env.LEGACY_PROVIDER_TOKEN="legacy-token";
  const p={id:"legacy",authMode:"header",secretEnv:"LEGACY_PROVIDER_TOKEN"};
  assert.equal(resolveProviderSecret(p),"legacy-token");
  assert.equal(publicProvider(p).secretConfigured,true);
});
''')

print("GAME_ZONE_PROVIDER_VAULT_V7_PATCHED=1")
