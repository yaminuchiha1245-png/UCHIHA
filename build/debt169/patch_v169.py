#!/usr/bin/env python3
"""Apply v1.5.19 schema-driven purchase dialog on top of v1.5.18."""
from pathlib import Path
import shutil
import sys


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"marker not found: {label}")
    return text.replace(old, new, 1)


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_v169.py <debt-app>")
    app = Path(sys.argv[1]).resolve()
    build_path = app / "app" / "build.gradle"
    build = build_path.read_text(encoding="utf-8")
    if "versionCode 1051800" not in build or "versionName '1.5.18'" not in build:
        raise SystemExit("unexpected v1.5.18 baseline")

    here = Path(__file__).resolve().parent
    assets = app / "app" / "src" / "main" / "assets"
    shutil.copy2(here / "overlay" / "app" / "src" / "main" / "assets" / "app-v169.js", assets / "app-v169.js")
    shutil.copy2(here / "overlay" / "app" / "src" / "main" / "assets" / "app-v169.css", assets / "app-v169.css")

    index_path = assets / "index.html"
    index = index_path.read_text(encoding="utf-8")
    index = replace_once(index, 'href="app-v164.css"', 'href="app-v169.css"', "v169 stylesheet")
    index = replace_once(index, 'src="app-v164.js"', 'src="app-v169.js"', "v169 script")
    index_path.write_text(index, encoding="utf-8")

    service_path = app / "app" / "src" / "main" / "java" / "com" / "uchiha" / "debtstore" / "DebtService.java"
    service = service_path.read_text(encoding="utf-8")
    service = replace_once(
        service,
        '"digital_catalog","digital_product","digital_purchase","digital_wallet","digital_topup_create",',
        '"digital_catalog","digital_product","digital_verify_player","digital_purchase","digital_wallet","digital_topup_create",',
        "native player verification allow-list",
    )
    service = replace_once(
        service,
        "conn.setConnectTimeout(15000);conn.setReadTimeout(35000);conn.setRequestMethod(\"POST\");",
        "conn.setConnectTimeout(15000);conn.setReadTimeout(action.startsWith(\"digital_\")||action.startsWith(\"owner_digital_\")?90000:35000);conn.setRequestMethod(\"POST\");",
        "digital provider read timeout",
    )
    service_path.write_text(service, encoding="utf-8")

    build = build.replace("versionCode 1051800", "versionCode 1051900", 1)
    build = build.replace("versionName '1.5.18'", "versionName '1.5.19'", 1)
    build_path.write_text(build, encoding="utf-8")


if __name__ == "__main__":
    main()
