from __future__ import annotations

import hashlib
import ipaddress
import json
import secrets
import sqlite3
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator


def now() -> int:
    return int(time.time())


def rid(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(8).upper()}"


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


@dataclass(frozen=True)
class Access:
    provider_id: str
    telegram_user_id: int
    role: str
    display_name: str


@dataclass(frozen=True)
class AgentAccess:
    provider_id: str
    router_id: str


class ProviderStore:
    def __init__(self, path: str | Path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.migrate()

    @contextmanager
    def conn(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA busy_timeout=15000")
        try:
            yield db
            db.commit()
        finally:
            db.close()

    def migrate(self) -> None:
        with self.conn() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS providers(
              id TEXT PRIMARY KEY,name TEXT NOT NULL,code TEXT NOT NULL UNIQUE,
              status TEXT NOT NULL DEFAULT 'active',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS telegram_identities(
              telegram_user_id INTEGER PRIMARY KEY,provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
              role TEXT NOT NULL CHECK(role IN ('owner','admin','operator','viewer')),
              display_name TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS api_sessions(
              token_hash TEXT PRIMARY KEY,provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
              telegram_user_id INTEGER NOT NULL,role TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS plans(
              id TEXT PRIMARY KEY,provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
              name TEXT NOT NULL,download_mbps REAL NOT NULL,upload_mbps REAL NOT NULL,quota_gb REAL NOT NULL DEFAULT 0,
              duration_days INTEGER NOT NULL DEFAULT 30,price REAL NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'active',
              created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(provider_id,name)
            );
            CREATE TABLE IF NOT EXISTS subscribers(
              id TEXT PRIMARY KEY,provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
              full_name TEXT NOT NULL,username TEXT NOT NULL,plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
              plan_label TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'active',
              created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(provider_id,username)
            );
            CREATE TABLE IF NOT EXISTS subscriber_credentials(
              subscriber_id TEXT PRIMARY KEY REFERENCES subscribers(id) ON DELETE CASCADE,
              provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
              password_ciphertext TEXT NOT NULL,updated_at INTEGER NOT NULL,
              UNIQUE(provider_id,subscriber_id)
            );
            CREATE INDEX IF NOT EXISTS idx_subscriber_credentials_provider
              ON subscriber_credentials(provider_id,updated_at DESC);
            CREATE TABLE IF NOT EXISTS routers(
              id TEXT PRIMARY KEY,provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
              code TEXT NOT NULL,name TEXT NOT NULL,management_ip TEXT NOT NULL,node_type TEXT NOT NULL DEFAULT 'MikroTik',
              region TEXT NOT NULL DEFAULT 'A',status TEXT NOT NULL DEFAULT 'provisioning',last_seen_at INTEGER,
              created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(provider_id,code),UNIQUE(provider_id,management_ip)
            );
            CREATE TABLE IF NOT EXISTS radius_sessions(
              id TEXT PRIMARY KEY,provider_id TEXT NOT NULL,username TEXT NOT NULL,router_id TEXT,
              framed_ip TEXT,access_kind TEXT NOT NULL DEFAULT 'PPPoE',started_at INTEGER NOT NULL,stopped_at INTEGER,
              input_octets INTEGER NOT NULL DEFAULT 0,output_octets INTEGER NOT NULL DEFAULT 0,
              status TEXT NOT NULL DEFAULT 'online',updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS invoices(
              id TEXT PRIMARY KEY,provider_id TEXT NOT NULL,account TEXT NOT NULL,amount REAL NOT NULL DEFAULT 0,
              due_at INTEGER,status TEXT NOT NULL DEFAULT 'open',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit_events(
              id INTEGER PRIMARY KEY AUTOINCREMENT,provider_id TEXT NOT NULL,telegram_user_id INTEGER,
              action TEXT NOT NULL,entity_type TEXT,entity_id TEXT,detail_json TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS connector_commands(
              command_id TEXT PRIMARY KEY,provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
              operation TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_connector_commands_provider
              ON connector_commands(provider_id,created_at DESC);
            CREATE TABLE IF NOT EXISTS site_agents(
              router_id TEXT PRIMARY KEY REFERENCES routers(id) ON DELETE CASCADE,
              provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
              token_hash TEXT NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT 'registered',
              last_seen_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS site_agent_commands(
              id TEXT PRIMARY KEY,provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
              router_id TEXT NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
              operation TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',
              result_json TEXT,created_at INTEGER NOT NULL,claimed_at INTEGER,completed_at INTEGER,updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_site_agent_commands_poll
              ON site_agent_commands(router_id,status,created_at);
            """)

    def _audit(self, db: sqlite3.Connection, access: Access | None, provider_id: str, action: str, kind: str = "", entity_id: str = "", detail: dict[str, Any] | None = None) -> None:
        db.execute("INSERT INTO audit_events(provider_id,telegram_user_id,action,entity_type,entity_id,detail_json,created_at) VALUES(?,?,?,?,?,?,?)",
                   (provider_id, access.telegram_user_id if access else None, action, kind, entity_id,
                    json.dumps(detail or {}, ensure_ascii=False, separators=(",", ":")), now()))

    def bootstrap_owner(self, telegram_user_id: int, *, provider_name: str, provider_code: str, display_name: str = "Owner") -> str:
        if telegram_user_id <= 0:
            raise ValueError("owner Telegram id must be positive")
        ts = now()
        with self.conn() as db:
            found = db.execute("SELECT provider_id FROM telegram_identities WHERE telegram_user_id=?", (telegram_user_id,)).fetchone()
            if found:
                return str(found["provider_id"])
            p = db.execute("SELECT id FROM providers WHERE code=?", (provider_code,)).fetchone()
            provider_id = str(p["id"]) if p else rid("ISP")
            if not p:
                db.execute("INSERT INTO providers VALUES(?,?,?,?,?,?)", (provider_id, provider_name, provider_code, "active", ts, ts))
            db.execute("INSERT INTO telegram_identities VALUES(?,?,?,?,1,?)", (telegram_user_id, provider_id, "owner", display_name, ts))
            self._audit(db, None, provider_id, "bootstrap-owner", "provider", provider_id)
            return provider_id

    def resolve_telegram(self, telegram_user_id: int, *, display_name: str = "") -> Access | None:
        with self.conn() as db:
            row = db.execute("""SELECT t.provider_id,t.telegram_user_id,t.role,t.display_name,t.enabled
                                FROM telegram_identities t JOIN providers p ON p.id=t.provider_id
                                WHERE t.telegram_user_id=? AND p.status='active'""", (telegram_user_id,)).fetchone()
            if not row or not row["enabled"]:
                return None
            if display_name and display_name != row["display_name"]:
                db.execute("UPDATE telegram_identities SET display_name=?,updated_at=? WHERE telegram_user_id=?", (display_name, now(), telegram_user_id))
            return Access(str(row["provider_id"]), int(row["telegram_user_id"]), str(row["role"]), display_name or str(row["display_name"]))

    @staticmethod
    def csrf_for_session(raw: str) -> str:
        return hashlib.sha256(("csrf:" + raw).encode("utf-8")).hexdigest() if raw else ""

    def issue_session(self, access: Access, ttl_seconds: int = 28800) -> str:
        raw = secrets.token_urlsafe(32); ts = now()
        with self.conn() as db:
            db.execute("DELETE FROM api_sessions WHERE expires_at<?", (ts,))
            db.execute("INSERT INTO api_sessions VALUES(?,?,?,?,?,?)", (digest(raw), access.provider_id, access.telegram_user_id, access.role, ts, ts + ttl_seconds))
        return raw

    def resolve_session(self, raw: str) -> Access | None:
        if not raw:
            return None
        with self.conn() as db:
            row = db.execute("""SELECT s.provider_id,s.telegram_user_id,s.role,t.display_name
                                FROM api_sessions s JOIN telegram_identities t ON t.telegram_user_id=s.telegram_user_id
                                JOIN providers p ON p.id=s.provider_id
                                WHERE s.token_hash=? AND s.expires_at>? AND t.enabled=1 AND p.status='active'""", (digest(raw), now())).fetchone()
            return Access(str(row["provider_id"]), int(row["telegram_user_id"]), str(row["role"]), str(row["display_name"])) if row else None

    def revoke_session(self, raw: str) -> None:
        if raw:
            with self.conn() as db:
                db.execute("DELETE FROM api_sessions WHERE token_hash=?", (digest(raw),))

    def _write(self, access: Access) -> None:
        if access.role not in ("owner", "admin", "operator"):
            raise PermissionError("read only")

    def provider(self, access: Access) -> dict[str, Any]:
        with self.conn() as db:
            row = db.execute("SELECT id,name,code,status FROM providers WHERE id=?", (access.provider_id,)).fetchone()
            if not row:
                raise KeyError("provider")
            return dict(row)

    def dashboard(self, access: Access) -> dict[str, Any]:
        pid = access.provider_id
        with self.conn() as db:
            q = lambda sql: db.execute(sql, (pid,)).fetchone()[0]
            subscribers = q("SELECT count(*) FROM subscribers WHERE provider_id=?")
            nodes = q("SELECT count(*) FROM routers WHERE provider_id=?")
            online = q("SELECT count(*) FROM routers WHERE provider_id=? AND status='online'")
            active = q("SELECT count(*) FROM radius_sessions WHERE provider_id=? AND status='online'")
            invoices = q("SELECT count(*) FROM invoices WHERE provider_id=? AND status IN ('open','overdue')")
            audits = q("SELECT count(*) FROM audit_events WHERE provider_id=?")
        state = "connected" if nodes and online == nodes else ("partial" if online else "stale")
        return {"totals":{"providers":1,"subscribers":subscribers,"nodes":nodes,"openInvoices":invoices,"incidents":0,"auditEvents":audits},
                "gateway":{"state":state,"snapshot":{"activeSessions":active,"onlineNodes":online,"totalNodes":nodes}},
                "permissions":{"canWrite":access.role in ("owner","admin","operator")}}

    def catalog(self, access: Access) -> dict[str, Any]:
        pid = access.provider_id
        with self.conn() as db:
            provider = db.execute("SELECT id,name,code,status,created_at FROM providers WHERE id=?", (pid,)).fetchone()
            subscribers = [dict(r) for r in db.execute("""SELECT s.id,s.full_name AS fullName,s.username,COALESCE(p.name,s.plan_label,'Unassigned') AS plan,
                s.status,s.created_at AS createdAt,s.updated_at AS updatedAt FROM subscribers s LEFT JOIN plans p ON p.id=s.plan_id
                WHERE s.provider_id=? ORDER BY s.created_at DESC""", (pid,))]
            routers = [dict(r) for r in db.execute("""SELECT id,code,node_type AS nodeType,management_ip AS managementAddress,region,status,
                created_at AS createdAt,updated_at AS updatedAt FROM routers WHERE provider_id=? ORDER BY created_at DESC""", (pid,))]
            invoices = [dict(r) for r in db.execute("""SELECT id,account,amount,due_at AS dueDate,status,created_at AS createdAt,updated_at AS updatedAt
                FROM invoices WHERE provider_id=? ORDER BY created_at DESC""", (pid,))]
            plans = [dict(r) for r in db.execute("""SELECT id,name,download_mbps,upload_mbps,quota_gb,duration_days,price,status,
                created_at AS createdAt,updated_at AS updatedAt FROM plans WHERE provider_id=? ORDER BY created_at DESC""", (pid,))]
        return {"providers":[dict(provider)] if provider else [],"subscribers":subscribers,"plans":plans,"incidents":[],"invoices":invoices,
                "voucherBatches":[],"backupRuns":[],"networkNodes":routers,
                "pageInfo":{"provider":None,"subscriber":None,"incident":None,"invoice":None,"voucher":None,"backup":None,"node":None}}

    def list_plans(self, access: Access) -> list[dict[str, Any]]:
        with self.conn() as db:
            return [dict(r) for r in db.execute("SELECT * FROM plans WHERE provider_id=? ORDER BY created_at DESC", (access.provider_id,))]

    def plan_owned(self, access: Access, plan_value: str) -> bool:
        value = str(plan_value or "").strip()
        if not value:
            return False
        with self.conn() as db:
            row = db.execute(
                "SELECT 1 FROM plans WHERE provider_id=? AND (id=? OR name=?) LIMIT 1",
                (access.provider_id, value, value),
            ).fetchone()
            return bool(row)

    def create_plan(self, access: Access, data: dict[str, Any]) -> dict[str, Any]:
        self._write(access)
        name = str(data.get("name") or "").strip()
        down, up = float(data.get("download_mbps") or 0), float(data.get("upload_mbps") or 0)
        quota, days, price = float(data.get("quota_gb") or 0), int(data.get("duration_days") or 30), float(data.get("price") or 0)
        if len(name) < 2 or min(down, up) <= 0 or quota < 0 or days <= 0 or price < 0:
            raise ValueError("invalid plan")
        item_id, ts = rid("PLAN"), now()
        with self.conn() as db:
            db.execute("INSERT INTO plans VALUES(?,?,?,?,?,?,?,?,?,?,?)", (item_id,access.provider_id,name,down,up,quota,days,price,"active",ts,ts))
            self._audit(db, access, access.provider_id, "plan-create", "plan", item_id, {"name":name})
            return dict(db.execute("SELECT * FROM plans WHERE id=? AND provider_id=?", (item_id,access.provider_id)).fetchone())

    def list_subscribers(self, access: Access) -> list[dict[str, Any]]:
        with self.conn() as db:
            return [dict(r) for r in db.execute("""SELECT s.*,COALESCE(p.name,s.plan_label,'') AS plan FROM subscribers s
                LEFT JOIN plans p ON p.id=s.plan_id WHERE s.provider_id=? ORDER BY s.created_at DESC""", (access.provider_id,))]

    def get_subscriber(self, access: Access, subscriber_id: str) -> dict[str, Any] | None:
        with self.conn() as db:
            row = db.execute(
                """SELECT s.*,COALESCE(p.name,s.plan_label,'') AS plan
                   FROM subscribers s LEFT JOIN plans p ON p.id=s.plan_id
                   WHERE s.id=? AND s.provider_id=?""",
                (str(subscriber_id or ""),access.provider_id),
            ).fetchone()
            return dict(row) if row else None

    def set_subscriber_credential(self, access: Access, subscriber_id: str, ciphertext: str) -> None:
        self._write(access)
        value = str(ciphertext or "").strip()
        if not value:
            raise ValueError("credential ciphertext required")
        ts = now()
        with self.conn() as db:
            subscriber = db.execute(
                "SELECT id FROM subscribers WHERE id=? AND provider_id=?",
                (str(subscriber_id or ""),access.provider_id),
            ).fetchone()
            if not subscriber:
                raise KeyError("subscriber")
            db.execute(
                """INSERT INTO subscriber_credentials(subscriber_id,provider_id,password_ciphertext,updated_at)
                   VALUES(?,?,?,?)
                   ON CONFLICT(subscriber_id) DO UPDATE SET
                     password_ciphertext=excluded.password_ciphertext,
                     provider_id=excluded.provider_id,
                     updated_at=excluded.updated_at""",
                (str(subscriber_id),access.provider_id,value,ts),
            )
            self._audit(
                db,access,access.provider_id,"subscriber-radius-password-set","subscriber",
                str(subscriber_id),{"rotated":True},
            )

    def subscriber_credential_ciphertext(self, access: Access, subscriber_id: str) -> str | None:
        with self.conn() as db:
            row = db.execute(
                "SELECT password_ciphertext FROM subscriber_credentials WHERE subscriber_id=? AND provider_id=?",
                (str(subscriber_id or ""),access.provider_id),
            ).fetchone()
            return str(row["password_ciphertext"]) if row else None

    def site_agent_accounts(self, agent: AgentAccess) -> list[dict[str, Any]]:
        with self.conn() as db:
            rows = db.execute(
                """SELECT s.id AS subscriber_id,s.username,s.status,s.plan_id,
                          COALESCE(p.name,s.plan_label,'') AS plan_name,
                          COALESCE(p.download_mbps,0) AS download_mbps,
                          COALESCE(p.upload_mbps,0) AS upload_mbps,
                          COALESCE(p.quota_gb,0) AS quota_gb,
                          c.password_ciphertext
                   FROM subscribers s
                   JOIN subscriber_credentials c
                     ON c.subscriber_id=s.id AND c.provider_id=s.provider_id
                   LEFT JOIN plans p ON p.id=s.plan_id AND p.provider_id=s.provider_id
                   WHERE s.provider_id=? AND s.status='active'
                   ORDER BY s.username""",
                (agent.provider_id,),
            ).fetchall()
            return [dict(row) for row in rows]

    def site_agent_router(self, agent: AgentAccess) -> dict[str, Any] | None:
        with self.conn() as db:
            row = db.execute(
                """SELECT id,provider_id,code,name,management_ip,node_type,region,status,last_seen_at
                   FROM routers WHERE id=? AND provider_id=?""",
                (agent.router_id,agent.provider_id),
            ).fetchone()
            return dict(row) if row else None

    def create_subscriber(self, access: Access, data: dict[str, Any]) -> dict[str, Any]:
        self._write(access)
        full_name = str(data.get("full_name") or data.get("fullName") or "").strip()
        username = str(data.get("username") or "").strip()
        plan_value = str(data.get("plan_id") or data.get("plan") or "").strip()
        if len(full_name) < 2 or len(username) < 3 or any(c.isspace() for c in username):
            raise ValueError("invalid subscriber")
        item_id, ts, plan_id, label = rid("SUB"), now(), None, plan_value or "Unassigned"
        with self.conn() as db:
            if plan_value:
                p = db.execute("SELECT id,name FROM plans WHERE provider_id=? AND (id=? OR name=?)", (access.provider_id,plan_value,plan_value)).fetchone()
                if p: plan_id, label = p["id"], p["name"]
            db.execute("INSERT INTO subscribers VALUES(?,?,?,?,?,?,?,?,?)", (item_id,access.provider_id,full_name,username,plan_id,label,"active",ts,ts))
            self._audit(db, access, access.provider_id, "subscriber-create", "subscriber", item_id, {"username":username})
            return dict(db.execute("SELECT * FROM subscribers WHERE id=? AND provider_id=?", (item_id,access.provider_id)).fetchone())

    def create_router(self, access: Access, data: dict[str, Any]) -> dict[str, Any]:
        self._write(access)
        code = str(data.get("code") or "").strip() or rid("MTK")
        name = str(data.get("name") or code).strip()
        ip = str(data.get("management_ip") or data.get("managementAddress") or "").strip()
        address = ipaddress.ip_address(ip)
        if address.version != 4 or not address.is_private:
            raise ValueError("router address must be private IPv4")
        item_id, ts, region = rid("NODE"), now(), str(data.get("region") or "A").strip()[:32]
        with self.conn() as db:
            db.execute("INSERT INTO routers VALUES(?,?,?,?,?,?,?,?,?,?,?)", (item_id,access.provider_id,code,name,ip,"MikroTik",region,"provisioning",None,ts,ts))
            self._audit(db, access, access.provider_id, "router-register", "router", item_id, {"code":code,"management_ip":ip})
            return dict(db.execute("SELECT * FROM routers WHERE id=? AND provider_id=?", (item_id,access.provider_id)).fetchone())

    def list_routers(self, access: Access) -> list[dict[str, Any]]:
        with self.conn() as db:
            return [dict(r) for r in db.execute("SELECT * FROM routers WHERE provider_id=? ORDER BY created_at DESC", (access.provider_id,))]

    def get_router(self, access: Access, router_id: str) -> dict[str, Any] | None:
        with self.conn() as db:
            row = db.execute("SELECT * FROM routers WHERE id=? AND provider_id=?", (router_id,access.provider_id)).fetchone()
            return dict(row) if row else None

    def mark_router_probe(self, access: Access, router_id: str, *, reachable: bool, detail: dict[str, Any]) -> dict[str, Any]:
        self._write(access); ts = now()
        with self.conn() as db:
            cur = db.execute("UPDATE routers SET status=?,last_seen_at=?,updated_at=? WHERE id=? AND provider_id=?",
                             ("online" if reachable else "offline",ts if reachable else None,ts,router_id,access.provider_id))
            if cur.rowcount != 1: raise KeyError("router")
            self._audit(db, access, access.provider_id, "router-probe", "router", router_id, {"reachable":reachable,"ports":detail.get("ports",{})})
            return dict(db.execute("SELECT * FROM routers WHERE id=? AND provider_id=?", (router_id,access.provider_id)).fetchone())


    def command_target_allowed(self, access: Access, payload: dict[str, Any]) -> bool:
        if access.role not in ("owner", "admin", "operator"):
            return False
        session = payload.get("session") if isinstance(payload.get("session"), dict) else {}
        session_id = str(session.get("id") or "").strip()
        username = str(session.get("user") or session.get("username") or "").strip()
        nas = str(session.get("nas") or "").strip()
        with self.conn() as db:
            if session_id:
                row = db.execute(
                    "SELECT 1 FROM radius_sessions WHERE id=? AND provider_id=? LIMIT 1",
                    (session_id, access.provider_id),
                ).fetchone()
                if row:
                    return True
            if not username:
                return False
            subscriber = db.execute(
                "SELECT 1 FROM subscribers WHERE provider_id=? AND username=? LIMIT 1",
                (access.provider_id, username),
            ).fetchone()
            if not subscriber:
                return False
            if not nas:
                return False
            router = db.execute(
                "SELECT 1 FROM routers WHERE provider_id=? AND (code=? OR name=?) LIMIT 1",
                (access.provider_id, nas, nas),
            ).fetchone()
            return bool(router)

    def node_target_allowed(self, access: Access, code: str) -> bool:
        code = str(code or "").strip()
        if not code or access.role not in ("owner", "admin", "operator"):
            return False
        with self.conn() as db:
            row = db.execute(
                "SELECT 1 FROM routers WHERE provider_id=? AND (code=? OR name=?) LIMIT 1",
                (access.provider_id, code, code),
            ).fetchone()
            return bool(row)

    def list_sessions(self, access: Access) -> list[dict[str, Any]]:
        with self.conn() as db:
            return [dict(r) for r in db.execute("""
                SELECT s.id,s.username,s.router_id,s.framed_ip,s.access_kind,s.started_at,s.stopped_at,
                       s.input_octets,s.output_octets,s.status,s.updated_at,
                       COALESCE(r.code,'') AS nas,COALESCE(r.name,'') AS router_name,
                       COALESCE(p.name,'') AS provider_name
                FROM radius_sessions s
                LEFT JOIN routers r ON r.id=s.router_id AND r.provider_id=s.provider_id
                LEFT JOIN providers p ON p.id=s.provider_id
                WHERE s.provider_id=?
                ORDER BY s.started_at DESC LIMIT 500
            """, (access.provider_id,))]

    def list_invoices(self, access: Access) -> list[dict[str, Any]]:
        with self.conn() as db:
            return [dict(r) for r in db.execute("SELECT * FROM invoices WHERE provider_id=? ORDER BY created_at DESC LIMIT 500", (access.provider_id,))]

    def remember_command(self, access: Access, command_id: str, operation: str = "") -> None:
        command_id = str(command_id or "").strip()
        if not command_id:
            return
        ts = now()
        with self.conn() as db:
            db.execute(
                "INSERT INTO connector_commands(command_id,provider_id,operation,created_at,updated_at) VALUES(?,?,?,?,?) "
                "ON CONFLICT(command_id) DO UPDATE SET provider_id=excluded.provider_id,operation=excluded.operation,updated_at=excluded.updated_at",
                (command_id,access.provider_id,str(operation or "")[:80],ts,ts),
            )
            self._audit(db, access, access.provider_id, "connector-command", "command", command_id, {"operation":str(operation or "")[:80]})

    def command_owned(self, access: Access, command_id: str) -> bool:
        command_id = str(command_id or "").strip()
        if not command_id:
            return False
        with self.conn() as db:
            row = db.execute(
                "SELECT 1 FROM connector_commands WHERE command_id=? AND provider_id=? LIMIT 1",
                (command_id,access.provider_id),
            ).fetchone()
            return bool(row)

    def router_route(self, access: Access, nas: str, session_id: str = "") -> tuple[str, str] | None:
        nas_value = str(nas or "").strip()
        session_value = str(session_id or "").strip()
        with self.conn() as db:
            if session_value:
                row = db.execute(
                    """SELECT r.id,r.code FROM radius_sessions s
                       JOIN routers r ON r.id=s.router_id AND r.provider_id=s.provider_id
                       WHERE s.id=? AND s.provider_id=? LIMIT 1""",
                    (session_value, access.provider_id),
                ).fetchone()
                if row:
                    return str(row["id"]), str(row["code"])
            if nas_value:
                row = db.execute(
                    "SELECT id,code FROM routers WHERE provider_id=? AND (code=? OR name=?) LIMIT 1",
                    (access.provider_id, nas_value, nas_value),
                ).fetchone()
                if row:
                    return str(row["id"]), str(row["code"])
        return None

    def issue_site_agent(self, access: Access, router_id: str) -> dict[str, Any]:
        if access.role not in ("owner", "admin"):
            raise PermissionError("owner or admin required")
        router_id = str(router_id or "").strip()
        raw = "ura_" + secrets.token_urlsafe(32)
        ts = now()
        with self.conn() as db:
            router = db.execute(
                "SELECT id,name,code FROM routers WHERE id=? AND provider_id=?",
                (router_id, access.provider_id),
            ).fetchone()
            if not router:
                raise KeyError("router")
            db.execute(
                """INSERT INTO site_agents(router_id,provider_id,token_hash,status,last_seen_at,created_at,updated_at)
                   VALUES(?,?,?,'registered',NULL,?,?)
                   ON CONFLICT(router_id) DO UPDATE SET token_hash=excluded.token_hash,status='registered',
                   last_seen_at=NULL,updated_at=excluded.updated_at""",
                (router_id, access.provider_id, digest(raw), ts, ts),
            )
            db.execute(
                "UPDATE site_agent_commands SET status='canceled',updated_at=? WHERE router_id=? AND provider_id=? AND status IN ('queued','claimed')",
                (ts, router_id, access.provider_id),
            )
            self._audit(db, access, access.provider_id, "site-agent-token-rotate", "router", router_id)
        return {
            "token": raw,
            "routerId": router_id,
            "providerId": access.provider_id,
            "routerName": str(router["name"]),
            "routerCode": str(router["code"]),
        }

    def resolve_site_agent(self, raw_token: str) -> AgentAccess | None:
        if not raw_token:
            return None
        with self.conn() as db:
            row = db.execute(
                """SELECT a.provider_id,a.router_id FROM site_agents a
                   JOIN routers r ON r.id=a.router_id AND r.provider_id=a.provider_id
                   JOIN providers p ON p.id=a.provider_id
                   WHERE a.token_hash=? AND p.status='active' LIMIT 1""",
                (digest(raw_token),),
            ).fetchone()
            return AgentAccess(str(row["provider_id"]),str(row["router_id"])) if row else None

    def touch_site_agent(self, agent: AgentAccess) -> None:
        ts = now()
        with self.conn() as db:
            db.execute(
                "UPDATE site_agents SET status='online',last_seen_at=?,updated_at=? WHERE router_id=? AND provider_id=?",
                (ts,ts,agent.router_id,agent.provider_id),
            )

    def site_agent_status(self, access: Access, router_id: str) -> dict[str, Any]:
        with self.conn() as db:
            row = db.execute(
                "SELECT status,last_seen_at,created_at,updated_at FROM site_agents WHERE router_id=? AND provider_id=?",
                (str(router_id or ""),access.provider_id),
            ).fetchone()
            if not row:
                return {"registered":False,"online":False,"lastSeenAt":None}
            last_seen = int(row["last_seen_at"] or 0)
            online = bool(last_seen and now()-last_seen <= 45)
            return {
                "registered":True,
                "online":online,
                "status":"online" if online else str(row["status"]),
                "lastSeenAt":last_seen or None,
            }

    def queue_site_agent_command(self, provider_id: str, router_id: str, operation: str, payload: dict[str, Any]) -> str:
        command_id = rid("AGC")
        ts = now()
        with self.conn() as db:
            agent = db.execute(
                "SELECT 1 FROM site_agents WHERE provider_id=? AND router_id=? LIMIT 1",
                (provider_id,router_id),
            ).fetchone()
            if not agent:
                raise RuntimeError("site agent is not registered")
            db.execute(
                """INSERT INTO site_agent_commands(id,provider_id,router_id,operation,payload_json,status,result_json,
                   created_at,claimed_at,completed_at,updated_at)
                   VALUES(?,?,?,?,?,'queued',NULL,?,NULL,NULL,?)""",
                (command_id,provider_id,router_id,str(operation or "")[:64],
                 json.dumps(payload,ensure_ascii=False,separators=(",",":")),ts,ts),
            )
        return command_id

    def poll_site_agent(self, agent: AgentAccess) -> dict[str, Any] | None:
        ts = now()
        with self.conn() as db:
            db.execute(
                """UPDATE site_agent_commands SET status='queued',claimed_at=NULL,updated_at=?
                   WHERE router_id=? AND provider_id=? AND status='claimed' AND claimed_at<?""",
                (ts,agent.router_id,agent.provider_id,ts-45),
            )
            row = db.execute(
                """SELECT * FROM site_agent_commands WHERE router_id=? AND provider_id=? AND status='queued'
                   ORDER BY created_at ASC LIMIT 1""",
                (agent.router_id,agent.provider_id),
            ).fetchone()
            if not row:
                return None
            changed = db.execute(
                "UPDATE site_agent_commands SET status='claimed',claimed_at=?,updated_at=? WHERE id=? AND status='queued'",
                (ts,ts,row["id"]),
            )
            if changed.rowcount != 1:
                return None
            return {
                "id":str(row["id"]),
                "operation":str(row["operation"]),
                "payload":json.loads(row["payload_json"]),
            }

    def finish_site_agent_command(self, agent: AgentAccess, command_id: str, result: dict[str, Any]) -> bool:
        ts = now()
        status = "completed" if bool(result.get("ok")) else "failed"
        with self.conn() as db:
            changed = db.execute(
                """UPDATE site_agent_commands SET status=?,result_json=?,completed_at=?,updated_at=?
                   WHERE id=? AND provider_id=? AND router_id=? AND status='claimed'""",
                (status,json.dumps(result,ensure_ascii=False,separators=(",",":")),ts,ts,
                 str(command_id or ""),agent.provider_id,agent.router_id),
            )
            return changed.rowcount == 1

    def site_agent_command_result(self, provider_id: str, command_id: str) -> dict[str, Any] | None:
        with self.conn() as db:
            row = db.execute(
                "SELECT status,result_json FROM site_agent_commands WHERE id=? AND provider_id=?",
                (str(command_id or ""),provider_id),
            ).fetchone()
            if not row:
                return None
            result = json.loads(row["result_json"]) if row["result_json"] else None
            return {"status":str(row["status"]),"result":result}

    def sync_site_sessions(self, agent: AgentAccess, items: list[dict[str, Any]]) -> dict[str, int]:
        if not isinstance(items, list) or len(items) > 2000:
            raise ValueError("invalid sessions payload")
        ts = now()
        active_ids: list[str] = []
        with self.conn() as db:
            router = db.execute(
                "SELECT id,code FROM routers WHERE id=? AND provider_id=?",
                (agent.router_id,agent.provider_id),
            ).fetchone()
            if not router:
                raise KeyError("router")
            for item in items:
                if not isinstance(item,dict):
                    continue
                external_id = str(item.get("externalId") or "").strip()[:160]
                username = str(item.get("username") or "").strip()[:160]
                if not external_id or not username:
                    continue
                stable = hashlib.sha256(
                    f"{agent.provider_id}:{agent.router_id}:{external_id}".encode("utf-8")
                ).hexdigest()[:24].upper()
                session_id = "RSL-" + stable
                active_ids.append(session_id)
                framed_ip = str(item.get("framedIp") or "")[:64]
                access_kind = str(item.get("accessKind") or "RADIUS")[:64]
                try:
                    started_at = int(item.get("startedAt") or ts)
                except (TypeError,ValueError):
                    started_at = ts
                started_at = min(max(0,started_at),ts)
                try:
                    input_octets = max(0,int(item.get("inputOctets") or 0))
                    output_octets = max(0,int(item.get("outputOctets") or 0))
                except (TypeError,ValueError):
                    input_octets = output_octets = 0
                db.execute(
                    """INSERT INTO radius_sessions(
                       id,provider_id,username,router_id,framed_ip,access_kind,started_at,stopped_at,
                       input_octets,output_octets,status,updated_at
                       ) VALUES(?,?,?,?,?,?,?,NULL,?,?,'online',?)
                       ON CONFLICT(id) DO UPDATE SET username=excluded.username,router_id=excluded.router_id,
                       framed_ip=excluded.framed_ip,access_kind=excluded.access_kind,
                       input_octets=excluded.input_octets,output_octets=excluded.output_octets,
                       status='online',stopped_at=NULL,updated_at=excluded.updated_at""",
                    (session_id,agent.provider_id,username,agent.router_id,framed_ip,access_kind,
                     started_at,input_octets,output_octets,ts),
                )
            if active_ids:
                placeholders=",".join("?" for _ in active_ids)
                db.execute(
                    f"""UPDATE radius_sessions SET status='offline',stopped_at=?,updated_at=?
                        WHERE provider_id=? AND router_id=? AND status='online'
                        AND id NOT IN ({placeholders})""",
                    (ts,ts,agent.provider_id,agent.router_id,*active_ids),
                )
            else:
                db.execute(
                    """UPDATE radius_sessions SET status='offline',stopped_at=?,updated_at=?
                       WHERE provider_id=? AND router_id=? AND status='online'""",
                    (ts,ts,agent.provider_id,agent.router_id),
                )
            db.execute(
                "UPDATE site_agents SET status='online',last_seen_at=?,updated_at=? WHERE router_id=? AND provider_id=?",
                (ts,ts,agent.router_id,agent.provider_id),
            )
            online = db.execute(
                "SELECT count(*) FROM radius_sessions WHERE provider_id=? AND router_id=? AND status='online'",
                (agent.provider_id,agent.router_id),
            ).fetchone()[0]
        return {"received":len(items),"online":int(online)}

    def workflow_actions(self, access: Access) -> list[dict[str, Any]]:
        with self.conn() as db:
            rows = db.execute("SELECT * FROM audit_events WHERE provider_id=? ORDER BY id DESC LIMIT 100", (access.provider_id,)).fetchall()
            return [{"id":f"AUD-{r['id']}","actionType":r["entity_type"] or "audit","title":r["action"],"status":"completed",
                     "createdAt":r["created_at"],"fields":json.loads(r["detail_json"] or "{}")} for r in rows]

    def update_status(self, access: Access, kind: str, record_id: str, status: str, expected: str | None = None) -> dict[str, Any]:
        self._write(access)
        allowed = {"subscriber":("subscribers",{"active","suspended","expired","archived"}),
                   "node":("routers",{"provisioning","online","maintenance","degraded","offline","archived"})}
        if kind not in allowed or status not in allowed[kind][1]: raise ValueError("unsupported status")
        table = allowed[kind][0]
        with self.conn() as db:
            row = db.execute(f"SELECT * FROM {table} WHERE id=? AND provider_id=?", (record_id,access.provider_id)).fetchone()
            if not row: raise KeyError("record")
            if expected and row["status"] != expected: raise RuntimeError("status changed")
            db.execute(f"UPDATE {table} SET status=?,updated_at=? WHERE id=? AND provider_id=?", (status,now(),record_id,access.provider_id))
            self._audit(db, access, access.provider_id, f"{kind}-status", kind, record_id, {"from":row["status"],"to":status})
            return dict(db.execute(f"SELECT * FROM {table} WHERE id=? AND provider_id=?", (record_id,access.provider_id)).fetchone())
