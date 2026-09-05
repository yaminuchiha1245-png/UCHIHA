'use strict';

const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const zlib = require('node:zlib');
const { getRepoFile, safeRepository, safeSourcePath } = require('./github-client');

const MAX_ZIP_BYTES = 34 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const RESULT_WORKFLOW_NAME = 'UCHIHA Preview Build';

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8'
});

const locks = new Map();

function previewError(code, message) {
  const value = new Error(message || code);
  value.code = code;
  return value;
}

function mimeFor(filePath) {
  return MIME[path.extname(String(filePath || '')).toLowerCase()] || null;
}

function normalizePreviewPath(value) {
  let sourcePath = String(value || '').replace(/^\/+/, '');
  if (!sourcePath || !path.extname(sourcePath)) sourcePath = 'index.html';
  sourcePath = safeSourcePath(sourcePath);
  if (!mimeFor(sourcePath)) {
    const error = new Error('Preview file type is blocked.');
    error.code = 'preview_file_type_blocked';
    throw error;
  }
  return sourcePath;
}

function protectHtml(value) {
  const html = String(value || '');
  const policy = "default-src 'self' data: blob:; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; media-src 'self' data: blob:; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self'; frame-ancestors 'none'";
  const protection = `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${protection}`);
  return `<!doctype html><html><head>${protection}</head><body>${html}</body></html>`;
}

function protectBuiltHtml(value) {
  const html = String(value || '');
  const policy = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; media-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self'; frame-ancestors 'none'";
  const protection = `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${protection}`);
  return `<!doctype html><html><head>${protection}</head><body>${html}</body></html>`;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function safeZipPath(value) {
  const raw = String(value || '').replace(/^\/+/, '');
  if (!raw || raw.length > 500 || raw.includes('\\') || raw.includes('\0')) {
    throw previewError('preview_artifact_path_invalid');
  }
  const parts = raw.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw previewError('preview_artifact_path_invalid');
  }
  return parts.join('/');
}

function findEocd(zip) {
  const min = Math.max(0, zip.length - 65557);
  for (let offset = zip.length - 22; offset >= min; offset -= 1) {
    if (zip.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw previewError('preview_artifact_zip_invalid', 'ZIP end record not found.');
}

function parseZipEntries(zip) {
  if (!Buffer.isBuffer(zip) || zip.length < 22 || zip.length > MAX_ZIP_BYTES) {
    throw previewError('preview_artifact_zip_invalid');
  }
  const eocd = findEocd(zip);
  const disk = zip.readUInt16LE(eocd + 4);
  const startDisk = zip.readUInt16LE(eocd + 6);
  const countDisk = zip.readUInt16LE(eocd + 8);
  const count = zip.readUInt16LE(eocd + 10);
  const centralSize = zip.readUInt32LE(eocd + 12);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  if (disk !== 0 || startDisk !== 0 || countDisk !== count || count === 0 || count > MAX_ENTRIES) {
    throw previewError('preview_artifact_zip_unsupported');
  }
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw previewError('preview_artifact_zip64_unsupported');
  }
  if (centralOffset + centralSize > eocd) throw previewError('preview_artifact_zip_invalid');

  const entries = [];
  let cursor = centralOffset;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== 0x02014b50) {
      throw previewError('preview_artifact_zip_invalid');
    }
    const flags = zip.readUInt16LE(cursor + 8);
    const method = zip.readUInt16LE(cursor + 10);
    const expectedCrc = zip.readUInt32LE(cursor + 16) >>> 0;
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const uncompressedSize = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const diskStart = zip.readUInt16LE(cursor + 34);
    const external = zip.readUInt32LE(cursor + 38) >>> 0;
    const localOffset = zip.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > zip.length || diskStart !== 0 || (flags & 1) !== 0 || ![0, 8].includes(method)) {
      throw previewError('preview_artifact_zip_unsupported');
    }
    const rawName = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor = end;
    const isDirectory = rawName.endsWith('/') || (external & 0x10) !== 0;
    if (isDirectory) continue;
    const unixMode = (external >>> 16) & 0xffff;
    if ((unixMode & 0o170000) === 0o120000) throw previewError('preview_artifact_symlink_rejected');
    const name = safeZipPath(rawName);
    if (uncompressedSize > MAX_ENTRY_BYTES || compressedSize > MAX_ZIP_BYTES) {
      throw previewError('preview_artifact_limits_exceeded');
    }
    total += uncompressedSize;
    if (total > MAX_UNCOMPRESSED_BYTES) throw previewError('preview_artifact_limits_exceeded');
    if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== 0x04034b50) {
      throw previewError('preview_artifact_zip_invalid');
    }
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zip.length) throw previewError('preview_artifact_zip_invalid');
    const compressed = zip.subarray(dataStart, dataEnd);
    let data;
    try {
      data = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES + 1 });
    } catch {
      throw previewError('preview_artifact_zip_invalid');
    }
    if (data.length !== uncompressedSize || data.length > MAX_ENTRY_BYTES || crc32(data) !== expectedCrc) {
      throw previewError('preview_artifact_zip_invalid');
    }
    entries.push({ name, data });
  }
  if (!entries.some((entry) => entry.name === 'index.html')) {
    throw previewError('preview_artifact_index_missing');
  }
  return entries;
}

