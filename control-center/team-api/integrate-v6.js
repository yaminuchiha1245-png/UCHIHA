'use strict';

const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(target)) {
  throw new Error('Usage: node integrate-v6.js /path/to/extracted-v6');
}

function read(name) {
  return fs.readFileSync(path.join(target, name), 'utf8');
}

function write(name, content) {
  fs.writeFileSync(path.join(target, name), content, 'utf8');
}

function replaceOnce(source, anchor, replacement, label) {
  if (!source.includes(anchor)) throw new Error(`v6 integration anchor missing: ${label}`);
  const first = source.indexOf(anchor);
  if (source.indexOf(anchor, first + anchor.length) !== -1) {
    throw new Error(`v6 integration anchor is ambiguous: ${label}`);
  }
  return source.replace(anchor, replacement);
}

for (const required of ['server.js', 'package.json', 'Dockerfile', 'compose.yaml']) {
  if (!fs.existsSync(path.join(target, required))) throw new Error(`v6 file missing: ${required}`);
}

const mobileDir = path.join(target, 'mobile');
fs.rmSync(mobileDir, { recursive: true, force: true });
fs.mkdirSync(mobileDir, { recursive: true });

const sourceDir = __dirname;
const mobileFiles = [
  'auth-store.js',
  'project-registry.js',
  'secret-vault.js',
  'connection-store.js',
  'github-client.js',
  'server-client.js',
  'server.js'
];
for (const file of mobileFiles) {
  const from = path.join(sourceDir, file);
  if (!fs.existsSync(from)) throw new Error(`mobile API file missing: ${file}`);
  fs.copyFileSync(from, path.join(mobileDir, file));
}

let server = read('server.js');
const mobileImport = "const { handler: mobileHandler } = require('./mobile/server');";
if (!server.includes(mobileImport)) {
  const importAnchor = "} = require('./lib/auth');\n";
  server = replaceOnce(server, importAnchor, `${importAnchor}${mobileImport}\n`, 'auth import');
}
const apiAnchor = "    if(url.pathname.startsWith('/api/'))return await handleApi(req,res,url.pathname,url);";
if (!server.includes("url.pathname.startsWith('/api/mobile/')")) {
  server = replaceOnce(
    server,
    apiAnchor,
    "    if(url.pathname.startsWith('/api/mobile/'))return await mobileHandler(req,res);\n" + apiAnchor,
    'api dispatch'
  );
}
write('server.js', server);

const pkg = JSON.parse(read('package.json'));
pkg.dependencies = { ...(pkg.dependencies || {}), ssh2: '1.17.0' };
write('package.json', JSON.stringify(pkg, null, 2) + '\n');

let dockerfile = read('Dockerfile');
if (!dockerfile.includes('npm install --omit=optional')) {
  const copyAnchor = 'COPY --chown=node:node package.json server.js ./\n';
  dockerfile = replaceOnce(
    dockerfile,
    copyAnchor,
    copyAnchor + 'RUN npm install --omit=optional --ignore-scripts --no-audit --no-fund && npm cache clean --force\n' +
      'COPY --chown=node:node mobile ./mobile\n',
    'Dockerfile package copy'
  );
}
write('Dockerfile', dockerfile);

let compose = read('compose.yaml');
if (!compose.includes('UCHIHA_VAULT_MASTER_KEY:')) {
  const envAnchor = '      OWNER_PASSWORD_HASH: ${OWNER_PASSWORD_HASH:?OWNER_PASSWORD_HASH is required}\n';
  const mobileEnv =
    envAnchor +
    '      UCHIHA_TEAM_AUTH_STORE: /app/data/mobile/team-auth.json\n' +
    '      UCHIHA_CONTROL_STATE_PATH: /app/data/state.json\n' +
    '      UCHIHA_CONNECTION_VAULT: /app/data/mobile/connection-vault.json\n' +
    '      UCHIHA_CONNECTION_STORE: /app/data/mobile/connections.json\n' +
    '      UCHIHA_VAULT_MASTER_KEY: ${UCHIHA_VAULT_MASTER_KEY:?UCHIHA_VAULT_MASTER_KEY is required}\n' +
    '      UCHIHA_TEAM_SETUP_CODE_HASH: ${UCHIHA_TEAM_SETUP_CODE_HASH:?UCHIHA_TEAM_SETUP_CODE_HASH is required}\n';
  compose = replaceOnce(compose, envAnchor, mobileEnv, 'compose owner environment');
}
write('compose.yaml', compose);

console.log('UCHIHA v6 mobile API integration prepared.');
