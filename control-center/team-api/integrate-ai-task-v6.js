'use strict';

const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(target)) {
  throw new Error('Usage: node integrate-ai-task-v6.js /path/to/extracted-v6');
}

function file(name) { return path.join(target, name); }
function read(name) { return fs.readFileSync(file(name), 'utf8'); }
function write(name, content) { fs.writeFileSync(file(name), content, 'utf8'); }
function replaceOnce(source, anchor, replacement, label) {
  if (!source.includes(anchor)) throw new Error(`alpha17 integration anchor missing: ${label}`);
  const at = source.indexOf(anchor);
  if (source.indexOf(anchor, at + anchor.length) !== -1) throw new Error(`alpha17 integration anchor ambiguous: ${label}`);
  return source.replace(anchor, replacement);
}

for (const required of ['mobile/server.js', 'compose.yaml']) {
  if (!fs.existsSync(file(required))) throw new Error(`alpha17 target missing: ${required}`);
}

fs.copyFileSync(path.join(__dirname, 'ai-task-store.js'), file('mobile/ai-task-store.js'));

let mobile = read('mobile/server.js');
const serverClientImport = "const { validateConnectionInput, testPasswordConnection } = require('./server-client');\n";
if (!mobile.includes("require('./ai-task-store')")) {
  mobile = replaceOnce(
    mobile,
    serverClientImport,
    serverClientImport + "const { AiTaskStore } = require('./ai-task-store');\n",
    'mobile AI task import'
  );
}

const connectionAnchor = "const connections = new ConnectionStore(CONNECTIONS_PATH);\n";
if (!mobile.includes('const aiTaskStore = new AiTaskStore(')) {
  mobile = replaceOnce(
    mobile,
    connectionAnchor,
    connectionAnchor + "const aiTaskStore = new AiTaskStore(process.env.UCHIHA_AI_TASK_STATE || './data/ai-tasks.json');\n",
    'mobile AI task store instance'
  );
}

const teamAnchor = "  if (req.method === 'GET' && pathname === '/api/mobile/team') {";
if (!mobile.includes('aiTasksMatch')) {
  const routes = `  const aiTasksMatch = pathname.match(/^\\/api\\/mobile\\/projects\\/([a-zA-Z0-9._-]+)\\/ai\\/tasks$/);
  if (req.method === 'GET' && aiTasksMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'ai.use', res)) return;
    try {
      const project = projectExists(aiTasksMatch[1]);
      json(res, 200, { ok: true, items: aiTaskStore.list(project.id, 40) });
    } catch (error) {
      const code = error && error.code ? error.code : 'ai_task_list_failed';
      json(res, code === 'project_not_found' ? 404 : 400, { ok: false, error: code });
    }
    return;
  }

  if (req.method === 'POST' && aiTasksMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'ai.use', res)) return;
    try {
      const project = projectExists(aiTasksMatch[1]);
      const body = await readJson(req);
      const task = aiTaskStore.create(project.id, auth.user, body);
      mobileAudit.record(auth.user, 'ai.task.created', {
        taskId: task.id,
        projectId: project.id,
        mode: task.mode,
        productionWrite: false,
        requiredFlow: task.guard.requiredFlow
      });
      json(res, 201, { ok: true, task });
    } catch (error) {
      const code = error && error.code ? error.code : 'ai_task_create_failed';
      let status = 400;
      if (code === 'project_not_found') status = 404;
      json(res, status, { ok: false, error: code });
    }
    return;
  }

  const aiTaskMatch = pathname.match(/^\\/api\\/mobile\\/projects\\/([a-zA-Z0-9._-]+)\\/ai\\/tasks\\/(ait_[a-f0-9]{24})$/);
  if (req.method === 'GET' && aiTaskMatch) {
    const auth = requireAuth(req, res);
    if (!auth || !requireCapability(auth.user, 'ai.use', res)) return;
    try {
      projectExists(aiTaskMatch[1]);
      const task = aiTaskStore.get(aiTaskMatch[1], aiTaskMatch[2]);
      if (!task) return json(res, 404, { ok: false, error: 'ai_task_not_found' });
      json(res, 200, { ok: true, task });
    } catch (error) {
      const code = error && error.code ? error.code : 'ai_task_read_failed';
      json(res, code === 'project_not_found' ? 404 : 400, { ok: false, error: code });
    }
    return;
  }

` + teamAnchor;
  mobile = replaceOnce(mobile, teamAnchor, routes, 'mobile AI task routes');
}
write('mobile/server.js', mobile);

let compose = read('compose.yaml');
if (!compose.includes('UCHIHA_AI_TASK_STATE:')) {
  const anchor = '      UCHIHA_CONNECTION_STORE: /app/data/mobile/connections.json\n';
  compose = replaceOnce(
    compose,
    anchor,
    anchor + '      UCHIHA_AI_TASK_STATE: /app/data/mobile/ai-tasks.json\n',
    'compose AI task state'
  );
}
write('compose.yaml', compose);

console.log('UCHIHA alpha17 guarded AI Task Engine integration prepared.');
