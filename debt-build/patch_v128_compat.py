from pathlib import Path
import sys
root=Path(sys.argv[1])
gradle=root/'app/build.gradle'
g=gradle.read_text(encoding='utf-8')
if "versionCode 15" not in g or "versionName '1.2.7'" not in g:
    raise SystemExit('v127 gradle marker missing')
if 'minifyEnabled true' not in g:
    raise SystemExit('release minify marker missing')
g=g.replace('versionCode 15','versionCode 16',1)
g=g.replace("versionName '1.2.7'","versionName '1.2.8'",1)
g=g.replace('minifyEnabled true','minifyEnabled false',1)
gradle.write_text(g,encoding='utf-8')
print('PATCH_V128_COMPAT_OK')
