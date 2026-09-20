#!/usr/bin/env python3
import datetime as dt
import json
import os
import pathlib
import re
import subprocess
import time
import uuid

STATE_DIR = pathlib.Path("/var/lib/uchiha-telegram-control")
CATALOG_PATH = STATE_DIR / "project-catalog.json"

DEFAULT_PROJECTS = [
    {
        "id":"uchiha-control-center","name":"UCHIHA Control Center","type":"website",
        "client":"UCHIHA","repository":"yaminuchiha1245-png/UCHIHA","branch":"main",
        "domain":"panel.uchiha-builder.com","runtime":[{"kind":"docker","name":"uchiha-control-center"}],
        "monthlyFee":0,"currency":"USD","dueDay":1,"expiresAt":"","autoStop":False,
        "versions":[{"id":"seed-v6","version":"v6 executor","kind":"release","notes":"الإصدار الفعلي المسجل في Control Center","createdAt":"2026-09-20T00:00:00Z","source":"live-registry"}]
    },
    {
        "id":"game-zone","name":"Game Zone","type":"bundle",
        "client":"Game Zone","repository":"yaminuchiha1245-png/Uchiha-shop-bot","branch":"main",
        "domain":"gamezone.155-254-35-187.sslip.io",
        "runtime":[
            {"kind":"docker","name":"deploy-server-1"},
            {"kind":"docker","name":"deploy-bot-1"},
            {"kind":"docker","name":"deploy-admin-bot-1"}
        ],
        "monthlyFee":0,"currency":"USD","dueDay":1,"expiresAt":"","autoStop":False,
        "versions":[]
    },
    {
        "id":"uchiha-radius","name":"UCHIHA RADIUS","type":"app","client":"","repository":"","branch":"main","domain":"",
        "runtime":[],"monthlyFee":0,"currency":"USD","dueDay":1,"expiresAt":"","autoStop":False,"versions":[]
    },
    {
        "id":"uchiha-debt-store","name":"UCHIHA Debt Store","type":"app","client":"","repository":"","branch":"main","domain":"",
        "runtime":[],"monthlyFee":0,"currency":"USD","dueDay":1,"expiresAt":"","autoStop":False,"versions":[]
    },
    {
        "id":"uchiha-school","name":"UCHIHA School","type":"app","client":"","repository":"","branch":"main","domain":"",
        "runtime":[],"monthlyFee":0,"currency":"USD","dueDay":1,"expiresAt":"","autoStop":False,"versions":[]
    },
    {
        "id":"pharmacy-duty","name":"Pharmacy Duty","type":"website","client":"","repository":"","branch":"main","domain":"",
        "runtime":[],"monthlyFee":0,"currency":"USD","dueDay":1,"expiresAt":"","autoStop":False,"versions":[]
    },
    {
        "id":"game-zone-user-bot","name":"Game Zone User Bot","type":"bot","client":"Game Zone",
        "repository":"yaminuchiha1245-png/Uchiha-shop-bot","branch":"main","domain":"",
        "runtime":[{"kind":"docker","name":"deploy-bot-1"}],"monthlyFee":0,"currency":"USD","dueDay":1,"expiresAt":"","autoStop":False,"versions":[]
    },
    {
        "id":"game-zone-admin-bot","name":"Game Zone Admin Bot","type":"bot","client":"Game Zone",
        "repository":"yaminuchiha1245-png/Uchiha-shop-bot","branch":"main","domain":"",
        "runtime":[{"kind":"docker","name":"deploy-admin-bot-1"}],"monthlyFee":0,"currency":"USD","dueDay":1,"expiresAt":"","autoStop":False,"versions":[]
    },
    {
        "id":"game-zone-api","name":"Game Zone API / Web","type":"website","client":"Game Zone",
        "repository":"yaminuchiha1245-png/Uchiha-shop-bot","branch":"main","domain":"gamezone.155-254-35-187.sslip.io",
        "runtime":[{"kind":"docker","name":"deploy-server-1"}],"monthlyFee":0,"currency":"USD","dueDay":1,"expiresAt":"","autoStop":False,"versions":[]
    }
]

