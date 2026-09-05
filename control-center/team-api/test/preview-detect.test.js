'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { activeBranch, detectPackage } = require('../preview-detect');

test('preview uses preview branch automatically when present', () => {
  assert.equal(activeBranch({
    repository: 'owner/repo',
    branch: 'main',
    previewBranch: 'uchiha-preview-app'
  }), 'uchiha-preview-app');
  assert.equal(activeBranch({ repository: 'owner/repo', branch: 'main' }), 'main');
});

test('detects common build frameworks without user configuration', () => {
  assert.deepEqual(detectPackage({
    scripts: { build: 'vite build' },
    devDependencies: { vite: '^7.0.0' }
  }), {
    framework: 'vite', outputDir: 'dist', runtime: 'static', hasBuildScript: true
  });

  assert.deepEqual(detectPackage({
    scripts: { build: 'react-scripts build' },
    dependencies: { 'react-scripts': '5.0.1' }
  }), {
    framework: 'react', outputDir: 'build', runtime: 'static', hasBuildScript: true
  });

  assert.deepEqual(detectPackage({
    scripts: { build: 'next build' },
    dependencies: { next: '16.0.0' }
  }), {
    framework: 'next', outputDir: null, runtime: 'node', hasBuildScript: true
  });
});
