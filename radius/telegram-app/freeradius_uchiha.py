from __future__ import annotations

import os
import sys
from pathlib import Path

import radiusd

BASE = Path(os.getenv("UCHIHA_SITE_RUNTIME_DIR", "/opt/uchiha-radius/site-gateway"))
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from site_radius_db import SiteRadiusDB

DB = SiteRadiusDB(os.getenv("UCHIHA_SITE_RADIUS_DB", "/var/lib/uchiha-radius/site-radius.sqlite3"))


def _section(payload, name: str):
    if isinstance(payload, dict):
        value = payload.get(name)
        return value if isinstance(value, (list, tuple)) else ()
    return payload if name == "request" and isinstance(payload, (list, tuple)) else ()


def _attr(payload, section: str, name: str) -> str:
    for item in _section(payload, section):
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        if str(item[0]) == name:
            return str(item[-1])
    return ""


def _rate(value: float) -> str:
    number = max(0.0, float(value or 0))
    if number <= 0:
        return ""
    if abs(number - round(number)) < 1e-9:
        return f"{int(round(number))}M"
    return f"{number:.3f}".rstrip("0").rstrip(".") + "M"


def authorize(payload):
    username = _attr(payload, "request", "User-Name").strip()
    if not username:
        return radiusd.RLM_MODULE_NOTFOUND

    account = DB.account(username)
    if not account:
        return radiusd.RLM_MODULE_NOTFOUND

    credential = str(account.get("credential") or "")
    if not credential:
        return radiusd.RLM_MODULE_NOTFOUND

    update = {
        "config": (("Cleartext-Password", ":=", credential),),
    }

    download = _rate(account.get("download_mbps") or 0)
    upload = _rate(account.get("upload_mbps") or 0)
    if download and upload:
        update["reply"] = (("Mikrotik-Rate-Limit", ":=", f"{download}/{upload}"),)

    return radiusd.RLM_MODULE_OK, update


def accounting(payload):
    return radiusd.RLM_MODULE_OK


def post_auth(payload):
    return radiusd.RLM_MODULE_OK
