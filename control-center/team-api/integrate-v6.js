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
  'preview-source.js',
  'server.js'
];
for (const file of mobileFiles) {
  const from = path.join(sourceDir, file);
  if (!fs.existsSync(from)) throw new Error(`mobile API file missing: ${file}`);
  fs.copyFileSync(from, path.join(mobileDir, file));
}

let mobileServer = read('mobile/server.js');
if (!mobileServer.includes("require('./preview-source')")) {
  const sourceImport = "const { validateConnectionInput, testPasswordConnection } = require('./server-client');\n";
  mobileServer = replaceOnce(
    mobileServer,
    sourceImport,
    sourceImport + "const { readPreviewFile } = require('./preview-source');\n",
    'mobile preview import'
  );
}
if (!mobileServer.includes('function rawPreview(')) {
  const jsonEnd = "  res.end(data);\n}\n\nfunction readJson(req) {";
  const rawHelper = "  res.end(data);\n}\n\nfunction rawPreview(res, status, contentType, data) {\n" +
    "  const body = Buffer.isBuffer(data) ? data : Buffer.from(data || '');\n" +
    "  res.writeHead(status, {\n" +
    "    'Content-Type': contentType,\n" +
    "    'Content-Length': body.length,\n" +
    "    'Cache-Control': 'no-store',\n" +
    "    'X-Content-Type-Options': 'nosniff',\n" +
    "    'Referrer-Policy': 'no-referrer'\n" +
    "  });\n" +
    "  res.end(body);\n" +
    "}\n\nfunction readJson(req) {";
  mobileServer = replaceOnce(mobileServer, jsonEnd, rawHelper, 'mobile raw preview helper');
}
if (!mobileServer.includes('previewFileMatch')) {
  const teamAnchor = "  if (req.method === 'GET' && pathname === '/api/mobile/team') {";
  const previewRoutes = `  const previewMatch = pathname.match(/^\\/api\\/mobile\\/projects\\/([a-zA-Z0-9._-]+)\\/preview$/);\n  if (req.method === 'GET' && previewMatch) {\n    const auth = requireAuth(req, res);\n    if (!auth || !requireCapability(auth.user, 'preview.use', res)) return;\n    try {\n      projectExists(previewMatch[1]);\n      const binding = connections.getGithubProject(previewMatch[1]);\n      if (!binding) return json(res, 409, { ok: false, error: 'preview_github_not_linked' });\n      await readPreviewFile(githubToken(), binding, 'index.html');\n      json(res, 200, {\n        ok: true,\n        mode: 'static-source',\n        entry: 'index.html',\n        repository: binding.repository,\n        branch: binding.branch\n      });\n    } catch (error) {\n      const code = error && error.code ? error.code : 'preview_unavailable';\n      const status = code === 'github_source_not_found' ? 404 : (code === 'preview_file_type_blocked' || code === 'preview_path_invalid' ? 400 : 502);\n      json(res, status, { ok: false, error: code });\n    }\n    return;\n  }\n\n  const previewFileMatch = pathname.match(/^\\/api\\/mobile\\/projects\\/([a-zA-Z0-9._-]+)\\/preview\\/files\\/(.+)$/);\n  if (req.method === 'GET' && previewFileMatch) {\n    const auth = requireAuth(req, res);\n    if (!auth || !requireCapability(auth.user, 'preview.use', res)) return;\n    try {\n      projectExists(previewFileMatch[1]);\n      const binding = connections.getGithubProject(previewFileMatch[1]);\n      if (!binding) return json(res, 409, { ok: false, error: 'preview_github_not_linked' });\n      const requested = decodeURIComponent(previewFileMatch[2]);\n      const file = await readPreviewFile(githubToken(), binding, requested);\n      rawPreview(res, 200, file.contentType, file.data);\n    } catch (error) {\n      const code = error && error.code ? error.code : 'preview_unavailable';\n      const status = code === 'github_source_not_found' ? 404 : (code === 'preview_file_type_blocked' || code === 'preview_path_invalid' ? 400 : 502);\n      json(res, status, { ok: false, error: code });\n    }\n    return;\n  }\n\n` + teamAnchor;
  mobileServer = replaceOnce(mobileServer, teamAnchor, previewRoutes, 'mobile preview routes');
}
write('mobile/server.js', mobileServer);

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
