#!/usr/bin/env python3
"""Safe local SQLite backup of bot admin state (NOT customer debt/cloud data).

Run as the service account; this file never reads or copies .env.
The SQLite online-backup API makes a consistent snapshot while bot is running.
"""
from __future__ import annotations

import os
import re
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "bot.sqlite3"
DESTINATION = HERE / "backups"
FILENAME = re.compile(r"^bot-state-\d{8}T\d{6}Z-[a-f0-9]{8}\.sqlite3$")


def list_backups(directory: Path = DESTINATION) -> list[Path]:
    if not directory.is_dir():
        return []
    return sorted(
        (p for p in directory.iterdir()
         if p.is_file() and not p.is_symlink() and FILENAME.fullmatch(p.name)),
        key=lambda p: (p.stat().st_mtime, p.name),
        reverse=True,
    )


def create_backup(source: Path = SOURCE, directory: Path = DESTINATION,
                  keep: int = 14, now: datetime | None = None) -> Path:
    if not source.is_file() or source.is_symlink():
        raise FileNotFoundError("Bot SQLite state is unavailable")
    if not (1 <= keep <= 90):
        raise ValueError("Invalid backup retention")
    # Reject symlinks BEFORE mkdir/chmod so a malicious destination never has
    # its permissions modified as a side effect of a rejected backup.
    if directory.is_symlink():
        raise ValueError("Backups directory cannot be a symlink")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not directory.is_dir() or directory.is_symlink():
        raise ValueError("Invalid backups directory")
    directory.chmod(0o700)
    instant = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    target = directory / (
        "bot-state-" + instant.strftime("%Y%m%dT%H%M%SZ")
        + "-" + secrets.token_hex(4) + ".sqlite3"
    )
    staged = directory / (".backup-" + secrets.token_hex(12) + ".tmp")
    source_connection = None
    backup_connection = None
    try:
        # Read-only source connection works with WAL and active bot writers.
        source_connection = sqlite3.connect(
            "file:" + str(source.resolve()) + "?mode=ro",
            uri=True, timeout=25
        )
        backup_connection = sqlite3.connect(str(staged), timeout=25)
        source_connection.backup(backup_connection, pages=128, sleep=0.1)
        # A source database in WAL mode can leave the copied file in WAL
        # mode too. Switch the *standalone backup* to DELETE before publishing
        # so a portable .sqlite3 does not depend on -wal/-shm sidecars.
        mode=backup_connection.execute("pragma journal_mode=DELETE").fetchone()[0]
        if mode.lower() != "delete":
            raise RuntimeError("Could not finalize SQLite backup journal")
        if backup_connection.execute("pragma integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite backup integrity check failed")
        expected = {"state", "flow", "operations"}
        tables = {row[0] for row in backup_connection.execute(
            "select name from sqlite_master where type='table'"
        )}
        if not expected <= tables:
            raise RuntimeError("Bot backup does not contain essential tables")
        backup_connection.close()
        backup_connection = None
        source_connection.close()
        source_connection = None
        os.chmod(staged, 0o600)
        with staged.open("rb") as f:
            os.fsync(f.fileno())
        os.replace(staged, target)
        # Do not prune if backup creation failed.
        for stale in list_backups(directory)[keep:]:
            stale.unlink()
        return target
    finally:
        if backup_connection is not None:
            backup_connection.close()
        if source_connection is not None:
            source_connection.close()
        if staged.exists():
            staged.unlink()


def main() -> None:
    os.umask(0o077)
    new = create_backup()
    print("UCHIHA bot SQLite state backup verified:", new.name)


if __name__ == "__main__":
    main()
