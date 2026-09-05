'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { URL } = require('node:url');
const { TeamAuthStore, publicUser } = require('./auth-store');
const { ProjectRegistry } = require('./project-registry');
const { SecretVault } = require('./secret-vault');
const { ConnectionStore } = require('./connection-store');
const { validateToken, listRepos, getRepoFile } = require('./github-client');
const { validateConnectionInput, testPasswordConnection } = require('./server-client');

const PORT = Number(process.env.PORT || process.env.UCHIHA_TEAM_API_PORT || 8091);
const HOST = process.env.UCHIHA_TEAM_API_HOST || '127.0.0.1';
const STORE_PATH = process.env.UCHIHA_TEAM_AUTH_STORE || './data/team-auth.json';
const PROJECT_STATE_PATH = process.env.UCHIHA_CONTROL_STATE_PATH || '';
const VAULT_PATH = process.env.UCHIHA_CONNECTION_VAULT || './data/connection-vault.json';
const CONNECTIONS_PATH = process.env.UCHIHA_CONNECTION_STORE || './data/connections.json';
const SETUP_CODE_HASH = String(process.env.UCHIHA_TEAM_SETUP_CODE_HASH || '').trim().toLowerCase();
const MAX_BODY_BYTES = 64 * 1024;

const store = new TeamAuthStore(STORE_PATH);
const projectRegistry = new ProjectRegistry(PROJECT_STATE_PATH);
const vault = new SecretVault(VAULT_PATH, process.env.UCHIHA_VAULT_MASTER_KEY || '');
const connections = new ConnectionStore(CONNECTIONS_PATH);
store.ensureOwnerFromEnv(process.env);

