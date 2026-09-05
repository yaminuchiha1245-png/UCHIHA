'use strict';

const crypto = require('node:crypto');
const https = require('node:https');
const { safeRepository, safeBranch } = require('./github-client');

const API_HOST = 'api.github.com';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const RESULT_PREFIX = 'UCHIHA_PREVIEW_RESULT ';

function safeProjectId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,80}$/.test(id)) {
    const error = new Error('Invalid preview project id.');
    error.code = 'preview_build_project_invalid';
    throw error;
  }
  return id;
}

function safeBridgeRepository(value) {
  return safeRepository(value || 'yaminuchiha1245-png/UCHIHA');
}

function buildRequestBody(input) {
  const projectId = safeProjectId(input && input.projectId);
  const repository = safeRepository(input && input.repository);
  const branch = safeBranch(input && input.branch);
  const framework = String(input && input.framework || '').trim().toLowerCase();
  const packageManager = String(input && input.packageManager || '').trim().toLowerCase();
  const outputDir = String(input && input.outputDir || '').trim();
  const requestedBy = String(input && input.requestedBy || '').trim().slice(0, 120);
  if (!['vite', 'react', 'angular', 'astro'].includes(framework)) {
    const error = new Error('Preview framework is not supported by the static build runner.');
    error.code = 'preview_build_framework_unsupported';
    throw error;
  }
  if (!['npm', 'pnpm', 'yarn'].includes(packageManager)) {
    const error = new Error('Preview package manager is invalid.');
    error.code = 'preview_build_package_manager_invalid';
    throw error;
  }
  if (!outputDir || outputDir.length > 80 || outputDir.startsWith('/') || outputDir.includes('..') || outputDir.includes('\\')) {
    const error = new Error('Preview output directory is invalid.');
    error.code = 'preview_build_output_invalid';
    throw error;
  }
  const requestId = `preview-${projectId}-${crypto.randomBytes(8).toString('hex')}`;
  return {
    requestId,
    title: `[UCHIHA-CMD] Preview build ${projectId}`,
    body: {
      schema: 'uchiha.command.v1',
      action: 'project.preview.build',
      requestId,
      requestedBy: requestedBy || null,
      project: {
        slug: projectId,
        repository,
        branch,
        framework,
        packageManager,
        outputDir
      }
    }
  };
}

function requestJson(token, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = https.request({
      hostname: API_HOST,
      port: 443,
      method,
      path: requestPath,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'UCHIHA-Control-Center',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(payload ? {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': payload.length
        } : {})
      },
      timeout: 12000
    }, (res) => {
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          res.destroy(new Error('GitHub preview build response too large.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = text ? JSON.parse(text) : {}; }
        catch { return reject(new Error('Invalid GitHub preview build response.')); }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error(parsed && parsed.message ? parsed.message : 'GitHub preview build request failed.');
          error.status = res.statusCode;
          if (res.statusCode === 401) error.code = 'github_invalid_token';
          else if (res.statusCode === 403) error.code = 'github_issue_write_forbidden';
          else if (res.statusCode === 404) error.code = 'github_bridge_repo_not_found';
          else if (res.statusCode === 422) error.code = 'preview_build_request_invalid';
          else error.code = 'preview_build_bridge_failed';
          return reject(error);
        }
        resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error('GitHub preview build request timed out.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function createPreviewBuildIssue(token, bridgeRepository, input) {
  const bridgeRepo = safeBridgeRepository(bridgeRepository);
  const request = buildRequestBody(input);
  const issue = await requestJson(token, 'POST', `/repos/${bridgeRepo}/issues`, {
    title: request.title,
    body: JSON.stringify(request.body)
  });
  if (!Number.isInteger(issue.number) || issue.number < 1) {
    const error = new Error('GitHub did not return a valid preview build issue.');
    error.code = 'preview_build_issue_invalid';
    throw error;
  }
  return {
    requestId: request.requestId,
    issueNumber: issue.number,
    issueUrl: typeof issue.html_url === 'string' ? issue.html_url : null,
    bridgeRepository: bridgeRepo
  };
}

function parsePreviewResultComment(body) {
  const text = String(body || '').trim();
  const index = text.indexOf(RESULT_PREFIX);
  if (index < 0) return null;
  const raw = text.slice(index + RESULT_PREFIX.length).trim().split('\n')[0];
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return null; }
  if (!parsed || parsed.version !== 1 || !['ready', 'failed'].includes(parsed.status)) return null;
  return {
    status: parsed.status,
    runId: Number.isInteger(parsed.runId) ? parsed.runId : null,
    artifactName: typeof parsed.artifactName === 'string' ? parsed.artifactName.slice(0, 180) : null,
    revision: typeof parsed.revision === 'string' && /^[a-f0-9]{40}$/i.test(parsed.revision) ? parsed.revision : null,
    framework: typeof parsed.framework === 'string' ? parsed.framework.slice(0, 40) : null,
    reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 160) : null
  };
}

async function getPreviewBuildResult(token, bridgeRepository, issueNumber) {
  const bridgeRepo = safeBridgeRepository(bridgeRepository);
  const number = Number(issueNumber);
  if (!Number.isInteger(number) || number < 1) {
    const error = new Error('Invalid preview build issue number.');
    error.code = 'preview_build_issue_invalid';
    throw error;
  }
  const comments = await requestJson(token, 'GET', `/repos/${bridgeRepo}/issues/${number}/comments?per_page=100`, undefined);
  if (!Array.isArray(comments)) return null;
  for (let i = comments.length - 1; i >= 0; i -= 1) {
    const result = parsePreviewResultComment(comments[i] && comments[i].body);
    if (result) return result;
  }
  return null;
}

module.exports = {
  RESULT_PREFIX,
  safeProjectId,
  buildRequestBody,
  parsePreviewResultComment,
  createPreviewBuildIssue,
  getPreviewBuildResult
};
