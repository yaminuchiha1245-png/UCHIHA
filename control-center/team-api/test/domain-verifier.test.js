'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateDomain,
  chooseExpectedRecord,
  matchesExpected
} = require('../domain-verifier');

test('domain validator accepts normal public hostnames and rejects URLs/IPs/local names', () => {
  assert.equal(validateDomain('App.Uchiha-Builder.com'), 'app.uchiha-builder.com');
  assert.throws(() => validateDomain('https://example.com'), (error) => error && error.code === 'domain_invalid');
  assert.throws(() => validateDomain('127.0.0.1'), (error) => error && error.code === 'domain_invalid');
  assert.throws(() => validateDomain('localhost'), (error) => error && error.code === 'domain_invalid');
  assert.throws(() => validateDomain('bad..example.com'), (error) => error && error.code === 'domain_invalid');
});

test('expected record prefers public IPv4 then public IPv6', () => {
  assert.deepEqual(chooseExpectedRecord([
    { address: '2001:4860:4860::8888', family: 6 },
    { address: '8.8.8.8', family: 4 }
  ]), { type: 'A', name: '@', value: '8.8.8.8' });
  assert.deepEqual(chooseExpectedRecord([
    { address: '2001:4860:4860::8888', family: 6 }
  ]), { type: 'AAAA', name: '@', value: '2001:4860:4860::8888' });
});

test('DNS verification requires the exact linked-server address', () => {
  const expected = { type: 'A', name: '@', value: '8.8.8.8' };
  assert.equal(matchesExpected([{ address: '8.8.8.8', family: 4 }], expected), true);
  assert.equal(matchesExpected([{ address: '1.1.1.1', family: 4 }], expected), false);
});
