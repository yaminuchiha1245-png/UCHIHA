'use strict';

const fs = require('node:fs');
const path = require('node:path');

function safeProjectId(value) {
  const id = String(value || '').trim();
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(id)) throw Object.assign(new Error('Invalid project id.'), { code: 'domain_project_invalid' });
  return id;
}

function publicDomain(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    projectId: row.projectId,
    domain: row.domain,
    expectedRecord: row.expectedRecord || null,
    dnsStatus: row.dnsStatus || 'pending',
    httpsStatus: row.httpsStatus || 'pending',
    resolvedAddresses: Array.isArray(row.resolvedAddresses) ? row.resolvedAddresses : [],
    certificateValidTo: row.certificateValidTo || null,
    tlsProtocol: row.tlsProtocol || null,
    httpStatus: Number.isInteger(row.httpStatus) ? row.httpStatus : null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    lastCheckedAt: row.lastCheckedAt || null
  };
}

class DomainStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath || './data/domain-state.json');
    this.data = this.#load();
  }

  #empty() { return { version: 1, items: {} }; }

  #load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || parsed.version !== 1 || !parsed.items || typeof parsed.items !== 'object') throw new Error('Invalid domain state store.');
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

  get(projectId) { return publicDomain(this.data.items[safeProjectId(projectId)]); }

  set(projectId, domain, expectedRecord) {
    const id = safeProjectId(projectId);
    const now = new Date().toISOString();
    const previous = this.data.items[id];
    const row = {
      projectId: id,
      domain,
      expectedRecord,
      dnsStatus: 'pending',
      httpsStatus: 'pending',
      resolvedAddresses: [],
      certificateValidTo: null,
      tlsProtocol: null,
      httpStatus: null,
      createdAt: previous && previous.domain === domain ? previous.createdAt : now,
      updatedAt: now,
      lastCheckedAt: null
    };
    this.data.items[id] = row;
    this.#save();
    return publicDomain(row);
  }

  updateVerification(projectId, result) {
    const id = safeProjectId(projectId);
    const row = this.data.items[id];
    if (!row) throw Object.assign(new Error('Project domain is not configured.'), { code: 'domain_not_configured' });
    row.dnsStatus = result && result.dnsStatus || 'failed';
    row.httpsStatus = result && result.httpsStatus || 'pending';
    row.resolvedAddresses = Array.isArray(result && result.resolvedAddresses) ? result.resolvedAddresses : [];
    row.certificateValidTo = result && result.certificateValidTo || null;
    row.tlsProtocol = result && result.tlsProtocol || null;
    row.httpStatus = Number.isInteger(result && result.httpStatus) ? result.httpStatus : null;
    row.lastCheckedAt = new Date().toISOString();
    row.updatedAt = row.lastCheckedAt;
    this.#save();
    return publicDomain(row);
  }
}

module.exports = { DomainStore, safeProjectId, publicDomain };
