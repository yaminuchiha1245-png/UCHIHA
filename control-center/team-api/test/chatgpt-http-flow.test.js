'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { TeamAuthStore } = require('../auth-store');
const { pkceS256 } = require('../chatgpt-oauth-store');

function form(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) params.set(key, String(value));
  return params.toString();
}

test('complete ChatGPT OAuth PKCE flow reaches read-only MCP tools', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uchiha-chatgpt-http-'));
  const authPath = path.join(dir, 'team-auth.json');
  const oauthPath = path.join(dir, 'chatgpt-oauth.json');
  const statePath = path.join(dir, 'state.json');

  const team = new TeamAuthStore(authPath);
  team.createInitialOwner({ username: 'owner', displayName: 'Owner', password: 'OwnerPassword-123' });
  fs.writeFileSync(statePath, JSON.stringify({
    projects: [{
      id: 'demo-project', name: 'Demo Project', status: 'online', statusLabel: 'Online',
      environment: 'preview', domain: 'demo.example.com', server: 'preview-node',
      release: 'r1', healthScore: 100, lastDeploy: null,
      source: { kind: 'github', verified: true }, executor: { mode: 'guarded', approvalRequired: true }
    }]
  }));

  process.env.UCHIHA_TEAM_AUTH_STORE = authPath;
  process.env.UCHIHA_CONTROL_STATE_PATH = statePath;
  process.env.UCHIHA_CHATGPT_OAUTH_STORE = oauthPath;
  process.env.UCHIHA_PUBLIC_ORIGIN = 'https://panel.uchiha-builder.com';

  delete require.cache[require.resolve('../chatgpt-bridge')];
  const bridge = require('../chatgpt-bridge');
  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url, 'http://127.0.0.1');
    if (!bridge.handles(parsed.pathname)) {
      res.writeHead(404); res.end(); return;
    }
    Promise.resolve(bridge.handler(req, res, parsed)).catch((error) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(String(error && error.message || error));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const metadata = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    assert.equal(metadata.status, 200);
    const metadataJson = await metadata.json();
    assert.equal(metadataJson.resource, 'https://panel.uchiha-builder.com/mcp');

    const blocked = await fetch(`${base}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    });
    assert.equal(blocked.status, 401);
    assert.match(blocked.headers.get('www-authenticate') || '', /oauth-protected-resource\/mcp/);

    const registered = await fetch(`${base}/oauth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'ChatGPT CI',
        redirect_uris: ['https://chatgpt.com/aip/oauth/callback'],
        token_endpoint_auth_method: 'none'
      })
    });
    assert.equal(registered.status, 201);
    const client = await registered.json();
    assert.ok(client.client_id);

    const verifier = crypto.randomBytes(48).toString('base64url').slice(0, 64);
    const challenge = pkceS256(verifier);
    const redirectUri = 'https://chatgpt.com/aip/oauth/callback';
    const resource = 'https://panel.uchiha-builder.com/mcp';
    const authorize = await fetch(`${base}/oauth/authorize`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({
        client_id: client.client_id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'projects:read',
        state: 'ci-state',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource,
        username: 'owner',
        password: 'OwnerPassword-123'
      })
    });
    assert.equal(authorize.status, 302);
    const location = new URL(authorize.headers.get('location'));
    assert.equal(location.origin + location.pathname, redirectUri);
    assert.equal(location.searchParams.get('state'), 'ci-state');
    const code = location.searchParams.get('code');
    assert.ok(code);

    const exchanged = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({
        grant_type: 'authorization_code', code, client_id: client.client_id,
        redirect_uri: redirectUri, code_verifier: verifier, resource
      })
    });
    assert.equal(exchanged.status, 200);
    const tokens = await exchanged.json();
    assert.equal(tokens.scope, 'projects:read');
    assert.ok(tokens.access_token);

    const headers = { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' };
    const initialized = await fetch(`${base}/mcp`, {
      method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ci', version: '1' } } })
    });
    assert.equal(initialized.status, 200);
    const initJson = await initialized.json();
    assert.equal(initJson.result.serverInfo.name, 'uchiha-control-center');

    const toolsResponse = await fetch(`${base}/mcp`, {
      method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} })
    });
    const toolsJson = await toolsResponse.json();
    assert.deepEqual(toolsJson.result.tools.map((x) => x.name), ['list_projects', 'get_project']);
    assert.equal(toolsJson.result.tools.some((x) => /deploy|write|delete/i.test(x.name)), false);

    const call = await fetch(`${base}/mcp`, {
      method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_projects', arguments: {} } })
    });
    const callJson = await call.json();
    assert.equal(callJson.result.structuredContent.items[0].id, 'demo-project');
  } finally {
    server.close();
    await once(server, 'close');
    delete process.env.UCHIHA_TEAM_AUTH_STORE;
    delete process.env.UCHIHA_CONTROL_STATE_PATH;
    delete process.env.UCHIHA_CHATGPT_OAUTH_STORE;
    delete process.env.UCHIHA_PUBLIC_ORIGIN;
  }
});
