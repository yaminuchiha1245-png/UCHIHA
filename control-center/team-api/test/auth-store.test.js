'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TeamAuthStore, hashPassword, verifyPassword } = require('../auth-store');

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uchiha-team-api-'));
  const file = path.join(dir, 'team-auth.json');
  return { dir, file, store: new TeamAuthStore(file) };
}

test('password hashes verify without storing plaintext', () => {
  const hash = hashPassword('StrongPassword-123');
  assert.equal(hash.includes('StrongPassword-123'), false);
  assert.equal(verifyPassword('StrongPassword-123', hash), true);
  assert.equal(verifyPassword('WrongPassword-123', hash), false);
});

test('first-run owner setup works exactly once', () => {
  const { store } = freshStore();
  assert.equal(store.needsInitialOwner(), true);

  const owner = store.createInitialOwner({
    username: 'yamen',
    displayName: 'Yamen',
    password: 'OwnerPassword-123'
  });
  assert.equal(owner.role, 'OWNER');
  assert.equal(store.needsInitialOwner(), false);

  const login = store.login('yamen', 'OwnerPassword-123');
  assert.ok(login);
  assert.equal(login.user.role, 'OWNER');

  assert.throws(() => store.createInitialOwner({
    username: 'other-owner',
    displayName: 'Other Owner',
    password: 'OtherPassword-123'
  }), /already complete/);
});

test('owner bootstrap, login and session authentication work', () => {
  const { store } = freshStore();
  const ownerHash = hashPassword('OwnerPassword-123');
  assert.equal(store.ensureOwnerFromEnv({
    UCHIHA_TEAM_OWNER_USERNAME: 'yamen',
    UCHIHA_TEAM_OWNER_DISPLAY_NAME: 'Yamen',
    UCHIHA_TEAM_OWNER_PASSWORD_HASH: ownerHash
  }), true);

  const login = store.login('YAMEN', 'OwnerPassword-123');
  assert.ok(login);
  assert.equal(login.user.role, 'OWNER');
  const actor = store.authenticate(login.token);
  assert.ok(actor);
  assert.equal(actor.username, 'yamen');
});

test('owner can create developer; developer can edit/build preview but cannot manage team', () => {
  const { store } = freshStore();
  store.ensureOwnerFromEnv({
    UCHIHA_TEAM_OWNER_USERNAME: 'owner',
    UCHIHA_TEAM_OWNER_DISPLAY_NAME: 'Owner',
    UCHIHA_TEAM_OWNER_PASSWORD_HASH: hashPassword('OwnerPassword-123')
  });
  const ownerLogin = store.login('owner', 'OwnerPassword-123');
  const owner = store.authenticate(ownerLogin.token);

  const created = store.createUser(owner, {
    username: 'dev1',
    displayName: 'Developer One',
    role: 'DEVELOPER',
    password: 'DeveloperPassword-123'
  });
  assert.equal(created.role, 'DEVELOPER');

  const devLogin = store.login('dev1', 'DeveloperPassword-123');
  const developer = store.authenticate(devLogin.token);
  assert.ok(developer);
  assert.throws(() => store.createUser(developer, {
    username: 'support1',
    displayName: 'Support',
    role: 'SUPPORT',
    password: 'SupportPassword-123'
  }), /Forbidden/);
  assert.deepEqual(store.capabilities(developer), [
    'projects.read', 'preview.use', 'preview.build', 'source.write', 'ai.use', 'github.use', 'deploy.plan'
  ]);
  assert.equal(store.capabilities(developer).includes('team.manage'), false);
});

test('support can view preview but cannot run builds or write source', () => {
  const { store } = freshStore();
  store.ensureOwnerFromEnv({
    UCHIHA_TEAM_OWNER_USERNAME: 'owner',
    UCHIHA_TEAM_OWNER_DISPLAY_NAME: 'Owner',
    UCHIHA_TEAM_OWNER_PASSWORD_HASH: hashPassword('OwnerPassword-123')
  });
  const ownerLogin = store.login('owner', 'OwnerPassword-123');
  const owner = store.authenticate(ownerLogin.token);
  const support = store.createUser(owner, {
    username: 'support1',
    displayName: 'Support One',
    role: 'SUPPORT',
    password: 'SupportPassword-123'
  });
  const supportLogin = store.login('support1', 'SupportPassword-123');
  const actor = store.authenticate(supportLogin.token);
  assert.deepEqual(store.capabilities(actor), ['projects.read', 'preview.use']);
});

test('disabled account loses active sessions', () => {
  const { store } = freshStore();
  store.ensureOwnerFromEnv({
    UCHIHA_TEAM_OWNER_USERNAME: 'owner',
    UCHIHA_TEAM_OWNER_DISPLAY_NAME: 'Owner',
    UCHIHA_TEAM_OWNER_PASSWORD_HASH: hashPassword('OwnerPassword-123')
  });
  const ownerLogin = store.login('owner', 'OwnerPassword-123');
  const owner = store.authenticate(ownerLogin.token);
  const support = store.createUser(owner, {
    username: 'support1',
    displayName: 'Support One',
    role: 'SUPPORT',
    password: 'SupportPassword-123'
  });
  const supportLogin = store.login('support1', 'SupportPassword-123');
  assert.ok(store.authenticate(supportLogin.token));
  store.updateUser(owner, support.id, { active: false });
  assert.equal(store.authenticate(supportLogin.token), null);
});
