'use strict';

const fs = require('node:fs');
const path = require('node:path');

class ConnectionStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath || './data/connections.json');
    this.data = this.#load();
  }

  #empty() {
    return {
      version: 1,
      github: {
        account: null,
        projects: {}
      }
    };
  }

  #load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || parsed.version !== 1 || !parsed.github || typeof parsed.github !== 'object') {
        throw new Error('Invalid connection store.');
      }
      if (!parsed.github.projects || typeof parsed.github.projects !== 'object') parsed.github.projects = {};
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

  bindGithubProject(projectId, repo, branch) {
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(String(projectId || ''))) throw new Error('Invalid project id.');
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repo || ''))) throw new Error('Invalid repository.');
    const safeBranch = String(branch || '').trim();
    if (!safeBranch || safeBranch.length > 200 || /[\s~^:?*\[\\]/.test(safeBranch) || safeBranch.includes('..')) {
      throw new Error('Invalid branch.');
    }
    this.data.github.projects[projectId] = {
      repository: repo,
      branch: safeBranch,
      linkedAt: new Date().toISOString()
    };
    this.#save();
    return this.getGithubProject(projectId);
  }

  getGithubProject(projectId) {
    const row = this.data.github.projects[String(projectId || '')];
    return row ? {
      repository: row.repository,
      branch: row.branch,
      linkedAt: row.linkedAt
    } : null;
  }
}

module.exports = { ConnectionStore };
