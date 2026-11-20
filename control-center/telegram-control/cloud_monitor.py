#!/usr/bin/env python3
"""Read-only cloud usage sampler integrated with UCHIHA's existing Telegram watcher.

Only official provider measurements are marked as measured. No runtime or billing
mutations are performed by this module. SQLite is local to the control plane.
"""
import datetime as dt
import json
import os
import pathlib
import re
import secrets
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request

from common import PROJECT_SECRETS_DIR
from project_manager import STATE_DIR, get_project

DB = pathlib.Path(os.environ.get("UCHIHA_CLOUD_DB", str(STATE_DIR / "cloud-usage.sqlite3")))
PROJECT_RE = re.compile(r"^[a-z0-9-]{2,64}$")
REMOTE_RE = re.compile(r"^[a-zA-Z0-9._:-]{2,128}$")
METRICS = {
    "api_requests_window": ("طلبات API / نافذة المزود", "count"),
    "firestore_reads_hour": ("قراءات Firestore / ساعة", "count"),
    "firestore_writes_hour": ("كتابات Firestore / ساعة", "count"),
    "firestore_deletes_hour": ("حذف Firestore / ساعة", "count"),
    "db_bytes": ("حجم قاعدة البيانات", "bytes"),
    "rtdb_monthly_egress": ("نقل RTDB / الشهر", "bytes"),
    "rtdb_connections": ("اتصالات RTDB المتزامنة", "count"),
    "firestore_connections": ("اتصالات Firestore المتزامنة", "count"),
}
# Metric type, result name, kind, unit, query horizon.
GCP_METRICS = (
    ("firestore.googleapis.com/document/read_count", "firestore_reads_hour", "DELTA", "count", 65),
    ("firestore.googleapis.com/document/write_count", "firestore_writes_hour", "DELTA", "count", 65),
    ("firestore.googleapis.com/document/delete_count", "firestore_deletes_hour", "DELTA", "count", 65),
    ("firestore.googleapis.com/storage/data_and_index_storage_bytes", "db_bytes", "GAUGE", "bytes", 160),
    ("firestore.googleapis.com/network/active_connections", "firestore_connections", "GAUGE", "count", 160),
    ("firebasedatabase.googleapis.com/network/active_connections", "rtdb_connections", "GAUGE", "count", 160),
    ("firebasedatabase.googleapis.com/network/monthly_sent", "rtdb_monthly_egress", "GAUGE", "bytes", 180),
    ("firebasedatabase.googleapis.com/network/monthly_sent_limit", "_rtdb_egress_limit", "GAUGE", "bytes", 180),
    ("firebasedatabase.googleapis.com/storage/total_bytes", "_rtdb_db_bytes", "GAUGE", "bytes", 1600),
    ("firebasedatabase.googleapis.com/storage/limit", "_rtdb_db_limit", "GAUGE", "bytes", 180),
)

def utcnow():
    return dt.datetime.now(dt.timezone.utc)

def iso():
    return utcnow().isoformat(timespec="seconds").replace("+00:00", "Z")

