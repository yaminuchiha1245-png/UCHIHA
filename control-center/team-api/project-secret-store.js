'use strict';

const fs = require('node:fs');
const path = require('node:path');

function validateProjectId(value) {
  const id = String(value || '').trim();
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(id)) {
    const error = new Error('Invalid project id.');
    error.code = 'project_secret_project_invalid';
    throw error;
  }
  return id;
}

function validateKey(value) {
  const key = String(value || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(key)) {
    const error = new Error('Invalid secret key.');
    error.code = 'project_secret_key_invalid';
    throw error;
  }
  return key;
}

function validateValue(value) {
  if (typeof value !== 'string' || !value || value.length > 32768 || /[\0\r\n]/.test(value)) {
    const error = new Error('Invalid secret value.');
    error.code = 'project_secret_value_invalid';
    throw error;
  }
  return value;
}

class ProjectSecretStore {
  constructor(baseDir) {
    this.baseDir = path.resolve(baseDir || './data/mobile/project-secrets');
  }

  #file(projectId) {
    return path.join(this.baseDir, validateProjectId(projectId) + '.env');
  }

  #read(projectId) {
    const file = this.#file(projectId);
    const result = new Map();
    let raw = '';
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return result;
      throw error;
    }

    for (const line of raw.split(/\n/)) {
      if (!line || line.startsWith('#')) continue;
      const index = line.indexOf('=');
      if (index <= 0) continue;
      const key = line.slice(0, index).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(key)) continue;
      const value = line.slice(index + 1);
      result.set(key, value);
    }
    return result;
  }

  #save(projectId, entries) {
    fs.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    const file = this.#file(projectId);
    const rows = Array.from(entries.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => key + '=' + value);
    const body = rows.length ? rows.join('\n') + '\n' : '';
    const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, 0o600); } catch {}
  }

  list(projectId) {
    const entries = this.#read(projectId);
    let updatedAt = null;
    try {
      updatedAt = fs.statSync(this.#file(projectId)).mtime.toISOString();
    } catch {}
    return Array.from(entries.keys()).sort().map((key) => ({
      key,
      configured: true,
      updatedAt
    }));
  }

  put(projectId, keyValue, secretValue) {
    const key = validateKey(keyValue);
    const value = validateValue(secretValue);
    const entries = this.#read(projectId);
    entries.set(key, value);
    this.#save(projectId, entries);
    return { key, configured: true, updatedAt: new Date().toISOString() };
  }

  remove(projectId, keyValue) {
    const key = validateKey(keyValue);
    const entries = this.#read(projectId);
    const existed = entries.delete(key);
    if (existed) this.#save(projectId, entries);
    return existed;
  }
}

module.exports = { ProjectSecretStore, validateProjectId, validateKey, validateValue };
