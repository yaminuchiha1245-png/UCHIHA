from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from cryptography.fernet import Fernet

from client_backup import create_backup, verify_snapshot


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


class ClientBackupTests(unittest.IsolatedAsyncioTestCase):
    async def _make_snapshot(self, root: Path) -> tuple[SimpleNamespace, Path, bytes]:
        db_path = root / "live.db"
        key_path = root / "client_store.key"
        backup_dir = root / "snapshots"
        key = Fernet.generate_key()
        key_path.write_bytes(key + b"\n")

        db = sqlite3.connect(str(db_path))
        try:
            db.execute("CREATE TABLE demo(id INTEGER PRIMARY KEY, value TEXT)")
            db.execute("INSERT INTO demo(value) VALUES('important-client-data')")
            db.commit()
        finally:
            db.close()

        store = SimpleNamespace(DB_PATH=str(db_path))
        env = {
            "CLIENT_STORE_MASTER_KEY_FILE": str(key_path),
            "CLIENT_BACKUP_DIR": str(backup_dir),
            "CLIENT_BACKUP_KEEP": "7",
        }
        with patch.dict(os.environ, env, clear=False):
            snapshot = await create_backup(store)
        return store, snapshot, key

    async def test_backup_contains_restorable_db_key_and_valid_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _, snapshot, key = await self._make_snapshot(Path(tmp))

            backup_db = snapshot / "client_store.db"
            backup_key = snapshot / "client_store.key"
            manifest_path = snapshot / "manifest.json"
            self.assertTrue(backup_db.is_file())
            self.assertTrue(backup_key.is_file())
            self.assertTrue(manifest_path.is_file())
            self.assertEqual(backup_key.read_bytes().strip(), key)

            restored = sqlite3.connect(str(backup_db))
            try:
                value = restored.execute("SELECT value FROM demo WHERE id=1").fetchone()[0]
                integrity = restored.execute("PRAGMA integrity_check").fetchone()[0]
            finally:
                restored.close()
            self.assertEqual(value, "important-client-data")
            self.assertEqual(integrity, "ok")

            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertTrue(manifest["key_included"])
            self.assertEqual(manifest["database"], "client_store.db")
            self.assertEqual(manifest["database_sha256"], _sha256(backup_db))
            ok, message = await verify_snapshot(snapshot)
            self.assertTrue(ok, message)

    async def test_verifier_rejects_modified_database(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _, snapshot, _ = await self._make_snapshot(Path(tmp))
            database = snapshot / "client_store.db"
            with database.open("ab") as handle:
                handle.write(b"tampered")
            ok, message = await verify_snapshot(snapshot)
            self.assertFalse(ok)
            self.assertIn("بصمة", message)

    async def test_verifier_rejects_missing_key_when_manifest_requires_it(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _, snapshot, _ = await self._make_snapshot(Path(tmp))
            (snapshot / "client_store.key").unlink()
            ok, message = await verify_snapshot(snapshot)
            self.assertFalse(ok)
            self.assertIn("مفتاح", message)

    async def test_retention_keeps_only_configured_snapshot_count(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db_path = root / "live.db"
            key_path = root / "client_store.key"
            backup_dir = root / "snapshots"
            key_path.write_bytes(Fernet.generate_key() + b"\n")

            db = sqlite3.connect(str(db_path))
            try:
                db.execute("CREATE TABLE demo(value TEXT)")
                db.execute("INSERT INTO demo(value) VALUES('v1')")
                db.commit()
            finally:
                db.close()

            store = SimpleNamespace(DB_PATH=str(db_path))
            env = {
                "CLIENT_STORE_MASTER_KEY_FILE": str(key_path),
                "CLIENT_BACKUP_DIR": str(backup_dir),
                "CLIENT_BACKUP_KEEP": "2",
            }
            with patch.dict(os.environ, env, clear=False):
                for index in range(4):
                    db = sqlite3.connect(str(db_path))
                    try:
                        db.execute("INSERT INTO demo(value) VALUES(?)", (f"v{index + 2}",))
                        db.commit()
                    finally:
                        db.close()
                    await create_backup(store)

            snapshots = [path for path in backup_dir.iterdir() if path.is_dir()]
            self.assertEqual(len(snapshots), 2)
            for snapshot in snapshots:
                self.assertTrue((snapshot / "manifest.json").is_file())
                self.assertTrue((snapshot / "client_store.db").is_file())


if __name__ == "__main__":
    unittest.main()