def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB), timeout=5)
    if DB.exists():
        os.chmod(DB, 0o600)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      provider TEXT NOT NULL, remote_id TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'unknown',
      alerts INTEGER NOT NULL DEFAULT 1, fixed_usd REAL,
      checked_at TEXT, checked_epoch INTEGER, error TEXT,
      UNIQUE(project_id, provider, remote_id)
    );
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT, link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      metric TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL,
      period TEXT NOT NULL, source TEXT NOT NULL, at TEXT NOT NULL, epoch INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_samples_latest ON samples(link_id,metric,epoch DESC);
    CREATE TABLE IF NOT EXISTS limits (
      link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      metric TEXT NOT NULL, amount REAL NOT NULL, unit TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'manual', PRIMARY KEY(link_id,metric)
    );
    CREATE TABLE IF NOT EXISTS devices (
      project_id TEXT NOT NULL, device_hash TEXT NOT NULL, last_seen INTEGER NOT NULL,
      sync_status TEXT NOT NULL, PRIMARY KEY(project_id,device_hash)
    );
    CREATE TABLE IF NOT EXISTS sync_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL,
      at INTEGER NOT NULL, state TEXT NOT NULL
    );
    """)
    return conn

def list_links():
    with connect() as db:
        return [dict(x) for x in db.execute("SELECT * FROM links ORDER BY project_id,provider,remote_id")]

def get_link(link_id):
    with connect() as db:
        x = db.execute("SELECT * FROM links WHERE id=?", (link_id,)).fetchone()
        return dict(x) if x else None

def add_link(project_id, provider, remote_id):
    project_id = str(project_id or "").lower().strip()
    provider = str(provider or "").lower().strip()
    remote_id = str(remote_id or "").strip()
    if not PROJECT_RE.fullmatch(project_id) or not get_project(project_id):
        raise ValueError("project_not_found")
    if provider not in ("supabase", "firebase", "other") or not REMOTE_RE.fullmatch(remote_id):
        raise ValueError("invalid_cloud_link")
    link_id = secrets.token_hex(5)
    with connect() as db:
        try:
            db.execute("INSERT INTO links(id,project_id,provider,remote_id) VALUES(?,?,?,?)",
                       (link_id, project_id, provider, remote_id))
            db.commit()
        except sqlite3.IntegrityError:
            raise ValueError("link_exists")
    return link_id

def remove_link(link_id):
    with connect() as db:
        count = db.execute("DELETE FROM links WHERE id=?", (link_id,)).rowcount
        db.commit()
        return bool(count)

def change_link(link_id, *, plan=None, alerts=None, fixed_usd=None):
    if not get_link(link_id):
        raise ValueError("link_not_found")
    with connect() as db:
        if plan is not None:
            if plan not in ("free", "paid", "unknown"):
                raise ValueError("invalid_plan")
            db.execute("UPDATE links SET plan=? WHERE id=?", (plan, link_id))
        if alerts is not None:
            db.execute("UPDATE links SET alerts=? WHERE id=?", (int(bool(alerts)), link_id))
        if fixed_usd is not None:
            amount = float(fixed_usd)
            if not 0 <= amount <= 1000000:
                raise ValueError("invalid_cost")
            db.execute("UPDATE links SET fixed_usd=? WHERE id=?", (amount, link_id))
        db.commit()

def set_limit(link_id, metric, amount):
    if not get_link(link_id) or metric not in METRICS:
        raise ValueError("invalid_metric")
    value = float(amount)
    if not (0 < value <= 1e18):
        raise ValueError("invalid_limit")
    with connect() as db:
        db.execute("""INSERT INTO limits(link_id,metric,amount,unit) VALUES(?,?,?,?)
                   ON CONFLICT(link_id,metric) DO UPDATE SET amount=excluded.amount,
                   unit=excluded.unit,origin='manual'""",
                   (link_id, metric, value, METRICS[metric][1]))
        db.commit()

def _secret(project_id, name):
    # Reuse the existing protected project secret store; never persist a token here.
    if not PROJECT_RE.fullmatch(project_id):
        return None
    path = PROJECT_SECRETS_DIR / (project_id + ".env")
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith(name + "="):
                return line.partition("=")[2].strip()
    except OSError:
        pass
    return None

def _json_get(url, token, timeout=6):
    req = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + token, "Accept": "application/json",
        "User-Agent": "UCHIHA-CloudMonitor/1.0"
    })
    with urllib.request.urlopen(req, timeout=timeout) as response:
        if int(response.headers.get("Content-Length", "0") or "0") > 2_000_000:
            raise ValueError("provider_response_too_large")
        return json.loads(response.read(2_000_001).decode("utf-8"))

def _supabase(link):
    token = _secret(link["project_id"], "SUPABASE_MGMT_TOKEN")
    if not token:
        raise ValueError("supabase_token_not_configured")
    rid = link["remote_id"]
    base = "https://api.supabase.com/v1/projects/" + urllib.parse.quote(rid, safe="")
    project = _json_get(base, token)
    if not isinstance(project, dict) or not project.get("id"):
        raise ValueError("supabase_project_unavailable")
    payload = _json_get(base + "/analytics/endpoints/usage.api-requests-count", token)
    items = payload.get("result") if isinstance(payload, dict) else None
    # The endpoint doesn't document a billing-cycle time window. Never compare
    # it to a monthly quota or call it monthly usage.
    if isinstance(items, list) and items and isinstance(items[0], dict):
        count = items[0].get("count")
        if isinstance(count, (int, float)) and count >= 0:
            return {"api_requests_window": (float(count), "count", "provider-window", "supabase-management-api")}
    return {}

def _google_token():
    # ADC with a read-only Monitoring IAM role; no service-account JSON in the bot.
    try:
        import google.auth
        from google.auth.transport.requests import Request
    except ImportError:
        raise ValueError("google_auth_library_unavailable")
    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/monitoring.read"])
    if not creds.valid:
        creds.refresh(Request())
    return creds.token

def _gcp_series(project_id, token, metric_type, kind, minutes):
    finish = utcnow()
    start = finish - dt.timedelta(minutes=minutes)
    params = urllib.parse.urlencode({
        "filter": 'metric.type="' + metric_type + '"',
        "interval.startTime": start.isoformat().replace("+00:00", "Z"),
        "interval.endTime": finish.isoformat().replace("+00:00", "Z"),
        "view": "FULL", "pageSize": "1000"
    })
    url = "https://monitoring.googleapis.com/v3/projects/" + urllib.parse.quote(project_id, safe="") + "/timeSeries?" + params
    body = _json_get(url, token)
    if body.get("nextPageToken"):
        # Incomplete series must never be presented as total usage.
        return None
    vals = []
    for series in body.get("timeSeries", []):
        points = series.get("points", [])
        numeric = []
        for point in points:
            v = point.get("value") or {}
            raw = v.get("int64Value", v.get("doubleValue"))
            try:
                if raw is not None:
                    numeric.append((point.get("interval", {}).get("endTime", ""), float(raw)))
            except (TypeError, ValueError):
                continue
        if numeric:
            if kind == "GAUGE":
                vals.append(max(numeric, key=lambda x: x[0])[1])
            else:
                # DELTA points represent nonoverlapping time buckets.
                vals.append(sum(v for _, v in numeric))
    return sum(vals) if vals else None

def _firebase(link):
    token = _google_token()
    data = {}
    for metric_type, key, kind, unit, minutes in GCP_METRICS:
        try:
            value = _gcp_series(link["remote_id"], token, metric_type, kind, minutes)
        except urllib.error.HTTPError as ex:
            if ex.code in (401, 403):
                raise ValueError("google_monitoring_permission_denied")
            if ex.code == 404:
                continue
            raise
        if value is not None:
            period = "last-65m" if kind == "DELTA" else "latest"
            data[key] = (value, unit, period, "google-cloud-monitoring")
    # Distinguish Firestore and RTDB storage even if they share a Firebase project.
    if "_rtdb_db_bytes" in data:
        data["rtdb_db_bytes"] = data.pop("_rtdb_db_bytes")
    return data

def sample_link(link_id, force=False):
    link = get_link(link_id)
    if not link:
        raise ValueError("link_not_found")
    now = int(time.time())
    if not force and link["checked_epoch"] and now - link["checked_epoch"] < 900:
        return False
    if link["provider"] == "other":
        measured = {}
        error = "no_official_adapter"
    else:
        try:
            measured = _supabase(link) if link["provider"] == "supabase" else _firebase(link)
            error = None if measured else "metrics_not_available"
        except urllib.error.HTTPError as ex:
            measured, error = {}, "provider_http_" + str(ex.code)
        except (urllib.error.URLError, TimeoutError):
            measured, error = {}, "provider_connection_error"
        except (ValueError, RuntimeError) as ex:
            measured, error = {}, str(ex)[:80]
        except Exception:
            measured, error = {}, "provider_error"
    with connect() as db:
        stamp = iso()
        for metric, (value, unit, period, source) in measured.items():
            db.execute("""INSERT INTO samples(link_id,metric,value,unit,period,source,at,epoch)
                       VALUES(?,?,?,?,?,?,?,?)""",
                       (link_id, metric, value, unit, period, source, stamp, now))
        db.execute("UPDATE links SET checked_at=?, checked_epoch=?, error=? WHERE id=?",
                   (stamp, now, error, link_id))
        db.execute("DELETE FROM samples WHERE epoch < ?", (now - 93 * 86400,))
        db.commit()
    return True

def collect_due(max_links=3):
    processed = 0
    for row in list_links():
        if processed >= max_links:
            break
        if not row["checked_epoch"] or int(time.time()) - row["checked_epoch"] >= 900:
            try:
                sample_link(row["id"])
            except Exception:
                pass  # Never prevent existing server alarms or business operations.
            processed += 1
    return processed

def _latest(db, link_id):
    rows = db.execute("""SELECT s.* FROM samples s JOIN (
       SELECT metric,MAX(id) latest_id FROM samples WHERE link_id=? GROUP BY metric
    ) last ON s.id=last.latest_id ORDER BY s.metric""", (link_id,)).fetchall()
    return {r["metric"]: dict(r) for r in rows}

def snapshot(link_id):
    link = get_link(link_id)
    if not link:
        return None
    with connect() as db:
        link["metrics"] = _latest(db, link_id)
        link["limits"] = {x["metric"]: dict(x) for x in db.execute(
            "SELECT * FROM limits WHERE link_id=?", (link_id,))}
        devices = db.execute("""SELECT COUNT(*) n, MAX(last_seen) last_seen FROM devices
                      WHERE project_id=? AND last_seen>=?""",
                      (link["project_id"], int(time.time()) - 900)).fetchone()
        link["active_devices_15m"] = devices["n"] if devices["n"] else None
        link["latest_device_seen"] = devices["last_seen"]
        sync = db.execute("""SELECT state,at FROM sync_events WHERE project_id=?
                   ORDER BY id DESC LIMIT 1""", (link["project_id"],)).fetchone()
        link["sync"] = dict(sync) if sync else None
    return link

def cloud_alerts():
    alerts = []
    for link in list_links():
        if not link["alerts"]:
            continue
        view = snapshot(link["id"])
        title = link["project_id"] + " / " + link["provider"]
        if link["error"] and link["error"] not in (
                "no_official_adapter", "supabase_token_not_configured",
                "google_auth_library_unavailable", "metrics_not_available"):
            alerts.append({"level": "warning", "title": title, "detail": "Cloud: " + link["error"]})
        for metric, row in view["metrics"].items():
            limit = view["limits"].get(metric)
            if not limit or row["unit"] != limit["unit"]:
                continue
            if row["epoch"] < int(time.time()) - 3600:
                continue
            if metric == "api_requests_window" or metric.endswith("_hour"):
                continue  # Unknown vendor window is not a billing-month quota.
            pct = 100 * row["value"] / limit["amount"]
            threshold = next((t for t in (95, 85, 70) if pct >= t), None)
            if threshold:
                alerts.append({"level": "critical" if threshold >= 95 else "warning",
                               "title": title, "detail": "%s: %.1f%% (عتبة %s%%)" %
                               (METRICS.get(metric, (metric, ""))[0], pct, threshold)})
        if view["sync"] and view["sync"]["state"] == "error" and int(time.time()) - view["sync"]["at"] < 3600:
            alerts.append({"level": "warning", "title": title, "detail": "فشل مزامنة مُبلّغ عنه من التطبيق"})
    return alerts

def record_heartbeat(project_id, device_id, state):
    # Called only after api.py checks the project-scoped HMAC.
    if not PROJECT_RE.fullmatch(project_id) or not get_project(project_id):
        raise ValueError("project_not_found")
    if state not in ("ok", "error") or not isinstance(device_id, str) or len(device_id) > 150:
        raise ValueError("invalid_heartbeat")
    import hashlib
    import hmac
    key = _secret(project_id, "CLOUD_HEARTBEAT_KEY")
    if not key:
        raise ValueError("heartbeat_not_configured")
    digest = hmac.new(key.encode(), device_id.encode(), hashlib.sha256).hexdigest()
    stamp = int(time.time())
    with connect() as db:
        db.execute("""INSERT INTO devices(project_id,device_hash,last_seen,sync_status)
                   VALUES(?,?,?,?) ON CONFLICT(project_id,device_hash)
                   DO UPDATE SET last_seen=excluded.last_seen,sync_status=excluded.sync_status""",
                   (project_id, digest, stamp, state))
        last = db.execute("SELECT state FROM sync_events WHERE project_id=? ORDER BY id DESC LIMIT 1",
                          (project_id,)).fetchone()
        if not last or last["state"] != state:
            db.execute("INSERT INTO sync_events(project_id,at,state) VALUES(?,?,?)",
                       (project_id, stamp, state))
        db.execute("DELETE FROM devices WHERE last_seen<?", (stamp - 35 * 86400,))
        db.commit()

def verify_heartbeat(raw, timestamp, signature):
    import hashlib
    import hmac
    try:
        stamp = int(timestamp)
        payload = json.loads(raw)
        project_id = payload.get("projectId", "")
        if abs(time.time() - stamp) > 300 or not PROJECT_RE.fullmatch(project_id):
            return None
        key = _secret(project_id, "CLOUD_HEARTBEAT_KEY")
        if not key:
            return None
        signed = timestamp.encode() + b"." + raw
        expected = hmac.new(key.encode(), signed, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, str(signature)):
            return None
        device = payload.get("deviceId")
        state = payload.get("sync", "")
        if not isinstance(device, str) or not 1 <= len(device) <= 150 or state not in ("ok", "error"):
            return None
        return project_id, device, state
    except (ValueError, TypeError, AttributeError, UnicodeError):
        return None
