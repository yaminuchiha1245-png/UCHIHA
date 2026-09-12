#!/usr/bin/env python3
"""Overlay the v1.4.5 activation/owner service onto reconstructed v1.4.4."""
from pathlib import Path
import shutil
import sys


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_v145.py <debt-app>")
    app = Path(sys.argv[1]).resolve()
    if not (app / "app" / "build.gradle").is_file():
        raise SystemExit(f"not an Android source tree: {app}")
    overlay = Path(__file__).resolve().parent / "overlay"
    build_path = app / "app" / "build.gradle"
    build = build_path.read_text(encoding="utf-8")
    if "versionCode 1040400" not in build or "versionName '1.4.4'" not in build:
        raise SystemExit("unexpected baseline version; refusing to overlay")
    for source in overlay.rglob("*"):
        if not source.is_file():
            continue
        relative = source.relative_to(overlay)
        target = app / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    build = build.replace("versionCode 1040400", "versionCode 1040500", 1)
    build = build.replace("versionName '1.4.4'", "versionName '1.4.5'", 1)
    build_path.write_text(build, encoding="utf-8")


if __name__ == "__main__":
    main()
