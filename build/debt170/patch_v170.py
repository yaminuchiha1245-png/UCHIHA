#!/usr/bin/env python3
"""Apply v1.5.20 instant dialog and provider-style loader on top of v1.5.19."""
from pathlib import Path
import shutil
import sys


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"marker not found: {label}")
    return text.replace(old, new, 1)


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_v170.py <debt-app>")
    app = Path(sys.argv[1]).resolve()
    build_path = app / "app" / "build.gradle"
    build = build_path.read_text(encoding="utf-8")
    if "versionCode 1051900" not in build or "versionName '1.5.19'" not in build:
        raise SystemExit("unexpected v1.5.19 baseline")

    here = Path(__file__).resolve().parent
    overlay = here / "overlay" / "app" / "src" / "main" / "assets"
    assets = app / "app" / "src" / "main" / "assets"
    for name in ("app-v170.js", "app-v170.css", "loading-wallet-v170.png"):
        shutil.copy2(overlay / name, assets / name)

    index_path = assets / "index.html"
    index = index_path.read_text(encoding="utf-8")
    index = replace_once(index, 'href="app-v169.css"', 'href="app-v170.css"', "v170 stylesheet")
    index = replace_once(index, 'src="app-v169.js"', 'src="app-v170.js"', "v170 script")
    index_path.write_text(index, encoding="utf-8")

    build = build.replace("versionCode 1051900", "versionCode 1052000", 1)
    build = build.replace("versionName '1.5.19'", "versionName '1.5.20'", 1)
    build_path.write_text(build, encoding="utf-8")


if __name__ == "__main__":
    main()
