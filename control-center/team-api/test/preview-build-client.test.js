'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRequestBody, parsePreviewResultComment } = require('../preview-build-client');

test('preview build request contains no secret fields and fixed action', () => {
  const req = buildRequestBody({
    projectId: 'demo-app',
    repository: 'owner/demo-app',
    branch: 'uchiha-preview-demo-app',
    framework: 'vite',
    packageManager: 'npm',
    outputDir: 'dist',
    requestedBy: 'Developer One'
  });
  assert.equal(req.body.schema, 'uchiha.command.v1');
  assert.equal(req.body.action, 'project.preview.build');
  assert.equal(req.body.project.repository, 'owner/demo-app');
  assert.equal(req.body.project.framework, 'vite');
  assert.equal(req.body.project.outputDir, 'dist');
  const encoded = JSON.stringify(req.body).toLowerCase();
  assert.equal(encoded.includes('password'), false);
  assert.equal(encoded.includes('token'), false);
  assert.equal(encoded.includes('secret'), false);
});

test('runtime frameworks cannot be sent to static preview build runner', () => {
  assert.throws(() => buildRequestBody({
    projectId: 'next-app',
    repository: 'owner/next-app',
    branch: 'main',
    framework: 'next',
    packageManager: 'npm',
    outputDir: '.next'
  }), (error) => error && error.code === 'preview_build_framework_unsupported');
});

test('parses signed-format preview result marker without accepting arbitrary comments', () => {
  assert.equal(parsePreviewResultComment('normal comment'), null);
  const ready = parsePreviewResultComment('UCHIHA_PREVIEW_RESULT {"version":1,"status":"ready","runId":123,"artifactName":"uchiha-preview-demo-123","revision":"0123456789012345678901234567890123456789","framework":"vite"}');
  assert.ok(ready);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.runId, 123);
  assert.equal(ready.framework, 'vite');
  const failed = parsePreviewResultComment('note\nUCHIHA_PREVIEW_RESULT {"version":1,"status":"failed","reason":"build_failed"}');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.reason, 'build_failed');
});
