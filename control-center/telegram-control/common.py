#!/usr/bin/env python3
import hashlib
import hmac
import json
import os
import pathlib
import re
import time
import subprocess
import datetime
import urllib.parse

INFRA_PATH = pathlib.Path("/var/www/uchiha-infra/status.json")
CONTROL_DATA = pathlib.Path("/var/lib/docker/volumes/uchiha-control_uchiha_data/_data")
STATE_PATH = CONTROL_DATA / "state.json"
APPROVALS_PATH = CONTROL_DATA / "approvals.json"
AUDIT_PATH = CONTROL_DATA / "audit.jsonl"
PROJECT_SECRETS_DIR = CONTROL_DATA / "project-secrets"
BOT_STATE_DIR = pathlib.Path("/var/lib/uchiha-telegram-control")
ADMINS_PATH = BOT_STATE_DIR / "admins.json"
GITHUB_REPOS_PATH = BOT_STATE_DIR / "github-repos.json"
BOT_TOKEN_PATH = BOT_STATE_DIR / "bot-token"
CLAIM_HASH_PATH = BOT_STATE_DIR / "claim-code.sha256"

def read_json(path, default):
    try:
        return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    except Exception:
        return default

def bot_token():
    value = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if value:
        return value
    try:
        return BOT_TOKEN_PATH.read_text(encoding="utf-8").strip()
    except Exception:
        return ""

def env_admin_ids():
    value = os.environ.get("TELEGRAM_ADMIN_IDS", "")
    out = set()
    for item in value.split(","):
        item = item.strip()
        if item.isdigit():
            out.add(int(item))
    return out

def stored_admin_ids():
    data = read_json(ADMINS_PATH, {"admins":[]})
    out = set()
    for item in data.get("admins", []):
        try: out.add(int(item))
        except Exception: pass
    return out

def admin_ids():
    return env_admin_ids() | stored_admin_ids()

def is_admin(user_id):
    try: return int(user_id) in admin_ids()
    except Exception: return False

def claim_admin(user_id, code):
    if admin_ids():
        return False, "already_configured"
    expected = os.environ.get("TELEGRAM_CLAIM_CODE_HASH", "").strip().lower()
    if not expected:
        try:
            expected = CLAIM_HASH_PATH.read_text(encoding="utf-8").strip().lower()
        except Exception:
            expected = ""
    if not re.fullmatch(r"[a-f0-9]{64}", expected):
        return False, "claim_disabled"
    actual = hashlib.sha256(str(code).strip().encode()).hexdigest()
    if not hmac.compare_digest(actual, expected):
        return False, "invalid_code"
    BOT_STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = ADMINS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps({"admins":[int(user_id)]}, separators=(",",":")), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(ADMINS_PATH)
    try:
        CLAIM_HASH_PATH.unlink()
    except Exception:
        pass
    return True, "ok"

def validate_init_data(init_data, max_age=86400):
    token = bot_token()
    if not token or not init_data:
        return None
    pairs = urllib.parse.parse_qsl(init_data, keep_blank_values=True)
    data = dict(pairs)
    their_hash = data.pop("hash", "")
    if not their_hash:
        return None
    check = "\n".join(f"{k}={data[k]}" for k in sorted(data))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    ours = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(ours, their_hash):
        return None
    try:
        auth_date = int(data.get("auth_date", "0"))
    except Exception:
        return None
    if auth_date <= 0 or abs(time.time() - auth_date) > max_age:
        return None
    try:
        user = json.loads(data.get("user", "{}"))
    except Exception:
        return None
    if not is_admin(user.get("id")):
        return None
    return user

def infra():
    return read_json(INFRA_PATH, {"ok":False})

