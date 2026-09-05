'use strict';

const path = require('node:path');
const { getRepoFile, getRepoTree, safeSourcePath } = require('./github-client');

const MAX_SOURCE_FILE_BYTES = 512 * 1024;
const TEXT_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json',
  '.md', '.txt', '.xml', '.yml', '.yaml', '.toml', '.ini', '.properties',
  '.java', '.kt', '.kts', '.gradle', '.py', '.php', '.rb', '.go', '.rs',
  '.c', '.h', '.cpp', '.hpp', '.cs', '.swift', '.dart', '.sh', '.bash',
  '.zsh', '.sql', '.graphql', '.gql', '.vue', '.svelte'
]);
const ALLOWED_EXTENSIONLESS = new Set([
  'dockerfile', 'makefile', 'procfile', 'gemfile', 'rakefile', 'license', 'readme'
]);
const SENSITIVE_NAMES = new Set([
  '.env', '.npmrc', '.pypirc', 'credentials.json', 'credential.json',
  'secrets.json', 'secret.json', 'service-account.json', 'service_account.json',
  'id_rsa', 'id_ed25519', 'known_hosts'
]);
const SENSITIVE_EXTENSIONS = new Set([
  '.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.der', '.crt'
]);

function activeBranch(binding) {
  return binding && (binding.previewBranch || binding.activeBranch || binding.branch);
}

function isSensitiveSourcePath(value) {
  const sourcePath = safeSourcePath(value);
  const lower = sourcePath.toLowerCase();
  const base = path.posix.basename(lower);
  if (SENSITIVE_NAMES.has(base)) return true;
  if (base.startsWith('.env.')) return true;
  if (SENSITIVE_EXTENSIONS.has(path.posix.extname(base))) return true;
  if (lower.startsWith('.git/') || lower.includes('/.git/')) return true;
  return false;
}

function isTextSourcePath(value) {
  const sourcePath = safeSourcePath(value);
  if (isSensitiveSourcePath(sourcePath)) return false;
  const base = path.posix.basename(sourcePath).toLowerCase();
  const ext = path.posix.extname(base);
  if (ext) return TEXT_EXTENSIONS.has(ext);
  return ALLOWED_EXTENSIONLESS.has(base);
}

function sanitizeTree(tree) {
  const source = tree && Array.isArray(tree.items) ? tree.items : [];
  const items = [];
  for (const row of source) {
    if (!row || typeof row.path !== 'string') continue;
    let sourcePath;
    try { sourcePath = safeSourcePath(row.path); }
    catch { continue; }
    if (!isTextSourcePath(sourcePath)) continue;
    items.push({
      path: sourcePath,
      size: Number.isFinite(row.size) ? row.size : null,
      sha: typeof row.sha === 'string' ? row.sha : null
    });
  }
  items.sort((a, b) => a.path.localeCompare(b.path));
  return {
    items,
    truncated: Boolean(tree && tree.truncated),
    treeSha: tree && typeof tree.treeSha === 'string' ? tree.treeSha : null
  };
}

async function listSourceFiles(githubCredential, binding) {
  const branch = activeBranch(binding);
  if (!binding || !binding.repository || !branch) {
    const error = new Error('Project GitHub repository is not linked.');
    error.code = 'source_github_not_linked';
    throw error;
  }
  const tree = await getRepoTree(githubCredential, binding.repository, branch);
  const sanitized = sanitizeTree(tree);
  return {
    repository: binding.repository,
    branch,
    baseBranch: binding.branch,
    previewBranch: binding.previewBranch || null,
    ...sanitized
  };
}

async function readSourceText(githubCredential, binding, requestedPath) {
  const branch = activeBranch(binding);
  if (!binding || !binding.repository || !branch) {
    const error = new Error('Project GitHub repository is not linked.');
    error.code = 'source_github_not_linked';
    throw error;
  }
  const sourcePath = safeSourcePath(requestedPath);
  if (!isTextSourcePath(sourcePath)) {
    const error = new Error('Source file type is not allowed.');
    error.code = isSensitiveSourcePath(sourcePath) ? 'source_sensitive_blocked' : 'source_file_type_blocked';
    throw error;
  }
  const file = await getRepoFile(githubCredential, binding.repository, branch, sourcePath);
  if (file.data.length > MAX_SOURCE_FILE_BYTES) {
    const error = new Error('Source file is too large.');
    error.code = 'source_file_too_large';
    throw error;
  }
  const text = file.data.toString('utf8');
  if (text.includes('\uFFFD')) {
    const error = new Error('Source file is not valid UTF-8 text.');
    error.code = 'source_not_text';
    throw error;
  }
  return {
    path: file.path,
    sha: file.sha,
    size: file.size,
    branch,
    content: text
  };
}

module.exports = {
  MAX_SOURCE_FILE_BYTES,
  activeBranch,
  isSensitiveSourcePath,
  isTextSourcePath,
  sanitizeTree,
  listSourceFiles,
  readSourceText
};
