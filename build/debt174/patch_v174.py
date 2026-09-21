#!/usr/bin/env python3
"""Apply v1.5.24 automatic Google Drive full-snapshot backup on top of v1.5.23."""
from pathlib import Path
import sys

def rep(s, a, b, label):
    if a not in s:
        raise SystemExit(f"marker not found: {label}")
    return s.replace(a, b, 1)

def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_v174.py <debt-app>")
    app = Path(sys.argv[1]).resolve()
    buildp = app / "app" / "build.gradle"
    build = buildp.read_text(encoding="utf-8")
    if "versionCode 1052300" not in build or "versionName '1.5.23'" not in build:
        raise SystemExit("unexpected v1.5.23 baseline")

    # ---------- Core app backup UI + automatic snapshots ----------
    appjs_path = app / "app" / "src" / "main" / "assets" / "app.js"
    js = appjs_path.read_text(encoding="utf-8")

    old_backup = """function renderBackup(){
  if(!isOwner())return shell('النسخ الاحتياطي','<div class="empty">للمالك فقط</div>');
  const body=`
  <div class="notice ok"><span>☁️</span><div class="grow"><b>البيانات محفوظة داخل الهاتف</b><small>أنشئ نسخة خارجية بشكل دوري لحماية الدفتر.</small></div></div>
  <div class="section-title">نسخة البيانات الكاملة</div>
  <div class="card">
    <button class="btn primary full" onclick="exportBackup()">⬇ تصدير نسخة احتياطية JSON</button>
    <button class="btn full" style="margin-top:9px" onclick="pickBackup()">⬆ استعادة نسخة احتياطية</button>
    <div class="small muted" style="margin-top:10px">تشمل العملاء، دفتر الحساب، الدفعات، المؤجل، النواقص، الحسابات والإعدادات. <b>الملف حساس؛ احتفظ به في مكان خاص.</b></div>
  </div>"""
    new_backup = """function driveBackupInfo(){try{return JSON.parse(window.Android?.driveBackupStatus?.()||'{}')}catch(_e){return{connected:false}}}
function driveSnapshot(reason='manual',sourceId=''){
  try{if(window.Android?.driveBackup)Android.driveBackup(JSON.stringify(state),String(reason||'record'),String(sourceId||''));}catch(_e){}
}
window.DebtDriveBackupSnapshot=driveSnapshot;
function chooseDriveBackupFolder(){try{if(window.Android?.pickDriveBackupFolder)Android.pickDriveBackupFolder();else toast('Google Drive متاح داخل APK فقط');}catch(_e){toast('تعذر فتح Google Drive')}}
function disconnectDriveBackup(){try{window.Android?.disconnectDriveBackup?.();if(view==='backup')render();toast('تم فصل مجلد النسخ الاحتياطي');}catch(_e){toast('تعذر فصل المجلد')}}
function driveBackupNow(){const d=driveBackupInfo();if(!d.connected){toast('اربط مجلد Google Drive أولًا');return;}driveSnapshot('manual','manual-'+Date.now());toast('جاري رفع نسخة كاملة جديدة إلى Drive');}
window.onNativeDriveFolderSelected=function(ok){if(ok){driveSnapshot('connect','initial-'+Date.now());toast('تم ربط Google Drive وإنشاء النسخة الأولى');}else toast('لم يتم اختيار مجلد');if(view==='backup')render();};
window.onNativeDriveBackupResult=function(result){if(view==='backup')render();if(result&&!result.ok&&result.error!=='NOT_CONNECTED')toast('تعذر رفع النسخة إلى Drive');};

function renderBackup(){
  if(!isOwner())return shell('النسخ الاحتياطي','<div class="empty">للمالك فقط</div>');
  const drive=driveBackupInfo();
  const driveStatus=drive.connected
    ? `<div class="notice ok"><span>✓</span><div class="grow"><b>Google Drive مربوط</b><small>${drive.last_at?'آخر نسخة: '+dateTimeFmt(drive.last_at):'جاهز للنسخ التلقائي'}</small></div></div>`
    : '<div class="notice warn"><span>☁️</span><div class="grow"><b>Google Drive غير مربوط</b><small>اربط مجلدًا مرة واحدة ليتم إنشاء نسخة كاملة جديدة بعد كل تسجيلة.</small></div></div>';
  const body=`
  <div class="notice ok"><span>☁️</span><div class="grow"><b>البيانات محفوظة داخل الهاتف</b><small>وتستطيع الآن إضافة نسخة تلقائية مباشرة إلى Google Drive.</small></div></div>
  <div class="section-title">Google Drive — نسخ تلقائي</div>
  <div class="card">
    ${driveStatus}
    <button class="btn primary full" onclick="chooseDriveBackupFolder()">${drive.connected?'تغيير مجلد Google Drive':'ربط مجلد Google Drive'}</button>
    ${drive.connected?'<button class="btn full" style="margin-top:9px" onclick="driveBackupNow()">☁️ إنشاء نسخة كاملة الآن</button><button class="btn ghost full" style="margin-top:9px" onclick="disconnectDriveBackup()">فصل Google Drive</button>':''}
    <div class="small muted" style="margin-top:10px">بعد الربط، كل تسجيل شراء أو دفعة أو إضافة/تعديل عميل ينشئ <b>ملف JSON كامل جديد</b> في المجلد المختار. الملفات السابقة لا يتم استبدالها.</div>
    ${drive.last_error?'<div class="small danger-text" style="margin-top:8px">آخر خطأ: '+esc(drive.last_error)+'</div>':''}
  </div>
  <div class="section-title">نسخة البيانات الكاملة</div>
  <div class="card">
    <button class="btn primary full" onclick="exportBackup()">⬇ تصدير نسخة احتياطية JSON</button>
    <button class="btn full" style="margin-top:9px" onclick="pickBackup()">⬆ استعادة نسخة احتياطية</button>
    <div class="small muted" style="margin-top:10px">تشمل العملاء، دفتر الحساب، الدفعات، المؤجل، النواقص، الحسابات والإعدادات. <b>الملف حساس؛ احتفظ به في مكان خاص.</b></div>
  </div>"""
    js = rep(js, old_backup, new_backup, "backup UI")

    js = rep(
        js,
        "state.clients.push(c);saveState();audit('إضافة عميل',name);closeModal();render();toast('تمت إضافة العميل ✓');",
        "state.clients.push(c);saveState();audit('إضافة عميل',name);driveSnapshot('client',c.id);closeModal();render();toast('تمت إضافة العميل ✓');",
        "new client backup",
    )
    js = rep(
        js,
        "saveState();audit('تعديل عميل',name);closeModal();render();toast('تم الحفظ');",
        "saveState();audit('تعديل عميل',name);driveSnapshot('client-edit',id);closeModal();render();toast('تم الحفظ');",
        "client edit backup",
    )
    js = rep(
        js,
        "state.entries.push(e);saveState();audit('تسجيل شراء',`${state.clients.find(c=>c.id===p.clientId)?.name} — ${p.amount} ${p.currency}`);logClientWarnings",
        "state.entries.push(e);saveState();audit('تسجيل شراء',`${state.clients.find(c=>c.id===p.clientId)?.name} — ${p.amount} ${p.currency}`);driveSnapshot('purchase',e.id);logClientWarnings",
        "purchase backup",
    )

    old_payment = """  state.entries.push({id:paymentId,clientId:p.clientId,type:'payment',date:today(),createdAt:nowIso(),description:'دفعة',originalAmount:p.amount,originalCurrency:p.currency,usdAmount:cv.usd,tryAmount:cv.try,sypAmount:cv.syp,rateUsdTry:state.rates.usdTry,rateUsdSyp:state.rates.usdSyp,paidUsd:cv.usd,remainingUsd:0,allocations,createdBy:currentAccount().name,authMethod});
  saveState();audit('تسجيل دفعة',`${state.clients.find(c=>c.id===p.clientId)?.name} — ${p.amount} ${p.currency}`);toast"""
    new_payment = """  const payment={id:paymentId,clientId:p.clientId,type:'payment',date:today(),createdAt:nowIso(),description:'دفعة',originalAmount:p.amount,originalCurrency:p.currency,usdAmount:cv.usd,tryAmount:cv.try,sypAmount:cv.syp,rateUsdTry:state.rates.usdTry,rateUsdSyp:state.rates.usdSyp,paidUsd:cv.usd,remainingUsd:0,allocations,createdBy:currentAccount().name,authMethod};
  state.entries.push(payment);
  saveState();audit('تسجيل دفعة',`${state.clients.find(c=>c.id===p.clientId)?.name} — ${p.amount} ${p.currency}`);driveSnapshot('payment',payment.id);toast"""
    js = rep(js, old_payment, new_payment, "payment backup")

    old_calc = """function commitPurchaseSilent(p,authMethod='none'){const cv=convert(p.amount,p.currency);if(!cv)return;state.entries.push({id:uid('PUR'),clientId:p.clientId,type:'purchase',date:today(),createdAt:nowIso(),description:p.description,originalAmount:p.amount,originalCurrency:p.currency,usdAmount:cv.usd,tryAmount:cv.try,sypAmount:cv.syp,rateUsdTry:state.rates.usdTry,rateUsdSyp:state.rates.usdSyp,paidUsd:0,remainingUsd:cv.usd,allocations:[],createdBy:currentAccount().name,authMethod});saveState();audit('تسجيل شراء من الحاسبة',`${state.clients.find(c=>c.id===p.clientId)?.name} — ${p.amount} ${p.currency}`);logClientWarnings"""
    new_calc = """function commitPurchaseSilent(p,authMethod='none'){const cv=convert(p.amount,p.currency);if(!cv)return;const e={id:uid('PUR'),clientId:p.clientId,type:'purchase',date:today(),createdAt:nowIso(),description:p.description,originalAmount:p.amount,originalCurrency:p.currency,usdAmount:cv.usd,tryAmount:cv.try,sypAmount:cv.syp,rateUsdTry:state.rates.usdTry,rateUsdSyp:state.rates.usdSyp,paidUsd:0,remainingUsd:cv.usd,allocations:[],createdBy:currentAccount().name,authMethod};state.entries.push(e);saveState();audit('تسجيل شراء من الحاسبة',`${state.clients.find(c=>c.id===p.clientId)?.name} — ${p.amount} ${p.currency}`);driveSnapshot('calculator-purchase',e.id);logClientWarnings"""
    js = rep(js, old_calc, new_calc, "calculator purchase backup")

    js = rep(
        js,
        "function confirmRestoreBackup(jsonString){try{state=JSON.parse(jsonString);saveState();sessionAccountId=null;closeModal();render();toast('تمت الاستعادة');}",
        "function confirmRestoreBackup(jsonString){try{state=JSON.parse(jsonString);saveState();driveSnapshot('restore','restore-'+Date.now());sessionAccountId=null;closeModal();render();toast('تمت الاستعادة');}",
        "restore snapshot",
    )
    appjs_path.write_text(js, encoding="utf-8")

    # ---------- Partner sync: create one full Drive snapshot for each newly-arrived remote record ----------
    syncp = app / "app" / "src" / "main" / "assets" / "sync-v165.js"
    sync = syncp.read_text(encoding="utf-8")
    sync = rep(sync, "const SYNC_VERSION='1.5.23';", "const SYNC_VERSION='1.5.24';", "sync version")

    sync = rep(
        sync,
        "async function syncTransactions(storeId,userId,cloudRows,clientMap){\n  const usedCloud=new Set();",
        "async function syncTransactions(storeId,userId,cloudRows,clientMap){\n  const usedCloud=new Set(),addedRemoteIds=[];",
        "sync added ids",
    )
    sync = rep(
        sync,
        "    state.entries.push(cloudRowToLocal(row,localClientId));\n    usedCloud.add(row.id);",
        "    state.entries.push(cloudRowToLocal(row,localClientId));\n    addedRemoteIds.push(row.id);\n    usedCloud.add(row.id);",
        "collect remote ids",
    )
    sync = rep(
        sync,
        "  for(const e of state.entries||[]){\n    if(e.cloudId)continue;",
        "  for(const e of state.entries||[]){\n    if(e.cloudId)continue;",
        "sync upload anchor",
    )
    sync = rep(
        sync,
        "  }\n}\nasync function touchMember",
        "  }\n  return addedRemoteIds;\n}\nasync function touchMember",
        "sync return ids",
    )
    sync = rep(
        sync,
        "    const membership=await resolveMembership(status);",
        "    const hadPriorSync=!!state.cloudSync?.lastSuccess;\n    const membership=await resolveMembership(status);",
        "prior sync flag",
    )
    sync = rep(
        sync,
        "    await syncTransactions(storeId,userId,transactions,clientMap);\n    rebuildLedger();",
        "    const addedRemoteIds=await syncTransactions(storeId,userId,transactions,clientMap);\n    rebuildLedger();",
        "capture remote ids",
    )
    sync = rep(
        sync,
        "    safePersist();\n    try{Android.cloudRealtimeStart(storeId);}catch(_e){}",
        "    safePersist();\n    if(hadPriorSync&&addedRemoteIds.length&&typeof window.DebtDriveBackupSnapshot==='function'){for(const id of addedRemoteIds)window.DebtDriveBackupSnapshot('partner-sync',id);}\n    try{Android.cloudRealtimeStart(storeId);}catch(_e){}",
        "partner drive snapshots",
    )
    syncp.write_text(sync, encoding="utf-8")

    # ---------- Native Android: persist a Drive/SAF folder and create a brand-new JSON file each time ----------
    mainp = app / "app" / "src" / "main" / "java" / "com" / "uchiha" / "debtstore" / "MainActivity.java"
    java = mainp.read_text(encoding="utf-8")
    java = rep(
        java,
        "import android.provider.MediaStore;",
        "import android.provider.MediaStore;\nimport android.provider.DocumentsContract;",
        "DocumentsContract import",
    )
    java = rep(
        java,
        "    private static final int PICK_BACKUP_REQUEST = 4107;",
        "    private static final int PICK_BACKUP_REQUEST = 4107;\n    private static final int DRIVE_BACKUP_FOLDER_REQUEST = 4111;\n    private static final String DRIVE_BACKUP_PREFS = \"uchiha_drive_backup_v1\";\n    private static final String DRIVE_BACKUP_URI = \"tree_uri\";",
        "drive constants",
    )

    activity_marker = """    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {"""
    helpers = """    private SharedPreferences driveBackupPrefs() {
        return getSharedPreferences(DRIVE_BACKUP_PREFS, MODE_PRIVATE);
    }

    private JSONObject driveBackupStatusInternal() {
        JSONObject out = new JSONObject();
        SharedPreferences p = driveBackupPrefs();
        try {
            String uri = p.getString(DRIVE_BACKUP_URI, "");
            out.put("connected", uri != null && !uri.isEmpty());
            out.put("last_at", p.getString("last_at", ""));
            out.put("last_name", p.getString("last_name", ""));
            out.put("last_error", p.getString("last_error", ""));
        } catch (Exception ignored) {}
        return out;
    }

    private String safeDriveToken(String value, String fallback) {
        String v = value == null ? "" : value.trim().replaceAll("[^A-Za-z0-9._-]+", "-").replaceAll("^-+|-+$", "");
        if (v.isEmpty()) v = fallback;
        return v.length() > 42 ? v.substring(0, 42) : v;
    }

    private void driveBackupCallback(JSONObject result) {
        js("window.onNativeDriveBackupResult && window.onNativeDriveBackupResult(" + result.toString() + ")");
    }

    private void createDriveBackupSnapshot(String json, String reason, String sourceId) {
        JSONObject result = new JSONObject();
        SharedPreferences prefs = driveBackupPrefs();
        String treeText = prefs.getString(DRIVE_BACKUP_URI, "");
        if (treeText == null || treeText.isEmpty()) {
            try { result.put("ok", false).put("error", "NOT_CONNECTED"); } catch (Exception ignored) {}
            driveBackupCallback(result);
            return;
        }
        try {
            new JSONObject(json);
            Uri treeUri = Uri.parse(treeText);
            String treeId = DocumentsContract.getTreeDocumentId(treeUri);
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(treeUri, treeId);
            String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.US).format(new Date());
            String tag = safeDriveToken(reason, "record");
            String sid = safeDriveToken(sourceId, "");
            String name = "UCHIHA-FULL-" + stamp + "-" + tag + (sid.isEmpty() ? "" : "-" + sid) + ".json";
            Uri file = DocumentsContract.createDocument(getContentResolver(), parent, "application/json", name);
            if (file == null) throw new IOException("تعذر إنشاء الملف");
            try (OutputStream out = getContentResolver().openOutputStream(file, "wt")) {
                if (out == null) throw new IOException("تعذر فتح الملف");
                out.write(json.getBytes(StandardCharsets.UTF_8));
                out.flush();
            }
            String at = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).format(new Date());
            prefs.edit().putString("last_at", at).putString("last_name", name).putString("last_error", "").apply();
            result.put("ok", true).put("name", name).put("at", at);
        } catch (Exception e) {
            String message = e.getMessage() == null ? "تعذر إنشاء النسخة في Google Drive" : trim(e.getMessage(), 120);
            prefs.edit().putString("last_error", message).apply();
            try { result.put("ok", false).put("error", message); } catch (Exception ignored) {}
        }
        driveBackupCallback(result);
    }

"""
    java = rep(java, activity_marker, helpers + activity_marker, "drive helpers")

    on_result_marker = """        if (requestCode == PICK_BACKUP_REQUEST) {"""
    on_result_drive = """        if (requestCode == DRIVE_BACKUP_FOLDER_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                Uri uri = data.getData();
                int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                try { getContentResolver().takePersistableUriPermission(uri, flags); } catch (Exception ignored) {}
                driveBackupPrefs().edit().putString(DRIVE_BACKUP_URI, uri.toString()).putString("last_error", "").apply();
                js("window.onNativeDriveFolderSelected && window.onNativeDriveFolderSelected(true)");
            } else {
                js("window.onNativeDriveFolderSelected && window.onNativeDriveFolderSelected(false)");
            }
            return;
        }
        if (requestCode == PICK_BACKUP_REQUEST) {"""
    java = rep(java, on_result_marker, on_result_drive, "drive activity result")

    bridge_marker = """        @JavascriptInterface
        public void exportBackup(String json, String fileName) {
            exportTextFile(json, fileName, "application/json", false);
        }
"""
    bridge_new = """        @JavascriptInterface
        public void exportBackup(String json, String fileName) {
            exportTextFile(json, fileName, "application/json", false);
        }

        @JavascriptInterface
        public String driveBackupStatus() {
            return driveBackupStatusInternal().toString();
        }

        @JavascriptInterface
        public void pickDriveBackupFolder() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
                        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
                String current = driveBackupPrefs().getString(DRIVE_BACKUP_URI, "");
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && current != null && !current.isEmpty()) {
                    try { intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(current)); } catch (Exception ignored) {}
                }
                try { startActivityForResult(intent, DRIVE_BACKUP_FOLDER_REQUEST); }
                catch (ActivityNotFoundException e) { toast("لا يوجد مزود ملفات/Google Drive متاح"); }
            });
        }

        @JavascriptInterface
        public void disconnectDriveBackup() {
            String current = driveBackupPrefs().getString(DRIVE_BACKUP_URI, "");
            if (current != null && !current.isEmpty()) {
                try {
                    getContentResolver().releasePersistableUriPermission(Uri.parse(current),
                            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                } catch (Exception ignored) {}
            }
            driveBackupPrefs().edit().clear().apply();
        }

        @JavascriptInterface
        public void driveBackup(String json, String reason, String sourceId) {
            ioExecutor.execute(() -> createDriveBackupSnapshot(json, reason, sourceId));
        }
"""
    java = rep(java, bridge_marker, bridge_new, "drive bridge")
    mainp.write_text(java, encoding="utf-8")

    # Product cards must not show a parent/subcategory picture as if it were the product picture.
    storep = app / "app" / "src" / "main" / "assets" / "app-v170.js"
    store = storep.read_text(encoding="utf-8")
    store = store.replace("imgMarkup(p,nearestPathImage())", "imgMarkup(p)")
    storep.write_text(store, encoding="utf-8")

    build = build.replace("versionCode 1052300", "versionCode 1052400", 1)
    build = build.replace("versionName '1.5.23'", "versionName '1.5.24'", 1)
    buildp.write_text(build, encoding="utf-8")

if __name__ == "__main__":
    main()
