'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SecretVault } = require('../secret-vault');
const { ConnectionStore } = require('../connection-store');
const { sanitizeRepo } = require('../github-client');

test('vault encrypts GitHub token and decrypts only with master key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uchiha-vault-'));
  const file = path.join(dir, 'vault.json');
  const key = crypto.randomBytes(32).toString('base64url');
  const vault = new SecretVault(file, key);
  const token = 'github_pat_example_secret_token_123456789';

  vault.put('github.workspace', token, { provider: 'github' });
  const stored = fs.readFileSync(file, 'utf8');
  assert.equal(stored.includes(token), false);
  assert.equal(vault.get('github.workspace'), token);
  assert.equal(vault.metadata('github.workspace').metadata.provider, 'github');
});

test('GitHub connection store keeps only non-secret account and project binding data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uchiha-connections-'));
  const file = path.join(dir, 'connections.json');
  const store = new ConnectionStore(file);

  const status = store.setGithubAccount({ login: 'uchiha-owner', id: 123, name: 'UCHIHA' });
  assert.equal(status.connected, true);
  assert.equal(status.account.login, 'uchiha-owner');

  const binding = store.bindGithubProject('game-zone', 'owner/game-zone', 'main');
  assert.equal(binding.repository, 'owner/game-zone');
  assert.equal(binding.branch, 'main');
});

test('repository sanitizer allow-lists only mobile-safe fields', () => {
  const repo = sanitizeRepo({
    id: 42,
    name: 'game-zone',
    full_name: 'owner/game-zone',
    private: true,
    default_branch: 'main',
    updated_at: '2026-09-05T00:00:00Z',
    archived: false,
    permissions: { pull: true, push: true, admin: false },
    clone_url: 'secret-looking-field',
    ssh_url: 'secret-looking-field'
  });
  assert.equal(repo.fullName, 'owner/game-zone');
  assert.equal(repo.permissions.push, true);
  assert.equal(Object.hasOwn(repo, 'clone_url'), false);
  assert.equal(Object.hasOwn(repo, 'ssh_url'), false);
});
