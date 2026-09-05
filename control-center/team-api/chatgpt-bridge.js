'use strict';

const { URL, URLSearchParams } = require('node:url');
const { TeamAuthStore, verifyPassword } = require('./auth-store');
const { ProjectRegistry } = require('./project-registry');
const { ChatGptOAuthStore } = require('./chatgpt-oauth-store');

const PUBLIC_ORIGIN = String(process.env.UCHIHA_PUBLIC_ORIGIN || 'https://panel.uchiha-builder.com').replace(/\/$/, '');
const RESOURCE = `${PUBLIC_ORIGIN}/mcp`;
const AUTH_STORE = process.env.UCHIHA_TEAM_AUTH_STORE || './data/team-auth.json';
const PROJECT_STATE = process.env.UCHIHA_CONTROL_STATE_PATH || '';
const OAUTH_PATH = process.env.UCHIHA_CHATGPT_OAUTH_STORE || './data/chatgpt-oauth.json';
const oauth = new ChatGptOAuthStore(OAUTH_PATH);
const loginAttempts = new Map();
const MAX_BODY = 96 * 1024;

function teamStore() { return new TeamAuthStore(AUTH_STORE); }
function registry() { return new ProjectRegistry(PROJECT_STATE); }
function json(res, status, body, headers = {}) {
  const data = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers
  });
  res.end(data);
}
function html(res, status, body) {
  const data = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8', 'Content-Length': data.length,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  res.end(data);
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('body_too_large'), { code:'body_too_large' })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function bearer(req) {
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}
function clientKey(req) { return String(req.socket && req.socket.remoteAddress || 'unknown'); }
function rateLimited(req) {
  const key = clientKey(req); const now = Date.now(); const windowMs = 10 * 60 * 1000;
  let row = loginAttempts.get(key);
  if (!row || now - row.at > windowMs) { row = { at: now, count: 0 }; loginAttempts.set(key, row); }
  row.count += 1;
  return row.count > 12;
}
function clearRate(req) { loginAttempts.delete(clientKey(req)); }
function activeUserByCredentials(username, password) {
  const store = teamStore();
  const normalized = String(username || '').trim().toLowerCase();
  const user = store.data.users.find((x) => x.username === normalized && x.active);
  if (!user || !verifyPassword(String(password || ''), user.passwordHash)) return null;
  return { store, user };
}
function activeUserById(userId) {
  const store = teamStore();
  const user = store.data.users.find((x) => x.id === userId && x.active);
  return user ? { store, user } : null;
}
function canProjectsRead(store, user) { return store.capabilities(user).includes('projects.read'); }
function unauthorized(res) {
  json(res, 401, { error: 'unauthorized' }, {
    'WWW-Authenticate': `Bearer resource_metadata="${PUBLIC_ORIGIN}/.well-known/oauth-protected-resource", scope="projects:read"`
  });
}
function oauthError(res, status, code, description) {
  json(res, status, { error: code, ...(description ? { error_description: description } : {}) });
}
function protectedResourceMetadata() {
  return { resource: RESOURCE, authorization_servers: [PUBLIC_ORIGIN], scopes_supported: ['projects:read'], bearer_methods_supported: ['header'], resource_documentation: `${PUBLIC_ORIGIN}/` };
}
function authorizationServerMetadata() {
  return {
    issuer: PUBLIC_ORIGIN,
    authorization_endpoint: `${PUBLIC_ORIGIN}/oauth/authorize`,
    token_endpoint: `${PUBLIC_ORIGIN}/oauth/token`,
    registration_endpoint: `${PUBLIC_ORIGIN}/oauth/register`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code','refresh_token'],
    token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'],
    scopes_supported: ['projects:read']
  };
}
function authorizePage(params, errorText = '') {
  const fields = ['client_id','redirect_uri','response_type','scope','state','code_challenge','code_challenge_method','resource'];
  const hidden = fields.map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(params[name] || '')}">`).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ربط ChatGPT بـ UCHIHA</title><style>body{margin:0;background:#070c14;color:#f4f7fc;font-family:system-ui,sans-serif}.box{max-width:440px;margin:7vh auto;padding:24px}.card{background:#0e1622;border:1px solid #2a384c;border-radius:22px;padding:22px}h1{font-size:23px;margin:0 0 8px}p{color:#99a6b9;line-height:1.7}.scope{background:#141f2e;padding:12px;border-radius:14px;margin:14px 0;color:#cfd8e7}input{box-sizing:border-box;width:100%;height:52px;margin:7px 0;padding:0 14px;background:#09101a;border:1px solid #2a384c;border-radius:14px;color:#fff;font-size:16px}button{width:100%;height:52px;border:0;border-radius:14px;background:#3ac884;color:#07120d;font-weight:800;font-size:16px;margin-top:12px}.err{color:#ff8585}.brand{text-align:center;font-size:28px;font-weight:900;margin-bottom:18px}</style></head><body><div class="box"><div class="brand">UCHIHA</div><div class="card"><h1>ربط ChatGPT بحساب UCHIHA</h1><p>ChatGPT سيستخدم حسابه الخاص للذكاء الاصطناعي. هذه الصفحة تمنحه فقط صلاحية الأدوات التي توافق عليها داخل UCHIHA.</p><div class="scope">الصلاحية المطلوبة: قراءة المشاريع فقط · بدون نشر أو تعديل أو أسرار</div>${errorText ? `<p class="err">${escapeHtml(errorText)}</p>` : ''}<form method="post" action="/oauth/authorize">${hidden}<input name="username" autocomplete="username" placeholder="اسم مستخدم UCHIHA" required><input type="password" name="password" autocomplete="current-password" placeholder="كلمة مرور UCHIHA" required><button type="submit">سماح وربط ChatGPT</button></form></div></div></body></html>`;
}
function parseAuthorizeParams(source) {
  const get = (name) => String(source.get ? source.get(name) || '' : source[name] || '');
  return { client_id:get('client_id'), redirect_uri:get('redirect_uri'), response_type:get('response_type'), scope:get('scope') || 'projects:read', state:get('state'), code_challenge:get('code_challenge'), code_challenge_method:get('code_challenge_method'), resource:get('resource') || RESOURCE };
}
function redirectWithCode(res, redirectUri, code, state) {
  const out = new URL(redirectUri); out.searchParams.set('code', code); if (state) out.searchParams.set('state', state);
  res.writeHead(302, { Location: out.toString(), 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer' }); res.end();
}
function rpcResult(id, result) { return { jsonrpc:'2.0', id, result }; }
function rpcError(id, code, message) { return { jsonrpc:'2.0', id: id ?? null, error:{ code, message } }; }
function toolList() {
  return [
    { name:'list_projects', title:'List UCHIHA projects', description:'List the projects the signed-in UCHIHA member can read. Returns sanitized operational metadata only.', inputSchema:{ type:'object', properties:{}, additionalProperties:false }, annotations:{ readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false } },
    { name:'get_project', title:'Get UCHIHA project', description:'Get sanitized status and operational metadata for one UCHIHA project by id.', inputSchema:{ type:'object', properties:{ projectId:{ type:'string', minLength:1, maxLength:80 } }, required:['projectId'], additionalProperties:false }, annotations:{ readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false } }
  ];
}
async function handleMcp(req, res) {
  if (req.method !== 'POST') { res.writeHead(405, { Allow:'POST', 'Cache-Control':'no-store' }); res.end(); return; }
  const auth = oauth.authenticate(bearer(req), RESOURCE, 'projects:read');
  if (!auth) return unauthorized(res);
  const active = activeUserById(auth.userId);
  if (!active || !canProjectsRead(active.store, active.user)) return unauthorized(res);
  let message;
  try { message = JSON.parse(await readBody(req)); } catch { return json(res, 400, rpcError(null, -32700, 'Parse error')); }
  const id = message.id;
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') return json(res, 400, rpcError(id, -32600, 'Invalid Request'));
  if (message.method === 'notifications/initialized' || message.method.startsWith('notifications/')) { res.writeHead(202, { 'Cache-Control':'no-store' }); res.end(); return; }
  if (message.method === 'initialize') {
    const requested = String(message.params && message.params.protocolVersion || '2025-06-18');
    return json(res, 200, rpcResult(id, { protocolVersion: requested, capabilities:{ tools:{ listChanged:false } }, serverInfo:{ name:'uchiha-control-center', version:'2.0.0-alpha17' }, instructions:'Read-only UCHIHA project access. Never assume permission to modify or deploy.' }));
  }
  if (message.method === 'ping') return json(res, 200, rpcResult(id, {}));
  if (message.method === 'tools/list') return json(res, 200, rpcResult(id, { tools: toolList() }));
  if (message.method === 'tools/call') {
    const name = String(message.params && message.params.name || '');
    const args = message.params && message.params.arguments && typeof message.params.arguments === 'object' ? message.params.arguments : {};
    try {
      if (name === 'list_projects') {
        const items = registry().list();
        return json(res, 200, rpcResult(id, { content:[{ type:'text', text:JSON.stringify({ items }) }], structuredContent:{ items } }));
      }
      if (name === 'get_project') {
        const projectId = String(args.projectId || '').trim();
        if (!/^[a-zA-Z0-9._-]{1,80}$/.test(projectId)) return json(res, 200, rpcResult(id, { isError:true, content:[{ type:'text', text:'Invalid project id.' }] }));
        const project = registry().get(projectId);
        if (!project) return json(res, 200, rpcResult(id, { isError:true, content:[{ type:'text', text:'Project not found.' }] }));
        return json(res, 200, rpcResult(id, { content:[{ type:'text', text:JSON.stringify({ project }) }], structuredContent:{ project } }));
      }
      return json(res, 200, rpcResult(id, { isError:true, content:[{ type:'text', text:'Unknown tool.' }] }));
    } catch {
      return json(res, 200, rpcResult(id, { isError:true, content:[{ type:'text', text:'UCHIHA project registry is unavailable.' }] }));
    }
  }
  return json(res, 200, rpcError(id, -32601, 'Method not found'));
}

function handles(pathname) {
  return pathname === '/mcp' || pathname === '/oauth/register' || pathname === '/oauth/authorize' || pathname === '/oauth/token' || pathname === '/.well-known/oauth-protected-resource' || pathname === '/.well-known/oauth-authorization-server';
}

async function handler(req, res, parsedUrl) {
  const url = parsedUrl instanceof URL ? parsedUrl : new URL(req.url || '/', PUBLIC_ORIGIN);
  const pathname = url.pathname;
  if (pathname === '/.well-known/oauth-protected-resource' && req.method === 'GET') return json(res, 200, protectedResourceMetadata());
  if (pathname === '/.well-known/oauth-authorization-server' && req.method === 'GET') return json(res, 200, authorizationServerMetadata());
  if (pathname === '/oauth/register' && req.method === 'POST') {
    try { return json(res, 201, oauth.registerClient(JSON.parse(await readBody(req) || '{}'))); }
    catch (error) { return oauthError(res, 400, error.code || 'invalid_client_metadata'); }
  }
  if (pathname === '/oauth/authorize' && req.method === 'GET') {
    const params = parseAuthorizeParams(url.searchParams);
    try { oauth.validateAuthorizationRequest(params, RESOURCE); return html(res, 200, authorizePage(params)); }
    catch (error) { return html(res, 400, authorizePage(params, `تعذر بدء الربط: ${error.code || 'invalid_request'}`)); }
  }
  if (pathname === '/oauth/authorize' && req.method === 'POST') {
    let form;
    try { form = new URLSearchParams(await readBody(req)); } catch { return html(res, 400, authorizePage({}, 'طلب غير صالح.')); }
    const params = parseAuthorizeParams(form);
    let validated;
    try { validated = oauth.validateAuthorizationRequest(params, RESOURCE); } catch (error) { return html(res, 400, authorizePage(params, `طلب OAuth غير صالح: ${error.code || 'invalid_request'}`)); }
    if (rateLimited(req)) return html(res, 429, authorizePage(params, 'محاولات كثيرة. حاول لاحقًا.'));
    const auth = activeUserByCredentials(form.get('username'), form.get('password'));
    if (!auth || !canProjectsRead(auth.store, auth.user)) return html(res, 401, authorizePage(params, 'اسم المستخدم أو كلمة المرور غير صحيحة، أو الحساب لا يملك صلاحية قراءة المشاريع.'));
    clearRate(req);
    const code = oauth.createCode({ userId:auth.user.id, clientId:validated.client.client_id, redirectUri:validated.redirectUri, scopes:validated.scopes, resource:RESOURCE, codeChallenge:validated.codeChallenge });
    return redirectWithCode(res, validated.redirectUri, code, validated.state);
  }
  if (pathname === '/oauth/token' && req.method === 'POST') {
    let form;
    try { form = new URLSearchParams(await readBody(req)); } catch { return oauthError(res, 400, 'invalid_request'); }
    const grant = String(form.get('grant_type') || '');
    const clientId = String(form.get('client_id') || '');
    if (!oauth.getClient(clientId)) return oauthError(res, 401, 'invalid_client');
    try {
      if (grant === 'authorization_code') {
        const tokens = oauth.exchangeCode({ code:form.get('code'), clientId, redirectUri:form.get('redirect_uri'), codeVerifier:form.get('code_verifier'), resource:String(form.get('resource') || RESOURCE) });
        return json(res, 200, tokens);
      }
      if (grant === 'refresh_token') {
        const tokens = oauth.refresh({ refreshToken:form.get('refresh_token'), clientId, resource:String(form.get('resource') || RESOURCE), scope:form.get('scope') || '' });
        return json(res, 200, tokens);
      }
      return oauthError(res, 400, 'unsupported_grant_type');
    } catch (error) { return oauthError(res, 400, error.code || 'invalid_grant'); }
  }
  if (pathname === '/mcp') return handleMcp(req, res);
  json(res, 404, { error:'not_found' });
}

module.exports = { handler, handles, protectedResourceMetadata, authorizationServerMetadata, toolList };
