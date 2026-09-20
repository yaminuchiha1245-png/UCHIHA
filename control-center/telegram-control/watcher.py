#!/usr/bin/env python3
import hashlib
import json
import pathlib
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, "/opt/uchiha/telegram-control")
from common import bot_token, admin_ids, current_alerts
from project_manager import enforce_timers, billing_alerts

STATE = pathlib.Path("/var/lib/uchiha-telegram-control/alert-state.json")

def send(chat_id, text):
    token = bot_token()
    if not token:
        return False
    payload = urllib.parse.urlencode({
        "chat_id": str(chat_id),
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": "true"
    }).encode()
    try:
        with urllib.request.urlopen(
            urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=payload),
            timeout=10
        ) as res:
            body = json.loads(res.read().decode())
        return bool(body.get("ok"))
    except Exception:
        return False

def load_state():
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except Exception:
        return {"fingerprint":"","hadIssues":False}

def save_state(data):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",",":")), encoding="utf-8")
    tmp.chmod(0o600)
    tmp.replace(STATE)

def main():
    admins = sorted(admin_ids())
    if not admins:
        return 0
    previous = load_state()

    timer_events = enforce_timers()
    for event in timer_events:
        if event.get("ok"):
            msg = f"⏱ <b>تم إطفاء المشروع تلقائيًا</b>\n{event.get('name','')}\nالسبب: انتهاء المؤقت."
        else:
            msg = f"⚠️ <b>تعذر تنفيذ مؤقت المشروع</b>\n{event.get('name','')}\nراجع /projects و /ops."
        for admin in admins:
            send(admin, msg)

    alerts = current_alerts()
    billing = billing_alerts()
    serial = json.dumps({"alerts":alerts,"billing":billing}, ensure_ascii=False, sort_keys=True, separators=(",",":"))
    fingerprint = hashlib.sha256(serial.encode()).hexdigest()

    if alerts and fingerprint != previous.get("fingerprint"):
        lines = ["<b>🚨 تنبيه UCHIHA</b>", ""]
        for x in alerts:
            icon = "🔴" if x.get("level") == "critical" else "🟡"
            lines.append(f"{icon} <b>{x.get('title','')}</b> — {x.get('detail','')}")
        lines.append("\nافتح /alerts أو /ops للتفاصيل.")
        msg = "\n".join(lines)
        for admin in admins:
            send(admin, msg)
    elif not alerts and previous.get("hadIssues"):
        for admin in admins:
            send(admin, "✅ <b>UCHIHA</b>\nتمت استعادة الحالة الطبيعية ولم تعد هناك تنبيهات تقنية نشطة.")

    billing_fp = hashlib.sha256(json.dumps(billing,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
    if billing and billing_fp != previous.get("billingFingerprint"):
        lines=["<b>💰 مستحقات شهرية</b>",""]
        for row in billing[:20]:
            lines.append(f"• <b>{row.get('name','')}</b> — {row.get('monthlyFee')} {row.get('currency')}\n  العميل: {row.get('client') or '—'}")
        lines.append("\nافتح قسم المشاريع لتسجيل الدفعة.")
        for admin in admins:
            send(admin,"\n".join(lines))

    save_state({
        "fingerprint":fingerprint,
        "billingFingerprint":billing_fp,
        "hadIssues":bool(alerts),
        "hadBilling":bool(billing)
    })
    return 0

if __name__ == "__main__":
    raise SystemExit(main())