'use strict';

const https = require('node:https');

const API_HOST = 'api.github.com';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function sanitizeRepo(repo) {
  if (!repo || typeof repo !== 'object') return null;
  const fullName = typeof repo.full_name === 'string' ? repo.full_name : '';
  const name = typeof repo.name === 'string' ? repo.name : '';
  if (!fullName || !name) return null;
  return {
    id: Number.isFinite(repo.id) ? repo.id : null,
    name,
    fullName,
    private: Boolean(repo.private),
    defaultBranch: typeof repo.default_branch === 'string' ? repo.default_branch : 'main',
    updatedAt: typeof repo.updated_at === 'string' ? repo.updated_at : null,
    archived: Boolean(repo.archived),
    permissions: repo.permissions && typeof repo.permissions === 'object' ? {
      pull: Boolean(repo.permissions.pull),
      push: Boolean(repo.permissions.push),
      admin: Boolean(repo.permissions.admin)
    } : { pull: true, push: false, admin: false }
  };
}

function requestJson(token, requestPath) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: API_HOST,
      port: 443,
      path: requestPath,
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'UCHIHA-Control-Center',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      timeout: 12000
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          response.destroy(new Error('GitHub response too large.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body;
        try { body = text ? JSON.parse(text) : {}; }
        catch { return reject(new Error('Invalid GitHub response.')); }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(body && body.message ? body.message : 'GitHub request failed.');
          error.status = response.statusCode;
          error.code = response.statusCode === 401 ? 'github_invalid_token' : 'github_request_failed';
          return reject(error);
        }
        resolve({ body, headers: response.headers });
      });
    });
    request.on('timeout', () => request.destroy(new Error('GitHub request timed out.')));
    request.on('error', reject);
    request.end();
  });
}

async function validateToken(token) {
  if (typeof token !== 'string' || token.trim().length < 20 || token.length > 512) {
    const error = new Error('Invalid GitHub token.');
    error.code = 'github_invalid_token';
    throw error;
  }
  const { body } = await requestJson(token.trim(), '/user');
  return {
    login: typeof body.login === 'string' ? body.login : '',
    id: Number.isFinite(body.id) ? body.id : null,
    name: typeof body.name === 'string' ? body.name : null
  };
}

async function listRepos(token) {
  const { body } = await requestJson(token, '/user/repos?per_page=100&sort=updated&affiliation=owner%2Ccollaborator%2Corganization_member');
  if (!Array.isArray(body)) throw new Error('Invalid GitHub repository response.');
  return body.map(sanitizeRepo).filter(Boolean);
}

module.exports = { validateToken, listRepos, sanitizeRepo };
