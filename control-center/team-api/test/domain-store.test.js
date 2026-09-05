'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DomainStore } = require('../domain-store');

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uchiha-domain-store-'));
  return new DomainStore(path.join(dir, 'domains.json'));
}

test('domain store keeps only public verification metadata', () => {
  const store = fresh();
  const configured = store.set('game-zone', 'game.example.com', { type: 'A', name: '@', value: '8.8.8.8' });
  assert.equal(configured.dnsStatus, 'pending');
  const verified = store.updateVerification('game-zone', {
    dnsStatus: 'verified', httpsStatus: 'verified', resolvedAddresses: ['8.8.8.8'],
    certificateValidTo: 'Dec 31 23:59:59 2026 GMT', tlsProtocol: 'TLSv1.3', httpStatus: 200
  });
  assert.equal(verified.httpsStatus, 'verified');
  const encoded = JSON.stringify(verified).toLowerCase();
  assert.equal(encoded.includes('password'), false);
  assert.equal(encoded.includes('token'), false);
});

test('changing domain resets verification state', () => {
  const store = fresh();
  store.set('demo-app', 'one.example.com', { type: 'A', name: '@', value: '8.8.8.8' });
  store.updateVerification('demo-app', { dnsStatus: 'verified', httpsStatus: 'verified' });
  const changed = store.set('demo-app', 'two.example.com', { type: 'A', name: '@', value: '8.8.8.8' });
  assert.equal(changed.dnsStatus, 'pending');
  assert.equal(changed.httpsStatus, 'pending');
});
