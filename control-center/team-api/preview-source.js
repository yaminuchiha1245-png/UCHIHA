'use strict';

const path = require('node:path');
const { getRepoFile, safeSourcePath } = require('./github-client');

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
  '.woff2': 'font/woff2'
});

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

async function readPreviewFile(githubCredential, binding, requestedPath) {
  const branch = binding && (binding.previewBranch || binding.activeBranch || binding.branch);
  if (!binding || !binding.repository || !branch) {
    const error = new Error('Project is not linked to GitHub.');
    error.code = 'preview_github_not_linked';
    throw error;
  }
  const sourcePath = normalizePreviewPath(requestedPath);
  const file = await getRepoFile(
    githubCredential,
    binding.repository,
    branch,
    sourcePath
  );
  const contentType = mimeFor(file.path);
  const data = contentType.startsWith('text/html')
    ? Buffer.from(protectHtml(file.data.toString('utf8')), 'utf8')
    : file.data;
  return { path: file.path, contentType, data, branch };
}

module.exports = {
  MIME,
  mimeFor,
  normalizePreviewPath,
  protectHtml,
  readPreviewFile
};
