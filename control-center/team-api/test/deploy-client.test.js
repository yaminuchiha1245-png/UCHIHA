'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { commandBody, parseDeployComment } = require('../deploy-client');

test('deploy command contains fixed production action and no secret fields', () => {
  const command = commandBody({
    projectId: 'game-zone',
    repository: 'yaminuchiha1245-png/game-zone',
    branch: 'main',
    requestedBy: 'Owner'
  });
  assert.equal(command.body.schema, 'uchiha.command.v1');
  assert.equal(command.body.action, 'project.deploy');
  assert.equal(command.body.project.repository, 'https://github.com/yaminuchiha1245-png/game-zone');
  const encoded = JSON.stringify(command.body).toLowerCase();
  assert.equal(encoded.includes('password'), false);
  assert.equal(encoded.includes('private_key'), false);
  assert.equal(encoded.includes('api_key'), false);
});

test('executor success comment is accepted only from github-actions bot', () => {
  const body = 'UCHIHA Executor completed the approved deployment successfully. Revision: 0123456789ab. Open https://panel.uchiha-builder.com to review.';
  assert.equal(parseDeployComment({ user: { login: 'someone' }, body }), null);
  const result = parseDeployComment({ user: { login: 'github-actions[bot]' }, body });
  assert.deepEqual(result, {
    status: 'succeeded', revision: '0123456789ab', reason: null, rollback: false
  });
});

test('executor failure comment exposes only safe failure reason', () => {
  const result = parseDeployComment({
    user: { login: 'github-actions[bot]' },
    body: 'UCHIHA could not complete this command. Safe failure reason: remote_deploy_failed. No secret values were included in this report.'
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'remote_deploy_failed');
});
