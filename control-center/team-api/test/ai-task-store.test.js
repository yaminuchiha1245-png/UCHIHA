'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AiTaskStore } = require('../ai-task-store');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uchiha-ai-task-'));
  return path.join(dir, 'tasks.json');
}

test('AI task starts behind account bridge and production guard', () => {
  const store = new AiTaskStore(tempFile());
  const actor = { id: 'usr_1', username: 'owner', displayName: 'Owner' };
  const task = store.create('uchiha-control-center', actor, {
    mode: 'refactor_proposal',
    instruction: 'Refactor the project screen without changing production directly.'
  });

  assert.equal(task.stage, 'proposal_requested');
  assert.equal(task.status, 'awaiting_account_bridge');
  assert.equal(task.productionWrite, false);
  assert.equal(task.bridge.mode, 'account');
  assert.equal(task.guard.directProductionWrite, false);
  assert.equal(task.guard.approvalRequired, true);
  assert.deepEqual(task.guard.requiredFlow, ['explain_or_inspect', 'diff', 'preview', 'owner_approval']);
});

test('AI task validates mode, project and instruction', () => {
  const store = new AiTaskStore(tempFile());
  assert.throws(() => store.create('../prod', {}, { mode: 'explain', instruction: 'Explain this.' }), /ai_task_project_invalid/);
  assert.throws(() => store.create('project', {}, { mode: 'write_production', instruction: 'Do it.' }), /ai_task_mode_invalid/);
  assert.throws(() => store.create('project', {}, { mode: 'inspect', instruction: 'x' }), /ai_task_instruction_invalid/);
});

test('AI task list is project scoped', () => {
  const store = new AiTaskStore(tempFile());
  store.create('a', { username: 'dev' }, { mode: 'inspect', instruction: 'Inspect project A.' });
  store.create('b', { username: 'dev' }, { mode: 'explain', instruction: 'Explain project B.' });
  assert.equal(store.list('a').length, 1);
  assert.equal(store.list('a')[0].projectId, 'a');
  assert.equal(store.list('b').length, 1);
});
