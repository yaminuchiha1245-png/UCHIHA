'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');

const MAX_OUTPUT_BYTES = 256 * 1024;

function runBridgeCommand(command, env = process.env) {
  return new Promise((resolve, reject) => {
    const script = path.resolve(__dirname, '..', 'scripts', 'bridge-command.js');
    const actor = String(env.UCHIHA_BRIDGE_OWNER || 'yaminuchiha1245-png').trim();
    const body = { ...command, actor };
    const child = execFile(process.execPath, [script], {
      cwd: path.dirname(script),
      env: { ...env, UCHIHA_BRIDGE_OWNER: actor },
      timeout: 12000,
      maxBuffer: MAX_OUTPUT_BYTES
    }, (error, stdout, stderr) => {
      const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
      let parsed = null;
      try { parsed = lines.length ? JSON.parse(lines[lines.length - 1]) : null; } catch {}
      if (error || !parsed || parsed.ok !== true) {
        const failure = new Error(parsed && parsed.error ? parsed.error : 'deploy_bridge_rejected');
        failure.code = parsed && parsed.error ? parsed.error : 'deploy_bridge_rejected';
        failure.detail = String(stderr || '').slice(0, 300);
        reject(failure);
        return;
      }
      resolve(parsed);
    });
    child.stdin.end(JSON.stringify(body));
  });
}

module.exports = { runBridgeCommand };
