'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MODES = Object.freeze(['explain', 'inspect', 'refactor_proposal']);
const MAX_TASKS = 1000;

function nowIso() {
  return new Date().toISOString();
}

function fail(code, message) {
  const error = new Error(message || code);
  error.code = code;
  throw error;
}

function validateProjectId(value) {
  const projectId = String(value || '').trim();
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(projectId)) fail('ai_task_project_invalid');
  return projectId;
}

function validateMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (!MODES.includes(mode)) fail('ai_task_mode_invalid');
  return mode;
}

function validateInstruction(value) {
  const instruction = String(value || '').trim();
  if (instruction.length < 4 || instruction.length > 4000) fail('ai_task_instruction_invalid');
  return instruction;
}

function publicTask(task) {
  return JSON.parse(JSON.stringify(task));
}

class AiTaskStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath || './data/ai-tasks.json');
    this.data = this.#load();
  }

  #empty() {
    return { version: 1, tasks: [] };
  }

  #load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tasks)) fail('ai_task_store_invalid');
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

  create(projectIdValue, actor, input) {
    const projectId = validateProjectId(projectIdValue);
    const mode = validateMode(input && input.mode);
    const instruction = validateInstruction(input && input.instruction);
    const createdAt = nowIso();
    const task = {
      id: `ait_${crypto.randomBytes(12).toString('hex')}`,
      projectId,
      mode,
      instruction,
      requestedBy: actor && (actor.displayName || actor.username) ? (actor.displayName || actor.username) : 'UCHIHA user',
      requestedByUserId: actor && actor.id ? actor.id : null,
      stage: 'proposal_requested',
      status: 'awaiting_account_bridge',
      createdAt,
      updatedAt: createdAt,
      productionWrite: false,
      bridge: {
        mode: 'account',
        provider: null,
        state: 'not_connected'
      },
      guard: {
        directProductionWrite: false,
        approvalRequired: true,
        requiredFlow: ['explain_or_inspect', 'diff', 'preview', 'owner_approval']
      }
    };
    this.data.tasks.unshift(task);
    if (this.data.tasks.length > MAX_TASKS) this.data.tasks.length = MAX_TASKS;
    this.#save();
    return publicTask(task);
  }

  list(projectIdValue, limitValue) {
    const projectId = validateProjectId(projectIdValue);
    const limit = Math.min(Math.max(Number(limitValue) || 30, 1), 100);
    return this.data.tasks
      .filter((task) => task.projectId === projectId)
      .slice(0, limit)
      .map(publicTask);
  }

  get(projectIdValue, taskIdValue) {
    const projectId = validateProjectId(projectIdValue);
    const taskId = String(taskIdValue || '').trim();
    if (!/^ait_[a-f0-9]{24}$/.test(taskId)) fail('ai_task_id_invalid');
    const task = this.data.tasks.find((row) => row.projectId === projectId && row.id === taskId);
    return task ? publicTask(task) : null;
  }
}

module.exports = {
  MODES,
  AiTaskStore,
  validateProjectId,
  validateMode,
  validateInstruction
};
