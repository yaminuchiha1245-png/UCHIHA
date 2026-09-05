'use strict';

const https = require('node:https');
const { getRepoFile, safeRepository, safeBranch, safeSourcePath } = require('./github-client');
const { isSensitiveSourcePath, isTextSourcePath } = require('./source-browser');

const API_HOST = 'api.github.com';
const MAX_WRITE_RESPONSE_BYTES = 1024 * 1024;
const MAX_DRAFT_BYTES = 200 * 1024;

function previewBranchName(projectId) {
  const id = String(projectId || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{1,120}$/.test(id)) {
    const error = new Error('Invalid project id.');
    error.code = 'project_id_invalid';
    throw error;
  }
  const compact = id.replace(/[^a-z0-9._-]/g, '-').slice(0, 80);
  return `uchiha-preview-${compact}`;
}

function requestJson(token, method, requestPath, body, allowedStatuses = []) {
  return new Promise((resolve, reject) => {
    const data = body === undefined || body === null
      ? null
      : Buffer.from(JSON.stringify(body), 'utf8');
    const headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'UCHIHA-Control-Center',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (data) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      headers['Content-Length'] = data.length;
    }

    const request = https.request({
      hostname: API_HOST,
      port: 443,
      path: requestPath,
      method,
      headers,
      timeout: 12000
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_WRITE_RESPONSE_BYTES) {
          response.destroy(new Error('GitHub write response too large.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = {};
        try { parsed = text ? JSON.parse(text) : {}; }
        catch { return reject(Object.assign(new Error('Invalid GitHub response.'), { code: 'github_response_invalid' })); }
        const status = Number(response.statusCode || 0);
        if ((status >= 200 && status < 300) || allowedStatuses.includes(status)) {
          resolve({ status, body: parsed });
          return;
        }
        const error = new Error(parsed && parsed.message ? parsed.message : 'GitHub write request failed.');
        error.status = status;
        if (status === 401) error.code = 'github_invalid_token';
        else if (status === 403) error.code = 'github_write_forbidden';
        else if (status === 404) error.code = 'github_source_not_found';
        else if (status === 409 || status === 422) error.code = 'source_conflict';
        else error.code = 'github_write_failed';
        reject(error);
      });
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('GitHub write timed out.'), { code: 'github_timeout' })));
    request.on('error', reject);
    if (data) request.write(data);
    request.end();
  });
}

function encodeRepository(repo) {
  return safeRepository(repo).split('/').map(encodeURIComponent).join('/');
}

function encodeSourcePath(value) {
  return safeSourcePath(value).split('/').map(encodeURIComponent).join('/');
}

async function ensurePreviewBranch(token, binding, projectId) {
  if (!binding || !binding.repository || !binding.branch) {
    const error = new Error('Project GitHub repository is not linked.');
    error.code = 'source_github_not_linked';
    throw error;
  }
  const repository = safeRepository(binding.repository);
  const baseBranch = safeBranch(binding.branch);
  const previewBranch = previewBranchName(projectId);
  const repoPath = encodeRepository(repository);
  const previewRefPath = `/repos/${repoPath}/git/ref/heads/${encodeURIComponent(previewBranch)}`;

  const existing = await requestJson(token, 'GET', previewRefPath, null, [404]);
  if (existing.status === 200) {
    const sha = existing.body && existing.body.object && existing.body.object.sha;
    if (!/^[a-f0-9]{40}$/i.test(String(sha || ''))) {
      const error = new Error('Preview branch ref is invalid.');
      error.code = 'preview_branch_invalid';
      throw error;
    }
    return { branch: previewBranch, created: false, sha };
  }

  const base = await requestJson(
    token,
    'GET',
    `/repos/${repoPath}/commits/${encodeURIComponent(baseBranch)}`
  );
  const baseSha = base.body && base.body.sha;
  if (!/^[a-f0-9]{40}$/i.test(String(baseSha || ''))) {
    const error = new Error('Base branch SHA is unavailable.');
    error.code = 'base_branch_invalid';
    throw error;
  }

  try {
    await requestJson(token, 'POST', `/repos/${repoPath}/git/refs`, {
      ref: `refs/heads/${previewBranch}`,
      sha: baseSha
    });
    return { branch: previewBranch, created: true, sha: baseSha };
  } catch (error) {
    if (error && error.code === 'source_conflict') {
      const raced = await requestJson(token, 'GET', previewRefPath);
      const sha = raced.body && raced.body.object && raced.body.object.sha;
      if (/^[a-f0-9]{40}$/i.test(String(sha || ''))) {
        return { branch: previewBranch, created: false, sha };
      }
    }
    throw error;
  }
}

function validateDraftInput(input) {
  const sourcePath = safeSourcePath(input && input.path);
  if (!isTextSourcePath(sourcePath)) {
    const error = new Error('Source file is not writable.');
    error.code = isSensitiveSourcePath(sourcePath) ? 'source_sensitive_blocked' : 'source_file_type_blocked';
    throw error;
  }
  const originalSha = String(input && input.originalSha || '').trim();
  if (!/^[a-f0-9]{40}$/i.test(originalSha)) {
    const error = new Error('Original file SHA is required.');
    error.code = 'source_sha_invalid';
    throw error;
  }
  const content = input && input.content;
  if (typeof content !== 'string') {
    const error = new Error('Draft content must be text.');
    error.code = 'source_content_invalid';
    throw error;
  }
  const data = Buffer.from(content, 'utf8');
  if (data.length > MAX_DRAFT_BYTES) {
    const error = new Error('Draft is too large.');
    error.code = 'source_file_too_large';
    throw error;
  }
  return { sourcePath, originalSha, content, data };
}

async function applyDraftToPreview(token, binding, projectId, input) {
  const draft = validateDraftInput(input);
  const branchState = await ensurePreviewBranch(token, binding, projectId);
  const repository = safeRepository(binding.repository);

  const current = await getRepoFile(token, repository, branchState.branch, draft.sourcePath);
  if (!current.sha || current.sha.toLowerCase() !== draft.originalSha.toLowerCase()) {
    const error = new Error('Source changed since the draft was opened.');
    error.code = 'source_conflict';
    error.currentSha = current.sha || null;
    throw error;
  }

  const repoPath = encodeRepository(repository);
  const encodedPath = encodeSourcePath(draft.sourcePath);
  const result = await requestJson(token, 'PUT', `/repos/${repoPath}/contents/${encodedPath}`, {
    message: `UCHIHA Preview: update ${draft.sourcePath}`,
    content: draft.data.toString('base64'),
    sha: draft.originalSha,
    branch: branchState.branch
  });

  const commitSha = result.body && result.body.commit && result.body.commit.sha;
  const fileSha = result.body && result.body.content && result.body.content.sha;
  return {
    repository,
    baseBranch: binding.branch,
    previewBranch: branchState.branch,
    branchCreated: branchState.created,
    path: draft.sourcePath,
    previousSha: draft.originalSha,
    fileSha: typeof fileSha === 'string' ? fileSha : null,
    commitSha: typeof commitSha === 'string' ? commitSha : null
  };
}

module.exports = {
  MAX_DRAFT_BYTES,
  previewBranchName,
  validateDraftInput,
  ensurePreviewBranch,
  applyDraftToPreview
};
