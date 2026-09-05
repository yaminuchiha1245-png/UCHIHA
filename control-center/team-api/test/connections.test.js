'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SecretVault } = require('../secret-vault');
const { ConnectionStore } = require('../connection-store');
const { sanitizeRepo, safeRepository, safeSourcePath } = require('../github-client');

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

test('GitHub connection store keeps non-secret binding, privacy and preview build metadata', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uchiha-connections-'));
  const file = path.join(dir, 'connections.json');
  const store = new ConnectionStore(file);

  const status = store.setGithubAccount({ login: 'uchiha-owner', id: 123, name: 'UCHIHA' });
  assert.equal(status.connected, true);
  assert.equal(status.account.login, 'uchiha-owner');

  const binding = store.bindGithubProject('game-zone', 'owner/game-zone', 'main', { private: true });
  assert.equal(binding.repository, 'owner/game-zone');
  assert.equal(binding.branch, 'main');
  assert.equal(binding.private, true);

  const queued = store.setPreviewBuild('game-zone', {
    requestId: 'preview-game-zone-1',
    issueNumber: 44,
    issueUrl: 'https://github.com/owner/UCHIHA/issues/44',
    bridgeRepository: 'owner/UCHIHA',
    framework: 'vite',
    packageManager: 'npm',
    outputDir: 'dist',
    requestedBy: 'Developer One'
  });
  assert.equal(queued.status, 'queued');
  assert.equal(queued.issueNumber, 44);
  const ready = store.updatePreviewBuild('game-zone', {
    status: 'ready',
    runId: 99,
    artifactName: 'uchiha-preview-game-zone-99',
    revision: '0123456789012345678901234567890123456789'
  });
  assert.equal(ready.status, 'ready');
  assert.equal(store.getGithubProject('game-zone').previewBuild.runId, 99);
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

test('preview GitHub source identifiers reject traversal and arbitrary repository values', () => {
  assert.equal(safeRepository('owner/game-zone'), 'owner/game-zone');
  assert.equal(safeSourcePath('/public/index.html'), 'public/index.html');
  assert.equal(safeSourcePath('assets/app.css'), 'assets/app.css');

  assert.throws(() => safeRepository('https://github.com/owner/repo'), /Invalid GitHub repository/);
  assert.throws(() => safeSourcePath('../secret.txt'), /Invalid source path/);
  assert.throws(() => safeSourcePath('public/../secret.txt'), /Invalid source path/);
  assert.throws(() => safeSourcePath('public\\secret.txt'), /Invalid source path/);
});
