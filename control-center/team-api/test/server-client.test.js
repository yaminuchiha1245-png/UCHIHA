'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validHostname, isPublicAddress, validateConnectionInput } = require('../server-client');

test('server host guard accepts public VPS addresses and rejects local/private targets', () => {
  assert.equal(validHostname('155.254.35.187'), true);
  assert.equal(validHostname('vps.example.com'), true);
  assert.equal(validHostname('localhost'), false);
  assert.equal(validHostname('service.local'), false);

  assert.equal(isPublicAddress('155.254.35.187'), true);
  assert.equal(isPublicAddress('127.0.0.1'), false);
  assert.equal(isPublicAddress('10.0.0.4'), false);
  assert.equal(isPublicAddress('192.168.1.20'), false);
  assert.equal(isPublicAddress('169.254.10.2'), false);
  assert.equal(isPublicAddress('203.0.113.5'), false);
  assert.equal(isPublicAddress('::1'), false);
  assert.equal(isPublicAddress('2001:db8::1'), false);
});

test('SSH connection input is normalized without logging or reshaping password', () => {
  const input = validateConnectionInput({
    label: 'Primary VPS',
    host: 'VPS.Example.COM',
    port: 22,
    username: 'root',
    password: 'a-private-password'
  });
  assert.equal(input.host, 'vps.example.com');
  assert.equal(input.port, 22);
  assert.equal(input.username, 'root');
  assert.equal(input.password, 'a-private-password');
});
