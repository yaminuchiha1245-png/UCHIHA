#!/usr/bin/env python3
import hashlib
import hmac
import json
import os
import pathlib
import re
import time
import urllib.parse

INFRA_PATH = pathlib.Path("/var/www/uchiha-infra/status.json")
CONTROL_DATA = pathlib.Path("/var/lib/docker/volumes/uchiha-control_uchiha_data/_data")
STATE_PATH = CONTROL_DATA / "state.json"
APPROVALS_PATH = CONTROL_DATA / "approvals.json"
AUDIT_PATH = CONTROL_DATA / "audit.jsonl"
PROJECT_SECRETS_DIR = CONTROL_DATA / "project-secrets"
BOT_STATE_DIR = pathlib.Path("/var/lib/uchiha-telegram-control")
ADMINS_PATH = BOT_STATE_DIR / "admins.json"

def read_json(path, default):
    try:
        return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    except Exception:
        return default

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
    return True, "ok"

def validate_init_data(init_data, max_age=86400):
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
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
    root = secret_files()
    result = []
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

def dashboard():
    return {
        "ok": True,
        "infra": infra(),
        "projects": projects(),
        "secrets": secret_index(),
        "approvals": approvals(),
        "audit": audit_events(50)
    }