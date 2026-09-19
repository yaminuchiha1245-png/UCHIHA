'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ProjectSecretStore } = require('../project-secret-store');

test('project secret store writes protected env files without exposing values in list', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uchiha-project-secrets-'));
  const store = new ProjectSecretStore(dir);
  store.put('game-zone', 'BOT_TOKEN', 'abc123:secret-value');
  store.put('game-zone', 'API_KEY', 'hello#world');

  const items = store.list('game-zone');
  assert.deepEqual(items.map((item) => item.key), ['API_KEY', 'BOT_TOKEN']);
  assert.equal(JSON.stringify(items).includes('secret-value'), false);

  const file = path.join(dir, 'game-zone.env');
  const raw = fs.readFileSync(file, 'utf8');
  assert.match(raw, /BOT_TOKEN=abc123:secret-value/);
  assert.match(raw, /API_KEY=hello#world/);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  assert.equal(store.remove('game-zone', 'BOT_TOKEN'), true);
  assert.deepEqual(store.list('game-zone').map((item) => item.key), ['API_KEY']);
});

test('project secret store rejects multiline values and invalid keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uchiha-project-secrets-'));
  const store = new ProjectSecretStore(dir);
  assert.throws(() => store.put('x', 'BAD-KEY', 'x'), /Invalid secret key/);
  assert.throws(() => store.put('x', 'TOKEN', 'line1\nline2'), /Invalid secret value/);
});