function extractZipBuffer(zip, destination) {
  const entries = parseZipEntries(zip);
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const entry of entries) {
    const target = path.resolve(destination, ...entry.name.split('/'));
    const root = path.resolve(destination) + path.sep;
    if (!target.startsWith(root)) throw previewError('preview_artifact_path_invalid');
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, entry.data, { mode: 0o600 });
  }
  return { files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.data.length, 0) };
}

function requestJson(token, repository, endpoint) {
  const repo = safeRepository(repository);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com', port: 443, method: 'GET', path: `/repos/${repo}${endpoint}`,
      headers: {
        Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
        'User-Agent': 'UCHIHA-Control-Center', 'X-GitHub-Api-Version': '2022-11-28'
      }, timeout: 12000
    }, (res) => {
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) return res.destroy(previewError('preview_artifact_response_too_large'));
        chunks.push(chunk);
      });
      res.on('end', () => {
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
        catch { return reject(previewError('preview_artifact_response_invalid')); }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(previewError(res.statusCode === 401 ? 'github_invalid_token' : 'preview_artifact_github_failed'));
        }
        resolve(body);
      });
    });
    req.on('timeout', () => req.destroy(previewError('preview_artifact_timeout')));
    req.on('error', reject);
    req.end();
  });
}

function redirectHostAllowed(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'objects.githubusercontent.com'
    || host.endsWith('.githubusercontent.com')
    || host.endsWith('.blob.core.windows.net');
}

