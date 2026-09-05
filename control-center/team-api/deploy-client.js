'use strict';

const crypto = require('node:crypto');
const https = require('node:https');
const { safeRepository, safeBranch } = require('./github-client');

const API_HOST = 'api.github.com';
const MAX_RESPONSE_BYTES = 1024 * 1024;

function safeSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(slug)) {
    const error = new Error('Invalid deploy slug.');
    error.code = 'deploy_slug_invalid';
    throw error;
  }
  return slug;
}

function safeBridgeRepository(value) {
  return safeRepository(value || 'yaminuchiha1245-png/UCHIHA');
}

function commandBody(input) {
  const slug = safeSlug(input && input.projectId);
  const repository = safeRepository(input && input.repository);
  const branch = safeBranch(input && input.branch);
  const requestId = `deploy-${slug}-${crypto.randomBytes(8).toString('hex')}`;
  return {
    requestId,
    body: {
      schema: 'uchiha.command.v1',
      action: 'project.deploy',
      requestId,
      requestedBy: String(input && input.requestedBy || '').slice(0, 120) || null,
      project: {
        slug,
        repository: `https://github.com/${repository}`,
        branch
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
          res.destroy(new Error('GitHub deploy response too large.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = text ? JSON.parse(text) : {}; }
        catch { return reject(new Error('Invalid GitHub deploy response.')); }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error(parsed && parsed.message ? parsed.message : 'GitHub deploy request failed.');
          if (res.statusCode === 401) error.code = 'github_invalid_token';
          else if (res.statusCode === 403) error.code = 'github_issue_write_forbidden';
          else if (res.statusCode === 404) error.code = 'github_bridge_repo_not_found';
          else error.code = 'deploy_command_failed';
          return reject(error);
        }
        resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error('GitHub deploy request timed out.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function createDeployIssue(token, bridgeRepository, input) {
  const bridgeRepo = safeBridgeRepository(bridgeRepository);
  const command = commandBody(input);
  const issue = await requestJson(token, 'POST', `/repos/${bridgeRepo}/issues`, {
    title: `[UCHIHA-CMD] Mobile deploy ${safeSlug(input && input.projectId)}`,
    body: JSON.stringify(command.body)
  });
  if (!Number.isInteger(issue.number) || issue.number < 1) {
    const error = new Error('GitHub did not return a deploy issue number.');
    error.code = 'deploy_issue_invalid';
    throw error;
  }
  return {
    requestId: command.requestId,
    issueNumber: issue.number,
    issueUrl: typeof issue.html_url === 'string' ? issue.html_url : null,
    bridgeRepository: bridgeRepo
  };
}

function parseDeployComment(comment) {
  const login = String(comment && comment.user && comment.user.login || '');
  if (login !== 'github-actions[bot]') return null;
  const text = String(comment && comment.body || '');
  const success = text.match(/UCHIHA Executor completed the approved deployment successfully\. Revision: ([0-9a-f]{7,40})\./i);
  if (success) return { status: 'succeeded', revision: success[1], reason: null, rollback: false };
  const failure = text.match(/UCHIHA could not complete this command\. Safe failure reason: ([^.\n]{1,200})\./i);
  if (failure) return { status: 'failed', revision: null, reason: failure[1], rollback: /rollback/i.test(text) };
  return null;
}

async function getDeployResult(token, bridgeRepository, issueNumber) {
  const bridgeRepo = safeBridgeRepository(bridgeRepository);
  const number = Number(issueNumber);
  if (!Number.isInteger(number) || number < 1) return null;
  const comments = await requestJson(token, 'GET', `/repos/${bridgeRepo}/issues/${number}/comments?per_page=100`, undefined);
  if (!Array.isArray(comments)) return null;
  for (let i = comments.length - 1; i >= 0; i -= 1) {
    const result = parseDeployComment(comments[i]);
    if (result) return result;
  }
  return null;
}

module.exports = {
  safeSlug,
  commandBody,
  parseDeployComment,
  createDeployIssue,
  getDeployResult
};
