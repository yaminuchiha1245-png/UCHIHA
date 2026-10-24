const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||'debt-app/app/src/main/assets');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const v110=fs.readFileSync(path.join(root,'app-v110.js'),'utf8');
const v145=fs.readFileSync(path.join(root,'app-v145.js'),'utf8');
const sync=fs.readFileSync(path.join(root,'sync-v165.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'runtime-v193.js'),'utf8');

assert(index.includes("window.__UCHIHA_MODERN_SYNC_BOOT=true"),'boot gate flag missing');
assert(index.includes("document.documentElement.classList.add('uchiha-booting')"),'boot shield missing');
assert(index.includes('<script src="runtime-v193.js"></script>'),'final runtime missing');
assert(index.indexOf('runtime-v193.js')>index.indexOf('partner-entry-v186.js'),'runtime must load after all historical overrides');

assert(app.includes("if(v===view&&!drawerOpen)return;"),'active tab must not rerender');
assert(app.includes("if(!window.__UCHIHA_MODERN_SYNC_BOOT)render();"),'base startup render must be gated');

assert(v110.includes("if(window.__UCHIHA_MODERN_SYNC_BOOT){"),'legacy startup cloud init must be gated');
assert(v110.includes("if(window.__UCHIHA_MODERN_SYNC_BOOT)return;if(!document.hidden"),'legacy resume pull must be disabled');

assert(v145.includes("if(!window.__UCHIHA_MODERN_SYNC_BOOT)render();"),'license layer startup paint must be gated');
assert(v145.includes("window.__UCHIHA_BOOT_READY"),'license refresh must wait for final boot');

assert(sync.includes("SYNC_VERSION='1.5.38'"),'sync version mismatch');
assert(sync.includes("const hadLocalMutations="),'passive refetch gate missing');
assert(sync.includes("let finalCustomers=customers,finalTransactions=transactions;"),'first snapshot reuse missing');
assert(sync.includes("if(hadLocalMutations||hadLegacyPending){"),'conditional convergence refetch missing');
assert(sync.includes("function interactionAge()"),'interaction-aware scheduler missing');
assert(sync.includes("interactionAge()<1600"),'sync must defer while user is interacting');
assert(sync.includes("schedule(1100)"),'post-save sync must be off the tap critical path');
assert(!sync.includes("return JSON.stringify([\n    (state.clients||[]).map"),'large JSON screen signature must be removed');
assert(sync.includes("safePersist(changed||hadLocalMutations||hadLegacyPending)"),'passive persistence throttle missing');

assert(runtime.includes("requestAnimationFrame(()=>requestAnimationFrame"),'final reveal must wait for stable frame');
assert(runtime.includes("classList.remove('uchiha-booting')"),'boot shield must be removed only by final runtime');
assert(runtime.includes("document.addEventListener('pointerdown',mark"),'tap activity marker missing');

console.log('PASS v1.5.38 single-paint boot and idle-aware sync performance regression');

