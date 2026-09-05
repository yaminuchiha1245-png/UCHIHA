'use strict';

const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(target)) {
  throw new Error('Usage: node integrate-domain-v6.js /path/to/extracted-v6');
}

function file(name) { return path.join(target, name); }
function read(name) { return fs.readFileSync(file(name), 'utf8'); }
function write(name, content) { fs.writeFileSync(file(name), content, 'utf8'); }
function replaceOnce(source, anchor, replacement, label) {
  if (!source.includes(anchor)) throw new Error(`alpha15 integration anchor missing: ${label}`);
  const at = source.indexOf(anchor);
  if (source.indexOf(anchor, at + anchor.length) !== -1) throw new Error(`alpha15 integration anchor ambiguous: ${label}`);
  return source.replace(anchor, replacement);
}

for (const required of ['mobile/server.js', 'compose.yaml']) {
  if (!fs.existsSync(file(required))) throw new Error(`alpha15 target missing: ${required}`);
}

const sourceDir = __dirname;
for (const name of ['domain-store.js', 'domain-verifier.js']) {
  fs.copyFileSync(path.join(sourceDir, name), file(`mobile/${name}`));
}

let mobile = read('mobile/server.js');
const serverClientImport = "const { validateConnectionInput, testPasswordConnection } = require('./server-client');\n";
if (!mobile.includes("require('./domain-store')")) {
  mobile = replaceOnce(mobile, serverClientImport,
    serverClientImport +
    "const { DomainStore } = require('./domain-store');\n" +
    "const { validateDomain, expectedRecordForServer, verifyDomain } = require('./domain-verifier');\n",
    'mobile domain imports');
}

const connectionAnchor = "const connections = new ConnectionStore(CONNECTIONS_PATH);\n";
if (!mobile.includes('const domainStore = new DomainStore(')) {
  mobile = replaceOnce(mobile, connectionAnchor,
    connectionAnchor + "const domainStore = new DomainStore(process.env.UCHIHA_DOMAIN_STATE || './data/domain-state.json');\n",
    'mobile domain store instance');
}

const teamAnchor = "  if (req.method === 'GET' && pathname === '/api/mobile/team') {";
if (!mobile.includes('domainStatusMatch')) {
  const routes = `  const domainStatusMatch = pathname.match(/^\\/api\\/mobile\\/projects\\/([a-zA-Z0-9._-]+)\\/domain$/);
  if (req.method === 'GET' && domainStatusMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'domain.manage', res)) return;
    try {
      const project = projectExists(domainStatusMatch[1]);
      const binding = connections.getProjectServer(project.id);
      json(res, 200, {
        ok: true,
        domain: domainStore.get(project.id),
        serverLinked: Boolean(binding && binding.server),
        serverLabel: binding && binding.server ? binding.server.label : null
      });
    } catch (error) {
      const code = error && error.code ? error.code : 'domain_status_failed';
      json(res, code === 'project_not_found' ? 404 : 500, { ok: false, error: code });
    }
    return;
  }

  if (req.method === 'POST' && domainStatusMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'domain.manage', res)) return;
    try {
      const project = projectExists(domainStatusMatch[1]);
      const binding = connections.getProjectServer(project.id);
      if (!binding || !binding.server) return json(res, 409, { ok: false, error: 'domain_server_not_linked' });
      const body = await readJson(req);
      const domain = validateDomain(body && body.domain);
      const expectedRecord = await expectedRecordForServer(binding.server, domain);
      const configured = domainStore.set(project.id, domain, expectedRecord);
      mobileAudit.record(auth.user, 'domain.configured', {
        projectId: project.id,
        domain,
        recordType: expectedRecord.type,
        recordValue: expectedRecord.value
      });
      json(res, 201, { ok: true, domain: configured });
    } catch (error) {
      const code = error && error.code ? error.code : 'domain_config_failed';
      let status = 500;
      if (code === 'project_not_found') status = 404;
      else if (code === 'domain_server_not_linked') status = 409;
      else if (code === 'domain_invalid' || code === 'domain_server_address_unavailable' || code === 'server_invalid_host' || code === 'server_private_address' || code === 'server_dns_failed') status = 400;
      json(res, status, { ok: false, error: code });
    }
    return;
  }

  const domainVerifyMatch = pathname.match(/^\\/api\\/mobile\\/projects\\/([a-zA-Z0-9._-]+)\\/domain\\/verify$/);
  if (req.method === 'POST' && domainVerifyMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'domain.manage', res)) return;
    try {
      const project = projectExists(domainVerifyMatch[1]);
      const current = domainStore.get(project.id);
      if (!current) return json(res, 409, { ok: false, error: 'domain_not_configured' });
      const binding = connections.getProjectServer(project.id);
      if (!binding || !binding.server) return json(res, 409, { ok: false, error: 'domain_server_not_linked' });
      const expectedRecord = await expectedRecordForServer(binding.server, current.domain);
      let configured = current;
      if (!current.expectedRecord || current.expectedRecord.type !== expectedRecord.type || current.expectedRecord.name !== expectedRecord.name || current.expectedRecord.value !== expectedRecord.value) {
        configured = domainStore.set(project.id, current.domain, expectedRecord);
      }
      const result = await verifyDomain(configured.domain, expectedRecord);
      const verified = domainStore.updateVerification(project.id, result);
      mobileAudit.record(auth.user, 'domain.verified', {
        projectId: project.id,
        domain: verified.domain,
        dnsStatus: verified.dnsStatus,
        httpsStatus: verified.httpsStatus,
        recordType: expectedRecord.type
      });
      json(res, 200, { ok: true, domain: verified });
    } catch (error) {
      const code = error && error.code ? error.code : 'domain_verify_failed';
      let status = 502;
      if (code === 'project_not_found') status = 404;
      else if (code === 'domain_not_configured' || code === 'domain_server_not_linked') status = 409;
      else if (code === 'domain_invalid' || code === 'domain_server_address_unavailable' || code === 'server_invalid_host' || code === 'server_private_address' || code === 'server_dns_failed') status = 400;
      json(res, status, { ok: false, error: code });
    }
    return;
  }

` + teamAnchor;
  mobile = replaceOnce(mobile, teamAnchor, routes, 'mobile domain routes');
}
write('mobile/server.js', mobile);

let compose = read('compose.yaml');
if (!compose.includes('UCHIHA_DOMAIN_STATE:')) {
  const anchor = '      UCHIHA_CONNECTION_STORE: /app/data/mobile/connections.json\n';
  compose = replaceOnce(compose, anchor, anchor + '      UCHIHA_DOMAIN_STATE: /app/data/mobile/domain-state.json\n', 'compose domain state');
}
write('compose.yaml', compose);

console.log('UCHIHA alpha15 domain verification integration prepared.');
