'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ALLOWED_SCOPES = new Set(['projects:read']);

function nowIso(ms = Date.now()) { return new Date(ms).toISOString(); }
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function tokenHash(value) { return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex'); }
function safeEqualText(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function pkceS256(verifier) {
  return crypto.createHash('sha256').update(String(verifier || ''), 'ascii').digest('base64url');
}
function validVerifier(value) {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(String(value || ''));
}
function normalizeScopes(value) {
  const raw = Array.isArray(value) ? value : String(value || '').trim().split(/\s+/);
  const out = [...new Set(raw.map((x) => String(x || '').trim()).filter(Boolean))];
  if (!out.length || out.some((scope) => !ALLOWED_SCOPES.has(scope))) {
    const error = new Error('invalid_scope');
    error.code = 'invalid_scope';
    throw error;
  }
  return out;
}
function validateRedirectUri(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw Object.assign(new Error('invalid_redirect_uri'), { code: 'invalid_redirect_uri' }); }
  const localhost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(localhost && url.protocol === 'http:'))) {
    throw Object.assign(new Error('invalid_redirect_uri'), { code: 'invalid_redirect_uri' });
  }
  return url.toString();
}

class ChatGptOAuthStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath || './data/chatgpt-oauth.json');
    this.data = this.#load();
    this.#cleanup(false);
  }

  #empty() { return { version: 1, clients: [], codes: [], accessTokens: [], refreshTokens: [] }; }
  #load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || parsed.version !== 1) throw new Error('Invalid ChatGPT OAuth store.');
      for (const key of ['clients', 'codes', 'accessTokens', 'refreshTokens']) if (!Array.isArray(parsed[key])) parsed[key] = [];
      return parsed;
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
      return this.#empty();
    }
  }
  #save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }
  #cleanup(save = true) {
    const now = Date.now();
    const before = this.data.codes.length + this.data.accessTokens.length + this.data.refreshTokens.length;
    this.data.codes = this.data.codes.filter((x) => !x.usedAt && Date.parse(x.expiresAt) > now);
    this.data.accessTokens = this.data.accessTokens.filter((x) => Date.parse(x.expiresAt) > now);
    this.data.refreshTokens = this.data.refreshTokens.filter((x) => !x.revokedAt && Date.parse(x.expiresAt) > now);
    const after = this.data.codes.length + this.data.accessTokens.length + this.data.refreshTokens.length;
    if (save && after !== before) this.#save();
  }

  registerClient(input = {}) {
    const redirectUris = [...new Set((Array.isArray(input.redirect_uris) ? input.redirect_uris : []).map(validateRedirectUri))];
    if (!redirectUris.length || redirectUris.length > 8) throw Object.assign(new Error('invalid_redirect_uris'), { code: 'invalid_redirect_uris' });
    if (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== 'none') {
      throw Object.assign(new Error('unsupported_auth_method'), { code: 'unsupported_auth_method' });
    }
    const client = {
      client_id: `uchiha_${randomToken(18)}`,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: String(input.client_name || 'ChatGPT').slice(0, 120),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code']
    };
    this.data.clients.push(client);
    if (this.data.clients.length > 100) this.data.clients.splice(0, this.data.clients.length - 100);
    this.#save();
    return { ...client };
  }

  getClient(clientId) { return this.data.clients.find((x) => x.client_id === String(clientId || '')) || null; }
  validateAuthorizationRequest(input, resource) {
    const client = this.getClient(input.client_id);
    if (!client) throw Object.assign(new Error('invalid_client'), { code: 'invalid_client' });
    if (input.response_type !== 'code') throw Object.assign(new Error('unsupported_response_type'), { code: 'unsupported_response_type' });
    const redirectUri = validateRedirectUri(input.redirect_uri);
    if (!client.redirect_uris.includes(redirectUri)) throw Object.assign(new Error('redirect_uri_mismatch'), { code: 'redirect_uri_mismatch' });
    if (input.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(String(input.code_challenge || ''))) {
      throw Object.assign(new Error('pkce_required'), { code: 'pkce_required' });
    }
    if (String(input.resource || '') !== resource) throw Object.assign(new Error('invalid_resource'), { code: 'invalid_resource' });
    return {
      client,
      redirectUri,
      scopes: normalizeScopes(input.scope),
      state: String(input.state || '').slice(0, 512),
      codeChallenge: String(input.code_challenge)
    };
  }

  createCode({ userId, clientId, redirectUri, scopes, resource, codeChallenge }) {
    const raw = randomToken(32);
    const now = Date.now();
    this.data.codes.push({
      hash: tokenHash(raw), userId, clientId, redirectUri, scopes: normalizeScopes(scopes), resource,
      codeChallenge, createdAt: nowIso(now), expiresAt: nowIso(now + CODE_TTL_MS), usedAt: null
    });
    this.#cleanup(false);
    this.#save();
    return raw;
  }

  exchangeCode({ code, clientId, redirectUri, codeVerifier, resource }) {
    this.#cleanup();
    if (!validVerifier(codeVerifier)) throw Object.assign(new Error('invalid_grant'), { code: 'invalid_grant' });
    const hash = tokenHash(code);
    const record = this.data.codes.find((x) => x.hash === hash && !x.usedAt);
    if (!record || record.clientId !== clientId || record.redirectUri !== validateRedirectUri(redirectUri) || record.resource !== resource) {
      throw Object.assign(new Error('invalid_grant'), { code: 'invalid_grant' });
    }
    if (!safeEqualText(pkceS256(codeVerifier), record.codeChallenge)) throw Object.assign(new Error('invalid_grant'), { code: 'invalid_grant' });
    record.usedAt = nowIso();
    const tokens = this.#issue(record.userId, record.clientId, record.scopes, record.resource);
    this.#save();
    return tokens;
  }

  refresh({ refreshToken, clientId, resource, scope }) {
    this.#cleanup();
    const hash = tokenHash(refreshToken);
    const record = this.data.refreshTokens.find((x) => x.hash === hash && !x.revokedAt);
    if (!record || record.clientId !== clientId || record.resource !== resource) throw Object.assign(new Error('invalid_grant'), { code: 'invalid_grant' });
    const scopes = scope ? normalizeScopes(scope) : record.scopes;
    if (scopes.some((s) => !record.scopes.includes(s))) throw Object.assign(new Error('invalid_scope'), { code: 'invalid_scope' });
    record.revokedAt = nowIso();
    const tokens = this.#issue(record.userId, record.clientId, scopes, record.resource);
    this.#save();
    return tokens;
  }

  #issue(userId, clientId, scopes, resource) {
    const accessToken = randomToken(32);
    const refreshToken = randomToken(40);
    const now = Date.now();
    const normalized = normalizeScopes(scopes);
    this.data.accessTokens.push({ hash: tokenHash(accessToken), userId, clientId, scopes: normalized, resource, createdAt: nowIso(now), expiresAt: nowIso(now + ACCESS_TTL_MS) });
    this.data.refreshTokens.push({ hash: tokenHash(refreshToken), userId, clientId, scopes: normalized, resource, createdAt: nowIso(now), expiresAt: nowIso(now + REFRESH_TTL_MS), revokedAt: null });
    return { access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: refreshToken, scope: normalized.join(' ') };
  }

  authenticate(accessToken, resource, requiredScope) {
    this.#cleanup();
    const hash = tokenHash(accessToken);
    const token = this.data.accessTokens.find((x) => x.hash === hash && x.resource === resource);
    if (!token || (requiredScope && !token.scopes.includes(requiredScope))) return null;
    return { userId: token.userId, clientId: token.clientId, scopes: [...token.scopes], resource: token.resource };
  }
}

module.exports = { ChatGptOAuthStore, normalizeScopes, validateRedirectUri, pkceS256 };
