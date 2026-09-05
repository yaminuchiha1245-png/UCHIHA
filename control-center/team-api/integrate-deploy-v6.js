'use strict';

const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(target)) {
  throw new Error('Usage: node integrate-deploy-v6.js /path/to/extracted-v6');
}

function file(name) { return path.join(target, name); }
function read(name) { return fs.readFileSync(file(name), 'utf8'); }
function write(name, content) { fs.writeFileSync(file(name), content, 'utf8'); }
function replaceOnce(source, anchor, replacement, label) {
  if (!source.includes(anchor)) throw new Error(`alpha14 integration anchor missing: ${label}`);
  const at = source.indexOf(anchor);
  if (source.indexOf(anchor, at + anchor.length) !== -1) throw new Error(`alpha14 integration anchor ambiguous: ${label}`);
  return source.replace(anchor, replacement);
}

for (const required of ['mobile/server.js', 'scripts/bridge-command.js', 'compose.yaml']) {
  if (!fs.existsSync(file(required))) throw new Error(`alpha14 target missing: ${required}`);
}

const sourceDir = __dirname;
for (const name of ['deploy-store.js', 'deploy-client.js', 'deploy-local-bridge.js']) {
  fs.copyFileSync(path.join(sourceDir, name), file(`mobile/${name}`));
}

let bridge = read('scripts/bridge-command.js');
const planAnchor = "  if(action==='project.plan-deploy'){\n    const approvals=await readJson(APPROVALS_FILE,[]);";
if (!bridge.includes('mobile_plan_repository_synced')) {
  bridge = replaceOnce(bridge, planAnchor,
`  if(action==='project.plan-deploy'){
    if(projectInput.repository){
      const repository=safeRepo(projectInput.repository);
      const branch=safeBranch(projectInput.branch||existing.branch||'main');
      const name=projectInput.name ? safeText(projectInput.name,120) : existing.name;
      if(!repository || !branch || !name) return reject('invalid_project_fields');
      existing.repository=repository;
      existing.branch=branch;
      existing.name=name;
      existing.updatedAt=new Date().toISOString();
      state._meta={...(state._meta||{}),source:'live_registry',lastMobilePlanSyncAt:existing.updatedAt};
      await writeJsonAtomic(STATE_FILE,state);
      await appendAudit(AUDIT_FILE,{type:'mobile_plan_repository_synced',requestId,actor:cmd.actor,project:existing.name,slug,repository,branch});
    }
    const approvals=await readJson(APPROVALS_FILE,[]);`, 'bridge plan repository sync');
}

const prepareAnchor = "  if(action==='project.deploy.prepare'){";
if (!bridge.includes("action==='project.approve-deploy'")) {
  bridge = replaceOnce(bridge, prepareAnchor,
`  if(action==='project.approve-deploy'){
    const approvalId=safeText(cmd.approvalId,120);
    if(!approvalId || !approvalId.startsWith('apr-')) return reject('invalid_approval_id');
    const approvals=await readJson(APPROVALS_FILE,[]);
    const approval=approvals.find(a=>a.id===approvalId&&a.status==='pending'&&a.action==='deploy-project'&&a.projectId===slug&&!a.consumedAt);
    if(!approval) return reject('deploy_approval_not_pending');
    approval.status='approved';
    approval.approvedAt=new Date().toISOString();
    approval.approvedBy=safeText(cmd.requestedBy||'mobile-owner',120)||'mobile-owner';
    await writeJsonAtomic(APPROVALS_FILE,approvals);
    await appendAudit(AUDIT_FILE,{type:'mobile_deploy_approved',requestId,approvalId:approval.id,actor:cmd.actor,approvedBy:approval.approvedBy,project:existing.name,slug});
    console.log(JSON.stringify({ok:true,action,requestId,approvalId:approval.id,status:'approved'}));
    return;
  }

${prepareAnchor}`, 'bridge mobile owner approval');
}
write('scripts/bridge-command.js', bridge);

let mobile = read('mobile/server.js');
const serverClientImport = "const { validateConnectionInput, testPasswordConnection } = require('./server-client');\n";
if (!mobile.includes("require('./deploy-store')")) {
  mobile = replaceOnce(mobile, serverClientImport,
    serverClientImport +
    "const { DeployStore } = require('./deploy-store');\n" +
    "const { createDeployIssue, getDeployResult } = require('./deploy-client');\n" +
    "const { runBridgeCommand } = require('./deploy-local-bridge');\n",
    'mobile deploy imports');
}

