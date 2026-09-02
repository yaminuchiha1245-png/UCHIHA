from pathlib import Path
import shutil, sys

root=Path(sys.argv[1])
repo=Path(__file__).resolve().parent

gradle=root/'app/build.gradle'
g=gradle.read_text(encoding='utf-8')
if 'versionCode 19' not in g or "versionName '1.3.2'" not in g:
    raise SystemExit('v1.3.2 version marker missing')
g=g.replace('versionCode 19','versionCode 20',1).replace("versionName '1.3.2'","versionName '1.4.0'",1)
gradle.write_text(g,encoding='utf-8')

assets=root/'app/src/main/assets'
shutil.copy2(repo/'app-v140.css',assets/'app-v140.css')
shutil.copy2(repo/'app-v140.js',assets/'app-v140.js')

index=assets/'index.html'
s=index.read_text(encoding='utf-8')
if 'app-v140.css' not in s:
    marker='  <link rel="stylesheet" href="app-v130.css">'
    if marker not in s: raise SystemExit('v130 css marker missing')
    s=s.replace(marker,marker+'\n  <link rel="stylesheet" href="app-v140.css">',1)
if 'app-v140.js' not in s:
    marker='  <script src="app-v130.js"></script>'
    if marker not in s: raise SystemExit('v130 js marker missing')
    s=s.replace(marker,marker+'\n  <script src="app-v140.js"></script>',1)
index.write_text(s,encoding='utf-8')

checks={
    gradle:['versionCode 20',"versionName '1.4.0'"],
    index:['app-v140.css','app-v140.js'],
    assets/'app-v140.js':['springSamples','motion-nav-pill','motion-theme-toggle','MutationObserver','prefers-reduced-motion'],
    assets/'app-v140.css':['Premium Interactive Motion UI','motion-route-progress','motion-skeleton','data-theme="light"']
}
for path,needles in checks.items():
    txt=path.read_text(encoding='utf-8')
    for needle in needles:
        if needle not in txt: raise SystemExit(f'missing {needle} in {path}')
print('PATCH_V140_MOTION_OK')
