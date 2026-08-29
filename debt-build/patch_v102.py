from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'debt-app')
java = root / 'app/src/main/java/com/uchiha/debtstore/MainActivity.java'
s = java.read_text(encoding='utf-8')
old = '''        @JavascriptInterface\n        public void exportDebtSummaryPdf(String json, String fileName) {\n            exportDebtSummaryPdf(json, fileName);\n        }\n'''
new = '''        @JavascriptInterface\n        public void exportDebtSummaryPdf(String json, String fileName) {\n            MainActivity.this.exportDebtSummaryPdf(json, fileName);\n        }\n'''
if old not in s:
    if new not in s:
        raise SystemExit('PDF summary bridge block not found')
else:
    s = s.replace(old, new, 1)
java.write_text(s, encoding='utf-8')

gradle = root / 'app/build.gradle'
g = gradle.read_text(encoding='utf-8')
g = g.replace('versionCode 2', 'versionCode 3').replace("versionName '1.0.1'", "versionName '1.0.2'")
gradle.write_text(g, encoding='utf-8')

check = java.read_text(encoding='utf-8')
if 'MainActivity.this.exportDebtSummaryPdf(json, fileName);' not in check:
    raise SystemExit('PDF summary bridge recursion fix missing')
print('PATCH_V102_OK')
