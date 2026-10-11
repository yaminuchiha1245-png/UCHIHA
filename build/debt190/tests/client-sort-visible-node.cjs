const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||'debt-app/app/src/main/assets');
const ui=fs.readFileSync(path.join(root,'app-v121.js'),'utf8');
const sync=fs.readFileSync(path.join(root,'sync-v165.js'),'utf8');

for(const needle of [
  "function clientSortModeV190()",
  "function compareClientsV190(a,b,key=clientSortModeV190())",
  "window.openClientSortV190=function()",
  "window.setClientSortV190=function(key)",
  "onclick=\"openClientSortV190()\">↕ ترتيب</button>",
  "usd_desc:'الأعلى دينًا USD'",
  "try_desc:'الأعلى دينًا TRY'",
  "oldest:'الأقدم إضافة'",
  "newest:'الأحدث إضافة'",
  "sort((a,b)=>compareClientsV190(a,b))"
]) assert(ui.includes(needle),'missing '+needle);

assert(sync.includes("SYNC_VERSION='1.5.34'"),'sync version must be 1.5.34');

// Ensure the late-loaded v121 file is the one that owns the visible clients screen.
const defs=(ui.match(/window\.renderClients=function\(\)/g)||[]).length;
assert.equal(defs,1,'v121 must define exactly one visible clients renderer');
const renderAt=ui.indexOf("window.renderClients=function()");
const sortButtonAt=ui.indexOf('onclick="openClientSortV190()"');
assert(sortButtonAt>renderAt,'sort button must be inside the late-loaded visible renderer');

console.log('PASS v1.5.34 visible customer sort control');
