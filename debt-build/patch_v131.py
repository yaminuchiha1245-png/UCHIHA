from pathlib import Path
import sys

root=Path(sys.argv[1])

gradle=root/'app/build.gradle'
g=gradle.read_text(encoding='utf-8')
if "versionCode 17" not in g or "versionName '1.3.0'" not in g:
    raise SystemExit('v130 version marker missing')
g=g.replace('versionCode 17','versionCode 18',1)
g=g.replace("versionName '1.3.0'","versionName '1.3.1'",1)
gradle.write_text(g,encoding='utf-8')

java=root/'app/src/main/java/com/uchiha/debtstore/MainActivity.java'
s=java.read_text(encoding='utf-8')

const_marker='    private static final int PICK_BACKUP_REQUEST = 4107;'
if const_marker not in s:
    raise SystemExit('request code marker missing')
if 'CAMERA_PERMISSION_REQUEST' not in s:
    s=s.replace(const_marker,const_marker+'\n    private static final int CAMERA_PERMISSION_REQUEST = 4311;',1)

helper_marker='    private void exportInvoicePdf(String json, String fileName) {'
if helper_marker not in s:
    raise SystemExit('invoice pdf marker missing')
helper='''    private void openBarcodeScannerSafely() {\n        try {\n            if (!getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA_ANY)) {\n                toast("هذا الجهاز لا يحتوي على كاميرا متاحة");\n                return;\n            }\n            if (android.os.Build.VERSION.SDK_INT >= 23 &&\n                    checkSelfPermission(android.Manifest.permission.CAMERA) != android.content.pm.PackageManager.PERMISSION_GRANTED) {\n                requestPermissions(new String[]{android.Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);\n                return;\n            }\n            IntentIntegrator integrator = new IntentIntegrator(MainActivity.this);\n            integrator.setCaptureActivity(BarcodeCaptureActivity.class);\n            integrator.setDesiredBarcodeFormats(IntentIntegrator.ALL_CODE_TYPES);\n            integrator.setPrompt("وجّه الكاميرا نحو باركود المنتج");\n            integrator.setBeepEnabled(false);\n            integrator.setBarcodeImageEnabled(false);\n            integrator.setOrientationLocked(false);\n            integrator.initiateScan();\n        } catch (Throwable e) {\n            toast("تعذر فتح ماسح الباركود — تحقق من صلاحية الكاميرا");\n        }\n    }\n\n'''
if 'private void openBarcodeScannerSafely()' not in s:
    s=s.replace(helper_marker,helper+helper_marker,1)

activity_result_marker='    @Override\n    protected void onActivityResult(int requestCode, int resultCode, Intent data) {'
if activity_result_marker not in s:
    raise SystemExit('activity result marker missing')
permission_cb='''    @Override\n    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {\n        super.onRequestPermissionsResult(requestCode, permissions, grantResults);\n        if (requestCode == CAMERA_PERMISSION_REQUEST) {\n            if (grantResults.length > 0 && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED) {\n                openBarcodeScannerSafely();\n            } else {\n                toast("يلزم السماح للتطبيق باستخدام الكاميرا لقراءة الباركود");\n            }\n        }\n    }\n\n'''
if 'public void onRequestPermissionsResult(int requestCode' not in s:
    s=s.replace(activity_result_marker,permission_cb+activity_result_marker,1)

old='''        @JavascriptInterface\n        public void scanBarcode() {\n            runOnUiThread(() -> {\n                try {\n                    IntentIntegrator integrator = new IntentIntegrator(MainActivity.this);\n                    integrator.setDesiredBarcodeFormats(IntentIntegrator.PRODUCT_CODE_TYPES);\n                    integrator.setPrompt("وجّه الكاميرا نحو باركود المنتج");\n                    integrator.setBeepEnabled(false);\n                    integrator.setBarcodeImageEnabled(false);\n                    integrator.setOrientationLocked(true);\n                    integrator.initiateScan();\n                } catch (Exception e) { toast("تعذر فتح ماسح الباركود"); }\n            });\n        }\n'''
new='''        @JavascriptInterface\n        public void scanBarcode() {\n            runOnUiThread(() -> MainActivity.this.openBarcodeScannerSafely());\n        }\n'''
if old not in s:
    raise SystemExit('old scanner bridge marker missing')
s=s.replace(old,new,1)
java.write_text(s,encoding='utf-8')

capture=root/'app/src/main/java/com/uchiha/debtstore/BarcodeCaptureActivity.java'
capture.write_text('''package com.uchiha.debtstore;\n\n/** Dedicated barcode scanner Activity for device/OEM compatibility. */\npublic class BarcodeCaptureActivity extends com.journeyapps.barcodescanner.CaptureActivity {\n}\n''',encoding='utf-8')

manifest=root/'app/src/main/AndroidManifest.xml'
m=manifest.read_text(encoding='utf-8')
if 'BarcodeCaptureActivity' not in m:
    activity='''        <activity\n            android:name=".BarcodeCaptureActivity"\n            android:exported="false"\n            android:screenOrientation="portrait"\n            android:stateNotNeeded="true" />\n'''
    if '</application>' not in m:
        raise SystemExit('application close marker missing')
    m=m.replace('</application>',activity+'    </application>',1)
manifest.write_text(m,encoding='utf-8')

checks={
    gradle:["versionCode 18","versionName '1.3.1'"],
    java:['CAMERA_PERMISSION_REQUEST','openBarcodeScannerSafely','IntentIntegrator.ALL_CODE_TYPES','BarcodeCaptureActivity.class','onRequestPermissionsResult'],
    capture:['extends com.journeyapps.barcodescanner.CaptureActivity'],
    manifest:['android.permission.CAMERA','BarcodeCaptureActivity'],
}
for path,needles in checks.items():
    txt=path.read_text(encoding='utf-8')
    for needle in needles:
        if needle not in txt:
            raise SystemExit(f'missing {needle} in {path}')
print('PATCH_V131_OK')
