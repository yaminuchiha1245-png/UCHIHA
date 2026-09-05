'use strict';

const fs = require('node:fs');
const path = require('node:path');

function publicServer(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    host: row.host,
    port: row.port,
    username: row.username,
    fingerprint: row.fingerprint,
    createdAt: row.createdAt,
    lastVerifiedAt: row.lastVerifiedAt
  };
}

function validBranch(value) {
  const safeBranch = String(value || '').trim();
  const forbiddenChars = ['~', '^', ':', '?', '*', '[', '\\'];
  return Boolean(safeBranch)
    && safeBranch.length <= 200
    && !/\s/.test(safeBranch)
    && !forbiddenChars.some((char) => safeBranch.includes(char))
    && !safeBranch.includes('..')
    && !safeBranch.includes('@{')
    && !safeBranch.includes('//')
    && !safeBranch.startsWith('/')
    && !safeBranch.endsWith('/')
    && !safeBranch.endsWith('.')
    && !safeBranch.endsWith('.lock');
}

function publicPreviewBuild(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    requestId: row.requestId || null,
    issueNumber: Number.isInteger(row.issueNumber) ? row.issueNumber : null,
    issueUrl: row.issueUrl || null,
    bridgeRepository: row.bridgeRepository || null,
    repository: row.repository || null,
    branch: row.branch || null,
    framework: row.framework || null,
    packageManager: row.packageManager || null,
    outputDir: row.outputDir || null,
    status: row.status || 'queued',
    runId: Number.isInteger(row.runId) ? row.runId : null,
    artifactName: row.artifactName || null,
    revision: row.revision || null,
    reason: row.reason || null,
    requestedBy: row.requestedBy || null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

class ConnectionStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath || './data/connections.json');
    this.data = this.#load();
  }

  #empty() {
    return {
      version: 1,
      github: { account: null, projects: {} },
      servers: { items: {}, projects: {} }
    };
  }

  #load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || parsed.version !== 1 || !parsed.github || typeof parsed.github !== 'object') {
        throw new Error('Invalid connection store.');
      }
      if (!parsed.github.projects || typeof parsed.github.projects !== 'object') parsed.github.projects = {};
      if (!parsed.servers || typeof parsed.servers !== 'object') parsed.servers = { items: {}, projects: {} };
      if (!parsed.servers.items || typeof parsed.servers.items !== 'object') parsed.servers.items = {};
      if (!parsed.servers.projects || typeof parsed.servers.projects !== 'object') parsed.servers.projects = {};
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

  setGithubAccount(profile) {
    this.data.github.account = {
      login: String(profile && profile.login || ''),
      id: Number.isFinite(profile && profile.id) ? profile.id : null,
      name: typeof (profile && profile.name) === 'string' ? profile.name : null,
      connectedAt: new Date().toISOString()
    };
    this.#save();
    return this.githubStatus();
  }

  clearGithub() {
    this.data.github = { account: null, projects: {} };
    this.#save();
  }

  githubStatus() {
    const account = this.data.github.account;
    return {
      connected: Boolean(account && account.login),
      account: account ? {
        login: account.login,
        id: account.id,
        name: account.name,
        connectedAt: account.connectedAt
      } : null
    };
  }

  bindGithubProject(projectId, repo, branch, metadata = {}) {
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(String(projectId || ''))) throw new Error('Invalid project id.');
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repo || ''))) throw new Error('Invalid repository.');
    const safeBranch = String(branch || '').trim();
    if (!validBranch(safeBranch)) throw new Error('Invalid branch.');

    this.data.github.projects[projectId] = {
      repository: repo,
      branch: safeBranch,
      private: Boolean(metadata && metadata.private),
      previewBranch: null,
      previewBuild: null,
      linkedAt: new Date().toISOString()
    };
    this.#save();
    return this.getGithubProject(projectId);
  }

  setGithubPreviewBranch(projectId, previewBranch) {
    const row = this.data.github.projects[String(projectId || '')];
    if (!row) throw new Error('Project GitHub binding not found.');
    const safeBranch = String(previewBranch || '').trim();
    if (!validBranch(safeBranch)) throw new Error('Invalid branch.');
    row.previewBranch = safeBranch;
    row.previewUpdatedAt = new Date().toISOString();
    row.previewBuild = null;
    this.#save();
    return this.getGithubProject(projectId);
  }

  setPreviewBuild(projectId, input) {
    const row = this.data.github.projects[String(projectId || '')];
    if (!row) throw new Error('Project GitHub binding not found.');
    const now = new Date().toISOString();
    row.previewBuild = {
      requestId: String(input && input.requestId || ''),
      issueNumber: Number(input && input.issueNumber),
      issueUrl: input && input.issueUrl || null,
      bridgeRepository: input && input.bridgeRepository || null,
      repository: row.repository,
      branch: row.previewBranch || row.branch,
      framework: input && input.framework || null,
      packageManager: input && input.packageManager || null,
      outputDir: input && input.outputDir || null,
      status: 'queued',
      runId: null,
      artifactName: null,
      revision: null,
      reason: null,
      requestedBy: input && input.requestedBy || null,
      createdAt: now,
      updatedAt: now
    };
    this.#save();
    return this.getPreviewBuild(projectId);
  }

  updatePreviewBuild(projectId, patch) {
    const row = this.data.github.projects[String(projectId || '')];
    if (!row || !row.previewBuild) return null;
    const allowed = ['status', 'runId', 'artifactName', 'revision', 'reason'];
    for (const key of allowed) {
      if (patch && patch[key] !== undefined) row.previewBuild[key] = patch[key];
    }
    row.previewBuild.updatedAt = new Date().toISOString();
    this.#save();
    return this.getPreviewBuild(projectId);
  }

  getPreviewBuild(projectId) {
    const row = this.data.github.projects[String(projectId || '')];
    return row ? publicPreviewBuild(row.previewBuild) : null;
  }

  getGithubProject(projectId) {
    const row = this.data.github.projects[String(projectId || '')];
    return row ? {
      repository: row.repository,
      branch: row.branch,
      private: Boolean(row.private),
      previewBranch: typeof row.previewBranch === 'string' && row.previewBranch ? row.previewBranch : null,
      activeBranch: typeof row.previewBranch === 'string' && row.previewBranch ? row.previewBranch : row.branch,
      linkedAt: row.linkedAt,
      previewUpdatedAt: row.previewUpdatedAt || null,
      previewBuild: publicPreviewBuild(row.previewBuild)
    } : null;
  }

  addServer(server) {
    if (!server || !/^[a-zA-Z0-9_-]{4,100}$/.test(String(server.id || ''))) throw new Error('Invalid server id.');
    if (this.data.servers.items[server.id]) throw new Error('Server already exists.');
    const row = {
      id: server.id,
      label: String(server.label || server.host),
      host: String(server.host),
      port: Number(server.port),
      username: String(server.username),
      fingerprint: String(server.fingerprint || ''),
      createdAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString()
    };
    this.data.servers.items[row.id] = row;
    this.#save();
    return publicServer(row);
  }

  updateServerVerification(serverId, fingerprint) {
    const row = this.data.servers.items[String(serverId || '')];
    if (!row) throw new Error('Server not found.');
    if (fingerprint && row.fingerprint && fingerprint !== row.fingerprint) throw new Error('SSH host key changed.');
    if (fingerprint) row.fingerprint = fingerprint;
    row.lastVerifiedAt = new Date().toISOString();
    this.#save();
    return publicServer(row);
  }

  listServers() {
    return Object.values(this.data.servers.items).map(publicServer).sort((a, b) => a.label.localeCompare(b.label));
  }

  getServer(serverId) {
    return publicServer(this.data.servers.items[String(serverId || '')]);
  }

  bindServerProject(projectId, serverId) {
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(String(projectId || ''))) throw new Error('Invalid project id.');
    if (!this.data.servers.items[String(serverId || '')]) throw new Error('Server not found.');
    this.data.servers.projects[projectId] = {
      serverId,
      linkedAt: new Date().toISOString()
    };
    this.#save();
    return this.getProjectServer(projectId);
  }

  getProjectServer(projectId) {
    const binding = this.data.servers.projects[String(projectId || '')];
    if (!binding) return null;
    const server = this.getServer(binding.serverId);
    return server ? { server, linkedAt: binding.linkedAt } : null;
  }

  removeServer(serverId) {
    const id = String(serverId || '');
    if (!this.data.servers.items[id]) return false;
    delete this.data.servers.items[id];
    for (const [projectId, binding] of Object.entries(this.data.servers.projects)) {
      if (binding.serverId === id) delete this.data.servers.projects[projectId];
    }
    this.#save();
    return true;
  }
}

module.exports = { ConnectionStore, publicServer, publicPreviewBuild, validBranch };
