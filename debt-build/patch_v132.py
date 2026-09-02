from pathlib import Path
import sys

root=Path(sys.argv[1])

def rw(path, old, new, label):
    p=root/path
    s=p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'{label} marker missing in {p}')
    p.write_text(s.replace(old,new,1),encoding='utf-8')

# Version + dependencies: remove the legacy embedded Camera1 scanner.
rw('app/build.gradle','versionCode 18','versionCode 19','versionCode')
rw('app/build.gradle',"versionName '1.3.1'","versionName '1.3.2'",'versionName')
rw('app/build.gradle',"implementation 'com.journeyapps:zxing-android-embedded:4.3.0'","implementation 'com.google.zxing:core:3.5.3'\n    implementation 'androidx.core:core:1.15.0'",'legacy zxing dependency')
rw('gradle.properties','android.useAndroidX=false','android.useAndroidX=true','AndroidX')

java=root/'app/src/main/java/com/uchiha/debtstore/MainActivity.java'
s=java.read_text(encoding='utf-8')

# Imports.
s=s.replace('import android.graphics.Canvas;','import android.graphics.Bitmap;\nimport android.graphics.BitmapFactory;\nimport android.graphics.Canvas;',1)
s=s.replace('import android.graphics.Paint;','import android.graphics.Paint;\nimport android.graphics.Matrix;',1)
s=s.replace('import android.widget.Toast;','import android.widget.Toast;\n\nimport androidx.core.content.FileProvider;',1)
s=s.replace('import java.text.SimpleDateFormat;','import java.text.SimpleDateFormat;\nimport java.util.Arrays;',1)
s=s.replace('import java.util.Date;','import java.util.Date;\nimport java.util.EnumMap;',1)
s=s.replace('import java.util.Locale;','import java.util.Locale;\nimport java.util.Map;',1)
legacy_imports='import com.google.zxing.integration.android.IntentIntegrator;\nimport com.google.zxing.integration.android.IntentResult;'
core_imports='''import com.google.zxing.BarcodeFormat;\nimport com.google.zxing.BinaryBitmap;\nimport com.google.zxing.DecodeHintType;\nimport com.google.zxing.MultiFormatReader;\nimport com.google.zxing.RGBLuminanceSource;\nimport com.google.zxing.Result;\nimport com.google.zxing.common.HybridBinarizer;'''
if legacy_imports not in s: raise SystemExit('legacy scanner imports missing')
s=s.replace(legacy_imports,core_imports,1)

# Request code and state.
s=s.replace('private static final int CAMERA_PERMISSION_REQUEST = 4311;','private static final int BARCODE_PHOTO_REQUEST = 4312;',1)
field='    private volatile int realtimeRef = 1;'
if field not in s: raise SystemExit('realtime field marker missing')
s=s.replace(field,field+'\n    private boolean barcodeScanInProgress = false;\n    private File barcodePhotoFile;',1)

# Ensure temp photo is cleaned on shutdown.
old='''        realtimeHttp.connectionPool().evictAll();\n        ioExecutor.shutdownNow();\n        if (webView != null) webView.destroy();'''
new='''        realtimeHttp.connectionPool().evictAll();\n        ioExecutor.shutdownNow();\n        cleanupBarcodePhoto();\n        if (webView != null) webView.destroy();'''
if old not in s: raise SystemExit('onDestroy marker missing')
s=s.replace(old,new,1)

