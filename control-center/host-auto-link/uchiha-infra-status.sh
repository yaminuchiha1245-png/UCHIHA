[Reading 222 lines from start (total: 222 lines, 0 remaining)]

#!/usr/bin/env python3
import datetime
import glob
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import time

OUT = pathlib.Path("/var/www/uchiha-infra/status.json")
HISTORY = pathlib.Path("/var/lib/uchiha-infra/history.jsonl")
OUT.parent.mkdir(parents=True, exist_ok=True)
HISTORY.parent.mkdir(parents=True, exist_ok=True)

def run(args):
    try:
        return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=8).strip()
    except Exception:
        return ""

def mem_percent():
    vals = {}
    try:
        for line in pathlib.Path("/proc/meminfo").read_text().splitlines():
            key, value = line.split(":", 1)
            vals[key] = int(value.strip().split()[0])
        total = vals.get("MemTotal", 0)
        avail = vals.get("MemAvailable", 0)
        return round((total - avail) * 100 / total) if total else 0
    except Exception:
        return 0

def uptime_seconds():
    try:
        return int(float(pathlib.Path("/proc/uptime").read_text().split()[0]))
    except Exception:
        return 0

containers = []
raw = run(["docker","ps","--format","{{.Names}}|{{.Image}}|{{.Status}}"])
for line in raw.splitlines():
    if not line.strip():
        continue
    parts = line.split("|", 2)
    if len(parts) != 3:
        continue
    name, image, status = parts
    lower_status = status.lower()
    checked = "(healthy)" in lower_status or "(unhealthy)" in lower_status
    containers.append({
        "name": name,
        "image": image,
        "status": status,
        "healthChecked": checked,
        "healthy": True if "(healthy)" in lower_status else (False if "(unhealthy)" in lower_status else None)
    })

db = {"connected": False, "engine": "", "version": "", "health": "unavailable", "service": "", "name": "", "container": ""}
for c in containers:
    if "postgres" in c["image"].lower():
        m = re.search(r"postgres:([0-9.]+)", c["image"], re.I)
        db_name = run(["docker","exec",c["name"],"sh","-lc","printenv POSTGRES_DB"])
        db.update({
            "connected": True,
            "engine": "PostgreSQL",
            "version": m.group(1) if m else "",
            "health": "healthy" if c["healthy"] else "running",
            "service": "Game Zone" if db_name == "gamezone" else "",
            "name": db_name,
            "container": c["name"]
        })
        break

domain_files = {}
for file in glob.glob("/etc/nginx/sites-enabled/*"):
    try:
        text = pathlib.Path(file).read_text()
    except Exception:
        continue
    redirect = "return 301 https://$host$request_uri" in text
    for block in re.findall(r"server_name\s+([^;]+);", text):
        for domain in block.split():
            domain = domain.strip()
            if not domain or domain in {"_", "localhost", "example.com"}:
                continue
            domain_files.setdefault(domain, {"domain": domain, "redirectHttps": False})
            domain_files[domain]["redirectHttps"] = domain_files[domain]["redirectHttps"] or redirect

items = []
redirects = []
for domain in sorted(domain_files):
    ssl = pathlib.Path(f"/etc/letsencrypt/live/{domain}/fullchain.pem").is_file()
    role = "Control Center" if domain == "panel.uchiha-builder.com" else ("Game Zone" if domain.startswith("gamezone.") else "")
    items.append({"domain": domain, "ssl": ssl, "role": role, "source": "nginx"})
    if domain_files[domain]["redirectHttps"]:
        redirects.append({"from": f"http://{domain}", "to": f"https://{domain}", "code": 301})

ns_lines = [x.rstrip(".") for x in run(["dig","+short","NS","uchiha-builder.com"]).splitlines() if re.fullmatch(r"[A-Za-z0-9.-]+\.", x)]
provider = "Cloudflare" if any("cloudflare.com" in x.lower() for x in ns_lines) else ("DNS" if ns_lines else "")

api_managed = False
env_file = pathlib.Path("/root/uchiha-control-center/current/.env")
if env_file.is_file():
    for line in env_file.read_text(errors="ignore").splitlines():
        if line.startswith("DNS_API_TOKEN=") and line.split("=",1)[1].strip():
            api_managed = True
            break

