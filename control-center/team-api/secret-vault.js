'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function parseMasterKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, 'hex');
  else {
    try { key = Buffer.from(raw, 'base64url'); } catch { return null; }
  }
  return key.length === 32 ? key : null;
}

class SecretVault {
  constructor(filePath, masterKeyValue) {
    this.filePath = path.resolve(filePath || './data/connection-vault.json');
    this.masterKey = parseMasterKey(masterKeyValue);
    this.data = this.#load();
  }

  #empty() {
    return { version: 1, records: {} };
  }

  #load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || parsed.version !== 1 || !parsed.records || typeof parsed.records !== 'object') {
        throw new Error('Invalid vault format.');
      }
      return parsed;
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
      return this.#empty();
    }
  }

  #requireKey() {
    if (!this.masterKey) {
      const error = new Error('Vault master key is not configured.');
      error.code = 'vault_not_configured';
      throw error;
    }
    return this.masterKey;
  }

  #save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }

  put(name, plaintext, metadata = {}) {
    if (!/^[a-z0-9._-]{2,80}$/i.test(String(name || ''))) throw new Error('Invalid vault record name.');
    if (typeof plaintext !== 'string' || !plaintext) throw new Error('Secret cannot be empty.');
    const key = this.#requireKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const aad = Buffer.from(`uchiha-vault-v1:${name}`, 'utf8');
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    this.data.records[name] = {
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      tag: tag.toString('base64url'),
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      updatedAt: new Date().toISOString()
    };
    this.#save();
    return this.metadata(name);
  }

  get(name) {
    const record = this.data.records[name];
    if (!record) return null;
    const key = this.#requireKey();
    if (record.algorithm !== 'aes-256-gcm') throw new Error('Unsupported vault algorithm.');

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(record.iv, 'base64url')
    );
    decipher.setAAD(Buffer.from(`uchiha-vault-v1:${name}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64url')),
      decipher.final()
    ]);
    return plaintext.toString('utf8');
  }

  has(name) {
    return Boolean(this.data.records[name]);
  }

  metadata(name) {
    const record = this.data.records[name];
    if (!record) return null;
    return {
      metadata: record.metadata || {},
      updatedAt: record.updatedAt || null
    };
  }

  remove(name) {
    if (!this.data.records[name]) return false;
    delete this.data.records[name];
    this.#save();
    return true;
  }
}

module.exports = { SecretVault, parseMasterKey };
