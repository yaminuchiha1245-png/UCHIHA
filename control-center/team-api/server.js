'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const { TeamAuthStore, publicUser } = require('./auth-store');
const { ProjectRegistry } = require('./project-registry');
const { SecretVault } = require('./secret-vault');
const { ConnectionStore } = require('./connection-store');
const { validateToken, listRepos } = require('./github-client');

const PORT = Number(process.env.PORT || process.env.UCHIHA_TEAM_API_PORT || 8091);
const HOST = process.env.UCHIHA_TEAM_API_HOST || '127.0.0.1';
const STORE_PATH = process.env.UCHIHA_TEAM_AUTH_STORE || './data/team-auth.json';
const PROJECT_STATE_PATH = process.env.UCHIHA_CONTROL_STATE_PATH || '';
const VAULT_PATH = process.env.UCHIHA_CONNECTION_VAULT || './data/connection-vault.json';
const CONNECTIONS_PATH = process.env.UCHIHA_CONNECTION_STORE || './data/connections.json';
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
  if (message === 'User not found.') return 404;
  if (message === 'Username already exists.') return 409;
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

async function handler(req, res) {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = requestUrl.pathname;

  if (req.method === 'GET' && pathname === '/health') {
    json(res, 200, { ok: true, service: 'uchiha-team-api' });
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
      const project = projectRegistry.get(projectGithubMatch[1]);
      if (!project) {
        json(res, 404, { ok: false, error: 'project_not_found' });
        return;
      }
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
      githubError(res, error);
    }
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

module.exports = { server, handler };
