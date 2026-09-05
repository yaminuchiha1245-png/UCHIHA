'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRequest,
  normalizeProviderResponse,
  listModels,
  validateProvider,
  validateApiKey
} = require('../ai-provider-client');

test('AI provider ids and keys are strictly validated', () => {
  assert.equal(validateProvider('OpenAI'), 'openai');
  assert.throws(() => validateProvider('other'), (error) => error && error.code === 'ai_provider_invalid');
  assert.equal(validateApiKey('  abcdefgh123  '), 'abcdefgh123');
  assert.throws(() => validateApiKey('short'), (error) => error && error.code === 'ai_key_invalid');
  assert.throws(() => validateApiKey('abcdefgh\nleak'), (error) => error && error.code === 'ai_key_invalid');
});

test('official provider requests keep API keys in headers, never URLs', () => {
  const key = 'secret-key-123456';
  const openai = buildRequest('openai', key);
  assert.equal(openai.hostname, 'api.openai.com');
  assert.equal(openai.path, '/v1/models');
  assert.equal(openai.headers.Authorization, `Bearer ${key}`);
  assert.equal(openai.path.includes(key), false);

  const anthropic = buildRequest('anthropic', key);
  assert.equal(anthropic.hostname, 'api.anthropic.com');
  assert.equal(anthropic.headers['x-api-key'], key);
  assert.equal(anthropic.headers['anthropic-version'], '2023-06-01');
  assert.equal(anthropic.path.includes(key), false);

  const gemini = buildRequest('gemini', key);
  assert.equal(gemini.hostname, 'generativelanguage.googleapis.com');
  assert.equal(gemini.headers['x-goog-api-key'], key);
  assert.match(gemini.headers['x-goog-api-client'], /^uchiha-control-center\//);
  assert.equal(gemini.path.includes(key), false);
});

test('provider responses normalize to safe model ids', () => {
  assert.deepEqual(normalizeProviderResponse('openai', { data: [{ id: 'gpt-z' }, { id: 'gpt-a' }] }), [
    { id: 'gpt-a', name: 'gpt-a' },
    { id: 'gpt-z', name: 'gpt-z' }
  ]);
  assert.deepEqual(normalizeProviderResponse('anthropic', { data: [{ id: 'claude-x', display_name: 'Claude X' }] }), [
    { id: 'claude-x', name: 'Claude X' }
  ]);
  assert.deepEqual(normalizeProviderResponse('gemini', { models: [{ name: 'models/gemini-x', displayName: 'Gemini X' }] }), [
    { id: 'gemini-x', name: 'Gemini X' }
  ]);
});

test('listModels validates through injectable transport without exposing key', async () => {
  let captured;
  const models = await listModels('openai', 'secret-key-123456', async (options) => {
    captured = options;
    return { data: [{ id: 'gpt-test' }] };
  });
  assert.equal(captured.path, '/v1/models');
  assert.equal(captured.path.includes('secret-key-123456'), false);
  assert.equal(models[0].id, 'gpt-test');
});
