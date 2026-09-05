'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');
const { Client } = require('ssh2');

function validHostname(host) {
  if (typeof host !== 'string') return false;
  const value = host.trim().toLowerCase();
  if (!value || value.length > 253 || value.endsWith('.') || value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local')) return false;
  if (net.isIP(value)) return true;
  if (!/^[a-z0-9.-]+$/.test(value) || value.includes('..')) return false;
  return value.split('.').every((part) => part.length > 0 && part.length <= 63 && !part.startsWith('-') && !part.endsWith('-'));
}

function isPublicIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address) {
  const value = String(address || '').toLowerCase();
  if (!value || value === '::' || value === '::1') return false;
  if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('ff')) return false;
  if (value.startsWith('2001:db8:')) return false;
  if (value.startsWith('::ffff:')) return isPublicIpv4(value.slice(7));
  return true;
}

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

async function resolvePublicHost(host) {
  const value = String(host || '').trim().toLowerCase();
  if (!validHostname(value)) {
    const error = new Error('Invalid server host.');
    error.code = 'server_invalid_host';
    throw error;
  }

  if (net.isIP(value)) {
    if (!isPublicAddress(value)) {
      const error = new Error('Private or reserved server address is not allowed.');
      error.code = 'server_private_address';
      throw error;
    }
    return [{ address: value, family: net.isIP(value) }];
  }

  let addresses;
  try {
    addresses = await dns.lookup(value, { all: true, verbatim: true });
  } catch {
    const error = new Error('Server host could not be resolved.');
    error.code = 'server_dns_failed';
    throw error;
  }
  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
    const error = new Error('Server host resolves to a private or reserved address.');
    error.code = 'server_private_address';
    throw error;
  }
  return addresses;
}

function validateConnectionInput(input) {
  const host = String(input && input.host || '').trim().toLowerCase();
  const port = Number(input && input.port || 22);
  const username = String(input && input.username || '').trim();
  const password = String(input && input.password || '');
  const label = String(input && input.label || host).trim();

  if (!validHostname(host)) throw Object.assign(new Error('Invalid server host.'), { code: 'server_invalid_host' });
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Object.assign(new Error('Invalid SSH port.'), { code: 'server_invalid_port' });
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(username)) throw Object.assign(new Error('Invalid SSH username.'), { code: 'server_invalid_username' });
  if (!password || password.length > 1024) throw Object.assign(new Error('Invalid SSH password.'), { code: 'server_invalid_password' });
  if (!label || label.length > 80) throw Object.assign(new Error('Invalid server label.'), { code: 'server_invalid_label' });

  return { host, port, username, password, label };
}

async function testPasswordConnection(input, expectedFingerprint) {
  const config = validateConnectionInput(input);
  const addresses = await resolvePublicHost(config.host);
  const resolved = addresses[0];

  return new Promise((resolve, reject) => {
    const client = new Client();
    let observedFingerprint = null;
    let hostKeyMismatch = false;
    let settled = false;

    const finishError = (error) => {
      if (settled) return;
      settled = true;
      try { client.end(); } catch {}
      if (hostKeyMismatch) {
        const changed = new Error('SSH host key changed.');
        changed.code = 'ssh_host_key_changed';
        reject(changed);
        return;
      }
      const safe = new Error('SSH connection failed.');
      safe.code = error && error.level === 'client-authentication' ? 'ssh_auth_failed' : 'ssh_connection_failed';
      reject(safe);
    };

    client.on('ready', () => {
      client.exec('printf UCHIHA_OK', (error, stream) => {
        if (error) return finishError(error);
        let stdout = '';
        let stderr = '';
        stream.on('data', (chunk) => {
          if (stdout.length < 128) stdout += chunk.toString('utf8');
        });
        stream.stderr.on('data', (chunk) => {
          if (stderr.length < 128) stderr += chunk.toString('utf8');
        });
        stream.on('close', (code) => {
          if (settled) return;
          if (code !== 0 || stdout !== 'UCHIHA_OK') {
            const failed = new Error('SSH verification command failed.');
            failed.code = 'ssh_verification_failed';
            return finishError(failed);
          }
          settled = true;
          client.end();
          resolve({
            ok: true,
            fingerprint: observedFingerprint,
            resolvedAddress: resolved.address,
            family: resolved.family
          });
        });
      });
    });

    client.on('error', finishError);
    client.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      readyTimeout: 12000,
      keepaliveInterval: 5000,
      keepaliveCountMax: 2,
      tryKeyboard: false,
      hostHash: 'sha256',
      hostVerifier: (hash) => {
        observedFingerprint = String(hash || '');
        if (!expectedFingerprint) return true;
        const matches = observedFingerprint === expectedFingerprint;
        if (!matches) hostKeyMismatch = true;
        return matches;
      }
    });
  });
}

module.exports = {
  validHostname,
  isPublicAddress,
  resolvePublicHost,
  validateConnectionInput,
  testPasswordConnection
};
