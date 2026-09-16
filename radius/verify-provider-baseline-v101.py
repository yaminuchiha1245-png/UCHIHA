#!/usr/bin/env python3
"""Verify the frozen UCHIHA RADIUS v101 / Backend v37 baseline.

This check is intentionally limited to release identity and Android packaging
inputs. It does not claim that provider activation or MikroTik provisioning
has passed a real-environment acceptance test.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
KIT_MANIFEST = ROOT / "UCHIHA-RADIUS-v101-Backend-v37-PRODUCTION-KIT-v2-MANIFEST.json"
INTEGRITY_MANIFEST = ROOT / "UCHIHA-RADIUS-v101-Backend-v37-INTEGRITY.json"
ANDROID_ASSET = ROOT / "android-app/app/src/main/assets/RADIUS-A-Master-v101.html"
ANDROID_RUNTIME_FILES = (
    ROOT / "android-app/app/build.gradle.kts",
    ROOT / "android-app/app/src/main/AndroidManifest.xml",
    ROOT / "android-app/app/src/main/java/com/uchiha/radius/MainActivity.java",
    ROOT / "android-app/app/src/main/java/com/uchiha/radius/NativeBridge.java",
    ROOT / "android-app/app/src/main/res/xml/network_security_config.xml",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"BASELINE_VERIFY_FAILED: {message}")


def load_json(path: Path) -> dict:
    require(path.is_file(), f"missing {path.name}")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def main() -> None:
    kit = load_json(KIT_MANIFEST)
    integrity = load_json(INTEGRITY_MANIFEST)

    require(kit.get("uiBuild") == "v101", "kit UI is not v101")
    require(kit.get("backendBuild") == "v37", "kit backend is not v37")
    require(kit.get("databaseSchemaVersion") == 30, "kit schema is not 30")
    require(integrity.get("uiBuild") == "v101", "integrity UI is not v101")
    require(integrity.get("backendBuild") == "v37", "integrity backend is not v37")
    require(integrity.get("databaseSchemaVersion") == 30, "integrity schema is not 30")

    verified = []
    for entry in kit.get("files", []):
        path = ROOT / entry["name"]
        require(path.is_file(), f"missing kit file {entry['name']}")
        require(path.stat().st_size == entry["bytes"], f"size mismatch for {entry['name']}")
        require(sha256(path) == entry["sha256"], f"SHA-256 mismatch for {entry['name']}")
        verified.append(entry["name"])

    for entry in integrity.get("protectedFiles", []):
        path = ROOT / entry["name"]
        require(path.is_file(), f"missing protected file {entry['name']}")
        require(path.stat().st_size == entry["bytes"], f"protected size mismatch for {entry['name']}")
        require(sha256(path) == entry["sha256"], f"protected SHA-256 mismatch for {entry['name']}")

    root_ui = ROOT / "RADIUS-A-Master-v101.html"
    require(ANDROID_ASSET.is_file(), "bundled Android v101 asset is missing")
    require(sha256(ANDROID_ASSET) == sha256(root_ui), "Android asset is not the exact frozen v101 UI")

    runtime_text = "\n".join(path.read_text(encoding="utf-8") for path in ANDROID_RUNTIME_FILES)
    require("chatgpt.site" not in runtime_text.lower(), "chatgpt.site exists in Android runtime")
    require("https://radius.uchiha-builder.com/" in runtime_text, "production URL is missing from Android runtime")
    require('"radius.uchiha-builder.com"' in runtime_text, "production WebView allowlist is missing")

    print(json.dumps({
        "ok": True,
        "ui": "v101",
        "backend": "v37",
        "schema": 30,
        "kitFilesVerified": len(verified),
        "uiSha256": sha256(root_ui),
        "backendSha256": sha256(ROOT / "RADIUS-A-Connector-Backend-v37.py"),
        "androidAssetMatchesFrozenUi": True,
        "productionHost": "radius.uchiha-builder.com",
        "realEnvironmentAcceptance": False,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
