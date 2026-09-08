const test = require("node:test");
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
