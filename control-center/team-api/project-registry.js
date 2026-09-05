'use strict';

const fs = require('node:fs');
const path = require('node:path');

function safeString(value) {
  return typeof value === 'string' ? value : '';
}

function safeNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function sanitizeProject(project) {
  if (!project || typeof project !== 'object') return null;
  const executor = project.executor && typeof project.executor === 'object' ? project.executor : {};
  const source = project.source && typeof project.source === 'object' ? project.source : {};
  const id = safeString(project.id).trim();
  const name = safeString(project.name).trim();
  if (!id || !name) return null;

  return {
    id,
    name,
    status: safeString(project.status),
    statusLabel: safeString(project.statusLabel),
    environment: safeString(project.environment),
    domain: safeString(project.domain),
    server: safeString(project.server),
    lastDeploy: safeString(project.lastDeploy),
    release: safeString(project.release),
    healthScore: safeNumber(project.healthScore),
    executor: {
      mode: safeString(executor.mode),
      approvalRequired: Boolean(executor.approvalRequired)
    },
    source: {
      kind: safeString(source.kind),
      verified: Boolean(source.verified)
    }
  };
}

class ProjectRegistry {
  constructor(statePath) {
    this.statePath = statePath ? path.resolve(statePath) : null;
  }

  #readState() {
    if (!this.statePath) {
      const error = new Error('Project registry is not configured.');
      error.code = 'registry_not_configured';
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
    } catch (error) {
      const wrapped = new Error('Project registry is unavailable.');
      wrapped.code = 'registry_unavailable';
      wrapped.cause = error;
      throw wrapped;
    }
    if (!parsed || !Array.isArray(parsed.projects)) {
      const error = new Error('Project registry format is invalid.');
      error.code = 'registry_invalid';
      throw error;
    }
    return parsed;
  }

  list() {
    return this.#readState().projects.map(sanitizeProject).filter(Boolean);
  }

  get(id) {
    const projectId = safeString(id).trim();
    if (!projectId) return null;
    return this.list().find((project) => project.id === projectId) || null;
  }
}

module.exports = { ProjectRegistry, sanitizeProject };
