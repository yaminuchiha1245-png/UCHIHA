#!/usr/bin/env python3
"""Overlay the real v1.4.9 digital store onto the approved v1.4.5 debt app."""
from pathlib import Path
import shutil
import sys


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"marker not found: {label}")
    return text.replace(old, new, 1)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_v149.py <debt-app>")
    app = Path(sys.argv[1]).resolve()
    build_path = app / "app" / "build.gradle"
    if not build_path.is_file():
        raise SystemExit(f"not an Android source tree: {app}")

    build = build_path.read_text(encoding="utf-8")
    if "versionCode 1040500" not in build or "versionName '1.4.5'" not in build:
        raise SystemExit("unexpected v1.4.5 baseline; refusing to overlay")

    overlay = Path(__file__).resolve().parent / "overlay"
    for source in overlay.rglob("*"):
        if source.is_file():
            relative = source.relative_to(overlay)
            target = app / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)

    index_path = app / "app" / "src" / "main" / "assets" / "index.html"
    index = index_path.read_text(encoding="utf-8")
    index = replace_once(index, '<link rel="stylesheet" href="app-v145.css">', '<link rel="stylesheet" href="app-v145.css">\n  <link rel="stylesheet" href="app-v149.css">', "v149 css")
    index = replace_once(index, '<script src="app-v145.js"></script>', '<script src="app-v145.js"></script>\n  <script src="app-v149.js"></script>', "v149 js")
    index_path.write_text(index, encoding="utf-8")

    debt_service = app / "app" / "src" / "main" / "java" / "com" / "uchiha" / "debtstore" / "DebtService.java"
    service = debt_service.read_text(encoding="utf-8")
    old_allowed = '"owner_create","owner_list","owner_backups","owner_download","owner_set_active","owner_reset_device","owner_audit"));'
    new_allowed = '"owner_create","owner_list","owner_backups","owner_download","owner_set_active","owner_reset_device","owner_audit",\n        "digital_catalog","digital_product","digital_purchase","digital_wallet","digital_topup_create",\n        "owner_digital_config_get","owner_digital_config_set","owner_digital_provider_test",\n        "owner_digital_wallets","owner_digital_wallet_adjust","owner_digital_topups","owner_digital_topup_review",\n        "owner_digital_orders","owner_digital_order_update"));'
    service = replace_once(service, old_allowed, new_allowed, "DebtService digital actions")
    debt_service.write_text(service, encoding="utf-8")

    main_activity = app / "app" / "src" / "main" / "java" / "com" / "uchiha" / "debtstore" / "MainActivity.java"
    java = main_activity.read_text(encoding="utf-8")
    java = replace_once(
        java,
        "private static final int BARCODE_PHOTO_REQUEST = 4312;",
        "private static final int BARCODE_PHOTO_REQUEST = 4312;\n    private static final int DIGITAL_PROOF_REQUEST = 4416;",
        "proof request code",
    )
    activity_handler = r'''        if (requestCode == DIGITAL_PROOF_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                Uri uri = data.getData();
                ioExecutor.execute(() -> {
                    try (InputStream in = getContentResolver().openInputStream(uri)) {
                        if (in == null) throw new IOException("تعذر قراءة الصورة");
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        byte[] chunk = new byte[8192];
                        int count;
                        while ((count = in.read(chunk)) != -1) {
                            if (out.size() + count > 2_000_000) throw new IOException("الصورة كبيرة");
                            out.write(chunk, 0, count);
                        }
                        String mime = getContentResolver().getType(uri);
                        if (mime == null || !(mime.equals("image/png") || mime.equals("image/jpeg") || mime.equals("image/webp"))) {
                            mime = "image/jpeg";
                        }
                        String encoded = android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP);
                        String dataUrl = "data:" + mime + ";base64," + encoded;
                        js("window.onDigitalProofPicked && window.onDigitalProofPicked(" + JSONObject.quote(dataUrl) + "," + JSONObject.quote("إثبات التحويل") + ")");
                    } catch (Exception e) {
                        toast("تعذر قراءة صورة إثبات التحويل");
                        js("window.onDigitalProofCancelled && window.onDigitalProofCancelled()");
                    }
                });
            } else {
                js("window.onDigitalProofCancelled && window.onDigitalProofCancelled()");
            }
            return;
        }
'''
    java = replace_once(java, "        if (requestCode == PICK_BACKUP_REQUEST) {", activity_handler + "        if (requestCode == PICK_BACKUP_REQUEST) {", "proof result handler")
    bridge_methods = r'''        @JavascriptInterface
        public void pickDigitalProof() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                try { startActivityForResult(intent, DIGITAL_PROOF_REQUEST); }
                catch (ActivityNotFoundException e) { toast("لا يوجد مدير صور متاح"); }
            });
        }

        @JavascriptInterface
        public String qrDataUrl(String text) {
            try {
                String value = text == null ? "" : text.trim();
                if (value.isEmpty() || value.length() > 300) return "";
                com.google.zxing.common.BitMatrix matrix =
                    new com.google.zxing.MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, 420, 420);
                Bitmap bitmap = Bitmap.createBitmap(420, 420, Bitmap.Config.ARGB_8888);
                for (int y = 0; y < 420; y++) {
                    for (int x = 0; x < 420; x++) {
                        bitmap.setPixel(x, y, matrix.get(x, y) ? Color.BLACK : Color.WHITE);
                    }
                }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
                return "data:image/png;base64," + android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP);
            } catch (Exception e) {
                return "";
            }
        }

'''
    java = replace_once(
        java,
        "        @JavascriptInterface\n        public void notifyUser(String title, String body) {",
        bridge_methods + "        @JavascriptInterface\n        public void notifyUser(String title, String body) {",
        "digital native bridge",
    )
    main_activity.write_text(java, encoding="utf-8")

    build = build.replace("versionCode 1040500", "versionCode 1040900", 1)
    build = build.replace("versionName '1.4.5'", "versionName '1.4.9'", 1)
    build_path.write_text(build, encoding="utf-8")


if __name__ == "__main__":
    main()
