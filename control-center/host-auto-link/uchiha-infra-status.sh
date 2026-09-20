[Reading 133 lines from start (total: 133 lines, 0 remaining)]

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

OUT = pathlib.Path("/var/www/uchiha-infra/status.json")
OUT.parent.mkdir(parents=True, exist_ok=True)

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

containers = []
raw = run(["docker","ps","--format","{{.Names}}|{{.Image}}|{{.Status}}"])
for line in raw.splitlines():
    if not line.strip():
        continue
    parts = line.split("|", 2)
    if len(parts) != 3:
        continue
    name, image, status = parts
    containers.append({
        "name": name,
        "image": image,
        "status": status,
        "healthy": "healthy" in status.lower()
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
    row = {"domain": domain, "ssl": ssl, "role": role, "source": "nginx"}
    items.append(row)
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
data = {
    "ok": True,
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "server": {
        "connected": True,
        "provider": "Hostfiley",
        "host": socket.gethostname(),
        "publicIp": ips[0] if ips else "",
        "health": "healthy",
        "memoryPercent": mem_percent(),
        "diskPercent": round(disk.used * 100 / disk.total) if disk.total else 0,
        "load1": round(os.getloadavg()[0], 2),
        "containersRunning": len(containers),
        "containersHealthy": sum(1 for x in containers if x["healthy"]),
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
    }
}
tmp = OUT.with_suffix(".json.tmp")
tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",",":")))
os.chmod(tmp, 0o644)
tmp.replace(OUT)

[executed on device: vps307.hostfiley.net (87d4fe5e-f487-42d8-9e11-3c3246ef84fa)]