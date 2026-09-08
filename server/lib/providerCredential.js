const { encryptValue, decryptValue } = require("./inventoryCrypto");

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