VALID_TYPES={"app","website","bot","bundle","service"}
VALID_RUNTIME={"docker","systemd"}

def now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00","Z")

def atomic_write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    os.chmod(tmp,0o600)
    tmp.replace(path)
    os.chmod(path,0o600)

def _normalize(item):
    item=dict(item or {})
    item["id"]=str(item.get("id","")).strip().lower()
    item["name"]=str(item.get("name","")).strip()
    item["type"]=str(item.get("type","service")).strip().lower()
    if item["type"] not in VALID_TYPES: item["type"]="service"
    item["client"]=str(item.get("client","")).strip()
    item["repository"]=str(item.get("repository","")).strip()
    item["branch"]=str(item.get("branch","main")).strip() or "main"
    item["domain"]=str(item.get("domain","")).strip().lower()
    try: item["monthlyFee"]=max(0,float(item.get("monthlyFee") or 0))
    except Exception: item["monthlyFee"]=0
    item["currency"]=str(item.get("currency","USD")).strip().upper()[:12] or "USD"
    try: item["dueDay"]=max(1,min(28,int(item.get("dueDay") or 1)))
    except Exception: item["dueDay"]=1
    item["expiresAt"]=str(item.get("expiresAt","")).strip()
    item["autoStop"]=bool(item.get("autoStop",False))
    item["lastPaidAt"]=str(item.get("lastPaidAt","")).strip()
    payments=[]
    for x in item.get("payments",[]) or []:
        if not isinstance(x,dict): continue
        try: amount=max(0,float(x.get("amount") or 0))
        except Exception: amount=0
        payments.append({
            "id":str(x.get("id") or uuid.uuid4()),
            "amount":amount,
            "currency":str(x.get("currency") or item["currency"]).upper()[:12],
            "at":str(x.get("at") or now_iso()),
            "note":str(x.get("note") or "")[:500]
        })
    item["payments"]=payments[-120:]
    item["notes"]=str(item.get("notes","")).strip()[:2000]
    runtime=[]
    for r in item.get("runtime",[]) or []:
        if not isinstance(r,dict): continue
        kind=str(r.get("kind","")).strip().lower()
        name=str(r.get("name","")).strip()
        if kind in VALID_RUNTIME and re.fullmatch(r"[A-Za-z0-9_.@-]{1,160}",name):
            runtime.append({"kind":kind,"name":name})
    item["runtime"]=runtime[:30]
    versions=[]
    for v in item.get("versions",[]) or []:
        if not isinstance(v,dict): continue
        version=str(v.get("version","")).strip()
        if not version: continue
        versions.append({
            "id":str(v.get("id") or uuid.uuid4()),
            "version":version[:120],
            "kind":str(v.get("kind","update"))[:40],
            "notes":str(v.get("notes",""))[:4000],
            "createdAt":str(v.get("createdAt") or now_iso()),
            "source":str(v.get("source","manual"))[:80]
        })
    item["versions"]=versions[-300:]
    item["updatedAt"]=str(item.get("updatedAt") or now_iso())
    return item

def load_catalog():
    if not CATALOG_PATH.exists():
        data={"schema":1,"updatedAt":now_iso(),"projects":[_normalize(x) for x in DEFAULT_PROJECTS]}
        atomic_write(CATALOG_PATH,data)
        return data
    try:
        data=json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except Exception:
        data={"schema":1,"updatedAt":now_iso(),"projects":[]}
    projects=[]
    seen=set()
    for item in data.get("projects",[]) if isinstance(data,dict) else []:
        p=_normalize(item)
        if p["id"] and p["id"] not in seen:
            seen.add(p["id"]); projects.append(p)
    return {"schema":1,"updatedAt":str(data.get("updatedAt") or now_iso()),"projects":projects}

