'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {
  crc32,
  parseZipEntries,
  extractZipBuffer,
  protectBuiltHtml,
  normalizeBuiltPath
} = require('../preview-artifact-cache');

function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    const mode = file.mode === undefined ? 0o100644 : file.mode;
    central.writeUInt32LE(((mode & 0xffff) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralData = Buffer.concat(centrals);
  const localData = Buffer.concat(locals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(localData.length, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([localData, centralData, end]);
}

test('valid deflated preview artifact extracts bounded static files', () => {
  const zip = makeZip([
    { name: 'index.html', data: '<!doctype html><div id="app"></div><script src="assets/app.js"></script>' },
    { name: 'assets/app.js', data: 'document.getElementById("app").textContent="ok";' },
    { name: 'assets/app.css', data: 'body{margin:0}' }
  ]);
  const entries = parseZipEntries(zip);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].name, 'index.html');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uchiha-preview-artifact-'));
  const result = extractZipBuffer(zip, root);
  assert.equal(result.files, 3);
  assert.equal(fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8').includes('textContent'), true);
});

test('preview artifact rejects traversal entries', () => {
  const zip = makeZip([
    { name: 'index.html', data: '<h1>ok</h1>' },
    { name: '../secret.txt', data: 'blocked' }
  ]);
  assert.throws(() => parseZipEntries(zip), (error) => error && error.code === 'preview_artifact_path_invalid');
});

test('preview artifact rejects symlink entries', () => {
  const zip = makeZip([
    { name: 'index.html', data: '<h1>ok</h1>' },
    { name: 'assets/link', data: '/etc/passwd', mode: 0o120777 }
  ]);
  assert.throws(() => parseZipEntries(zip), (error) => error && error.code === 'preview_artifact_symlink_rejected');
});

test('preview artifact requires root index.html', () => {
  const zip = makeZip([{ name: 'dist/page.html', data: '<h1>nested</h1>' }]);
  assert.throws(() => parseZipEntries(zip), (error) => error && error.code === 'preview_artifact_index_missing');
});

test('built preview CSP allows local scripts but blocks network connections', () => {
  const html = protectBuiltHtml('<html><head><title>x</title></head><body><script src="/app.js"></script></body></html>');
  assert.match(html, /script-src 'self'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /frame-src 'none'/);
  assert.match(html, /form-action 'none'/);
});

test('built preview paths stay inside artifact and map SPA routes to index', () => {
  assert.equal(normalizeBuiltPath('/assets/app.js'), 'assets/app.js');
  assert.equal(normalizeBuiltPath('/dashboard'), 'index.html');
  assert.throws(() => normalizeBuiltPath('../secret.js'), (error) => error && error.code === 'preview_path_invalid');
});
