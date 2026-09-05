'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProjectRegistry, sanitizeProject } = require('../project-registry');

test('sanitizes the v6 project shape without leaking unknown fields', () => {
  const project = sanitizeProject({
    id: 'game-zone',
    name: 'Game Zone',
    status: 'online',
    statusLabel: 'Online',
    environment: 'production',
    domain: 'game.example.com',
    server: 'vps-1',
    lastDeploy: '2026-09-05T00:00:00Z',
    release: 'v1',
    healthScore: 98,
    executor: { mode: 'guarded', approvalRequired: true, secret: 'never' },
    source: { kind: 'github', verified: true, token: 'never' },
    secretValue: 'must-not-pass'
  });

  assert.equal(project.id, 'game-zone');
  assert.equal(project.executor.approvalRequired, true);
  assert.equal(project.source.verified, true);
  assert.equal(Object.hasOwn(project, 'secretValue'), false);
  assert.equal(Object.hasOwn(project.executor, 'secret'), false);
  assert.equal(Object.hasOwn(project.source, 'token'), false);
});

test('reads projects from Control Center state.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uchiha-registry-'));
  const statePath = path.join(dir, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    _meta: { source: 'live_registry', runtimeVersion: 'v6-executor' },
    projects: [
      { id: 'uchiha-control-center', name: 'UCHIHA Control Center', status: 'online', healthScore: 100 },
      { id: 'game-zone', name: 'Game Zone', status: 'development', healthScore: 90 }
    ],
    clients: [],
    dashboard: { decisions: [] }
  }));

  const registry = new ProjectRegistry(statePath);
  const items = registry.list();
  assert.equal(items.length, 2);
  assert.equal(registry.get('game-zone').name, 'Game Zone');
  assert.equal(registry.get('missing'), null);
});
