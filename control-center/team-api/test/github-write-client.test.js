'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_DRAFT_BYTES, previewBranchName, validateDraftInput } = require('../github-write-client');

test('preview branch name is deterministic and project scoped', () => {
  assert.equal(previewBranchName('Game-Zone'), 'uchiha-preview-game-zone');
  assert.equal(previewBranchName('uchiha-control-center'), 'uchiha-preview-uchiha-control-center');
});

test('preview writer accepts safe existing text drafts with original SHA', () => {
  const result = validateDraftInput({
    path: 'src/app.ts',
    originalSha: 'a'.repeat(40),
    content: 'export const ready = true;\n'
  });
  assert.equal(result.sourcePath, 'src/app.ts');
  assert.equal(result.originalSha, 'a'.repeat(40));
});

test('preview writer blocks sensitive files invalid SHA and oversized drafts', () => {
  assert.throws(() => validateDraftInput({
    path: '.env', originalSha: 'a'.repeat(40), content: 'SECRET=x'
  }), /not writable/i);
  assert.throws(() => validateDraftInput({
    path: 'src/app.ts', originalSha: 'bad', content: 'x'
  }), /SHA/i);
  assert.throws(() => validateDraftInput({
    path: 'src/app.ts', originalSha: 'a'.repeat(40), content: 'x'.repeat(MAX_DRAFT_BYTES + 1)
  }), /too large/i);
});
