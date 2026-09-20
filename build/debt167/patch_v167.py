#!/usr/bin/env python3
"""Apply v1.5.17 WebView media loading fix on top of v1.5.16."""
from pathlib import Path
import sys

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"marker not found: {label}")
    return text.replace(old, new, 1)

def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_v167.py <debt-app>")
    app=Path(sys.argv[1]).resolve()
    build_path=app/"app"/"build.gradle"
    if not build_path.is_file():
        raise SystemExit("not an Android source tree")
    build=build_path.read_text(encoding="utf-8")
    if "versionCode 1051600" not in build or "versionName '1.5.16'" not in build:
        raise SystemExit("unexpected v1.5.16 baseline")

    main_path=app/"app"/"src"/"main"/"java"/"com"/"uchiha"/"debtstore"/"MainActivity.java"
    java=main_path.read_text(encoding="utf-8")
    java=replace_once(
        java,
        "settings.setBlockNetworkLoads(true);",
        "settings.setBlockNetworkLoads(false);\n        settings.setLoadsImagesAutomatically(true);\n        settings.setBlockNetworkImage(false);",
        "enable HTTPS media loads"
    )
    main_path.write_text(java,encoding="utf-8")

    index_path=app/"app"/"src"/"main"/"assets"/"index.html"
    index=index_path.read_text(encoding="utf-8")
    marker='  <meta name="theme-color" content="#0a0d12">'
    csp='  <meta http-equiv="Content-Security-Policy" content="default-src \'self\'; img-src \'self\' data: https://js4card.com https://www.js4card.com; style-src \'self\' \'unsafe-inline\'; script-src \'self\' \'unsafe-inline\'; connect-src \'none\'; font-src \'self\' data:;">'
    if csp not in index:
        index=replace_once(index,marker,marker+"\n"+csp,"restrict remote media origins")
    index_path.write_text(index,encoding="utf-8")

    build=build.replace("versionCode 1051600","versionCode 1051700",1)
    build=build.replace("versionName '1.5.16'","versionName '1.5.17'",1)
    build_path.write_text(build,encoding="utf-8")

if __name__=="__main__":
    main()
