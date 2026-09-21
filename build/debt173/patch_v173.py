#!/usr/bin/env python3
"""Apply v1.5.23 product image inheritance + hero asset fix on top of v1.5.22."""
from pathlib import Path
import sys

def rep(s, a, b, label):
    if a not in s:
        raise SystemExit(f"marker not found: {label}")
    return s.replace(a, b, 1)

def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_v173.py <debt-app>")

    app = Path(sys.argv[1]).resolve()
    buildp = app / "app" / "build.gradle"
    build = buildp.read_text(encoding="utf-8")
    if "versionCode 1052200" not in build or "versionName '1.5.22'" not in build:
        raise SystemExit("unexpected v1.5.22 baseline")

    jsp = app / "app" / "src" / "main" / "assets" / "app-v170.js"
    js = jsp.read_text(encoding="utf-8")

    js = rep(
        js,
        'src="digital-hero-v158.webp"',
        'src="digital-hero-v163.webp"',
        "hero asset",
    )

    js = rep(
        js,
        """'+imgMarkup(p)+'</div><div class="digital-card-name">""",
        """'+imgMarkup(p,nearestPathImage())+'</div><div class="digital-card-name">""",
        "product image inheritance",
    )
    jsp.write_text(js, encoding="utf-8")

    syncp = app / "app" / "src" / "main" / "assets" / "sync-v165.js"
    sync = syncp.read_text(encoding="utf-8")
    sync = rep(
        sync,
        "const SYNC_VERSION='1.5.22';",
        "const SYNC_VERSION='1.5.23';",
        "sync version",
    )
    syncp.write_text(sync, encoding="utf-8")

    build = build.replace("versionCode 1052200", "versionCode 1052300", 1)
    build = build.replace("versionName '1.5.22'", "versionName '1.5.23'", 1)
    buildp.write_text(build, encoding="utf-8")

if __name__ == "__main__":
    main()
