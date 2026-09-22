const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const app=path.resolve(process.argv[2]||'debt-app');
const native=fs.readFileSync(path.join(app,'app/src/main/java/com/uchiha/debtstore/MainActivity.java'),'utf8');
const manifest=fs.readFileSync(path.join(app,'app/src/main/AndroidManifest.xml'),'utf8');
const sync=fs.readFileSync(path.join(app,'app/src/main/assets/sync-v165.js'),'utf8');
const presence=fs.readFileSync(path.join(app,'app/src/main/assets/app-v120.js'),'utf8');
const legacy=fs.readFileSync(path.join(app,'app/src/main/assets/app-v110.js'),'utf8');
for(const marker of [
  'WindowCompat.setDecorFitsSystemWindows(getWindow(), false)',
  'WindowInsetsCompat.Type.systemBars()',
  'WindowInsetsCompat.Type.displayCutout()',
  'WindowInsetsCompat.Type.ime()',
  'Math.max(bars.bottom, ime.bottom)',
  'safeRoot.setBackgroundColor(Color.rgb(10, 13, 18))',
  'return WindowInsetsCompat.CONSUMED',
  'if (realtimeWanted && realtimeSocket != null && requestedStore.equals(realtimeStoreId)) return;'
])assert(native.includes(marker),'missing native layout/realtime invariant: '+marker);
assert(manifest.includes('android:windowSoftInputMode="adjustResize"'),'keyboard must resize the safe content area');
assert(sync.includes("SYNC_VERSION='1.5.29'"),'wrong sync version');
assert(sync.includes('beforeScreen!==screenSignature()'),'unchanged sync may not re-render the app');
assert(sync.includes("type==='change'"),'sync must respond to native realtime event name');
assert(presence.includes('if(window.DebtCloudSync)'),'legacy presence must not trigger duplicate screen pulls');
assert(legacy.includes('if(window.DebtCloudSync)return;'),'legacy 15s poller must yield to new sync');
console.log('PASS v1.5.29: Android system bars, IME, cutouts, socket reuse, legacy polling disabled');