ips = run(["hostname","-I"]).split()
disk = shutil.disk_usage("/")
now = datetime.datetime.now(datetime.timezone.utc)
running = len(containers)
checked = sum(1 for x in containers if x["healthChecked"])
healthy = sum(1 for x in containers if x["healthy"] is True)
unhealthy = sum(1 for x in containers if x["healthy"] is False)
unchecked = running - checked
health_percent = round((healthy / checked) * 100, 1) if checked else None
memory_percent = mem_percent()
disk_percent = round(disk.used * 100 / disk.total) if disk.total else 0
load1 = round(os.getloadavg()[0], 2)

# Keep one real sample every five minutes, maximum 30 days.
history_rows = []
if HISTORY.exists():
    try:
        for line in HISTORY.read_text().splitlines():
            try:
                row = json.loads(line)
                if isinstance(row, dict) and row.get("at"):
                    history_rows.append(row)
            except Exception:
                pass
    except Exception:
        pass
last_ts = 0
if history_rows:
    try:
        last_ts = datetime.datetime.fromisoformat(history_rows[-1]["at"]).timestamp()
    except Exception:
        last_ts = 0
if now.timestamp() - last_ts >= 300:
    history_rows.append({
        "at": now.isoformat(),
        "healthPercent": health_percent,
        "memoryPercent": memory_percent,
        "diskPercent": disk_percent,
        "load1": load1,
        "containersRunning": running,
        "containersHealthy": healthy
    })
cutoff = now - datetime.timedelta(days=30)
history_rows = [r for r in history_rows if datetime.datetime.fromisoformat(r["at"]) >= cutoff]
HISTORY.write_text("\n".join(json.dumps(r,separators=(",",":")) for r in history_rows) + ("\n" if history_rows else ""))

# Aggregate daily values. Never backfill missing dates.
daily = {}
for row in history_rows:
    day = row["at"][:10]
    d = daily.setdefault(day, {"health": [], "memory": [], "disk": [], "load": [], "samples": 0})
    d["samples"] += 1
    if row.get("healthPercent") is not None: d["health"].append(float(row["healthPercent"]))
    if row.get("memoryPercent") is not None: d["memory"].append(float(row["memoryPercent"]))
    if row.get("diskPercent") is not None: d["disk"].append(float(row["diskPercent"]))
    if row.get("load1") is not None: d["load"].append(float(row["load1"]))
daily_rows = []
for day in sorted(daily):
    d = daily[day]
    avg = lambda xs: round(sum(xs)/len(xs),1) if xs else None
    daily_rows.append({
        "date": day,
        "samples": d["samples"],
        "healthPercent": avg(d["health"]),
        "memoryPercent": avg(d["memory"]),
        "diskPercent": avg(d["disk"]),
        "load1": avg(d["load"])
    })

data = {
    "ok": True,
    "generatedAt": now.isoformat(),
    "server": {
        "connected": True,
        "provider": "Hostfiley",
        "host": socket.gethostname(),
        "publicIp": ips[0] if ips else "",
        "health": "degraded" if unhealthy else ("healthy" if running else "unknown"),
        "healthPercent": health_percent,
        "memoryPercent": memory_percent,
        "diskPercent": disk_percent,
        "load1": load1,
        "uptimeSeconds": uptime_seconds(),
        "containersRunning": running,
        "containersHealthChecked": checked,
        "containersHealthy": healthy,
        "containersUnhealthy": unhealthy,
        "containersUnchecked": unchecked,
        "containers": containers
    },
    "database": db,
    "domains": {
        "detected": bool(items or ns_lines),
        "provider": provider,
        "apiManaged": api_managed,
        "rootDomain": "uchiha-builder.com" if ns_lines else "",
        "nameservers": ns_lines,
        "items": items,
        "redirects": redirects
    },
    "history": {
        "startedAt": history_rows[0]["at"] if history_rows else None,
        "sampleCount": len(history_rows),
        "daily": daily_rows,
        "recent": history_rows[-24:]
    }
}
tmp = OUT.with_suffix(".json.tmp")
tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",",":")))
os.chmod(tmp, 0o644)
tmp.replace(OUT)

[executed on device: vps307.hostfiley.net (87d4fe5e-f487-42d8-9e11-3c3246ef84fa)]