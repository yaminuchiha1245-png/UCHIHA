#!/usr/bin/env python3
"""Overlay the v1.4.6 digital-products preview onto v1.4.5."""
from pathlib import Path
import base64
import shutil
import sys


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing {label} marker; refusing to patch")
    return text.replace(old, new, 1)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_v146.py <debt-app>")
    app = Path(sys.argv[1]).resolve()
    build_path = app / "app" / "build.gradle"
    if not build_path.is_file():
        raise SystemExit(f"not an Android source tree: {app}")
    build = build_path.read_text(encoding="utf-8")
    if "versionCode 1040500" not in build or "versionName '1.4.5'" not in build:
        raise SystemExit("unexpected v1.4.5 baseline; refusing to overlay")

    here = Path(__file__).resolve().parent
    assets = app / "app" / "src" / "main" / "assets"
    encoded_assets = here / "assets"
    for name in ("app-v146.js", "app-v146.css"):
        parts = sorted(encoded_assets.glob("lite-" + name + ".b64.part-*"))
        if not parts:
            raise SystemExit(f"missing encoded asset chunks for {name}")
        raw = base64.b64decode(
            "".join(part.read_text(encoding="ascii").strip() for part in parts),
            validate=True,
        )
        (assets / name).write_bytes(raw)

    repo_root = here.parents[1]
    hero = repo_root / "static" / "uchiha-hero-market.webp"
    if not hero.is_file():
        raise SystemExit("digital hero asset is missing")
    shutil.copy2(hero, assets / "digital-hero.webp")

    index_path = assets / "index.html"
    index = index_path.read_text(encoding="utf-8")
    index = replace_once(
        index,
        '<link rel="stylesheet" href="app-v145.css">',
        '<link rel="stylesheet" href="app-v145.css">\n  <link rel="stylesheet" href="app-v146.css">',
        "v145 stylesheet",
    )
    index = replace_once(
        index,
        '<script src="app-v145.js"></script>',
        '<script src="app-v145.js"></script>\n  <script src="app-v146.js"></script>',
        "v145 script",
    )
    index_path.write_text(index, encoding="utf-8")

    debt_service_path = (
        app / "app" / "src" / "main" / "java" / "com" / "uchiha" / "debtstore" / "DebtService.java"
    )
    java = debt_service_path.read_text(encoding="utf-8")
    old = '"owner_create","owner_list","owner_backups","owner_download","owner_set_active","owner_reset_device","owner_audit"));'
    new = '"owner_create","owner_list","owner_backups","owner_download","owner_set_active","owner_reset_device","owner_audit",\n        "digital_catalog","digital_payment_methods","digital_purchase","digital_deposit_create",\n        "owner_digital_set_token","owner_digital_deposits","owner_digital_orders","owner_digital_methods","owner_digital_wallets"));'
    java = replace_once(java, old, new, "DebtService allowlist")
    debt_service_path.write_text(java, encoding="utf-8")

    build = build.replace("versionCode 1040500", "versionCode 1040600", 1)
    build = build.replace("versionName '1.4.5'", "versionName '1.4.6'", 1)
    build_path.write_text(build, encoding="utf-8")


if __name__ == "__main__":
    main()