def save_catalog(data):
    clean={"schema":1,"updatedAt":now_iso(),"projects":[_normalize(x) for x in data.get("projects",[])]}
    atomic_write(CATALOG_PATH,clean)
    return clean

def catalog():
    data=load_catalog()
    return [project_view(p) for p in data["projects"]]

def get_project(project_id):
    pid=str(project_id or "").strip().lower()
    for p in load_catalog()["projects"]:
        if p["id"]==pid: return p
    return None

def runtime_state(runtime):
    rows=[]
    for r in runtime or []:
        kind,name=r["kind"],r["name"]
        active=False; status="unknown"
        try:
            if kind=="docker":
                p=subprocess.run(["docker","inspect","-f","{{.State.Status}}",name],capture_output=True,text=True,timeout=8)
                status=p.stdout.strip() if p.returncode==0 else "missing"
                active=status=="running"
            else:
                p=subprocess.run(["systemctl","is-active",name],capture_output=True,text=True,timeout=8)
                status=p.stdout.strip() or "unknown"
                active=status=="active"
        except Exception:
            status="error"
        rows.append({"kind":kind,"name":name,"active":active,"status":status})
    return rows

def project_view(p):
    p=_normalize(p)
    states=runtime_state(p["runtime"])
    if not states: live="unlinked"
    elif all(x["active"] for x in states): live="online"
    elif any(x["active"] for x in states): live="partial"
    else: live="offline"
    currentVersion=p["versions"][-1]["version"] if p["versions"] else ""
    return {**p,"runtimeState":states,"liveStatus":live,"currentVersion":currentVersion,"billing":billing_view(p)}

def billing_view(p):
    fee=float(p.get("monthlyFee") or 0)
    due=int(p.get("dueDay") or 1)
    now=dt.datetime.now(dt.timezone.utc)
    y,m=now.year,now.month
    due_dt=dt.datetime(y,m,due,tzinfo=dt.timezone.utc)
    last=None
    raw=str(p.get("lastPaidAt") or "")
    if raw:
        try: last=dt.datetime.fromisoformat(raw.replace("Z","+00:00"))
        except Exception: last=None
    paid_this_month=bool(last and last.year==y and last.month==m)
    return {
        "monthlyFee":fee,"currency":p.get("currency","USD"),"dueDay":due,
        "dueAt":due_dt.isoformat().replace("+00:00","Z"),
        "paidThisMonth":paid_this_month,
        "overdue":bool(fee>0 and now>=due_dt and not paid_this_month),
        "lastPaidAt":raw
    }

def _available_runtime():
    found={"docker":set(),"systemd":set()}
    try:
        p=subprocess.run(["docker","ps","-a","--format","{{.Names}}"],capture_output=True,text=True,timeout=10)
        if p.returncode==0:
            found["docker"]={x.strip() for x in p.stdout.splitlines() if x.strip()}
    except Exception: pass
    try:
        p=subprocess.run(["systemctl","list-unit-files","--type=service","--no-legend","--no-pager"],capture_output=True,text=True,timeout=12)
        if p.returncode==0:
            for line in p.stdout.splitlines():
                name=line.split()[0] if line.split() else ""
                if name: found["systemd"].add(name)
    except Exception: pass
    return found

def available_runtime_targets():
    found=_available_runtime()
    return {
        "docker": sorted(found.get("docker",set())),
        "systemd": sorted(x for x in found.get("systemd",set()) if x.endswith(".service"))
    }

def _validate_runtime_payload(runtime):
    if runtime is None: return
    available=_available_runtime()
    for r in runtime or []:
        if not isinstance(r,dict): raise ValueError("invalid_runtime")
        kind=str(r.get("kind","")).strip().lower()
        name=str(r.get("name","")).strip()
        if kind not in VALID_RUNTIME or not re.fullmatch(r"[A-Za-z0-9_.@-]{1,160}",name):
            raise ValueError("invalid_runtime")
        if name not in available.get(kind,set()):
            raise ValueError("runtime_not_found")

