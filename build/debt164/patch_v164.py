#!/usr/bin/env python3
"""Apply the isolated v1.5.14 SMM fix on top of the complete v1.5.13 app."""
from pathlib import Path
import shutil
import sys


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"marker not found: {label}")
    return text.replace(old, new, 1)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_v164.py <debt-app>")
    app = Path(sys.argv[1]).resolve()
    build_path = app / "app" / "build.gradle"
    if not build_path.is_file():
        raise SystemExit(f"not an Android source tree: {app}")

    build = build_path.read_text(encoding="utf-8")
    if "versionCode 1051300" not in build or "versionName '1.5.13'" not in build:
        raise SystemExit("unexpected v1.5.13 baseline; refusing to overlay")

    overlay = Path(__file__).resolve().parent / "overlay"
    for source in overlay.rglob("*"):
        if source.is_file():
            target = app / source.relative_to(overlay)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)

    index_path = app / "app" / "src" / "main" / "assets" / "index.html"
    index = index_path.read_text(encoding="utf-8")
    index = replace_once(index, 'href="app-v163.css"', 'href="app-v164.css"', "v164 css")
    index = replace_once(index, 'src="app-v163.js"', 'src="app-v164.js"', "v164 js")
    index_path.write_text(index, encoding="utf-8")

    build = build.replace("versionCode 1051300", "versionCode 1051400", 1)
    build = build.replace("versionName '1.5.13'", "versionName '1.5.14'", 1)
    build_path.write_text(build, encoding="utf-8")


if __name__ == "__main__":
    main()
