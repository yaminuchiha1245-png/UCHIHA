from __future__ import annotations

import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


class SiteRadiusDB:
    def __init__(self, path: str | Path, *, readonly: bool = False):
        self.path = str(path)
        self.readonly = bool(readonly)
        if self.readonly:
            return
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.migrate()
        try:
            os.chmod(self.path, 0o640)
        except OSError:
            pass

    @contextmanager
    def conn(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA busy_timeout=10000")
        try:
            yield db
            db.commit()
        finally:
            db.close()

    def migrate(self) -> None:
        with self.conn() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS accounts(
              username TEXT PRIMARY KEY,
              subscriber_id TEXT NOT NULL,
              credential TEXT NOT NULL,
              status TEXT NOT NULL,
              plan_id TEXT,
              plan_name TEXT NOT NULL DEFAULT '',
              download_mbps REAL NOT NULL DEFAULT 0,
              upload_mbps REAL NOT NULL DEFAULT 0,
              quota_gb REAL NOT NULL DEFAULT 0,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS meta(
              key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL
            );
            """)

    def sync(self, config: dict[str, Any]) -> dict[str, int]:
        accounts = config.get("accounts")
        router = config.get("router")
        if not isinstance(accounts, list) or not isinstance(router, dict):
            raise ValueError("invalid site RADIUS config")
        if len(accounts) > 100000:
            raise ValueError("too many accounts")
        ts = int(time.time())
        usernames: list[str] = []
        with self.conn() as db:
            for item in accounts:
                if not isinstance(item, dict):
                    continue
                username = str(item.get("username") or "").strip()
                credential = str(item.get("password") or "")
                subscriber_id = str(item.get("subscriberId") or "").strip()
                status = str(item.get("status") or "active").strip()
                if not username or not credential or not subscriber_id:
                    continue
                usernames.append(username)
                db.execute(
                    """INSERT INTO accounts(
                       username,subscriber_id,credential,status,plan_id,plan_name,
                       download_mbps,upload_mbps,quota_gb,updated_at
                       ) VALUES(?,?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(username) DO UPDATE SET
                       subscriber_id=excluded.subscriber_id,
                       credential=excluded.credential,status=excluded.status,
                       plan_id=excluded.plan_id,plan_name=excluded.plan_name,
                       download_mbps=excluded.download_mbps,
                       upload_mbps=excluded.upload_mbps,
                       quota_gb=excluded.quota_gb,updated_at=excluded.updated_at""",
                    (
                        username,subscriber_id,credential,status,
                        str(item.get("planId") or "") or None,
                        str(item.get("planName") or "")[:160],
                        max(0.0,float(item.get("downloadMbps") or 0)),
                        max(0.0,float(item.get("uploadMbps") or 0)),
                        max(0.0,float(item.get("quotaGb") or 0)),
                        ts,
                    ),
                )
            if usernames:
                placeholders=",".join("?" for _ in usernames)
                db.execute(f"DELETE FROM accounts WHERE username NOT IN ({placeholders})",tuple(usernames))
            else:
                db.execute("DELETE FROM accounts")
            for key,value in {
                "provider_id":config.get("providerId"),
                "router_id":router.get("id"),
                "router_code":router.get("code"),
                "router_name":router.get("name"),
                "router_management_ip":router.get("managementIp"),
                "last_sync":ts,
            }.items():
                db.execute(
                    """INSERT INTO meta(key,value,updated_at) VALUES(?,?,?)
                       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at""",
                    (str(key),str(value or ""),ts),
                )
        return {"accounts":len(usernames)}

    def account(self, username: str) -> dict[str, Any] | None:
        value=str(username or "").strip()
        if not value:
            return None
        uri=f"file:{Path(self.path).resolve()}?mode=ro"
        db=sqlite3.connect(uri,uri=True,timeout=3)
        db.row_factory=sqlite3.Row
        try:
            row=db.execute(
                """SELECT username,subscriber_id,credential,status,plan_id,plan_name,
                          download_mbps,upload_mbps,quota_gb
                   FROM accounts WHERE username=? AND status='active'""",
                (value,),
            ).fetchone()
            return dict(row) if row else None
        finally:
            db.close()