def upsert_project(payload):
    pid=str(payload.get("id","")).strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,63}",pid): raise ValueError("invalid_project_id")
    name=str(payload.get("name","")).strip()
    if not name: raise ValueError("name_required")
    if "runtime" in payload:
        _validate_runtime_payload(payload.get("runtime"))
    data=load_catalog()
    existing=next((x for x in data["projects"] if x["id"]==pid),None)
    if existing:
        keep_versions=existing.get("versions",[])
        keep_runtime=existing.get("runtime",[])
        existing.update({k:v for k,v in payload.items() if k not in ("versions",)})
        if "runtime" not in payload: existing["runtime"]=keep_runtime
        existing["versions"]=keep_versions
        existing["updatedAt"]=now_iso()
    else:
        item=dict(payload); item["versions"]=[]; item["updatedAt"]=now_iso(); data["projects"].append(item)
    save_catalog(data)
    return project_view(get_project(pid))

def delete_project(project_id):
    pid=str(project_id or "").strip().lower()
    data=load_catalog()
    before=len(data["projects"])
    data["projects"]=[x for x in data["projects"] if x["id"]!=pid]
    if len(data["projects"])==before:
        raise ValueError("project_not_found")
    save_catalog(data)
    return True

def update_billing(project_id,payload):
    data=load_catalog(); p=next((x for x in data["projects"] if x["id"]==str(project_id).lower()),None)
    if not p: raise ValueError("project_not_found")
    for k in ("monthlyFee","currency","dueDay","client","notes"):
        if k in payload: p[k]=payload[k]
    p["updatedAt"]=now_iso(); save_catalog(data); return project_view(get_project(p["id"]))

def set_timer(project_id,expires_at,auto_stop=True):
    data=load_catalog(); p=next((x for x in data["projects"] if x["id"]==str(project_id).lower()),None)
    if not p: raise ValueError("project_not_found")
    raw=str(expires_at or "").strip()
    if raw:
        try:
            parsed=dt.datetime.fromisoformat(raw.replace("Z","+00:00"))
            if parsed.tzinfo is None: parsed=parsed.replace(tzinfo=dt.timezone.utc)
            raw=parsed.astimezone(dt.timezone.utc).isoformat().replace("+00:00","Z")
        except Exception: raise ValueError("invalid_expiry")
    p["expiresAt"]=raw; p["autoStop"]=bool(auto_stop); p["updatedAt"]=now_iso()
    save_catalog(data); return project_view(get_project(p["id"]))

def mark_paid(project_id,at=None):
    data=load_catalog(); p=next((x for x in data["projects"] if x["id"]==str(project_id).lower()),None)
    if not p: raise ValueError("project_not_found")
    paid_at=str(at or now_iso())
    p["lastPaidAt"]=paid_at
    p.setdefault("payments",[]).append({
        "id":str(uuid.uuid4()),
        "amount":float(p.get("monthlyFee") or 0),
        "currency":str(p.get("currency") or "USD"),
        "at":paid_at,
        "note":"monthly-payment"
    })
    p["payments"]=p["payments"][-120:]
    p["updatedAt"]=now_iso(); save_catalog(data)
    return project_view(get_project(p["id"]))

def renew_project(project_id,days=30):
    data=load_catalog(); p=next((x for x in data["projects"] if x["id"]==str(project_id).lower()),None)
    if not p: raise ValueError("project_not_found")
    try: days=max(1,min(366,int(days or 30)))
    except Exception: days=30
    now=dt.datetime.now(dt.timezone.utc)
    base=now
    raw=str(p.get("expiresAt") or "")
    if raw:
        try:
            current=dt.datetime.fromisoformat(raw.replace("Z","+00:00"))
            if current.tzinfo is None: current=current.replace(tzinfo=dt.timezone.utc)
            if current>now: base=current
        except Exception: pass
    paid_at=now_iso()
    p["lastPaidAt"]=paid_at
    p.setdefault("payments",[]).append({
        "id":str(uuid.uuid4()),"amount":float(p.get("monthlyFee") or 0),
        "currency":str(p.get("currency") or "USD"),"at":paid_at,"note":f"renew-{days}-days"
    })
    p["payments"]=p["payments"][-120:]
    p["expiresAt"]=(base+dt.timedelta(days=days)).astimezone(dt.timezone.utc).isoformat().replace("+00:00","Z")
    p["autoStop"]=True
    p.pop("timerTriggeredAt",None)
    p["updatedAt"]=now_iso()
    save_catalog(data)
    return project_view(get_project(p["id"]))