old_scanner='''    private void openBarcodeScannerSafely() {\n        try {\n            if (!getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA_ANY)) {\n                toast("هذا الجهاز لا يحتوي على كاميرا متاحة");\n                return;\n            }\n            if (android.os.Build.VERSION.SDK_INT >= 23 &&\n                    checkSelfPermission(android.Manifest.permission.CAMERA) != android.content.pm.PackageManager.PERMISSION_GRANTED) {\n                requestPermissions(new String[]{android.Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);\n                return;\n            }\n            IntentIntegrator integrator = new IntentIntegrator(MainActivity.this);\n            integrator.setCaptureActivity(BarcodeCaptureActivity.class);\n            integrator.setDesiredBarcodeFormats(IntentIntegrator.ALL_CODE_TYPES);\n            integrator.setPrompt("وجّه الكاميرا نحو باركود المنتج");\n            integrator.setBeepEnabled(false);\n            integrator.setBarcodeImageEnabled(false);\n            integrator.setOrientationLocked(false);\n            integrator.initiateScan();\n        } catch (Throwable e) {\n            toast("تعذر فتح ماسح الباركود — تحقق من صلاحية الكاميرا");\n        }\n    }\n'''
new_scanner='''    /**\n     * Stability-first barcode flow. The app never opens a live Camera1 preview.\n     * It delegates capture to the phone camera app and decodes the saved photo locally.\n     */\n    private void openBarcodeScannerSafely() {\n        if (barcodeScanInProgress) return;\n        if (!getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA_ANY)) {\n            toast("هذا الجهاز لا يحتوي على كاميرا متاحة");\n            js("window.onNativeBarcodeCancelled && window.onNativeBarcodeCancelled()");\n            return;\n        }\n        openSystemCameraBarcodeFallback();\n    }\n\n    private void deliverBarcode(String value) {\n        if (value == null || value.trim().isEmpty()) return;\n        js("window.onNativeBarcodeScanned && window.onNativeBarcodeScanned(" + JSONObject.quote(value.trim()) + ")");\n    }\n\n    private void openSystemCameraBarcodeFallback() {\n        if (barcodeScanInProgress) return;\n        try {\n            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);\n            if (camera.resolveActivity(getPackageManager()) == null) {\n                toast("لا يوجد تطبيق كاميرا متاح على الجهاز");\n                js("window.onNativeBarcodeCancelled && window.onNativeBarcodeCancelled()");\n                return;\n            }\n            File dir = new File(getCacheDir(), "barcode");\n            if (!dir.exists() && !dir.mkdirs()) throw new IOException("camera_cache");\n            barcodePhotoFile = File.createTempFile("barcode_", ".jpg", dir);\n            Uri photoUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", barcodePhotoFile);\n            camera.putExtra(MediaStore.EXTRA_OUTPUT, photoUri);\n            camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);\n            camera.setClipData(ClipData.newRawUri("barcode", photoUri));\n            barcodeScanInProgress = true;\n            startActivityForResult(camera, BARCODE_PHOTO_REQUEST);\n            toast("تم تشغيل كاميرا الهاتف الآمنة — صوّر الباركود بوضوح");\n        } catch (Throwable error) {\n            barcodeScanInProgress = false;\n            cleanupBarcodePhoto();\n            toast("تعذر فتح الكاميرا الآمنة");\n            js("window.onNativeBarcodeCancelled && window.onNativeBarcodeCancelled()");\n        }\n    }\n\n    private void decodeBarcodePhotoAsync(File photo) {\n        ioExecutor.execute(() -> {\n            String decoded = null;\n            try {\n                Bitmap bitmap = loadBarcodeBitmap(photo);\n                if (bitmap != null) { decoded = decodeBarcodeBitmap(bitmap); bitmap.recycle(); }\n            } catch (Throwable ignored) {\n            } finally { cleanupBarcodePhoto(); }\n            final String value = decoded;\n            runOnUiThread(() -> {\n                barcodeScanInProgress = false;\n                if (value != null && !value.trim().isEmpty()) deliverBarcode(value.trim());\n                else {\n                    toast("لم أتمكن من قراءة الباركود من الصورة — قرّبه من الكاميرا وحاول مجددًا");\n                    js("window.onNativeBarcodeCancelled && window.onNativeBarcodeCancelled()");\n                }\n            });\n        });\n    }\n\n    private Bitmap loadBarcodeBitmap(File photo) throws IOException {\n        if (photo == null || !photo.exists() || photo.length() == 0) return null;\n        BitmapFactory.Options bounds = new BitmapFactory.Options();\n        bounds.inJustDecodeBounds = true;\n        BitmapFactory.decodeFile(photo.getAbsolutePath(), bounds);\n        int maxSide = Math.max(bounds.outWidth, bounds.outHeight), sample = 1;\n        while (maxSide / sample > 1800) sample *= 2;\n        BitmapFactory.Options opts = new BitmapFactory.Options();\n        opts.inSampleSize = Math.max(1, sample);\n        opts.inPreferredConfig = Bitmap.Config.ARGB_8888;\n        Bitmap bitmap = BitmapFactory.decodeFile(photo.getAbsolutePath(), opts);\n        if (bitmap == null) return null;\n        int rotation = 0;\n        try {\n            android.media.ExifInterface exif = new android.media.ExifInterface(photo.getAbsolutePath());\n            int orientation = exif.getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, android.media.ExifInterface.ORIENTATION_NORMAL);\n            if (orientation == android.media.ExifInterface.ORIENTATION_ROTATE_90) rotation = 90;\n            else if (orientation == android.media.ExifInterface.ORIENTATION_ROTATE_180) rotation = 180;\n            else if (orientation == android.media.ExifInterface.ORIENTATION_ROTATE_270) rotation = 270;\n        } catch (Throwable ignored) {}\n        if (rotation == 0) return bitmap;\n        Matrix matrix = new Matrix(); matrix.postRotate(rotation);\n        Bitmap rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);\n        if (rotated != bitmap) bitmap.recycle();\n        return rotated;\n    }\n\n    private String decodeBarcodeBitmap(Bitmap bitmap) {\n        if (bitmap == null) return null;\n        int width = bitmap.getWidth(), height = bitmap.getHeight();\n        int[] pixels = new int[width * height];\n        bitmap.getPixels(pixels, 0, width, 0, 0, width, height);\n        BinaryBitmap binary = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(width, height, pixels)));\n        MultiFormatReader reader = new MultiFormatReader();\n        Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);\n        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);\n        hints.put(DecodeHintType.POSSIBLE_FORMATS, Arrays.asList(\n                BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,\n                BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.CODABAR,\n                BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX));\n        reader.setHints(hints);\n        try { Result result = reader.decodeWithState(binary); return result == null ? null : result.getText(); }\n        catch (Throwable ignored) { return null; }\n        finally { reader.reset(); }\n    }\n\n    private void cleanupBarcodePhoto() {\n        File photo = barcodePhotoFile; barcodePhotoFile = null;\n        if (photo != null) try { if (photo.exists()) photo.delete(); } catch (Throwable ignored) {}\n    }\n'''
if old_scanner not in s: raise SystemExit('v1.3.1 scanner method missing')
s=s.replace(old_scanner,new_scanner,1)

