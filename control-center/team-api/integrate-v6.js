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
  'github-write-client.js',
  'server-client.js',
  'preview-source.js',
  'preview-detect.js',
  'sandbox-plan.js',
  'preview-build-client.js',
  'source-browser.js',
  'audit-log.js',
  'server.js'
];
for (const file of mobileFiles) {
  const from = path.join(sourceDir, file);
  if (!fs.existsSync(from)) throw new Error(`mobile API file missing: ${file}`);
  fs.copyFileSync(from, path.join(mobileDir, file));
}

let mobileServer = read('mobile/server.js');
const serverClientImport = "const { validateConnectionInput, testPasswordConnection } = require('./server-client');\n";
const githubImport = "const { validateToken, listRepos, getRepoFile } = require('./github-client');\n";
if (mobileServer.includes(githubImport)) {
  mobileServer = replaceOnce(
    mobileServer,
    githubImport,
    "const { validateToken, listRepos, getRepoFile, getRepoTree } = require('./github-client');\n",
    'mobile github tree import'
  );
}
if (!mobileServer.includes("require('./preview-source')")) {
  mobileServer = replaceOnce(
    mobileServer,
    serverClientImport,
    serverClientImport + "const { readPreviewFile } = require('./preview-source');\n",
    'mobile preview import'
  );
}
if (!mobileServer.includes("require('./preview-detect')")) {
  mobileServer = replaceOnce(
    mobileServer,
    serverClientImport,
    serverClientImport + "const { detectPreviewProject } = require('./preview-detect');\n",
    'mobile preview detector import'
  );
}
if (!mobileServer.includes("require('./sandbox-plan')")) {
  mobileServer = replaceOnce(
    mobileServer,
    serverClientImport,
    serverClientImport + "const { createSandboxPlan } = require('./sandbox-plan');\n",
    'mobile sandbox plan import'
  );
}
if (!mobileServer.includes("require('./preview-build-client')")) {
  mobileServer = replaceOnce(
    mobileServer,
    serverClientImport,
    serverClientImport + "const { createPreviewBuildIssue, getPreviewBuildResult } = require('./preview-build-client');\n",
    'mobile preview build client import'
  );
}
if (!mobileServer.includes("require('./source-browser')")) {
  mobileServer = replaceOnce(
    mobileServer,
    serverClientImport,
    serverClientImport + "const { listSourceFiles, readSourceText } = require('./source-browser');\n",
    'mobile source browser import'
  );
}
if (!mobileServer.includes("require('./github-write-client')")) {
  mobileServer = replaceOnce(
    mobileServer,
    serverClientImport,
    serverClientImport + "const { applyDraftToPreview } = require('./github-write-client');\n",
    'mobile source writer import'
  );
}
if (!mobileServer.includes("require('./audit-log')")) {
  mobileServer = replaceOnce(
    mobileServer,
    serverClientImport,
    serverClientImport + "const { MobileAuditLog } = require('./audit-log');\n",
    'mobile audit import'
  );
}
if (!mobileServer.includes('const mobileAudit = new MobileAuditLog(')) {
  const connectionAnchor = "const connections = new ConnectionStore(CONNECTIONS_PATH);\n";
  mobileServer = replaceOnce(
    mobileServer,
    connectionAnchor,
    connectionAnchor + "const mobileAudit = new MobileAuditLog(process.env.UCHIHA_MOBILE_AUDIT_LOG || './data/mobile-audit.jsonl');\n",
    'mobile audit instance'
  );
}

const directPreviewAnchor = "      const source = await getRepoFile(githubToken(), binding.repository, binding.branch, filePath);\n      json(res, 200, {\n        ok: true,\n        projectId: project.id,\n        repository: binding.repository,\n        branch: binding.branch,";
if (mobileServer.includes(directPreviewAnchor)) {
  mobileServer = replaceOnce(
    mobileServer,
    directPreviewAnchor,
    "      const activeBranch = binding.previewBranch || binding.activeBranch || binding.branch;\n      const source = await getRepoFile(githubToken(), binding.repository, activeBranch, filePath);\n      json(res, 200, {\n        ok: true,\n        projectId: project.id,\n        repository: binding.repository,\n        branch: activeBranch,",
    'mobile direct preview active branch'
  );
}

