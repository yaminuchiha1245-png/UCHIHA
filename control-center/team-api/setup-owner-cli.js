'use strict';

const readline = require('node:readline');
const { TeamAuthStore } = require('./auth-store');

function askLine(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      reject(new Error('Interactive TTY is required. Run this command with docker exec -it.'));
      return;
    }

    let value = '';
    output.write(prompt);
    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();

    const cleanup = () => {
      input.off('keypress', onKeypress);
      try { input.setRawMode(false); } catch {}
      input.pause();
    };

    const onKeypress = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        output.write('\n');
        reject(new Error('Cancelled.'));
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        output.write('\n');
        resolve(value);
        return;
      }
      if (key.name === 'backspace') {
        if (value.length) value = value.slice(0, -1);
        return;
      }
      if (typeof str === 'string' && str && !key.ctrl && !key.meta) value += str;
    };

    input.on('keypress', onKeypress);
  });
}

async function main() {
  const storePath = process.env.UCHIHA_TEAM_AUTH_STORE || '/app/data/mobile/team-auth.json';
  const store = new TeamAuthStore(storePath);
  if (!store.needsInitialOwner()) {
    console.error('Owner setup is already complete.');
    process.exitCode = 2;
    return;
  }

  console.log('UCHIHA Control Center — First Owner Setup');
  console.log('The password is hidden and is never printed.');

  const username = await askLine('Username: ');
  const displayNameInput = await askLine('Display name (Enter = same username): ');
  const password = await askHidden('Password: ');
  const confirm = await askHidden('Confirm password: ');

  if (password !== confirm) throw new Error('Passwords do not match.');
  const user = store.createInitialOwner({
    username,
    displayName: displayNameInput || username,
    password
  });

  console.log(`Owner created successfully: ${user.username}`);
  console.log('You can now sign in from the UCHIHA Control Center app.');
}

main().catch((error) => {
  console.error(error && error.message ? error.message : 'Owner setup failed.');
  process.exitCode = 1;
});
