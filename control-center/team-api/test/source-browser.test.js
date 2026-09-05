'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isSensitiveSourcePath,
  isTextSourcePath,
  sanitizeTree
} = require('../source-browser');

test('source browser allows normal code and documentation files', () => {
  assert.equal(isTextSourcePath('src/main.js'), true);
  assert.equal(isTextSourcePath('app/src/MainActivity.java'), true);
  assert.equal(isTextSourcePath('README.md'), true);
  assert.equal(isTextSourcePath('Dockerfile'), true);
});

test('source browser blocks credential-like files and binary artifacts', () => {
  assert.equal(isSensitiveSourcePath('.env'), true);
  assert.equal(isSensitiveSourcePath('.env.production'), true);
  assert.equal(isSensitiveSourcePath('android/release.jks'), true);
  assert.equal(isSensitiveSourcePath('config/credentials.json'), true);
  assert.equal(isTextSourcePath('assets/logo.png'), false);
  assert.equal(isTextSourcePath('android/release.jks'), false);
});

test('source tree output removes secrets and keeps only safe text files', () => {
  const result = sanitizeTree({
    treeSha: 'a'.repeat(40),
    truncated: false,
    items: [
      { path: 'src/app.ts', size: 100, sha: '1' },
      { path: '.env', size: 30, sha: '2' },
      { path: 'android/signing.key', size: 40, sha: '3' },
      { path: 'public/logo.png', size: 50, sha: '4' },
      { path: 'README.md', size: 60, sha: '5' }
    ]
  });
  assert.deepEqual(result.items.map((item) => item.path), ['README.md', 'src/app.ts']);
});
