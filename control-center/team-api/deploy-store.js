'use strict';

const fs = require('node:fs');
const path = require('node:path');

function safeProjectId(value) {
  const id = String(value || '').trim();
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(id)) {
    const error = new Error('Invalid deploy project id.');
    error.code = 'deploy_project_invalid';
    throw error;
  }
  return id;
}

function publicDeploy(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    projectId: row.projectId,
    repository: row.repository || null,
    branch: row.branch || null,
    approvalId: row.approvalId || null,
    stage: row.stage || 'idle',
    requestedBy: row.requestedBy || null,
    approvedBy: row.approvedBy || null,
    issueNumber: Number.isInteger(row.issueNumber) ? row.issueNumber : null,
    issueUrl: row.issueUrl || null,
    requestId: row.requestId || null,
    revision: row.revision || null,
    reason: row.reason || null,
    rollback: Boolean(row.rollback),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

class DeployStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath || './data/deploy-state.json');
    this.data = this.#load();
  }

  #empty() {
    return { version: 1, items: {} };
  }

  #load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || parsed.version !== 1 || !parsed.items || typeof parsed.items !== 'object') {
        throw new Error('Invalid deploy state store.');
      }
      return parsed;
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
      return this.#empty();
    }
  }

  #save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
  }

  get(projectId) {
    return publicDeploy(this.data.items[safeProjectId(projectId)]);
  }

  plan(projectId, input) {
    const id = safeProjectId(projectId);
    const now = new Date().toISOString();
    const row = {
      projectId: id,
      repository: String(input && input.repository || ''),
      branch: String(input && input.branch || 'main'),
      approvalId: String(input && input.approvalId || ''),
      stage: 'pending_approval',
      requestedBy: input && input.requestedBy || null,
      approvedBy: null,
      issueNumber: null,
      issueUrl: null,
      requestId: null,
      revision: null,
      reason: null,
      rollback: false,
      createdAt: now,
      updatedAt: now
    };
    if (!row.repository || !row.approvalId) throw new Error('Deploy plan metadata is incomplete.');
    this.data.items[id] = row;
    this.#save();
    return publicDeploy(row);
  }

  approve(projectId, input) {
    const id = safeProjectId(projectId);
    const row = this.data.items[id];
    if (!row || row.stage !== 'pending_approval') {
      const error = new Error('Deploy approval is not pending.');
      error.code = 'deploy_approval_not_pending';
      throw error;
    }
    if (input && input.approvalId && input.approvalId !== row.approvalId) {
      const error = new Error('Deploy approval id changed.');
      error.code = 'deploy_approval_mismatch';
      throw error;
    }
    row.stage = 'approved';
    row.approvedBy = input && input.approvedBy || null;
    row.updatedAt = new Date().toISOString();
    this.#save();
    return publicDeploy(row);
  }

  start(projectId, input) {
    const id = safeProjectId(projectId);
    const row = this.data.items[id];
    if (!row || row.stage !== 'approved') {
      const error = new Error('Owner approval is required before deployment.');
      error.code = 'deploy_owner_approval_required';
      throw error;
    }
    row.stage = 'deploying';
    row.requestId = String(input && input.requestId || '');
    row.issueNumber = Number(input && input.issueNumber);
    row.issueUrl = input && input.issueUrl || null;
    row.reason = null;
    row.rollback = false;
    row.updatedAt = new Date().toISOString();
    this.#save();
    return publicDeploy(row);
  }

  finish(projectId, result) {
    const id = safeProjectId(projectId);
    const row = this.data.items[id];
    if (!row) return null;
    const status = String(result && result.status || '');
    if (!['succeeded', 'failed'].includes(status)) return publicDeploy(row);
    row.stage = status;
    row.revision = result && result.revision || null;
    row.reason = result && result.reason || null;
    row.rollback = Boolean(result && result.rollback);
    row.updatedAt = new Date().toISOString();
    this.#save();
    return publicDeploy(row);
  }
}

module.exports = { DeployStore, safeProjectId, publicDeploy };