def projects():
    state = read_json(STATE_PATH, {})
    out = []
    for p in state.get("projects", []):
        if not isinstance(p, dict): continue
        out.append({
            "id": str(p.get("id","")),
            "name": str(p.get("name","")),
            "status": str(p.get("status","")),
            "statusLabel": str(p.get("statusLabel","")),
            "environment": str(p.get("environment","")),
            "domain": str(p.get("domain","")),
            "server": str(p.get("server","")),
            "lastDeploy": str(p.get("lastDeploy","")),
            "release": str(p.get("release","")),
            "healthScore": p.get("healthScore"),
            "kind": str(p.get("kind", p.get("type","")))
        })
    return out

def approvals():
    rows = read_json(APPROVALS_PATH, [])
    if not isinstance(rows, list): return []
    result = []
    for x in rows[-50:]:
        if not isinstance(x, dict): continue
        result.append({k:x.get(k) for k in ["id","title","status","action","project","client","createdAt","approvedAt","detail"]})
    return result

def audit_events(limit=100):
    rows = []
    try:
        for line in AUDIT_PATH.read_text(encoding="utf-8").splitlines()[-limit:]:
            try:
                x = json.loads(line)
                if isinstance(x, dict):
                    rows.append({k:x.get(k) for k in ["id","at","source","type","hash","previousHash"]})
            except Exception: pass
    except Exception: pass
    return rows

def secret_files():
    PROJECT_SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(PROJECT_SECRETS_DIR, 0o700)
    return PROJECT_SECRETS_DIR

def secret_index():
    root = PROJECT_SECRETS_DIR
    result = []
    if not root.exists():
        return result
    for path in sorted(root.glob("*.env")):
        project_id = path.stem
        keys = []
        try:
            mtime = path.stat().st_mtime
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line or line.startswith("#") or "=" not in line: continue
                key = line.split("=",1)[0].strip()
                if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,79}", key):
                    keys.append(key)
        except Exception:
            mtime = 0
        result.append({"projectId":project_id,"keys":sorted(set(keys)),"count":len(set(keys)),"updatedAt":mtime})
    return result