function downloadBuffer(urlValue, token, redirects = 0, authenticated = true) {
  if (redirects > 3) return Promise.reject(previewError('preview_artifact_redirect_rejected'));
  const url = new URL(urlValue);
  if (url.protocol !== 'https:') return Promise.reject(previewError('preview_artifact_redirect_rejected'));
  if (authenticated && url.hostname !== 'api.github.com') return Promise.reject(previewError('preview_artifact_redirect_rejected'));
  if (!authenticated && !redirectHostAllowed(url.hostname)) return Promise.reject(previewError('preview_artifact_redirect_rejected'));
  return new Promise((resolve, reject) => {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'UCHIHA-Control-Center' };
    if (authenticated) headers.Authorization = `Bearer ${token}`;
    const req = https.request(url, { method: 'GET', headers, timeout: 20000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = res.headers.location;
        res.resume();
        if (!location) return reject(previewError('preview_artifact_redirect_rejected'));
        return resolve(downloadBuffer(new URL(location, url).toString(), token, redirects + 1, false));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(previewError(res.statusCode === 401 ? 'github_invalid_token' : 'preview_artifact_download_failed'));
      }
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_ZIP_BYTES) return res.destroy(previewError('preview_artifact_limits_exceeded'));
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(previewError('preview_artifact_timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function verifiedArtifactDescriptor(token, bridgeRepository, build) {
  const repo = safeRepository(bridgeRepository);
  if (!build || build.status !== 'ready' || !Number.isInteger(build.runId)
      || !build.artifactName || !/^[a-f0-9]{40}$/i.test(String(build.revision || ''))) {
    throw previewError('preview_artifact_build_not_ready');
  }
  const run = await requestJson(token, repo, `/actions/runs/${build.runId}`);
  if (!run || run.name !== RESULT_WORKFLOW_NAME || run.event !== 'issues'
      || run.status !== 'completed' || run.conclusion !== 'success') {
    throw previewError('preview_artifact_run_untrusted');
  }
  const list = await requestJson(token, repo, `/actions/runs/${build.runId}/artifacts?per_page=100`);
  const artifacts = Array.isArray(list.artifacts) ? list.artifacts : [];
  const artifact = artifacts.find((item) => item && item.name === build.artifactName && !item.expired);
  if (!artifact || !Number.isInteger(artifact.id)) throw previewError('preview_artifact_missing');
  return {
    id: artifact.id, name: artifact.name, runId: build.runId,
    revision: String(build.revision).toLowerCase(), repository: repo,
    downloadUrl: `https://api.github.com/repos/${repo}/actions/artifacts/${artifact.id}/zip`
  };
}

async function ensurePreviewArtifact(token, bridgeRepository, projectId, build, cacheRoot) {
  const safeProject = String(projectId || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,80}$/.test(safeProject)) throw previewError('preview_artifact_project_invalid');
  const root = path.resolve(cacheRoot || './data/preview-cache');
  const projectRoot = path.join(root, safeProject);
  const markerPath = path.join(projectRoot, '.uchiha-preview.json');
  const existing = (() => {
    try { return JSON.parse(fs.readFileSync(markerPath, 'utf8')); }
    catch { return null; }
  })();
  if (existing && existing.revision === String(build && build.revision || '').toLowerCase()
      && existing.runId === (build && build.runId) && existing.artifactName === (build && build.artifactName)
      && fs.existsSync(path.join(projectRoot, 'index.html'))) {
    return { root: projectRoot, marker: existing, cached: true };
  }
  if (locks.has(safeProject)) return locks.get(safeProject);
  const pending = (async () => {
    const descriptor = await verifiedArtifactDescriptor(token, bridgeRepository, build);
    const zip = await downloadBuffer(descriptor.downloadUrl, token);
    const temp = path.join(root, `.tmp-${safeProject}-${process.pid}-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.rmSync(temp, { recursive: true, force: true });
    const stats = extractZipBuffer(zip, temp);
    const marker = {
      version: 1, runId: descriptor.runId, artifactName: descriptor.name,
      revision: descriptor.revision, files: stats.files, bytes: stats.bytes,
      cachedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(temp, '.uchiha-preview.json'), JSON.stringify(marker), { mode: 0o600 });
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.renameSync(temp, projectRoot);
    return { root: projectRoot, marker, cached: false };
  })();
  locks.set(safeProject, pending);
  try { return await pending; }
  finally { locks.delete(safeProject); }
}

async function readBuiltPreviewFile(githubCredential, binding, requestedPath) {
  const build = binding && binding.previewBuild;
  const projectId = binding && binding.projectId;
  if (!build || build.status !== 'ready' || !projectId) throw previewError('preview_artifact_build_not_ready');
  const bridgeRepository = String(process.env.UCHIHA_BRIDGE_REPO || 'yaminuchiha1245-png/UCHIHA').trim();
  const cacheRoot = process.env.UCHIHA_PREVIEW_CACHE || './data/preview-cache';
  const cached = await ensurePreviewArtifact(githubCredential, bridgeRepository, projectId, build, cacheRoot);
  const relative = normalizePreviewPath(requestedPath);
  const target = path.resolve(cached.root, ...relative.split('/'));
  const prefix = path.resolve(cached.root) + path.sep;
  if (!target.startsWith(prefix) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw previewError('preview_artifact_file_missing');
  }
  let data = fs.readFileSync(target);
  const contentType = mimeFor(relative);
  if (contentType.startsWith('text/html')) data = Buffer.from(protectBuiltHtml(data.toString('utf8')), 'utf8');
  return { path: relative, contentType, data, branch: build.revision, built: true, marker: cached.marker };
}

async function readPreviewFile(githubCredential, binding, requestedPath) {
  if (binding && binding.previewBuild && binding.previewBuild.status === 'ready') {
    return readBuiltPreviewFile(githubCredential, binding, requestedPath);
  }
  const branch = binding && (binding.previewBranch || binding.activeBranch || binding.branch);
  if (!binding || !binding.repository || !branch) {
    const error = new Error('Project is not linked to GitHub.');
    error.code = 'preview_github_not_linked';
    throw error;
  }
  const sourcePath = normalizePreviewPath(requestedPath);
  const file = await getRepoFile(githubCredential, binding.repository, branch, sourcePath);
  const contentType = mimeFor(file.path);
  const data = contentType.startsWith('text/html')
    ? Buffer.from(protectHtml(file.data.toString('utf8')), 'utf8')
    : file.data;
  return { path: file.path, contentType, data, branch, built: false };
}

module.exports = {
  MIME,
  MAX_ZIP_BYTES,
  MAX_UNCOMPRESSED_BYTES,
  MAX_ENTRY_BYTES,
  MAX_ENTRIES,
  mimeFor,
  normalizePreviewPath,
  protectHtml,
  protectBuiltHtml,
  crc32,
  safeZipPath,
  parseZipEntries,
  extractZipBuffer,
  redirectHostAllowed,
  verifiedArtifactDescriptor,
  ensurePreviewArtifact,
  readBuiltPreviewFile,
  readPreviewFile
};
