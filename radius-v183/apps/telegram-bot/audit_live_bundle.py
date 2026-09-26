"""Read-only production drift audit against an independently verified bot bundle.

Run:
  python3 stage_bundle.py --output /tmp/uchiha-bot-review-unique
  python3 audit_live_bundle.py --bundle /tmp/uchiha-bot-review-unique

The auditor never reads secrets, runs the bot, calls Telegram, installs files,
or restarts services. A nonzero exit means live files differ from the bundle.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from stage_bundle import PRODUCTION, RUNTIME_FILES, digest, verify_bundle


def audit_bundle(bundle: Path, live: Path) -> dict:
    """Check only the five allowlisted deployment files; ignore credentials."""
    manifest = verify_bundle(bundle)
    if live.is_symlink():
        return {"status": "unsafe", "files": {}, "reason": "Live root is a symlink"}
    if not live.is_dir():
        return {"status": "missing", "files": {}, "reason": "Live directory missing"}
    expected = manifest["sha256"]
    files = {}
    for name in RUNTIME_FILES:
        path = live / name
        if path.is_symlink():
            status = "unsafe_symlink"
        elif not path.is_file():
            status = "missing"
        else:
            try:
                status = "match" if digest(path) == expected[name] else "drift"
            except OSError:
                status = "unreadable"
        files[name] = status
    return {
        "status": "match" if all(s == "match" for s in files.values()) else "drift",
        "files": files,
        "matched": sum(s == "match" for s in files.values()),
        "expected": len(RUNTIME_FILES),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only V1-83 production bot drift audit")
    parser.add_argument("--bundle", type=Path, required=True,
                        help="An independently verified staging bundle")
    parser.add_argument("--live", type=Path, default=PRODUCTION,
                        help="Live directory (read-only, never changed)")
    args = parser.parse_args(argv)
    try:
        result = audit_bundle(args.bundle, args.live)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        # Never print arbitrary Python file contents or credentials.
        print(json.dumps({"status": "invalid_bundle",
                          "error_type": type(error).__name__}))
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["status"] == "match" else 1


if __name__ == "__main__":
    raise SystemExit(main())
