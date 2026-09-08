const fs=require('fs');
const html=fs.readFileSync('miniapp/index.html','utf8');
const app=fs.readFileSync('miniapp/app.js','utf8');
const v21=fs.readFileSync('miniapp/v21.js','utf8');
const bot=fs.readFileSync('bot/bot.js','utf8');
const failures=[];

// Every static clickable button must be covered by a data-go route or referenced by JS.
for(const m of html.matchAll(/<button\b([^>]*)>/g)){
  const attrs=m[1];
  const id=(attrs.match(/\bid="([^"]+)"/)||[])[1];
  const go=(attrs.match(/\bdata-go="([^"]+)"/)||[])[1];
  const close=/\bdata-sheet-close\b/.test(attrs);
  if(go||close)continue;
  if(!id){failures.push(`static button without id/data-go: ${attrs.slice(0,100)}`);continue}
  const token=`#${id}`;
  if(!app.includes(token)&&!v21.includes(token))failures.push(`button #${id} has no JS reference`);
}

// Guard against the whole-document MutationObserver regression that froze touch events.
if(/observer\.observe\(document\.body,\{subtree:true/.test(v21))failures.push('whole-document MutationObserver regression present');
if(!v21.includes('observer.observe(gate,{attributes:true,attributeFilter:["class"]})'))failures.push('scoped auth-gate observer missing');
if(!v21.includes('if(btn.innerHTML!==balanceHtml)btn.innerHTML=balanceHtml'))failures.push('idempotent balance render missing');

// Literal Telegram callback_data must have a literal action handler, unless it is known to be generated/dynamic.
const literalCallbacks=new Set();
for(const m of bot.matchAll(/Markup\.button\.callback\([^,]+,\s*"([^"]+)"\)/g))literalCallbacks.add(m[1]);
const literalHandlers=new Set();
for(const m of bot.matchAll(/bot\.action\("([^"]+)"/g))literalHandlers.add(m[1]);
for(const cb of literalCallbacks){
  if(!literalHandlers.has(cb))failures.push(`literal callback has no handler: ${cb}`);
}

const requiredDynamicHandlers=[
  'cat:', 'prd:', 'adm_topup_receipt:', 'adm_topup_approve:', 'adm_topup_reject:',
  'adm_topup_do_', 'adm_topup_cancel:', 'adm_verify_approve:', 'adm_verify_reject:',
  'adm_verify_do_', 'adm_broadcast_do:'
];
for(const prefix of requiredDynamicHandlers){
  if(!bot.includes(prefix))failures.push(`dynamic callback prefix missing: ${prefix}`);
}
if(!bot.includes('bot.on("callback_query"'))failures.push('stale callback fallback missing');
if(!bot.includes('Game Zone bot v3.3 button-reliability production started'))failures.push('bot v3.3 marker missing');

if(failures.length){
  console.error('GAME_ZONE_BUTTON_AUDIT=FAIL');
  for(const x of failures)console.error('-',x);
  process.exit(1);
}
console.log(`GAME_ZONE_BUTTON_AUDIT=PASS static_buttons=${[...html.matchAll(/<button\b/g)].length} literal_callbacks=${literalCallbacks.size}`);
