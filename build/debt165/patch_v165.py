#!/usr/bin/env python3
"""Apply v1.5.15 non-destructive partner sync on top of the complete v1.5.14 app."""
from pathlib import Path
import shutil
import sys

def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"marker not found: {label}")
    return text.replace(old, new, 1)

def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_v165.py <debt-app>")
    app = Path(sys.argv[1]).resolve()
    build_path = app / "app" / "build.gradle"
    if not build_path.is_file():
        raise SystemExit(f"not an Android source tree: {app}")

    build = build_path.read_text(encoding="utf-8")
    if "versionCode 1051400" not in build or "versionName '1.5.14'" not in build:
        raise SystemExit("unexpected v1.5.14 baseline; refusing to overlay")

    overlay = Path(__file__).resolve().parent / "overlay"
    for source in overlay.rglob("*"):
        if source.is_file():
            target = app / source.relative_to(overlay)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)

    index_path = app / "app" / "src" / "main" / "assets" / "index.html"
    index = index_path.read_text(encoding="utf-8")
    index = replace_once(
        index,
        '  <script src="app-v164.js"></script>',
        '  <script src="app-v164.js"></script>\n  <script src="sync-v165.js"></script>',
        "v165 sync script",
    )
    index_path.write_text(index, encoding="utf-8")

    build = build.replace("versionCode 1051400", "versionCode 1051500", 1)
    build = build.replace("versionName '1.5.14'", "versionName '1.5.15'", 1)
    build_path.write_text(build, encoding="utf-8")

if __name__ == "__main__":
    main()
