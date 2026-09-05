'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChatGptOAuthStore, pkceS256 } = require('../chatgpt-oauth-store');

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uchiha-chatgpt-oauth-'));
  const file = path.join(dir, 'oauth.json');
  return { dir, file, store: new ChatGptOAuthStore(file) };
}

function verifier() { return crypto.randomBytes(48).toString('base64url').slice(0, 64); }

function setupAuthorization(store) {
  const client = store.registerClient({
    client_name: 'ChatGPT Test',
    redirect_uris: ['https://chatgpt.com/aip/oauth/callback'],
    token_endpoint_auth_method: 'none'
  });
  const codeVerifier = verifier();
  const resource = 'https://panel.uchiha-builder.com/mcp';
  const validated = store.validateAuthorizationRequest({
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    response_type: 'code',
    scope: 'projects:read',
    state: 'state-1',
    code_challenge: pkceS256(codeVerifier),
    code_challenge_method: 'S256',
    resource
  }, resource);
  const code = store.createCode({
    userId: 'usr_test', clientId: client.client_id, redirectUri: validated.redirectUri,
    scopes: validated.scopes, resource, codeChallenge: validated.codeChallenge
  });
  return { client, codeVerifier, resource, code };
}

test('dynamic registration only accepts public clients and safe redirect URIs', () => {
  const { store } = fresh();
  const client = store.registerClient({ redirect_uris: ['https://chatgpt.com/aip/oauth/callback'] });
  assert.equal(client.token_endpoint_auth_method, 'none');
  assert.deepEqual(client.grant_types, ['authorization_code', 'refresh_token']);
  assert.throws(() => store.registerClient({ redirect_uris: ['http://evil.example/callback'] }), /invalid_redirect_uri/);
  assert.throws(() => store.registerClient({ redirect_uris: ['https://chatgpt.com/aip/oauth/callback'], token_endpoint_auth_method: 'client_secret_basic' }), /unsupported_auth_method/);
});

test('authorization code requires S256 PKCE and is single use', () => {
  const { store } = fresh();
  const { client, codeVerifier, resource, code } = setupAuthorization(store);
  assert.throws(() => store.exchangeCode({
    code, clientId: client.client_id, redirectUri: client.redirect_uris[0], codeVerifier: 'x'.repeat(43), resource
  }), /invalid_grant/);
  const tokens = store.exchangeCode({ code, clientId: client.client_id, redirectUri: client.redirect_uris[0], codeVerifier, resource });
  assert.equal(tokens.token_type, 'Bearer');
  assert.equal(tokens.scope, 'projects:read');
  assert.ok(tokens.access_token.length > 30);
  assert.ok(tokens.refresh_token.length > 30);
  assert.throws(() => store.exchangeCode({ code, clientId: client.client_id, redirectUri: client.redirect_uris[0], codeVerifier, resource }), /invalid_grant/);
});

test('access tokens are resource and scope bound; refresh rotates', () => {
  const { store } = fresh();
  const { client, codeVerifier, resource, code } = setupAuthorization(store);
  const first = store.exchangeCode({ code, clientId: client.client_id, redirectUri: client.redirect_uris[0], codeVerifier, resource });
  const auth = store.authenticate(first.access_token, resource, 'projects:read');
  assert.equal(auth.userId, 'usr_test');
  assert.equal(store.authenticate(first.access_token, 'https://wrong.example/mcp', 'projects:read'), null);
  assert.equal(store.authenticate(first.access_token, resource, 'deploy:write'), null);

  const next = store.refresh({ refreshToken: first.refresh_token, clientId: client.client_id, resource });
  assert.notEqual(next.refresh_token, first.refresh_token);
  assert.throws(() => store.refresh({ refreshToken: first.refresh_token, clientId: client.client_id, resource }), /invalid_grant/);
});

test('raw authorization codes and tokens are never persisted', () => {
  const { file, store } = fresh();
  const { client, codeVerifier, resource, code } = setupAuthorization(store);
  const tokens = store.exchangeCode({ code, clientId: client.client_id, redirectUri: client.redirect_uris[0], codeVerifier, resource });
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.includes(code), false);
  assert.equal(raw.includes(tokens.access_token), false);
  assert.equal(raw.includes(tokens.refresh_token), false);
});

test('ChatGPT bridge exposes only read-only project tools in alpha17', () => {
  const bridge = require('../chatgpt-bridge');
  const tools = bridge.toolList();
  assert.deepEqual(tools.map((x) => x.name), ['list_projects', 'get_project']);
  for (const tool of tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.openWorldHint, false);
  }
  assert.equal(bridge.protectedResourceMetadata().resource, 'https://panel.uchiha-builder.com/mcp');
  assert.deepEqual(bridge.authorizationServerMetadata().code_challenge_methods_supported, ['S256']);
});