old_results='''    @Override\n    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {\n        super.onRequestPermissionsResult(requestCode, permissions, grantResults);\n        if (requestCode == CAMERA_PERMISSION_REQUEST) {\n            if (grantResults.length > 0 && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED) {\n                openBarcodeScannerSafely();\n            } else {\n                toast("يلزم السماح للتطبيق باستخدام الكاميرا لقراءة الباركود");\n            }\n        }\n    }\n\n    @Override\n    protected void onActivityResult(int requestCode, int resultCode, Intent data) {\n        IntentResult scan = IntentIntegrator.parseActivityResult(requestCode, resultCode, data);\n        if (scan != null) {\n            if (scan.getContents() != null && !scan.getContents().trim().isEmpty()) {\n                js("window.onNativeBarcodeScanned && window.onNativeBarcodeScanned(" + JSONObject.quote(scan.getContents().trim()) + ")");\n            } else {\n                js("window.onNativeBarcodeCancelled && window.onNativeBarcodeCancelled()");\n            }\n            return;\n        }\n        super.onActivityResult(requestCode, resultCode, data);\n'''
new_results='''    @Override\n    protected void onActivityResult(int requestCode, int resultCode, Intent data) {\n        super.onActivityResult(requestCode, resultCode, data);\n        if (requestCode == BARCODE_PHOTO_REQUEST) {\n            if (resultCode == RESULT_OK && barcodePhotoFile != null) decodeBarcodePhotoAsync(barcodePhotoFile);\n            else {\n                barcodeScanInProgress = false;\n                cleanupBarcodePhoto();\n                js("window.onNativeBarcodeCancelled && window.onNativeBarcodeCancelled()");\n            }\n            return;\n        }\n'''
if old_results not in s: raise SystemExit('v1.3.1 scanner result block missing')
s=s.replace(old_results,new_results,1)
java.write_text(s,encoding='utf-8')

# Manifest: no CAMERA permission; external camera app owns capture. Replace scanner Activity with FileProvider.
manifest=root/'app/src/main/AndroidManifest.xml'
m=manifest.read_text(encoding='utf-8')
m=m.replace('    <uses-permission android:name="android.permission.CAMERA" />\n','',1)
old_activity='''            <activity\n            android:name=".BarcodeCaptureActivity"\n            android:exported="false"\n            android:screenOrientation="portrait"\n            android:stateNotNeeded="true" />'''
provider='''            <provider\n            android:name="androidx.core.content.FileProvider"\n            android:authorities="${applicationId}.fileprovider"\n            android:exported="false"\n            android:grantUriPermissions="true">\n            <meta-data\n                android:name="android.support.FILE_PROVIDER_PATHS"\n                android:resource="@xml/file_paths" />\n        </provider>'''
if old_activity not in m: raise SystemExit('BarcodeCaptureActivity manifest marker missing')
m=m.replace(old_activity,provider,1)
manifest.write_text(m,encoding='utf-8')

capture=root/'app/src/main/java/com/uchiha/debtstore/BarcodeCaptureActivity.java'
if capture.exists(): capture.unlink()
xml=root/'app/src/main/res/xml/file_paths.xml'
xml.parent.mkdir(parents=True,exist_ok=True)
xml.write_text('''<?xml version="1.0" encoding="utf-8"?>\n<paths xmlns:android="http://schemas.android.com/apk/res/android">\n    <cache-path name="barcode_cache" path="barcode/" />\n</paths>\n''',encoding='utf-8')

checks={
  root/'app/build.gradle':["versionCode 19","versionName '1.3.2'","com.google.zxing:core:3.5.3","androidx.core:core:1.15.0"],
  java:['BARCODE_PHOTO_REQUEST','ACTION_IMAGE_CAPTURE','FileProvider.getUriForFile','decodeBarcodeBitmap','RGBLuminanceSource'],
  manifest:['androidx.core.content.FileProvider','@xml/file_paths'],
}
for p,needles in checks.items():
    txt=p.read_text(encoding='utf-8')
    for n in needles:
        if n not in txt: raise SystemExit(f'missing {n} in {p}')
for forbidden in ['IntentIntegrator','IntentResult','BarcodeCaptureActivity','CAMERA_PERMISSION_REQUEST']:
    if forbidden in java.read_text(encoding='utf-8'): raise SystemExit(f'legacy symbol remains: {forbidden}')
if 'android.permission.CAMERA' in manifest.read_text(encoding='utf-8'): raise SystemExit('CAMERA permission still present')
print('PATCH_V132_SAFE_OK')
