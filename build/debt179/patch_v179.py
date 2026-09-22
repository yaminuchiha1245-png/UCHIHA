#!/usr/bin/env python3
"""v1.5.29: eliminate automatic WebView navigation jumps and fit Android system bars."""
from pathlib import Path
import sys

def replace_exact(text, before, after, label):
    count = text.count(before)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, got {count}")
    return text.replace(before, after, 1)

def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_v179.py debt-app")
    app=Path(sys.argv[1]).resolve()
    gradle=app/"app/build.gradle"
    s=gradle.read_text()
    s=replace_exact(s,"versionCode 1052800","versionCode 1052900","versionCode")
    s=replace_exact(s,"versionName '1.5.28'","versionName '1.5.29'","versionName")
    gradle.write_text(s)

    native=app/"app/src/main/java/com/uchiha/debtstore/MainActivity.java"
    s=native.read_text()
    s=replace_exact(s,
        "import android.widget.Toast;",
        "import android.widget.Toast;\nimport android.widget.FrameLayout;\nimport android.view.WindowManager;",
        "native frame imports")
    s=replace_exact(s,
        "import androidx.core.content.FileProvider;",
        "import androidx.core.content.FileProvider;\nimport androidx.core.graphics.Insets;\nimport androidx.core.view.ViewCompat;\nimport androidx.core.view.WindowCompat;\nimport androidx.core.view.WindowInsetsCompat;\nimport androidx.core.view.WindowInsetsControllerCompat;",
        "AndroidX insets imports")
    s=replace_exact(s,
        """        getWindow().setStatusBarColor(Color.rgb(10, 13, 18));
        getWindow().setNavigationBarColor(Color.rgb(10, 13, 18));
        createNotificationChannel();""",
        """        getWindow().setStatusBarColor(Color.rgb(10, 13, 18));
        getWindow().setNavigationBarColor(Color.rgb(10, 13, 18));
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        // Android 15 enforces edge-to-edge at target 35. Draw behind the bars,
        // but constrain the actual WebView to a root padded by *real* insets.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        createNotificationChannel();""",
        "native edge-to-edge configuration")
    s=replace_exact(s,
        """        webView = new WebView(this);
        setContentView(webView);
        WebSettings settings = webView.getSettings();""",
        """        final FrameLayout safeRoot = new FrameLayout(this);
        safeRoot.setBackgroundColor(Color.rgb(10, 13, 18));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(10, 13, 18));
        safeRoot.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        ViewCompat.setOnApplyWindowInsetsListener(safeRoot, (root, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            final int bottom = Math.max(bars.bottom, ime.bottom);
            // Insets change with gesture/three-button navigation, cutouts,
            // rotation and keyboard. Never pad JS twice for the same bar.
            if (root.getPaddingLeft() != bars.left || root.getPaddingTop() != bars.top
                    || root.getPaddingRight() != bars.right || root.getPaddingBottom() != bottom) {
                root.setPadding(bars.left, bars.top, bars.right, bottom);
            }
            return WindowInsetsCompat.CONSUMED;
        });
        setContentView(safeRoot);
        WindowInsetsControllerCompat barIcons = WindowCompat.getInsetsController(getWindow(), safeRoot);
        barIcons.setAppearanceLightStatusBars(false);
        barIcons.setAppearanceLightNavigationBars(false);
        ViewCompat.requestApplyInsets(safeRoot);
        WebSettings settings = webView.getSettings();""",
        "native safe WebView container")
    s=replace_exact(s,
        """        realtimeWanted = true;
        realtimeStoreId = storeId.trim();
        WebSocket old = realtimeSocket;""",
        """        final String requestedStore = storeId.trim();
        // A sync pass must never close/reopen an already healthy subscription.
        if (realtimeWanted && realtimeSocket != null && requestedStore.equals(realtimeStoreId)) return;
        realtimeWanted = true;
        realtimeStoreId = requestedStore;
        WebSocket old = realtimeSocket;""",
        "native realtime no-op for same store")
    native.write_text(s)

    manifest=app/"app/src/main/AndroidManifest.xml"
    s=manifest.read_text()
    s=replace_exact(s,
       'android:screenOrientation="portrait">',
       'android:screenOrientation="portrait"\n            android:windowSoftInputMode="adjustResize">',
       "keyboard resize")
    manifest.write_text(s)

    cloudv110=app/"app/src/main/assets/app-v110.js"
    s=cloudv110.read_text()
    old="cloudTimer=setInterval(()=>{if(sessionAccountId&&cloudLinked()&&!document.hidden){flushCloudQueue().then(ok=>{if(ok)cloudPull(false);});}},15000);"
    new="cloudTimer=setInterval(()=>{if(window.DebtCloudSync)return; if(sessionAccountId&&cloudLinked()&&!document.hidden){flushCloudQueue().then(ok=>{if(ok)cloudPull(false);});}},15000);"
    s=replace_exact(s,old,new,"disable redundant 15-second full cloud pulls")
    cloudv110.write_text(s)

    cloudv120=app/"app/src/main/assets/app-v120.js"
    s=cloudv120.read_text()
    s=replace_exact(s,
      "function updateRealtimeV120(connected){ensureV120();state.cloud.realtimeConnected=!!connected;saveState();if(view==='home'||view==='cloud'||view==='partners')render();}",
      """function updateRealtimeV120(connected){
  ensureV120();
  const next=!!connected;
  if(window.DebtCloudSync){
    if(state.cloud.realtimeConnected===next)return;
    state.cloud.realtimeConnected=next;
    // Do not rebuild the whole home screen just because the socket reconnects.
    if((view==='cloud'||view==='partners')&&!document.hidden&&!document.querySelector('.modal:not(.hidden)'))render();
    return;
  }
  state.cloud.realtimeConnected=next;saveState();
  if(view==='home'||view==='cloud'||view==='partners')render();
}""",
      "quiet connection indicator")
    s=replace_exact(s,
      """window.onCloudRealtimeEvent=function(type,payload){
  ensureV120();
  if(type==='connected')""",
      """window.onCloudRealtimeEvent=function(type,payload){
  ensureV120();
  // The additive v1.5.29 sync owns cloud changes and selective rendering.
  // The legacy handler would otherwise pull + render for every presence ping.
  if(window.DebtCloudSync){
    if(type==='connected'||type==='disconnected'||type==='error')
      updateRealtimeV120(type==='connected');
    return;
  }
  if(type==='connected')""",
      "disable legacy realtime render/pull path")
    s=replace_exact(s,
      "presenceTimer=setInterval(()=>{if(sessionAccountId&&cloudLinked()&&!document.hidden)heartbeatPresenceV120();},30000);",
      "presenceTimer=setInterval(()=>{if(window.DebtCloudSync)return; if(sessionAccountId&&cloudLinked()&&!document.hidden)heartbeatPresenceV120();},30000);",
      "single presence heartbeat owner")
    s=replace_exact(s,
      """document.addEventListener('visibilitychange',()=>{
  if(document.hidden){realtimeNativeStopV120();}
  else if(sessionAccountId&&cloudLinked()){heartbeatPresenceV120();realtimeNativeStartV120();cloudPull(false);}
});""",
      """document.addEventListener('visibilitychange',()=>{
  if(window.DebtCloudSync){
    if(document.hidden)realtimeNativeStopV120();
    else if(sessionAccountId&&cloudLinked()){realtimeNativeStartV120();window.DebtCloudSync.schedule(250);}
    return;
  }
  if(document.hidden){realtimeNativeStopV120();}
  else if(sessionAccountId&&cloudLinked()){heartbeatPresenceV120();realtimeNativeStartV120();cloudPull(false);}
});""",
      "avoid duplicate resume cloud pulls")
    cloudv120.write_text(s)

    sync=app/"app/src/main/assets/sync-v165.js"
    s=sync.read_text()
    s=replace_exact(s, "const SYNC_VERSION='1.5.28';", "const SYNC_VERSION='1.5.29';", "sync version")
    s=replace_exact(s,
      "let seq=0,running=false,rerun=false,timer=null,applying=false,initialised=false;",
      """let seq=0,running=false,rerun=false,timer=null,applying=false,initialised=false;
let lastPresenceAt=0,realtimeStartedStore='';""",
      "new sync gates")
    s=replace_exact(s,
      """function maybeRender(){
  if(hasTypingFocus())return;
  try{if(sessionAccountId&&typeof render==='function')render();}catch(_e){}
}""",
      """function screenSignature(){
  // Stable UI fields only; sync timestamps and internal cloud IDs do not
  // warrant replacing the user's active page or moving the scroll position.
  return JSON.stringify([
    (state.clients||[]).map(c=>[c.id,c.name,c.phone,c.address,c.pinned,c.debtLimit,c.maxDays]),
    (state.entries||[]).map(e=>[e.id,e.clientId,e.type,e.originalCurrency,e.originalAmount,
      e.usdAmount,e.paidUsd,e.remainingUsd,e.description,e.createdAt,e.date,
      (e.allocations||[]).map(a=>[a.entryId,a.usd])])
  ]);
}
function maybeRender(changed){
  if(!changed||document.hidden||!sessionAccountId||typeof render!=='function')return;
  if(hasTypingFocus()||document.querySelector?.('.modal:not(.hidden)'))return;
  // Never replace an unfinished form, calculator or invoice cart on cloud events.
  if(['purchase','payment','calculator','invoiceCart'].includes(view))return;
  try{const y=window.scrollY||0;render();if(y>0&&typeof window.scrollTo==='function')window.scrollTo(0,y);}catch(_e){}
}""",
      "render only if visible records changed")
    s=replace_exact(s,
      """async function touchMember(storeId,userId){
  const body={last_seen_at:new Date().toISOString(),app_version:SYNC_VERSION};
  await cloud('PATCH','/rest/v1/store_members?store_id=eq.'+encodeURIComponent(storeId)+'&user_id=eq.'+encodeURIComponent(userId),body);
}""",
      """async function touchMember(storeId,userId){
  // Presence writes are NOT sync triggers. A write on every pull broadcasts
  // changes to all partners and creates a permanent refresh feedback loop.
  if(Date.now()-lastPresenceAt<60000)return;
  const body={last_seen_at:new Date().toISOString(),app_version:SYNC_VERSION};
  const r=await cloud('PATCH','/rest/v1/store_members?store_id=eq.'+encodeURIComponent(storeId)+'&user_id=eq.'+encodeURIComponent(userId),body);
  if(r.ok)lastPresenceAt=Date.now();
}""",
      "throttled presence writes")
    s=replace_exact(s,
      """    const [customers,transactions]=await Promise.all([
      getAll('/rest/v1/customers?select=*&store_id=eq.'+encodeURIComponent(storeId)+'&is_deleted=eq.false&order=created_at.asc',500),
      getAll('/rest/v1/transactions?select=*&store_id=eq.'+encodeURIComponent(storeId)+'&is_deleted=eq.false&order=created_at.asc',500)
    ]);
    const clientMap=""",
      """    const [customers,transactions]=await Promise.all([
      getAll('/rest/v1/customers?select=*&store_id=eq.'+encodeURIComponent(storeId)+'&is_deleted=eq.false&order=created_at.asc',500),
      getAll('/rest/v1/transactions?select=*&store_id=eq.'+encodeURIComponent(storeId)+'&is_deleted=eq.false&order=created_at.asc',500)
    ]);
    const beforeScreen=screenSignature();
    const clientMap=""",
      "capture pre-sync screen")
    s=replace_exact(s,
      """    try{Android.cloudRealtimeStart(storeId);}catch(_e){}
    maybeRender();""",
      """    if(realtimeStartedStore!==storeId){
      try{Android.cloudRealtimeStart(storeId);realtimeStartedStore=storeId;}catch(_e){}
    }
    maybeRender(beforeScreen!==screenSignature());""",
      "no redundant socket reconnect or UI render")
    s=replace_exact(s,
      """window.onCloudRealtimeEvent=function(type,payload){
  if(typeof priorRealtime==='function')try{priorRealtime(type,payload);}catch(_e){}
  if(type==='postgres_changes'||type==='system'||type==='phx_reply'||type==='error')schedule(type==='postgres_changes'?250:1500);
};""",
      """window.onCloudRealtimeEvent=function(type,payload){
  if(typeof priorRealtime==='function')try{priorRealtime(type,payload);}catch(_e){}
  // The native bridge actually sends "change", not "postgres_changes".
  // "connected"/"error" are socket status updates, not ledger mutations.
  if((type==='change'||type==='postgres_changes')&&!document.hidden)schedule(450);
};""",
      "realtime event semantics")
    sync.write_text(s)

    print("Applied v1.5.29: bounded insets, no sync-driven screen jumps, no socket churn")

if __name__=="__main__":
    main()
