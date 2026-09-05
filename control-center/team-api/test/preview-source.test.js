'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mimeFor,
  normalizePreviewPath,
  protectHtml
} = require('../preview-source');

test('preview path accepts bounded web assets and falls back to index', () => {
  assert.equal(normalizePreviewPath(''), 'index.html');
  assert.equal(normalizePreviewPath('about'), 'index.html');
  assert.equal(normalizePreviewPath('assets/app.js'), 'assets/app.js');
  assert.equal(mimeFor('assets/site.css'), 'text/css; charset=utf-8');
});

test('preview path rejects traversal and unsupported executable files', () => {
  assert.throws(() => normalizePreviewPath('../secret.txt'));
  assert.throws(() => normalizePreviewPath('server.sh'));
  assert.throws(() => normalizePreviewPath('app.exe'));
});

test('preview HTML receives a restrictive network policy', () => {
  const html = protectHtml('<html><head><title>Demo</title></head><body>OK</body></html>');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /referrer/);
});
