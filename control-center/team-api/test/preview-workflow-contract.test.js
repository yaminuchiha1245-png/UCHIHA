'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.resolve(__dirname, '../../../.github/workflows/uchiha-preview-build.yml');

function workflow() {
  return fs.readFileSync(workflowPath, 'utf8');
}

test('preview build workflow is isolated from VPS and production secrets', () => {
  const text = workflow();
  assert.match(text, /name: UCHIHA Preview Build/);
  assert.match(text, /\[UCHIHA-PREVIEW\]/);
  assert.match(text, /project\.preview\.build/);
  assert.match(text, /permissions:\s*\n\s*contents: read\s*\n\s*issues: write/);
  assert.equal(text.includes('secrets.UCHIHA_VPS'), false);
  assert.equal(text.includes('pull_request_target'), false);
  assert.equal(text.includes('docker.sock'), false);
  assert.equal(text.includes('privileged'), false);
});

test('preview build workflow constrains untrusted build execution', () => {
  const text = workflow();
  assert.match(text, /--network none/);
  assert.match(text, /--cap-drop ALL/);
  assert.match(text, /no-new-privileges:true/);
  assert.match(text, /--pids-limit 256/);
  assert.match(text, /--memory 768m/);
  assert.match(text, /--cpus 1/);
  assert.match(text, /--ignore-scripts/);
  assert.match(text, /secret_like_files_committed/);
  assert.match(text, /artifact_limits_exceeded/);
  assert.match(text, /retention-days: 7/);
});