const connectionAnchor = "const connections = new ConnectionStore(CONNECTIONS_PATH);\n";
if (!mobile.includes('const deployStore = new DeployStore(')) {
  mobile = replaceOnce(mobile, connectionAnchor,
    connectionAnchor + "const deployStore = new DeployStore(process.env.UCHIHA_DEPLOY_STATE || './data/deploy-state.json');\n",
    'mobile deploy store instance');
}

const teamAnchor = "  if (req.method === 'GET' && pathname === '/api/mobile/team') {";
if (!mobile.includes('deployPlanMatch')) {
  const routes = `  const deployStatusMatch = pathname.match(/^\\/api\\/mobile\\/projects\\/([a-zA-Z0-9._-]+)\\/deploy$/);
  if (req.method === 'GET' && deployStatusMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'deploy.plan', res)) return;
    try {
      const project = projectExists(deployStatusMatch[1]);
      let deploy = deployStore.get(project.id);
      if (deploy && deploy.stage === 'deploying' && deploy.issueNumber) {
        const bridgeRepository = String(process.env.UCHIHA_BRIDGE_REPO || 'yaminuchiha1245-png/UCHIHA').trim();
        const result = await getDeployResult(githubToken(), bridgeRepository, deploy.issueNumber);
        if (result) {
          deploy = deployStore.finish(project.id, result);
          mobileAudit.record(auth.user, result.status === 'succeeded' ? 'deploy.succeeded' : 'deploy.failed', {
            projectId: project.id,
            issueNumber: deploy.issueNumber,
            revision: result.revision,
            reason: result.reason,
            rollback: result.rollback
          });
        }
      }
      json(res, 200, { ok: true, deploy });
    } catch (error) {
      const code = error && error.code ? error.code : 'deploy_status_failed';
      json(res, code === 'github_invalid_token' ? 401 : 502, { ok: false, error: code });
    }
    return;
  }

  const deployPlanMatch = pathname.match(/^\\/api\\/mobile\\/projects\\/([a-zA-Z0-9._-]+)\\/deploy\\/plan$/);
  if (req.method === 'POST' && deployPlanMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'deploy.plan', res)) return;
    try {
      const project = projectExists(deployPlanMatch[1]);
      const binding = connections.getGithubProject(project.id);
      if (!binding) return json(res, 409, { ok: false, error: 'deploy_github_not_linked' });
      const owner = String(process.env.UCHIHA_BRIDGE_OWNER || 'yaminuchiha1245-png').trim();
      if (!binding.repository.startsWith(owner + '/')) return json(res, 409, { ok: false, error: 'deploy_repository_owner_mismatch' });
      const requestId = 'mobile-plan-' + crypto.randomUUID();
      const result = await runBridgeCommand({
        schema: 'uchiha.command.v1',
        action: 'project.plan-deploy',
        requestId,
        requestedBy: auth.user.displayName || auth.user.username,
        project: {
          slug: project.id,
          name: project.name || project.id,
          repository: 'https://github.com/' + binding.repository,
          branch: binding.branch || 'main'
        }
      });
      const deploy = deployStore.plan(project.id, {
        repository: binding.repository,
        branch: binding.branch || 'main',
        approvalId: result.approvalId,
        requestedBy: auth.user.displayName || auth.user.username
      });
      mobileAudit.record(auth.user, 'deploy.plan.created', {
        projectId: project.id,
        repository: binding.repository,
        branch: binding.branch || 'main',
        approvalId: result.approvalId
      });
      json(res, 201, { ok: true, deploy });
    } catch (error) {
      const code = error && error.code ? error.code : 'deploy_plan_failed';
      let status = 502;
      if (code === 'project_not_found') status = 404;
      else if (code === 'deploy_github_not_linked' || code === 'deploy_repository_owner_mismatch') status = 409;
      else if (code.startsWith('invalid_') || code === 'project_not_registered') status = 400;
      json(res, status, { ok: false, error: code });
    }
    return;
  }

  const deployApproveMatch = pathname.match(/^\\/api\\/mobile\\/projects\\/([a-zA-Z0-9._-]+)\\/deploy\\/approve$/);
  if (req.method === 'POST' && deployApproveMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'deploy.approve', res)) return;
    try {
      const project = projectExists(deployApproveMatch[1]);
      const current = deployStore.get(project.id);
      if (!current || current.stage !== 'pending_approval' || !current.approvalId) {
        return json(res, 409, { ok: false, error: 'deploy_approval_not_pending' });
      }
      const result = await runBridgeCommand({
        schema: 'uchiha.command.v1',
        action: 'project.approve-deploy',
        requestId: 'mobile-approve-' + crypto.randomUUID(),
        requestedBy: auth.user.displayName || auth.user.username,
        approvalId: current.approvalId,
        project: { slug: project.id }
      });
      const deploy = deployStore.approve(project.id, {
        approvalId: result.approvalId,
        approvedBy: auth.user.displayName || auth.user.username
      });
      mobileAudit.record(auth.user, 'deploy.owner.approved', { projectId: project.id, approvalId: result.approvalId });
      json(res, 200, { ok: true, deploy });
    } catch (error) {
      const code = error && error.code ? error.code : 'deploy_approval_failed';
      json(res, code === 'deploy_approval_not_pending' ? 409 : 502, { ok: false, error: code });
    }
    return;
  }

  const deployStartMatch = pathname.match(/^\\/api\\/mobile\\/projects\\/([a-zA-Z0-9._-]+)\\/deploy\\/start$/);
  if (req.method === 'POST' && deployStartMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'deploy.approve', res)) return;
    try {
      const project = projectExists(deployStartMatch[1]);
      const current = deployStore.get(project.id);
      if (!current || current.stage !== 'approved') return json(res, 409, { ok: false, error: 'deploy_owner_approval_required' });
      const binding = connections.getGithubProject(project.id);
      if (!binding) return json(res, 409, { ok: false, error: 'deploy_github_not_linked' });
      const owner = String(process.env.UCHIHA_BRIDGE_OWNER || 'yaminuchiha1245-png').trim();
      const github = githubConnectionStatus();
      if (!github.connected || !github.account || github.account.login !== owner) {
        return json(res, 409, { ok: false, error: 'deploy_github_owner_required' });
      }
      const bridgeRepository = String(process.env.UCHIHA_BRIDGE_REPO || 'yaminuchiha1245-png/UCHIHA').trim();
      const issued = await createDeployIssue(githubToken(), bridgeRepository, {
        projectId: project.id,
        repository: binding.repository,
        branch: binding.branch || 'main',
        requestedBy: auth.user.displayName || auth.user.username
      });
      const deploy = deployStore.start(project.id, issued);
      mobileAudit.record(auth.user, 'deploy.executor.requested', {
        projectId: project.id,
        approvalId: current.approvalId,
        issueNumber: issued.issueNumber,
        requestId: issued.requestId
      });
      json(res, 202, { ok: true, deploy });
    } catch (error) {
      const code = error && error.code ? error.code : 'deploy_start_failed';
      let status = 502;
      if (code === 'github_invalid_token') status = 401;
      else if (code === 'github_issue_write_forbidden') status = 403;
      else if (code === 'deploy_owner_approval_required' || code === 'deploy_github_owner_required') status = 409;
      json(res, status, { ok: false, error: code });
    }
    return;
  }

` + teamAnchor;
  mobile = replaceOnce(mobile, teamAnchor, routes, 'mobile deploy routes');
}
write('mobile/server.js', mobile);

let compose = read('compose.yaml');
if (!compose.includes('UCHIHA_DEPLOY_STATE:')) {
  const anchor = '      UCHIHA_CONNECTION_STORE: /app/data/mobile/connections.json\n';
  compose = replaceOnce(compose, anchor, anchor + '      UCHIHA_DEPLOY_STATE: /app/data/mobile/deploy-state.json\n', 'compose deploy state');
}
write('compose.yaml', compose);

console.log('UCHIHA alpha14 guarded mobile deploy integration prepared.');

// alpha15 intentionally chains the separate guarded domain capability here so
// every existing v6 integration path (CI and future production packaging)
// receives the same Domain/DNS/TLS verification layer without duplicating it.
require('./integrate-domain-v6.js');