const githubBindAnchor = "      const binding = connections.bindGithubProject(project.id, selected.fullName, selected.defaultBranch);";
if (mobileServer.includes(githubBindAnchor)) {
  mobileServer = replaceOnce(
    mobileServer,
    githubBindAnchor,
    "      const binding = connections.bindGithubProject(project.id, selected.fullName, selected.defaultBranch, { private: selected.private });",
    'mobile github binding privacy'
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
  const previewRoutes = `  const previewMatch = pathname.match(/^\\/api\\/mobile\\/projects\\/([a-zA-Z0-9._-]+)\\/preview$/);\n  if (req.method === 'GET' && previewMatch) {\n    const auth = requireAuth(req, res);\n    if (!auth || !requireCapability(auth.user, 'preview.use', res)) return;\n    try {\n      projectExists(previewMatch[1]);\n      const binding = connections.getGithubProject(previewMatch[1]);\n      if (!binding) return json(res, 409, { ok: false, error: 'preview_github_not_linked' });\n      const detected = await detectPreviewProject(githubToken(), binding);\n      json(res, 200, {\n        ok: true,\n        repository: binding.repository,\n        previewBuild: connections.getPreviewBuild(previewMatch[1]),\n        ...detected\n      });\n    } catch (error) {\n      const code = error && error.code ? error.code : 'preview_unavailable';\n      const status = code === 'github_source_not_found' ? 404 : (code === 'preview_manifest_invalid' || code === 'preview_path_invalid' ? 400 : 502);\n      json(res, status, { ok: false, error: code });\n    }\n    return;\n  }\n\n  const previewBuildMatch = pathname.match(/^\\/api\\/mobile\\/projects\\/([a-zA-Z0-9._-]+)\\/preview\\/build$/);\n  if (req.method === 'POST' && previewBuildMatch) {\n    const auth = requireAuth(req, res);\n    if (!auth || !requireCapability(auth.user, 'preview.build', res)) return;\n    try {\n      const project = projectExists(previewBuildMatch[1]);\n      const binding = connections.getGithubProject(project.id);\n      if (!binding) return json(res, 409, { ok: false, error: 'preview_github_not_linked' });\n      if (binding.private) return json(res, 409, { ok: false, error: 'preview_build_private_repo_requires_app' });\n      const detected = await detectPreviewProject(githubToken(), binding);\n      if (detected.mode !== 'build-required') return json(res, 409, { ok: false, error: 'preview_build_not_required' });\n      const tree = await getRepoTree(githubToken(), binding.repository, detected.branch);\n      const plan = createSandboxPlan(detected, tree.items.map((row) => row.path));\n      if (!plan.supported) {\n        return json(res, 409, { ok: false, error: 'preview_build_unsupported', reason: plan.reason, framework: plan.framework });\n      }\n      const bridgeRepository = String(process.env.UCHIHA_BRIDGE_REPO || 'yaminuchiha1245-png/UCHIHA').trim();\n      const issued = await createPreviewBuildIssue(githubToken(), bridgeRepository, {\n        projectId: project.id,\n        repository: binding.repository,\n        branch: detected.branch,\n        framework: plan.framework,\n        packageManager: plan.packageManager,\n        outputDir: plan.outputDir,\n        requestedBy: auth.user.displayName || auth.user.username\n      });\n      const build = connections.setPreviewBuild(project.id, {\n        ...issued,\n        framework: plan.framework,\n        packageManager: plan.packageManager,\n        outputDir: plan.outputDir,\n        requestedBy: auth.user.displayName || auth.user.username\n      });\n      mobileAudit.record(auth.user, 'preview.build.request', {\n        projectId: project.id,\n        repository: binding.repository,\n        branch: detected.branch,\n        framework: plan.framework,\n        requestId: issued.requestId,\n        issueNumber: issued.issueNumber\n      });\n      json(res, 202, { ok: true, build, isolation: plan.isolation });\n    } catch (error) {\n      const code = error && error.code ? error.code : 'preview_build_request_failed';\n      let status = 502;\n      if (code === 'github_invalid_token') status = 401;\n      else if (code === 'github_issue_write_forbidden') status = 403;\n      else if (code === 'github_bridge_repo_not_found') status = 404;\n      else if (code === 'preview_build_request_invalid' || code.startsWith('preview_build_')) status = 400;\n      json(res, status, { ok: false, error: code });\n    }\n    return;\n  }\n\n  if (req.method === 'GET' && previewBuildMatch) {\n    const auth = requireAuth(req, res);\n    if (!auth || !requireCapability(auth.user, 'preview.use', res)) return;\n    try {\n      projectExists(previewBuildMatch[1]);\n      let build = connections.getPreviewBuild(previewBuildMatch[1]);\n      if (!build) return json(res, 200, { ok: true, build: null });\n      if (build.status === 'queued' || build.status === 'running') {\n        const result = await getPreviewBuildResult(githubToken(), build.bridgeRepository, build.issueNumber);\n        if (result) {\n          build = connections.updatePreviewBuild(previewBuildMatch[1], result);\n          mobileAudit.record(auth.user, result.status === 'ready' ? 'preview.build.ready' : 'preview.build.failed', {\n            projectId: previewBuildMatch[1],\n            requestId: build.requestId,\n            issueNumber: build.issueNumber,\n            runId: build.runId,\n            revision: build.revision,\n            reason: build.reason\n          });\n        }\n      }\n      json(res, 200, { ok: true, build });\n    } catch (error) {\n      const code = error && error.code ? error.code : 'preview_build_status_failed';\n      const status = code === 'github_invalid_token' ? 401 : 502;\n      json(res, status, { ok: false, error: code });\n    }\n    return;\n  }\n\n  const previewFileMatch = pathname.match(/^\\/api\\/mobile\\/projects\\/([a-zA-Z0-9._-]+)\\/preview\\/files\\/(.+)$/);\n  if (req.method === 'GET' && previewFileMatch) {\n    const auth = requireAuth(req, res);\n    if (!auth || !requireCapability(auth.user, 'preview.use', res)) return;\n    try {\n      projectExists(previewFileMatch[1]);\n      const binding = connections.getGithubProject(previewFileMatch[1]);\n      if (!binding) return json(res, 409, { ok: false, error: 'preview_github_not_linked' });\n      const requested = decodeURIComponent(previewFileMatch[2]);\n      const file = await readPreviewFile(githubToken(), binding, requested);\n      rawPreview(res, 200, file.contentType, file.data);\n    } catch (error) {\n      const code = error && error.code ? error.code : 'preview_unavailable';\n      const status = code === 'github_source_not_found' ? 404 : (code === 'preview_file_type_blocked' || code === 'preview_path_invalid' ? 400 : 502);\n      json(res, status, { ok: false, error: code });\n    }\n    return;\n  }\n\n` + teamAnchor;
  mobileServer = replaceOnce(mobileServer, teamAnchor, previewRoutes, 'mobile preview routes');
}

if (!mobileServer.includes('sourceTreeMatch')) {
  const teamAnchor = "  if (req.method === 'GET' && pathname === '/api/mobile/team') {";
  const sourceRoutes = `  const sourceTreeMatch = pathname.match(/^\\/api\\/mobile\\/projects\\/([a-zA-Z0-9._-]+)\\/source\\/tree$/);\n  if (req.method === 'GET' && sourceTreeMatch) {\n    const auth = requireAuth(req, res);\n    if (!auth || !requireCapability(auth.user, 'github.use', res)) return;\n    try {\n      projectExists(sourceTreeMatch[1]);\n      const binding = connections.getGithubProject(sourceTreeMatch[1]);\n      if (!binding) return json(res, 409, { ok: false, error: 'source_github_not_linked' });\n      const tree = await listSourceFiles(githubToken(), binding);\n      json(res, 200, { ok: true, ...tree });\n    } catch (error) {\n      const code = error && error.code ? error.code : 'source_unavailable';\n      const status = code === 'github_source_not_found' ? 404 : (code === 'github_invalid_token' ? 401 : 502);\n      json(res, status, { ok: false, error: code });\n    }\n    return;\n  }\n\n  const sourceFileMatch = pathname.match(/^\\/api\\/mobile\\/projects\\/([a-zA-Z0-9._-]+)\\/source\\/file$/);\n  if (req.method === 'GET' && sourceFileMatch) {\n    const auth = requireAuth(req, res);\n    if (!auth || !requireCapability(auth.user, 'github.use', res)) return;\n    try {\n      projectExists(sourceFileMatch[1]);\n      const binding = connections.getGithubProject(sourceFileMatch[1]);\n      if (!binding) return json(res, 409, { ok: false, error: 'source_github_not_linked' });\n      const file = await readSourceText(githubToken(), binding, requestUrl.searchParams.get('path'));\n      json(res, 200, { ok: true, repository: binding.repository, branch: file.branch, file });\n    } catch (error) {\n      const code = error && error.code ? error.code : 'source_unavailable';\n      let status = 502;\n      if (code === 'github_source_not_found') status = 404;\n      else if (code === 'source_sensitive_blocked') status = 403;\n      else if (code === 'source_file_type_blocked' || code === 'preview_path_invalid') status = 400;\n      else if (code === 'source_file_too_large') status = 413;\n      else if (code === 'github_invalid_token') status = 401;\n      json(res, status, { ok: false, error: code });\n    }\n    return;\n  }\n\n  const sourceApplyMatch = pathname.match(/^\\/api\\/mobile\\/projects\\/([a-zA-Z0-9._-]+)\\/source\\/apply$/);\n  if (req.method === 'POST' && sourceApplyMatch) {\n    const auth = requireAuth(req, res);\n    if (!auth || !requireCapability(auth.user, 'source.write', res)) return;\n    try {\n      projectExists(sourceApplyMatch[1]);\n      const binding = connections.getGithubProject(sourceApplyMatch[1]);\n      if (!binding) return json(res, 409, { ok: false, error: 'source_github_not_linked' });\n      const body = await readJson(req);\n      const result = await applyDraftToPreview(githubToken(), binding, sourceApplyMatch[1], body);\n      const updatedBinding = connections.setGithubPreviewBranch(sourceApplyMatch[1], result.previewBranch);\n      mobileAudit.record(auth.user, 'source.preview.apply', {\n        projectId: sourceApplyMatch[1],\n        repository: result.repository,\n        baseBranch: result.baseBranch,\n        previewBranch: result.previewBranch,\n        path: result.path,\n        commitSha: result.commitSha\n      });\n      json(res, 200, { ok: true, result, binding: updatedBinding });\n    } catch (error) {\n      const code = error && error.code ? error.code : 'source_apply_failed';\n      let status = 502;\n      if (code === 'source_conflict') status = 409;\n      else if (code === 'source_sensitive_blocked' || code === 'github_write_forbidden') status = 403;\n      else if (code === 'source_file_type_blocked' || code === 'preview_path_invalid' || code === 'source_sha_invalid' || code === 'source_content_invalid') status = 400;\n      else if (code === 'source_file_too_large') status = 413;\n      else if (code === 'github_source_not_found') status = 404;\n      else if (code === 'github_invalid_token') status = 401;\n      json(res, status, { ok: false, error: code });\n    }\n    return;\n  }\n\n` + teamAnchor;
  mobileServer = replaceOnce(mobileServer, teamAnchor, sourceRoutes, 'mobile source browser routes');
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
    '      UCHIHA_MOBILE_AUDIT_LOG: /app/data/mobile/mobile-audit.jsonl\n' +
    '      UCHIHA_VAULT_MASTER_KEY: ${UCHIHA_VAULT_MASTER_KEY:?UCHIHA_VAULT_MASTER_KEY is required}\n' +
    '      UCHIHA_TEAM_SETUP_CODE_HASH: ${UCHIHA_TEAM_SETUP_CODE_HASH:?UCHIHA_TEAM_SETUP_CODE_HASH is required}\n' +
    '      UCHIHA_BRIDGE_REPO: ${UCHIHA_BRIDGE_REPO:-yaminuchiha1245-png/UCHIHA}\n';
  compose = replaceOnce(compose, envAnchor, mobileEnv, 'compose owner environment');
}
write('compose.yaml', compose);

console.log('UCHIHA v6 mobile API integration prepared.');