def add_version(project_id,version,notes="",kind="update"):
    data=load_catalog(); p=next((x for x in data["projects"] if x["id"]==str(project_id).lower()),None)
    if not p: raise ValueError("project_not_found")
    version=str(version or "").strip()
    if not version: raise ValueError("version_required")
    p.setdefault("versions",[]).append({"id":str(uuid.uuid4()),"version":version[:120],"kind":str(kind or "update")[:40],"notes":str(notes or "")[:4000],"createdAt":now_iso(),"source":"manual"})
    p["updatedAt"]=now_iso(); save_catalog(data); return project_view(get_project(p["id"]))

def _act_runtime(p,action):
    runtime=p.get("runtime",[])
    if not runtime: raise ValueError("project_runtime_unlinked")
    seq=list(runtime) if action=="start" else list(reversed(runtime))
    results=[]
    for r in seq:
        kind,name=r["kind"],r["name"]
        if kind=="docker":
            cmd=["docker",action,name]
        else:
            cmd=["systemctl",action,name]
        try:
            x=subprocess.run(cmd,capture_output=True,text=True,timeout=90,check=False)
            results.append({"kind":kind,"name":name,"ok":x.returncode==0,"output":(x.stdout or x.stderr).strip()[-500:]})
            if x.returncode!=0: raise RuntimeError("runtime_action_failed")
        except Exception:
            raise RuntimeError("runtime_action_failed")
    return results

def start_project(project_id):
    p=get_project(project_id)
    if not p: raise ValueError("project_not_found")
    result=_act_runtime(p,"start")
    return {"project":project_view(p),"result":result}

def stop_project(project_id,reason="manual"):
    p=get_project(project_id)
    if not p: raise ValueError("project_not_found")
    result=_act_runtime(p,"stop")
    return {"project":project_view(p),"result":result,"reason":reason}

def enforce_timers():
    data=load_catalog(); changed=False; events=[]; now=dt.datetime.now(dt.timezone.utc)
    for p in data["projects"]:
        raw=str(p.get("expiresAt") or "")
        if not raw or not p.get("autoStop"): continue
        try: when=dt.datetime.fromisoformat(raw.replace("Z","+00:00"))
        except Exception: continue
        if when.tzinfo is None: when=when.replace(tzinfo=dt.timezone.utc)
        if now<when or p.get("timerTriggeredAt"): continue
        try:
            result=_act_runtime(p,"stop")
            p["timerTriggeredAt"]=now_iso(); p["updatedAt"]=now_iso(); changed=True
            events.append({"projectId":p["id"],"name":p["name"],"ok":True,"at":p["timerTriggeredAt"],"result":result})
        except Exception as exc:
            p["timerLastErrorAt"]=now_iso(); p["timerLastError"]=type(exc).__name__; changed=True
            events.append({"projectId":p["id"],"name":p["name"],"ok":False,"at":p["timerLastErrorAt"]})
    if changed: save_catalog(data)
    return events

def billing_alerts():
    rows=[]
    for p in load_catalog()["projects"]:
        b=billing_view(p)
        if b["overdue"]:
            rows.append({"projectId":p["id"],"name":p["name"],"client":p.get("client",""),"monthlyFee":b["monthlyFee"],"currency":b["currency"],"dueAt":b["dueAt"]})
    return rows