const loginAttempts = new Map();

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function bearer(req) {
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function clientKey(req) {
  return String(req.socket.remoteAddress || 'unknown');
}

function rateLimited(req) {
  const key = clientKey(req);
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const current = loginAttempts.get(key);
  if (!current || now - current.startedAt > windowMs) {
    loginAttempts.set(key, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > 12;
}

function clearRateLimit(req) {
  loginAttempts.delete(clientKey(req));
}

function setupCodeConfigured() {
  return /^[a-f0-9]{64}$/.test(SETUP_CODE_HASH);
}

function verifySetupCode(value) {
  if (!setupCodeConfigured()) return false;
  const code = String(value || '').trim();
  if (code.length < 8 || code.length > 128) return false;
  const actual = crypto.createHash('sha256').update(code, 'utf8').digest();
  const expected = Buffer.from(SETUP_CODE_HASH, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function requireAuth(req, res) {
  const token = bearer(req);
  const user = store.authenticate(token);
  if (!user) {
    json(res, 401, { ok: false, error: 'unauthorized' });
    return null;
  }
  return { token, user };
}

function requireCapability(user, capability, res) {
  if (!store.capabilities(user).includes(capability)) {
    json(res, 403, { ok: false, error: 'forbidden' });
    return false;
  }
  return true;
}

function errorStatus(message) {
  if (message === 'Forbidden.') return 403;
  if (message === 'User not found.' || message === 'Server not found.') return 404;
  if (message === 'Username already exists.' || message === 'Initial setup is already complete.') return 409;
  return 400;
}

function registryError(res, error) {
  const code = error && error.code ? error.code : 'registry_unavailable';
  const status = code === 'registry_invalid' ? 500 : 503;
  json(res, status, { ok: false, error: code });
}

function githubConnectionStatus() {
  const status = connections.githubStatus();
  return {
    connected: Boolean(status.connected && vault.has('github.workspace')),
    account: status.account
  };
}

function githubError(res, error) {
  const code = error && error.code ? error.code : 'github_request_failed';
  if (code === 'vault_not_configured') return json(res, 503, { ok: false, error: code });
  if (code === 'github_invalid_token') return json(res, 400, { ok: false, error: code });
  if (code === 'github_not_connected') return json(res, 409, { ok: false, error: code });
  return json(res, 502, { ok: false, error: code });
}

function previewMime(filePath) {
  const lower = String(filePath || '').toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.css')) return 'text/css';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.ico')) return 'image/x-icon';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain';
  if (lower.endsWith('.xml')) return 'application/xml';
  if (lower.endsWith('.woff')) return 'font/woff';
  if (lower.endsWith('.woff2')) return 'font/woff2';
  return null;
}

function previewError(res, error) {
  const code = error && error.code ? error.code : 'preview_source_failed';
  if (code === 'github_not_connected' || code === 'preview_github_not_linked') {
    return json(res, 409, { ok: false, error: code });
  }
  if (code === 'github_source_not_found') return json(res, 404, { ok: false, error: code });
  if (code === 'preview_file_too_large') return json(res, 413, { ok: false, error: code });
  if (code === 'preview_path_invalid' || code === 'github_repository_invalid' || code === 'github_branch_invalid') {
    return json(res, 400, { ok: false, error: code });
  }
  if (code === 'github_invalid_token') return json(res, 401, { ok: false, error: code });
  return json(res, 502, { ok: false, error: code });
}

function githubToken() {
  if (!vault.has('github.workspace')) {
    const error = new Error('GitHub is not connected.');
    error.code = 'github_not_connected';
    throw error;
  }
  return vault.get('github.workspace');
}

function serverError(res, error) {
  const code = error && error.code ? error.code : 'server_connection_failed';
  if (code === 'vault_not_configured') return json(res, 503, { ok: false, error: code });
  if (code === 'ssh_host_key_changed') return json(res, 409, { ok: false, error: code });
  if (code === 'server_not_found') return json(res, 404, { ok: false, error: code });
  return json(res, 400, { ok: false, error: code });
}

function projectExists(projectId) {
  const project = projectRegistry.get(projectId);
  if (!project) {
    const error = new Error('Project not found.');
    error.code = 'project_not_found';
    throw error;
  }
  return project;
}

function serverPassword(serverId) {
  const name = `server.${serverId}.password`;
  if (!vault.has(name)) {
    const error = new Error('Server credential is unavailable.');
    error.code = 'server_credential_missing';
    throw error;
  }
  return vault.get(name);
}

async function handler(req, res) {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = requestUrl.pathname;

  if (req.method === 'GET' && pathname === '/health') {
    json(res, 200, { ok: true, service: 'uchiha-team-api' });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/mobile/setup') {
    const needsOwner = store.needsInitialOwner();
    json(res, 200, {
      ok: true,
      needsOwner,
      setupReady: needsOwner && setupCodeConfigured()
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/mobile/setup/owner') {
    if (!store.needsInitialOwner()) {
      json(res, 409, { ok: false, error: 'setup_complete' });
      return;
    }
    if (!setupCodeConfigured()) {
      json(res, 503, { ok: false, error: 'setup_not_configured' });
      return;
    }
    if (rateLimited(req)) {
      json(res, 429, { ok: false, error: 'too_many_attempts' });
      return;
    }
    try {
      const body = await readJson(req);
      if (!verifySetupCode(body.setupCode)) {
        json(res, 401, { ok: false, error: 'invalid_setup_code' });
        return;
      }
      const user = store.createInitialOwner(body);
      const result = store.login(user.username, body.password);
      clearRateLimit(req);
      json(res, 201, {
        ok: true,
        token: result.token,
        expiresAt: result.expiresAt,
        user: result.user,
        capabilities: store.capabilities(result.user)
      });
    } catch (error) {
      json(res, errorStatus(error.message), { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/mobile/auth/login') {
    if (rateLimited(req)) {
      json(res, 429, { ok: false, error: 'too_many_attempts' });
      return;
    }
    try {
      const body = await readJson(req);
      const result = store.login(body.username, body.password);
      if (!result) {
        json(res, 401, { ok: false, error: 'invalid_credentials' });
        return;
      }
      clearRateLimit(req);
      json(res, 200, {
        ok: true,
        token: result.token,
        expiresAt: result.expiresAt,
        user: result.user,
        capabilities: store.capabilities(result.user)
      });
    } catch (error) {
      json(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/mobile/auth/logout') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    store.logout(auth.token, auth.user);
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/mobile/me') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    json(res, 200, {
      ok: true,
      user: publicUser(auth.user),
      capabilities: store.capabilities(auth.user)
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/mobile/projects') {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'projects.read', res)) return;
    try {
      json(res, 200, { ok: true, items: projectRegistry.list() });
    } catch (error) {
      registryError(res, error);
    }
    return;
  }

  const projectMatch = pathname.match(/^\/api\/mobile\/projects\/([a-zA-Z0-9._-]+)$/);
  if (req.method === 'GET' && projectMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'projects.read', res)) return;
    try {
      const project = projectRegistry.get(projectMatch[1]);
      if (!project) {
        json(res, 404, { ok: false, error: 'project_not_found' });
        return;
      }
      json(res, 200, { ok: true, project });
    } catch (error) {
      registryError(res, error);
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/mobile/connections/github') {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'github.use', res)) return;
    json(res, 200, { ok: true, github: githubConnectionStatus() });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/mobile/connections/github') {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'team.manage', res)) return;
    try {
      const body = await readJson(req);
      const token = String(body.token || '').trim();
      const profile = await validateToken(token);
      vault.put('github.workspace', token, { provider: 'github', login: profile.login });
      connections.setGithubAccount(profile);
      json(res, 200, { ok: true, github: githubConnectionStatus() });
    } catch (error) {
      githubError(res, error);
    }
    return;
  }

  if (req.method === 'DELETE' && pathname === '/api/mobile/connections/github') {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'team.manage', res)) return;
    vault.remove('github.workspace');
    connections.clearGithub();
    json(res, 200, { ok: true, github: githubConnectionStatus() });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/mobile/github/repos') {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'github.use', res)) return;
    try {
      const repos = await listRepos(githubToken());
      json(res, 200, { ok: true, items: repos });
    } catch (error) {
      githubError(res, error);
    }
    return;
  }

  const projectGithubMatch = pathname.match(/^\/api\/mobile\/projects\/([a-zA-Z0-9._-]+)\/github$/);
  if (req.method === 'GET' && projectGithubMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'github.use', res)) return;
    json(res, 200, {
      ok: true,
      connected: githubConnectionStatus().connected,
      binding: connections.getGithubProject(projectGithubMatch[1])
    });
    return;
  }

  if (req.method === 'POST' && projectGithubMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'team.manage', res)) return;
    try {
      const project = projectExists(projectGithubMatch[1]);
      const body = await readJson(req);
      const repository = String(body.repository || '').trim();
      const repos = await listRepos(githubToken());
      const selected = repos.find((repo) => repo.fullName === repository);
      if (!selected || selected.archived) {
        json(res, 400, { ok: false, error: 'github_repository_unavailable' });
        return;
      }
      if (!selected.permissions.push && !selected.permissions.admin) {
        json(res, 403, { ok: false, error: 'github_repository_write_required' });
        return;
      }
      const binding = connections.bindGithubProject(project.id, selected.fullName, selected.defaultBranch);
      json(res, 200, { ok: true, binding });
    } catch (error) {
      if (error && error.code && String(error.code).startsWith('registry_')) return registryError(res, error);
      if (error && error.code === 'project_not_found') return json(res, 404, { ok: false, error: error.code });
      githubError(res, error);
    }
    return;
  }

  const projectPreviewSourceMatch = pathname.match(/^\/api\/mobile\/projects\/([a-zA-Z0-9._-]+)\/preview\/source$/);
  if (req.method === 'GET' && projectPreviewSourceMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'preview.use', res)) return;
    try {
      const project = projectExists(projectPreviewSourceMatch[1]);
      const binding = connections.getGithubProject(project.id);
      if (!binding) {
        const error = new Error('Project GitHub repository is not linked.');
        error.code = 'preview_github_not_linked';
        throw error;
      }
      const filePath = String(requestUrl.searchParams.get('path') || 'index.html');
      const mime = previewMime(filePath);
      if (!mime) return json(res, 400, { ok: false, error: 'preview_file_type_not_allowed' });
      const source = await getRepoFile(githubToken(), binding.repository, binding.branch, filePath);
      json(res, 200, {
        ok: true,
        projectId: project.id,
        repository: binding.repository,
        branch: binding.branch,
        path: source.path,
        sha: source.sha,
        size: source.size,
        mime,
        contentBase64: source.data.toString('base64')
      });
    } catch (error) {
      if (error && error.code && String(error.code).startsWith('registry_')) return registryError(res, error);
      if (error && error.code === 'project_not_found') return json(res, 404, { ok: false, error: error.code });
      previewError(res, error);
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/mobile/servers') {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'server.manage', res)) return;
    json(res, 200, { ok: true, items: connections.listServers() });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/mobile/servers') {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'server.manage', res)) return;
    try {
      const body = await readJson(req);
      const projectId = body.projectId ? String(body.projectId) : null;
      if (projectId) projectExists(projectId);
      const input = validateConnectionInput(body);
      const verification = await testPasswordConnection(input, null);
      const serverId = `srv_${crypto.randomBytes(8).toString('hex')}`;
      const vaultName = `server.${serverId}.password`;
      vault.put(vaultName, input.password, {
        provider: 'ssh-password',
        host: input.host,
        port: input.port,
        username: input.username
      });
      let server;
      try {
        server = connections.addServer({
          id: serverId,
          label: input.label,
          host: input.host,
          port: input.port,
          username: input.username,
          fingerprint: verification.fingerprint
        });
      } catch (error) {
        vault.remove(vaultName);
        throw error;
      }
      const binding = projectId ? connections.bindServerProject(projectId, serverId) : null;
      json(res, 201, { ok: true, server, binding });
    } catch (error) {
      if (error && error.code && String(error.code).startsWith('registry_')) return registryError(res, error);
      if (error && error.code === 'project_not_found') return json(res, 404, { ok: false, error: error.code });
      serverError(res, error);
    }
    return;
  }

  const projectServerMatch = pathname.match(/^\/api\/mobile\/projects\/([a-zA-Z0-9._-]+)\/server$/);
  if (req.method === 'GET' && projectServerMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'server.manage', res)) return;
    json(res, 200, { ok: true, binding: connections.getProjectServer(projectServerMatch[1]) });
    return;
  }

  if (req.method === 'POST' && projectServerMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'server.manage', res)) return;
    try {
      projectExists(projectServerMatch[1]);
      const body = await readJson(req);
      const binding = connections.bindServerProject(projectServerMatch[1], String(body.serverId || ''));
      json(res, 200, { ok: true, binding });
    } catch (error) {
      if (error && error.code && String(error.code).startsWith('registry_')) return registryError(res, error);
      if (error && error.code === 'project_not_found') return json(res, 404, { ok: false, error: error.code });
      json(res, errorStatus(error.message), { ok: false, error: error.message });
    }
    return;
  }

  const serverTestMatch = pathname.match(/^\/api\/mobile\/servers\/(srv_[a-zA-Z0-9_-]+)\/test$/);
  if (req.method === 'POST' && serverTestMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'server.manage', res)) return;
    try {
      const server = connections.getServer(serverTestMatch[1]);
      if (!server) return json(res, 404, { ok: false, error: 'server_not_found' });
      const verification = await testPasswordConnection({
        label: server.label,
        host: server.host,
        port: server.port,
        username: server.username,
        password: serverPassword(server.id)
      }, server.fingerprint);
      const updated = connections.updateServerVerification(server.id, verification.fingerprint);
      json(res, 200, { ok: true, server: updated });
    } catch (error) {
      serverError(res, error);
    }
    return;
  }

  const serverDeleteMatch = pathname.match(/^\/api\/mobile\/servers\/(srv_[a-zA-Z0-9_-]+)$/);
  if (req.method === 'DELETE' && serverDeleteMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'server.manage', res)) return;
    const serverId = serverDeleteMatch[1];
    vault.remove(`server.${serverId}.password`);
    const removed = connections.removeServer(serverId);
    json(res, removed ? 200 : 404, removed
      ? { ok: true }
      : { ok: false, error: 'server_not_found' });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/mobile/team') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      json(res, 200, { ok: true, users: store.listUsers(auth.user) });
    } catch (error) {
      json(res, errorStatus(error.message), { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/mobile/team') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const body = await readJson(req);
      const user = store.createUser(auth.user, body);
      json(res, 201, { ok: true, user });
    } catch (error) {
      json(res, errorStatus(error.message), { ok: false, error: error.message });
    }
    return;
  }

  const teamMatch = pathname.match(/^\/api\/mobile\/team\/([a-zA-Z0-9_-]+)$/);
  if (req.method === 'PATCH' && teamMatch) {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const body = await readJson(req);
      const user = store.updateUser(auth.user, teamMatch[1], body);
      json(res, 200, { ok: true, user });
    } catch (error) {
      json(res, errorStatus(error.message), { ok: false, error: error.message });
    }
    return;
  }

  json(res, 404, { ok: false, error: 'not_found' });
}

const server = http.createServer((req, res) => {
  Promise.resolve(handler(req, res)).catch((error) => {
    console.error('team-api request failed:', error && error.message ? error.message : error);
    if (!res.headersSent) json(res, 500, { ok: false, error: 'internal_error' });
    else res.end();
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`UCHIHA Team API listening on http://${HOST}:${PORT}`);
  });
}

module.exports = { server, handler, verifySetupCode };
