'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { packageManagerFromFiles, createSandboxPlan } = require('../sandbox-plan');

test('detects package manager from lockfile without user settings', () => {
  assert.equal(packageManagerFromFiles(['package.json', 'pnpm-lock.yaml']), 'pnpm');
  assert.equal(packageManagerFromFiles(['package.json', 'yarn.lock']), 'yarn');
  assert.equal(packageManagerFromFiles(['package.json', 'package-lock.json']), 'npm');
});

test('creates constrained Vite build plan', () => {
  const plan = createSandboxPlan({
    mode: 'build-required',
    framework: 'vite',
    branch: 'uchiha-preview-app',
    outputDir: 'dist'
  }, ['package.json', 'package-lock.json']);

  assert.equal(plan.supported, true);
  assert.deepEqual(plan.install, ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  assert.deepEqual(plan.build, ['./node_modules/.bin/vite', 'build']);
  assert.equal(plan.outputDir, 'dist');
  assert.equal(plan.isolation.productionSecrets, false);
  assert.equal(plan.isolation.runAsRoot, false);
  assert.equal(plan.isolation.buildNetwork, false);
});

test('does not pretend generic Node runtime can be static-previewed', () => {
  const plan = createSandboxPlan({
    mode: 'build-required',
    framework: 'node',
    branch: 'main'
  }, ['package.json']);
  assert.equal(plan.supported, false);
  assert.equal(plan.reason, 'runtime_preview_not_supported');
});
