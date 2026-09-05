'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROLES = Object.freeze(['OWNER', 'DEVELOPER', 'SUPPORT']);
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_AUDIT = 2000;

function nowIso() {
  return new Date().toISOString();
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: Boolean(user.active),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null
  };
}

function assertPassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 256) {
    throw new Error('Password must be between 10 and 256 characters.');
  }
}

function hashPassword(password) {
  assertPassword(password);
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  try {
    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

class TeamAuthStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath || './data/team-auth.json');
    this.data = this.#load();
  }

  #empty() {
    return { version: 1, users: [], sessions: [], audit: [] };
  }

  #load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.users) || !Array.isArray(parsed.sessions)) {
        throw new Error('Invalid team auth store.');
      }
      if (!Array.isArray(parsed.audit)) parsed.audit = [];
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

  #audit(action, actorUserId, targetUserId, detail) {
    this.data.audit.push({
      id: newId('audit'),
      at: nowIso(),
      action,
      actorUserId: actorUserId || null,
      targetUserId: targetUserId || null,
      detail: detail || null
    });
    if (this.data.audit.length > MAX_AUDIT) {
      this.data.audit.splice(0, this.data.audit.length - MAX_AUDIT);
    }
  }

  needsInitialOwner() {
    return this.data.users.length === 0;
  }

  createInitialOwner(input) {
    if (!this.needsInitialOwner()) throw new Error('Initial setup is already complete.');

    const username = normalizeUsername(input && input.username);
    const displayName = String((input && input.displayName) || '').trim();
    const password = input && input.password;

    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('Invalid username.');
    if (!displayName || displayName.length > 80) throw new Error('Invalid display name.');
    assertPassword(password);

    const user = {
      id: newId('usr'),
      username,
      displayName,
      role: 'OWNER',
      active: true,
      passwordHash: hashPassword(password),
      createdAt: nowIso(),
      lastLoginAt: null
    };
    this.data.users.push(user);
    this.#audit('team.owner.first_setup', user.id, user.id, null);
    this.#save();
    return publicUser(user);
  }

  ensureOwnerFromEnv(env = process.env) {
    if (!this.needsInitialOwner()) return false;
    const username = normalizeUsername(env.UCHIHA_TEAM_OWNER_USERNAME);
    const displayName = String(env.UCHIHA_TEAM_OWNER_DISPLAY_NAME || 'Owner').trim();
    const passwordHash = String(env.UCHIHA_TEAM_OWNER_PASSWORD_HASH || '').trim();
    if (!username || !passwordHash) return false;
    if (!passwordHash.startsWith('scrypt$')) {
      throw new Error('UCHIHA_TEAM_OWNER_PASSWORD_HASH must use the supported scrypt format.');
    }
    const user = {
      id: newId('usr'),
      username,
      displayName: displayName || username,
      role: 'OWNER',
      active: true,
      passwordHash,
      createdAt: nowIso(),
      lastLoginAt: null
    };
    this.data.users.push(user);
    this.#audit('team.owner.bootstrap', user.id, user.id, null);
    this.#save();
    return true;
  }

  createUser(actor, input) {
    if (!actor || actor.role !== 'OWNER' || !actor.active) throw new Error('Forbidden.');
    const username = normalizeUsername(input && input.username);
    const displayName = String((input && input.displayName) || '').trim();
    const role = String((input && input.role) || '').toUpperCase();
    const password = input && input.password;

    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('Invalid username.');
    if (!displayName || displayName.length > 80) throw new Error('Invalid display name.');
    if (!ROLES.includes(role)) throw new Error('Invalid role.');
    assertPassword(password);
    if (this.data.users.some((u) => u.username === username)) throw new Error('Username already exists.');

    const user = {
      id: newId('usr'),
      username,
      displayName,
      role,
      active: true,
      passwordHash: hashPassword(password),
      createdAt: nowIso(),
      lastLoginAt: null
    };
    this.data.users.push(user);
    this.#audit('team.user.create', actor.id, user.id, { role });
    this.#save();
    return publicUser(user);
  }

  updateUser(actor, userId, input) {
    if (!actor || actor.role !== 'OWNER' || !actor.active) throw new Error('Forbidden.');
    const user = this.data.users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found.');

    if (input && input.role !== undefined) {
      const role = String(input.role).toUpperCase();
      if (!ROLES.includes(role)) throw new Error('Invalid role.');
      if (user.id === actor.id && role !== 'OWNER') throw new Error('Owner cannot remove own owner role.');
      user.role = role;
    }
    if (input && input.active !== undefined) {
      const active = Boolean(input.active);
      if (user.id === actor.id && !active) throw new Error('Owner cannot disable own account.');
      user.active = active;
      if (!active) this.data.sessions = this.data.sessions.filter((s) => s.userId !== user.id);
    }
    if (input && input.displayName !== undefined) {
      const displayName = String(input.displayName).trim();
      if (!displayName || displayName.length > 80) throw new Error('Invalid display name.');
      user.displayName = displayName;
    }
    if (input && input.password !== undefined) {
      assertPassword(input.password);
      user.passwordHash = hashPassword(input.password);
      this.data.sessions = this.data.sessions.filter((s) => s.userId !== user.id);
    }

    this.#audit('team.user.update', actor.id, user.id, {
      role: user.role,
      active: user.active
    });
    this.#save();
    return publicUser(user);
  }

  listUsers(actor) {
    if (!actor || actor.role !== 'OWNER' || !actor.active) throw new Error('Forbidden.');
    return this.data.users.map(publicUser).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  login(usernameValue, password) {
    const username = normalizeUsername(usernameValue);
    const user = this.data.users.find((u) => u.username === username);
    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      this.#audit('auth.login.failed', user ? user.id : null, user ? user.id : null, { username });
      this.#save();
      return null;
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    this.data.sessions = this.data.sessions.filter((s) => Date.parse(s.expiresAt) > now && s.userId !== user.id);
    this.data.sessions.push({
      id: newId('ses'),
      userId: user.id,
      tokenHash: tokenHash(token),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString()
    });
    user.lastLoginAt = new Date(now).toISOString();
    this.#audit('auth.login.success', user.id, user.id, null);
    this.#save();
    return {
      token,
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
      user: publicUser(user)
    };
  }

  authenticate(token) {
    if (!token) return null;
    const hashed = tokenHash(token);
    const now = Date.now();
    const session = this.data.sessions.find((s) => s.tokenHash === hashed && Date.parse(s.expiresAt) > now);
    if (!session) return null;
    const user = this.data.users.find((u) => u.id === session.userId && u.active);
    return user || null;
  }

  logout(token, actor) {
    const hashed = tokenHash(token);
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((s) => s.tokenHash !== hashed);
    if (this.data.sessions.length !== before) {
      this.#audit('auth.logout', actor && actor.id, actor && actor.id, null);
      this.#save();
    }
  }

  capabilities(user) {
    if (!user || !user.active) return [];
    if (user.role === 'OWNER') {
      return ['projects.read', 'preview.use', 'ai.use', 'github.use', 'server.manage', 'domain.manage', 'deploy.plan', 'deploy.approve', 'team.manage'];
    }
    if (user.role === 'DEVELOPER') {
      return ['projects.read', 'preview.use', 'ai.use', 'github.use', 'deploy.plan'];
    }
    return ['projects.read', 'preview.use'];
  }
}

module.exports = {
  ROLES,
  TeamAuthStore,
  hashPassword,
  verifyPassword,
  publicUser
};
