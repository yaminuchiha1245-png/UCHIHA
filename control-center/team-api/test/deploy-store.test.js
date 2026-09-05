'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DeployStore } = require('../deploy-store');

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uchiha-deploy-store-'));
  return new DeployStore(path.join(dir, 'deploy.json'));
}

test('deploy state enforces plan approval start success order', () => {
  const store = fresh();
  assert.equal(store.get('game-zone'), null);
  const plan = store.plan('game-zone', {
    repository: 'yaminuchiha1245-png/game-zone',
    branch: 'main',
    approvalId: 'apr-123',
    requestedBy: 'Developer One'
  });
  assert.equal(plan.stage, 'pending_approval');
  assert.throws(() => store.start('game-zone', { requestId: 'x', issueNumber: 1 }),
    (error) => error && error.code === 'deploy_owner_approval_required');

  const approved = store.approve('game-zone', { approvalId: 'apr-123', approvedBy: 'Owner' });
  assert.equal(approved.stage, 'approved');
  const started = store.start('game-zone', { requestId: 'deploy-1', issueNumber: 44, issueUrl: 'https://example.test/44' });
  assert.equal(started.stage, 'deploying');
  const done = store.finish('game-zone', { status: 'succeeded', revision: '0123456789ab' });
  assert.equal(done.stage, 'succeeded');
  assert.equal(done.revision, '0123456789ab');
});

test('approval id mismatch is rejected', () => {
  const store = fresh();
  store.plan('demo-app', { repository: 'owner/demo-app', branch: 'main', approvalId: 'apr-good' });
  assert.throws(() => store.approve('demo-app', { approvalId: 'apr-wrong' }),
    (error) => error && error.code === 'deploy_approval_mismatch');
});

test('failed executor result records rollback metadata without secrets', () => {
  const store = fresh();
  store.plan('demo-app', { repository: 'owner/demo-app', branch: 'main', approvalId: 'apr-good' });
  store.approve('demo-app', { approvalId: 'apr-good', approvedBy: 'Owner' });
  store.start('demo-app', { requestId: 'deploy-2', issueNumber: 45 });
  const failed = store.finish('demo-app', { status: 'failed', reason: 'health_or_start_failed', rollback: true });
  assert.equal(failed.stage, 'failed');
  assert.equal(failed.rollback, true);
  assert.equal(JSON.stringify(failed).includes('password'), false);
  assert.equal(JSON.stringify(failed).includes('token'), false);
});
