from pathlib import Path
import sys

root=Path(sys.argv[1])
repo=Path(__file__).resolve().parent

gradle=root/'app/build.gradle'
g=gradle.read_text(encoding='utf-8')
if "versionCode 16" not in g or "versionName '1.2.8'" not in g:
    raise SystemExit('v128 gradle marker missing')
if "implementation 'com.squareup.okhttp3:okhttp:4.12.0'" not in g:
    raise SystemExit('okhttp dependency marker missing')
g=g.replace('versionCode 16','versionCode 17',1)
g=g.replace("versionName '1.2.8'","versionName '1.3.0'",1)
if 'zxing-android-embedded' not in g:
    g=g.replace("implementation 'com.squareup.okhttp3:okhttp:4.12.0'","implementation 'com.squareup.okhttp3:okhttp:4.12.0'\n    implementation 'com.journeyapps:zxing-android-embedded:4.3.0'",1)
gradle.write_text(g,encoding='utf-8')

idx=root/'app/src/main/assets/index.html'
s=idx.read_text(encoding='utf-8')
if 'app-v130.js' in s or 'app-v130.css' in s:
    raise SystemExit('v130 assets already referenced')
s=s.replace('<link rel="stylesheet" href="app-v110.css">','<link rel="stylesheet" href="app-v110.css">\n  <link rel="stylesheet" href="app-v130.css">',1)
s=s.replace('<script src="app-v121.js"></script>','<script src="app-v121.js"></script>\n  <script src="app-v130.js"></script>',1)
idx.write_text(s,encoding='utf-8')

parts=[repo/f'v130_app.part{i}' for i in (1,2,3)]
for p in parts:
    if not p.exists(): raise SystemExit(f'missing {p.name}')
js=''.join(p.read_text(encoding='utf-8') for p in parts)
if 'UCHIHA Debt Store v1.3.0' not in js or 'exportInvoicePdfV130' not in js or 'startInvoiceV130' not in js:
    raise SystemExit('v130 js payload markers missing')
(root/'app/src/main/assets/app-v130.js').write_text(js,encoding='utf-8')
css=(repo/'v130_app.css').read_text(encoding='utf-8')
if '.product-actions-v130' not in css or '.invoice-lines-v130' not in css:
    raise SystemExit('v130 css markers missing')
(root/'app/src/main/assets/app-v130.css').write_text(css,encoding='utf-8')

manifest=root/'app/src/main/AndroidManifest.xml'
m=manifest.read_text(encoding='utf-8')
if 'android.permission.CAMERA' not in m:
    marker='    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />'
    if marker not in m: raise SystemExit('manifest permission marker missing')
    m=m.replace(marker,marker+'\n    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-feature android:name="android.hardware.camera.any" android:required="false" />',1)
manifest.write_text(m,encoding='utf-8')

checks={
    gradle:["versionCode 17","versionName '1.3.0'",'zxing-android-embedded:4.3.0','minifyEnabled false'],
    idx:['app-v130.css','app-v130.js'],
    manifest:['android.permission.CAMERA','android.hardware.camera.any'],
    root/'app/src/main/assets/app-v130.js':['onNativeBarcodeScanned','فاتورة منتجات كاملة','invoice_id','exportInvoicePdfV130'],
}
for path,needles in checks.items():
    text=path.read_text(encoding='utf-8')
    for needle in needles:
        if needle not in text: raise SystemExit(f'missing marker {needle} in {path}')
print('PATCH_V130_OK')
