'use strict';

const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(target)) throw new Error('Usage: node integrate-chatgpt-v6.js /path/to/extracted-v6');
function file(name) { return path.join(target, name); }
function read(name) { return fs.readFileSync(file(name), 'utf8'); }
function write(name, content) { fs.writeFileSync(file(name), content, 'utf8'); }
function replaceOnce(source, anchor, replacement, label) {
  if (!source.includes(anchor)) throw new Error(`alpha17 integration anchor missing: ${label}`);
  const at = source.indexOf(anchor);
  if (source.indexOf(anchor, at + anchor.length) !== -1) throw new Error(`alpha17 integration anchor ambiguous: ${label}`);
  return source.replace(anchor, replacement);
}

for (const required of ['server.js', 'mobile/server.js', 'compose.yaml']) {
  if (!fs.existsSync(file(required))) throw new Error(`alpha17 target missing: ${required}`);
}
for (const name of ['chatgpt-oauth-store.js', 'chatgpt-bridge.js']) {
  fs.copyFileSync(path.join(__dirname, name), file(`mobile/${name}`));
}

let server = read('server.js');
const mobileImport = "const { handler: mobileHandler } = require('./mobile/server');";
const bridgeImport = "const { handler: chatGptHandler, handles: chatGptHandles } = require('./mobile/chatgpt-bridge');";
if (!server.includes(bridgeImport)) {
  server = replaceOnce(server, mobileImport, `${mobileImport}\n${bridgeImport}`, 'ChatGPT bridge import');
}
const mobileDispatch = "    if(url.pathname.startsWith('/api/mobile/'))return await mobileHandler(req,res);";
if (!server.includes('chatGptHandles(url.pathname)')) {
  server = replaceOnce(server, mobileDispatch, `    if(chatGptHandles(url.pathname))return await chatGptHandler(req,res,url);\n${mobileDispatch}`, 'ChatGPT bridge dispatch');
}
write('server.js', server);

let compose = read('compose.yaml');
if (!compose.includes('UCHIHA_CHATGPT_OAUTH_STORE:')) {
  const anchor = '      UCHIHA_MOBILE_AUDIT_LOG: /app/data/mobile/mobile-audit.jsonl\n';
  compose = replaceOnce(compose, anchor,
    anchor +
    '      UCHIHA_CHATGPT_OAUTH_STORE: /app/data/mobile/chatgpt-oauth.json\n' +
    '      UCHIHA_PUBLIC_ORIGIN: ${UCHIHA_PUBLIC_ORIGIN:-https://panel.uchiha-builder.com}\n',
    'compose ChatGPT OAuth state');
}
write('compose.yaml', compose);

console.log('UCHIHA alpha17 ChatGPT account bridge integration prepared.');