def put_secret(project_id, key, value):
    project_id = str(project_id or "").strip()
    key = str(key or "").strip()
    value = str(value or "")
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,120}", project_id):
        raise ValueError("invalid_project")
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,79}", key):
        raise ValueError("invalid_key")
    if not value or len(value) > 32768 or "\n" in value or "\r" in value or "\0" in value:
        raise ValueError("invalid_value")
    root = secret_files()
    path = root / f"{project_id}.env"
    rows = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line or line.startswith("#") or "=" not in line: continue
            k,v = line.split("=",1)
            if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,79}", k.strip()):
                rows[k.strip()] = v
    rows[key] = value
    tmp = path.with_suffix(".tmp")
    tmp.write_text("".join(f"{k}={rows[k]}\n" for k in sorted(rows)), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(path)
    os.chmod(path, 0o600)
    return {"projectId":project_id,"key":key,"configured":True}

def delete_secret(project_id, key):
    project_id = str(project_id or "").strip()
    key = str(key or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,120}", project_id) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,79}", key):
        raise ValueError("invalid_key")
    path = secret_files() / f"{project_id}.env"
    if not path.exists():
        return False
    rows = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line: continue
        k,v = line.split("=",1)
        rows[k.strip()] = v
    existed = key in rows
    rows.pop(key, None)
    tmp = path.with_suffix(".tmp")
    tmp.write_text("".join(f"{k}={rows[k]}\n" for k in sorted(rows)), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(path)
    os.chmod(path, 0o600)
    return existed

def github_repositories():
    data = read_json(GITHUB_REPOS_PATH, {"repositories":[]})
    rows = data.get("repositories", [])
    return {
        "account": str(data.get("account","")),
        "syncedAt": str(data.get("syncedAt","")),
        "repositories": [x for x in rows if isinstance(x, dict)]
    }

BACKUP_DIR = BOT_STATE_DIR / "backups"

def _run(args, timeout=30):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
        return p.returncode, p.stdout.strip(), p.stderr.strip()
    except Exception as exc:
        return 1, "", type(exc).__name__

def operational_state():
    data = infra()
    server = data.get("server", {})
    containers = []
    for item in server.get("containers", []):
        name = str(item.get("name",""))
        if re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", name):
            containers.append({
                "name": name,
                "image": item.get("image"),
                "status": item.get("status"),
                "healthy": item.get("healthy"),
                "healthChecked": item.get("healthChecked"),
            })
    return {
        "containers": containers,
        "nginx": _run(["systemctl","is-active","nginx"], 8)[1] or "unknown",
        "controlCenter": _run(["systemctl","is-active","uchiha-telegram-control-api.service"], 8)[1] or "unknown",
        "bot": _run(["systemctl","is-active","uchiha-telegram-control-bot.service"], 8)[1] or "unknown",
    }

def restart_container(name):
    name = str(name or "").strip()
    allowed = {x["name"] for x in operational_state()["containers"]}
    if name not in allowed:
        raise ValueError("container_not_allowed")
    rc, out, err = _run(["docker","restart",name], 90)
    if rc != 0:
        raise RuntimeError("container_restart_failed")
    return {"name":name,"status":"restarted","output":out[:200]}

def restart_nginx():
    rc, _, _ = _run(["nginx","-t"], 15)
    if rc != 0:
        raise RuntimeError("nginx_config_invalid")
    rc, out, err = _run(["systemctl","reload","nginx"], 20)
    if rc != 0:
        raise RuntimeError("nginx_reload_failed")
    return {"status":"reloaded"}

def refresh_infrastructure():
    rc, out, err = _run(["/usr/local/sbin/uchiha-infra-status"], 30)
    if rc != 0:
        raise RuntimeError("infra_refresh_failed")
    return infra()

def database_stats():
    d = infra().get("database", {})
    container = str(d.get("container") or "")
    dbname = str(d.get("name") or "")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", container) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", dbname):
        return {"connected":False}
    rc_user, dbuser, _ = _run(["docker","exec",container,"sh","-lc","printenv POSTGRES_USER"], 8)
    dbuser = dbuser.strip() if rc_user == 0 and dbuser.strip() else "postgres"
    query = "select current_database(), pg_size_pretty(pg_database_size(current_database())), (select count(*) from pg_stat_activity where datname=current_database()), (select count(*) from information_schema.tables where table_schema='public');"
    rc, out, err = _run(["docker","exec",container,"psql","-U",dbuser,"-d",dbname,"-At","-F","|","-c",query], 20)
    if rc != 0 or not out:
        return {"connected":False}
    parts = out.splitlines()[-1].split("|")
    return {
        "connected": True,
        "database": parts[0] if len(parts)>0 else dbname,
        "size": parts[1] if len(parts)>1 else "",
        "connections": int(parts[2]) if len(parts)>2 and parts[2].isdigit() else None,
        "publicTables": int(parts[3]) if len(parts)>3 and parts[3].isdigit() else None,
    }

def create_database_backup():
    d = infra().get("database", {})
    container = str(d.get("container") or "")
    dbname = str(d.get("name") or "")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", container) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", dbname):
        raise ValueError("database_unavailable")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(BACKUP_DIR, 0o700)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
    path = BACKUP_DIR / f"{dbname}-{stamp}.dump"
    rc_user, dbuser, _ = _run(["docker","exec",container,"sh","-lc","printenv POSTGRES_USER"], 8)
    dbuser = dbuser.strip() if rc_user == 0 and dbuser.strip() else "postgres"
    cmd = ["docker","exec",container,"pg_dump","-U",dbuser,"-Fc",dbname]
    try:
        with open(path,"wb") as fh:
            p = subprocess.run(cmd, stdout=fh, stderr=subprocess.PIPE, timeout=180, check=False)
        if p.returncode != 0:
            try: path.unlink()
            except Exception: pass
            raise RuntimeError("database_backup_failed")
        os.chmod(path,0o600)
    except Exception:
        try:
            if path.exists(): path.unlink()
        except Exception: pass
        raise
    return {"name":path.name,"size":path.stat().st_size,"createdAt":datetime.datetime.now(datetime.timezone.utc).isoformat()}

