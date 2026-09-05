'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class MobileAuditLog {
  constructor(filePath) {
    this.filePath = path.resolve(filePath || './data/mobile-audit.jsonl');
  }

  record(actor, action, detail) {
    const row = {
      id: `ma_${crypto.randomBytes(10).toString('hex')}`,
      at: new Date().toISOString(),
      actor: actor ? {
        id: actor.id || null,
        username: actor.username || null,
        role: actor.role || null
      } : null,
      action: String(action || ''),
      detail: detail && typeof detail === 'object' ? detail : null
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    fs.appendFileSync(this.filePath, JSON.stringify(row) + '\n', { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
    return row;
  }
}

module.exports = { MobileAuditLog };
