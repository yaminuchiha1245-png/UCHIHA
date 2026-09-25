"""Create a complete V1-83 Telegram bot staging bundle without touching production.

Run: python3 stage_bundle.py --output /tmp/uchiha-telegram-v183-stage
Then: python3 stage_bundle.py --verify /tmp/uchiha-telegram-v183-stage
No token, env file or production service is read or modified.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

RUNTIME_FILES = (
    "v183_bot.py",
    "v183_screens.py",
    "v183_member_routers.py",
    "v183_member_workflows.py",
    "assets/profile-default.png",
)
MANIFEST = "bundle-manifest.json"
PRODUCTION = Path("/opt/uchiha-radius/telegram-v183")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def refuse_production(path: Path) -> None:
    resolved = path.resolve()
    if resolved == PRODUCTION or PRODUCTION in resolved.parents:
        raise ValueError("Refusing to stage or inspect inside the live bot directory")


def validate_files(directory: Path, hashes: dict) -> None:
    if set(hashes) != set(RUNTIME_FILES):
        raise ValueError("Incomplete or unexpected bot file list")
    for name in RUNTIME_FILES:
        file = directory / name
        if not file.is_file() or file.is_symlink() or digest(file) != hashes[name]:
            raise ValueError(f"Missing, unsafe or mismatched bundle file: {name}")
    avatar = (directory / "assets/profile-default.png").read_bytes()
    if avatar[:8] != bytes.fromhex("89504e470d0a1a0a"):
        raise ValueError("Bundled avatar is not a valid PNG header")


def smoke_import(directory: Path) -> None:
    # -I excludes user site packages; -B prevents writing to the bundle.
    # Do not run main(), poll Telegram, or load environment credentials.
    script = ("import sys; sys.path.insert(0, sys.argv[1]); "
              "import v183_screens, v183_member_workflows, v183_member_routers; "
              "assert hasattr(v183_screens, 'V183ScreenBot')")
    result = subprocess.run(
        [sys.executable, "-I", "-B", "-c", script, str(directory)],
        text=True, capture_output=True, timeout=10, check=False,
    )
    if result.returncode:
        raise ValueError("Bundle module import failed: " + result.stderr[-1500:])


def verify_bundle(bundle: Path) -> dict:
    refuse_production(bundle)
    manifest_file = bundle / MANIFEST
    if not manifest_file.is_file() or manifest_file.is_symlink():
        raise ValueError("Missing bundle manifest")
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    if manifest.get("version") != "v183" or not isinstance(manifest.get("sha256"), dict):
        raise ValueError("Unknown or malformed bundle manifest")
    validate_files(bundle, manifest["sha256"])
    smoke_import(bundle)
    return manifest


def stage_bundle(source: Path, output: Path) -> dict:
    source = source.resolve()
    refuse_production(output)
    output = output.absolute()
    if output.exists() or output.is_symlink():
        raise FileExistsError("Staging destination must not already exist")
    if not output.parent.is_dir():
        raise FileNotFoundError("Create the staging parent directory first")
    staging = Path(tempfile.mkdtemp(prefix=f".{output.name}.", dir=output.parent))
    try:
        hashes = {}
        for name in RUNTIME_FILES:
            original = source / name
            if not original.is_file() or original.is_symlink():
                raise ValueError(f"Required runtime file absent: {name}")
            target = staging / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, target, follow_symlinks=False)
            hashes[name] = digest(target)
        validate_files(staging, hashes)
        smoke_import(staging)
        manifest = {"version": "v183", "entrypoint": "v183_screens.py",
                    "sha256": hashes, "containsSecrets": False}
        (staging / MANIFEST).write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        if output.exists() or output.is_symlink():
            raise FileExistsError("Staging destination appeared during build")
        os.rename(staging, output)
        return verify_bundle(output)
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="V1-83 bot staging / verification only")
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--output", type=Path, help="New, empty staging directory")
    action.add_argument("--verify", type=Path, help="Verify an existing staging bundle")
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args(argv)
    try:
        result = (stage_bundle(args.source, args.output) if args.output
                  else verify_bundle(args.verify))
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print(f"Staging failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"status": "verified", "entrypoint": result["entrypoint"],
                      "files": len(result["sha256"])}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