def list_backups():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(BACKUP_DIR,0o700)
    rows=[]
    for path in sorted(BACKUP_DIR.glob("*.dump"), key=lambda p:p.stat().st_mtime, reverse=True)[:50]:
        st=path.stat()
        rows.append({"name":path.name,"size":st.st_size,"createdAt":datetime.datetime.fromtimestamp(st.st_mtime,datetime.timezone.utc).isoformat()})
    return rows

def delete_backup(name):
    name = str(name or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,180}\.dump", name):
        raise ValueError("invalid_backup")
    path = BACKUP_DIR / name
    if not path.exists():
        return False
    path.unlink()
    return True

def safe_container_logs(name, lines=120):
    name = str(name or "").strip()
    allowed = {x["name"] for x in operational_state()["containers"]}
    if name not in allowed:
        raise ValueError("container_not_allowed")
    lines = max(20,min(int(lines or 120),300))
    rc,out,err=_run(["docker","logs","--tail",str(lines),name],20)
    text=(out+"\n"+err).strip()
    patterns=[
        (r"(?i)(authorization:\s*bearer\s+)[A-Za-z0-9._~-]+",r"\1[REDACTED]"),
        (r"(?i)(token|password|secret|api[_-]?key)(\s*[:=]\s*)[^\s,;]+",r"\1\2[REDACTED]"),
        (r"[0-9]{6,15}:[A-Za-z0-9_-]{20,}","[TELEGRAM_TOKEN_REDACTED]"),
        (r"github_pat_[A-Za-z0-9_]+","[GITHUB_TOKEN_REDACTED]"),
    ]
    for pat,repl in patterns:
        text=re.sub(pat,repl,text)
    return {"name":name,"lines":text[-12000:]}

def current_alerts():
    x = infra()
    s = x.get("server", {})
    d = x.get("database", {})
    domains = x.get("domains", {})
    out = []
    if s.get("health") not in ("healthy","ok"):
        out.append({"level":"critical","code":"server_health","title":"حالة السيرفر غير سليمة","detail":str(s.get("health") or "unknown")})
    if int(s.get("containersUnhealthy") or 0) > 0:
        out.append({"level":"critical","code":"container_unhealthy","title":"حاويات غير سليمة","detail":str(s.get("containersUnhealthy"))})
    if float(s.get("diskPercent") or 0) >= 85:
        out.append({"level":"warning","code":"disk_high","title":"استخدام التخزين مرتفع","detail":f"{s.get('diskPercent')}%"})
    if float(s.get("memoryPercent") or 0) >= 90:
        out.append({"level":"warning","code":"memory_high","title":"استخدام الذاكرة مرتفع","detail":f"{s.get('memoryPercent')}%"})
    if d.get("connected") and d.get("health") not in ("healthy","ok","running"):
        out.append({"level":"critical","code":"database_health","title":"قاعدة البيانات تحتاج مراجعة","detail":str(d.get("health") or "unknown")})
    for row in domains.get("items", []):
        if row.get("role") == "Control Center" and not row.get("ssl"):
            out.append({"level":"critical","code":"control_ssl","title":"SSL لوحة التحكم غير متاح","detail":str(row.get("domain") or "")})
    return out

def dashboard():
    try:
        from project_manager import catalog as project_catalog, billing_alerts
        managed_projects = project_catalog()
        billing = billing_alerts()
    except Exception:
        managed_projects = []
        billing = []
    return {
        "ok": True,
        "infra": infra(),
        "projects": projects(),
        "managedProjects": managed_projects,
        "billingAlerts": billing,
        "github": github_repositories(),
        "secrets": secret_index(),
        "approvals": approvals(),
        "audit": audit_events(50),
        "operations": operational_state(),
        "databaseStats": database_stats(),
        "backups": list_backups(),
        "alerts": current_alerts(),
    }