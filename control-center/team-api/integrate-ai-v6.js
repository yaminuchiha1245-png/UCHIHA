'use strict';

const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(target)) {
  throw new Error('Usage: node integrate-ai-v6.js /path/to/extracted-v6');
}

function file(name) { return path.join(target, name); }
function read(name) { return fs.readFileSync(file(name), 'utf8'); }
function write(name, content) { fs.writeFileSync(file(name), content, 'utf8'); }
function replaceOnce(source, anchor, replacement, label) {
  if (!source.includes(anchor)) throw new Error(`alpha16 integration anchor missing: ${label}`);
  const at = source.indexOf(anchor);
  if (source.indexOf(anchor, at + anchor.length) !== -1) throw new Error(`alpha16 integration anchor ambiguous: ${label}`);
  return source.replace(anchor, replacement);
}

if (!fs.existsSync(file('mobile/server.js'))) throw new Error('alpha16 target missing: mobile/server.js');
for (const name of ['ai-provider-client.js', 'setup-owner-cli.js']) {
  fs.copyFileSync(path.join(__dirname, name), file(`mobile/${name}`));
}

let mobile = read('mobile/server.js');
const serverClientImport = "const { validateConnectionInput, testPasswordConnection } = require('./server-client');\n";
if (!mobile.includes("require('./ai-provider-client')")) {
  mobile = replaceOnce(mobile, serverClientImport,
    serverClientImport +
    "const { PROVIDERS: AI_PROVIDERS, validateProvider: validateAiProvider, listModels: listAiModels, publicProvider: publicAiProvider } = require('./ai-provider-client');\n",
    'mobile AI provider import');
}

const teamAnchor = "  if (req.method === 'GET' && pathname === '/api/mobile/team') {";
if (!mobile.includes('aiProvidersPath')) {
  const routes = `  const aiProvidersPath = pathname === '/api/mobile/ai/providers';
  if (req.method === 'GET' && aiProvidersPath) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'ai.use', res)) return;
    const items = Object.keys(AI_PROVIDERS).map((provider) => {
      const base = publicAiProvider(provider);
      const saved = vault.metadata('ai.' + provider);
      const metadata = saved && saved.metadata ? saved.metadata : {};
      return {
        ...base,
        connected: Boolean(saved),
        updatedAt: saved ? saved.updatedAt : null,
        validatedAt: metadata.validatedAt || null,
        modelCount: Number.isInteger(metadata.modelCount) ? metadata.modelCount : null
      };
    });
    json(res, 200, { ok: true, items });
    return;
  }

  const aiModelsMatch = pathname.match(/^\\/api\\/mobile\\/ai\\/providers\\/(openai|anthropic|gemini)\\/models$/);
  if (req.method === 'GET' && aiModelsMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'ai.use', res)) return;
    try {
      const provider = validateAiProvider(aiModelsMatch[1]);
      const vaultName = 'ai.' + provider;
      if (!vault.has(vaultName)) return json(res, 409, { ok: false, error: 'ai_provider_not_connected' });
      const models = await listAiModels(provider, vault.get(vaultName));
      json(res, 200, { ok: true, provider: publicAiProvider(provider), models });
    } catch (error) {
      const code = error && error.code ? error.code : 'ai_provider_unavailable';
      let status = 502;
      if (code === 'vault_not_configured') status = 503;
      else if (code === 'ai_provider_invalid' || code === 'ai_key_invalid') status = 400;
      else if (code === 'ai_credentials_rejected') status = 401;
      json(res, status, { ok: false, error: code });
    }
    return;
  }

  const aiProviderMatch = pathname.match(/^\\/api\\/mobile\\/ai\\/providers\\/(openai|anthropic|gemini)$/);
  if (req.method === 'POST' && aiProviderMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'team.manage', res)) return;
    try {
      const provider = validateAiProvider(aiProviderMatch[1]);
      const body = await readJson(req);
      const apiKey = String(body && body.apiKey || '').trim();
      const models = await listAiModels(provider, apiKey);
      const validatedAt = new Date().toISOString();
      const saved = vault.put('ai.' + provider, apiKey, {
        provider,
        modelCount: models.length,
        validatedAt
      });
      mobileAudit.record(auth.user, 'ai.provider.connected', {
        provider,
        modelCount: models.length,
        validatedAt
      });
      json(res, 200, {
        ok: true,
        provider: {
          ...publicAiProvider(provider),
          connected: true,
          updatedAt: saved.updatedAt,
          validatedAt,
          modelCount: models.length
        }
      });
    } catch (error) {
      const code = error && error.code ? error.code : 'ai_provider_unavailable';
      let status = 502;
      if (code === 'vault_not_configured') status = 503;
      else if (code === 'ai_provider_invalid' || code === 'ai_key_invalid') status = 400;
      else if (code === 'ai_credentials_rejected') status = 401;
      json(res, status, { ok: false, error: code });
    }
    return;
  }

  if (req.method === 'DELETE' && aiProviderMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'team.manage', res)) return;
    try {
      const provider = validateAiProvider(aiProviderMatch[1]);
      const removed = vault.remove('ai.' + provider);
      if (removed) mobileAudit.record(auth.user, 'ai.provider.disconnected', { provider });
      json(res, 200, { ok: true, provider: { ...publicAiProvider(provider), connected: false } });
    } catch (error) {
      const code = error && error.code ? error.code : 'ai_provider_disconnect_failed';
      json(res, code === 'ai_provider_invalid' ? 400 : 500, { ok: false, error: code });
    }
    return;
  }

` + teamAnchor;
  mobile = replaceOnce(mobile, teamAnchor, routes, 'mobile AI provider routes');
}
write('mobile/server.js', mobile);

console.log('UCHIHA alpha16 guarded AI connections integration prepared.');

// alpha17 extends the AI layer with a guarded task state machine. Tasks can
// request analysis/proposals only; Production remains behind Diff → Preview → Owner Approval.
require('./integrate-ai-task-v6.js');
