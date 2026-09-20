#!/usr/bin/env python3
import html
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, "/opt/uchiha/telegram-control")
from common import infra, projects, secret_index, approvals, audit_events, is_admin, claim_admin

TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN","").strip()
WEBAPP_URL = os.environ.get("TELEGRAM_WEBAPP_URL","https://panel.uchiha-builder.com/telegram-control/").strip()
API = f"https://api.telegram.org/bot{TOKEN}" if TOKEN else ""

def tg(method, payload=None, timeout=35):
    if not TOKEN:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")
    data = urllib.parse.urlencode(payload or {}).encode()
    req = urllib.request.Request(f"{API}/{method}", data=data)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        body = json.loads(res.read().decode())
    if not body.get("ok"):
        raise RuntimeError(body.get("description","Telegram API error"))
    return body.get("result")

def keyboard(rows):
    return json.dumps({"inline_keyboard":rows},ensure_ascii=False,separators=(",",":"))

def main_keyboard():
    return keyboard([
        [{"text":"🏠 الرئيسية","callback_data":"home"},{"text":"📦 المشاريع","callback_data":"projects"}],
        [{"text":"🔐 الأسرار","callback_data":"secrets"},{"text":"🖥 الخوادم","callback_data":"servers"}],
        [{"text":"🗄 قاعدة البيانات","callback_data":"database"},{"text":"🌐 الدومينات","callback_data":"domains"}],
        [{"text":"📊 التقارير","callback_data":"reports"},{"text":"✅ الموافقات","callback_data":"approvals"}],
        [{"text":"🧾 سجل التدقيق","callback_data":"audit"},{"text":"⚙️ الإعدادات","callback_data":"settings"}],
        [{"text":"🚀 فتح لوحة UCHIHA الكاملة","web_app":{"url":WEBAPP_URL}}]
    ])

def back_keyboard():
    return keyboard([
        [{"text":"↩️ الرئيسية","callback_data":"home"}],
        [{"text":"🚀 فتح اللوحة الكاملة","web_app":{"url":WEBAPP_URL}}]
    ])

def e(v):
    return html.escape(str(v if v not in (None,"") else "—"))

def status_icon(value):
    v=str(value or "").lower()
    if v in ("healthy","online","connected","ok","سليم"): return "🟢"
    if v in ("degraded","warning","running"): return "🟡"
    if v in ("down","offline","failed","unhealthy"): return "🔴"
    return "⚪️"

def home_text():
    x=infra()
    s=x.get("server",{})
    db=x.get("database",{})
    dom=x.get("domains",{})
    ps=projects()
    sec=secret_index()
    hist=x.get("history",{})
    return (
        "<b>UCHIHA Control Center</b>\n"
        "لوحة الإدارة المركزية عبر Telegram\n\n"
        f"{status_icon(s.get('health'))} <b>السيرفر:</b> {e(s.get('health'))}\n"
        f"🧠 RAM: <b>{e(s.get('memoryPercent'))}%</b> · 💾 Disk: <b>{e(s.get('diskPercent'))}%</b>\n"
        f"📦 الحاويات: <b>{e(s.get('containersRunning'))}</b> · سليمة: <b>{e(s.get('containersHealthy'))}</b>\n"
        f"🗄 PostgreSQL: <b>{e(db.get('health'))}</b> · {e(db.get('name'))}\n"
        f"🌐 الدومينات المكتشفة: <b>{len(dom.get('items',[]))}</b>\n"
        f"📦 المشاريع: <b>{len(ps)}</b>\n"
        f"🔐 ملفات الأسرار: <b>{len(sec)}</b>\n"
        f"📊 عينات التقرير: <b>{e(hist.get('sampleCount',0))}</b>\n\n"
        "<i>كل الأرقام من المصادر الفعلية فقط.</i>"
    )

def projects_text():
    rows=projects()
    if not rows:
        return "<b>📦 المشاريع</b>\n\nلا توجد مشاريع مسجلة حاليًا."
    out=["<b>📦 المشاريع الفعلية</b>",""]
    for p in rows[:30]:
        out.append(
            f"{status_icon(p.get('status'))} <b>{e(p.get('name'))}</b>\n"
            f"ID: <code>{e(p.get('id'))}</code>\n"
            f"الحالة: {e(p.get('statusLabel') or p.get('status'))} · البيئة: {e(p.get('environment'))}\n"
            f"الدومين: {e(p.get('domain'))}\n"
            f"الإصدار: {e(p.get('release'))}\n"
        )
    return "\n".join(out)[:3900]

def secrets_text():
    rows=secret_index()
    out=["<b>🔐 أسرار المشاريع</b>",""]
    if not rows:
        out.append("لا توجد أسرار محفوظة على خادم Control Center حاليًا.")
    for row in rows:
        out.append(f"<b>{e(row.get('projectId'))}</b> — {row.get('count',0)} مفتاح")
        for key in row.get("keys",[])[:40]:
            out.append(f"• <code>{e(key)}</code> = •••••••• ✅")
        out.append("")
    out.append("🔒 <i>Telegram لا يعرض القيمة السرية نفسها. من اللوحة الكاملة يمكنك إضافة/استبدال/حذف السر بشكل Write-only.</i>")
    return "\n".join(out)[:3900]

def servers_text():
    s=infra().get("server",{})
    out=[
        "<b>🖥 حالة السيرفر</b>","",
        f"المزود: <b>{e(s.get('provider'))}</b>",
        f"Host: <code>{e(s.get('host'))}</code>",
        f"IP: <code>{e(s.get('publicIp'))}</code>",
        f"الحالة: {status_icon(s.get('health'))} <b>{e(s.get('health'))}</b>",
        f"RAM: <b>{e(s.get('memoryPercent'))}%</b>",
        f"Disk: <b>{e(s.get('diskPercent'))}%</b>",
        f"Load 1m: <b>{e(s.get('load1'))}</b>",
        f"الحاويات: <b>{e(s.get('containersRunning'))}</b>",
        f"Health Checked: <b>{e(s.get('containersHealthChecked'))}</b>",
        f"Healthy: <b>{e(s.get('containersHealthy'))}</b>",
        f"Unhealthy: <b>{e(s.get('containersUnhealthy'))}</b>",
        f"Unchecked: <b>{e(s.get('containersUnchecked'))}</b>","",
        "<b>الخدمات:</b>"
    ]
    for c in s.get("containers",[])[:30]:
        mark="🟢" if c.get("healthy") is True else ("🔴" if c.get("healthy") is False else "⚪️")
        out.append(f"{mark} <code>{e(c.get('name'))}</code> — {e(c.get('status'))}")
    return "\n".join(out)[:3900]

def database_text():
    d=infra().get("database",{})
    return (
        "<b>🗄 قاعدة البيانات</b>\n\n"
        f"متصلة: <b>{'نعم ✅' if d.get('connected') else 'لا'}</b>\n"
        f"المحرك: <b>{e(d.get('engine'))}</b>\n"
        f"الإصدار: <b>{e(d.get('version'))}</b>\n"
        f"الحالة: {status_icon(d.get('health'))} <b>{e(d.get('health'))}</b>\n"
        f"قاعدة البيانات: <code>{e(d.get('name'))}</code>\n"
        f"الخدمة: {e(d.get('service'))}\n"
        f"Container: <code>{e(d.get('container'))}</code>"
    )

def domains_text():
    d=infra().get("domains",{})
    out=[
        "<b>🌐 الدومينات و DNS</b>","",
        f"المزود: <b>{e(d.get('provider'))}</b>",
        f"إدارة API: <b>{'مفعلة ✅' if d.get('apiManaged') else 'غير مفعلة'}</b>",
        f"Root: <code>{e(d.get('rootDomain'))}</code>","",
        "<b>Nameservers:</b>"
    ]
    for ns in d.get("nameservers",[]):
        out.append(f"• <code>{e(ns)}</code>")
    out.append("\n<b>الدومينات المكتشفة:</b>")
    for row in d.get("items",[]):
        out.append(f"{'🔒' if row.get('ssl') else '⚪️'} <code>{e(row.get('domain'))}</code> — {e(row.get('role'))}")
    if d.get("redirects"):
        out.append("\n<b>Redirects:</b>")
        for x in d.get("redirects",[])[:20]:
            out.append(f"• {e(x.get('code'))}: <code>{e(x.get('from'))}</code> → <code>{e(x.get('to'))}</code>")
    return "\n".join(out)[:3900]

def reports_text():
    x=infra()
    h=x.get("history",{})
    s=x.get("server",{})
    out=[
        "<b>📊 التقارير والإحصائيات</b>","",
        f"بدأ جمع التاريخ: <code>{e(h.get('startedAt'))}</code>",
        f"عدد العينات: <b>{e(h.get('sampleCount',0))}</b>",
        f"الحالة الحالية: {status_icon(s.get('health'))} <b>{e(s.get('health'))}</b>",
        f"Health checks: <b>{e(s.get('healthPercent'))}%</b>",
        f"RAM: <b>{e(s.get('memoryPercent'))}%</b> · Disk: <b>{e(s.get('diskPercent'))}%</b> · Load: <b>{e(s.get('load1'))}</b>","",
        "<b>الأيام المتاحة فعليًا:</b>"
    ]
    daily=h.get("daily",[])
    if not daily:
        out.append("لا يوجد تاريخ كافٍ بعد.")
    for d in daily[-14:]:
        out.append(
            f"• <code>{e(d.get('date'))}</code> — Health {e(d.get('healthPercent'))}% · "
            f"RAM {e(d.get('memoryPercent'))}% · Disk {e(d.get('diskPercent'))}% · samples {e(d.get('samples'))}"
        )
    out.append("\n<i>لا يتم توليد أيام أو نسب غير موجودة فعليًا.</i>")
    return "\n".join(out)[:3900]

def approvals_text():
    rows=approvals()
    out=["<b>✅ الموافقات</b>",""]
    if not rows:
        out.append("لا توجد موافقات مسجلة.")
    for x in rows[-20:]:
        out.append(
            f"• <b>{e(x.get('title'))}</b>\n"
            f"الحالة: {e(x.get('status'))} · الإجراء: {e(x.get('action'))}\n"
            f"المشروع: {e(x.get('project'))} · {e(x.get('createdAt'))}\n"
        )
    return "\n".join(out)[:3900]

def audit_text():
    rows=audit_events(20)
    out=["<b>🧾 سجل التدقيق</b>",""]
    if not rows:
        out.append("لا توجد أحداث تدقيق.")
    for x in reversed(rows):
        out.append(f"• <code>{e(x.get('at'))}</code> — <b>{e(x.get('type'))}</b> · {e(x.get('source'))}")
    return "\n".join(out)[:3900]

def settings_text():
    return (
        "<b>⚙️ إعدادات بوت UCHIHA</b>\n\n"
        "• الوصول محصور بمديري Telegram المعتمدين.\n"
        "• Mini App يتحقق من Telegram initData بالتوقيع.\n"
        "• قيم الأسرار لا تُرسل في رسائل Telegram.\n"
        "• إضافة/استبدال الأسرار تتم Write-only من اللوحة الكاملة.\n"
        "• البيانات الوهمية غير مسموحة؛ أي مصدر غير مربوط يظهر كغير متاح.\n"
        "• البيانات الحساسة ومفاتيح التوقيع لا تُخزن داخل المحادثات."
    )

SCREENS={
    "home":(home_text,main_keyboard),
    "projects":(projects_text,back_keyboard),
    "secrets":(secrets_text,back_keyboard),
    "servers":(servers_text,back_keyboard),
    "database":(database_text,back_keyboard),
    "domains":(domains_text,back_keyboard),
    "reports":(reports_text,back_keyboard),
    "approvals":(approvals_text,back_keyboard),
    "audit":(audit_text,back_keyboard),
    "settings":(settings_text,back_keyboard)
}

def send_screen(chat_id, screen, message_id=None):
    fn,kb=SCREENS.get(screen,SCREENS["home"])
    payload={"chat_id":chat_id,"text":fn(),"parse_mode":"HTML","reply_markup":kb()}
    if message_id:
        payload["message_id"]=message_id
        try: return tg("editMessageText",payload)
        except Exception: pass
    return tg("sendMessage",payload)

def handle_message(msg):
    chat=msg.get("chat",{})
    if chat.get("type") != "private":
        return
    chat_id=chat.get("id")
    user=msg.get("from",{})
    user_id=user.get("id")
    text=str(msg.get("text","")).strip()
    if text.startswith("/claim"):
        parts=text.split(maxsplit=1)
        if len(parts)<2:
            return tg("sendMessage",{"chat_id":chat_id,"text":"أرسل: <code>/claim CODE</code>","parse_mode":"HTML"})
        ok,reason=claim_admin(user_id,parts[1])
        if ok:
            return send_screen(chat_id,"home")
        return tg("sendMessage",{"chat_id":chat_id,"text":f"تعذر التفعيل: <code>{e(reason)}</code>","parse_mode":"HTML"})
    if not is_admin(user_id):
        return tg("sendMessage",{"chat_id":chat_id,"text":"⛔ هذا البوت خاص بإدارة UCHIHA. حسابك غير معتمد."})
    if text in ("/start","/menu","/home",""):
        return send_screen(chat_id,"home")
    if text=="/projects": return send_screen(chat_id,"projects")
    if text=="/secrets": return send_screen(chat_id,"secrets")
    if text=="/server": return send_screen(chat_id,"servers")
    if text=="/domains": return send_screen(chat_id,"domains")
    if text=="/reports": return send_screen(chat_id,"reports")
    return send_screen(chat_id,"home")

def handle_callback(q):
    qid=q.get("id")
    user=q.get("from",{})
    if not is_admin(user.get("id")):
        return tg("answerCallbackQuery",{"callback_query_id":qid,"text":"غير مصرح","show_alert":"true"})
    data=q.get("data","home")
    msg=q.get("message",{})
    chat_id=(msg.get("chat") or {}).get("id")
    mid=msg.get("message_id")
    tg("answerCallbackQuery",{"callback_query_id":qid})
    return send_screen(chat_id,data,mid)

def configure():
    try:
        tg("setMyCommands",{"commands":json.dumps([
            {"command":"start","description":"فتح لوحة UCHIHA"},
            {"command":"projects","description":"المشاريع"},
            {"command":"secrets","description":"الأسرار"},
            {"command":"server","description":"حالة السيرفر"},
            {"command":"domains","description":"الدومينات"},
            {"command":"reports","description":"التقارير"}
        ],ensure_ascii=False)})
    except Exception:
        pass

def main():
    if not TOKEN:
        print("TELEGRAM_BOT_TOKEN is not configured",file=sys.stderr)
        return 2
    configure()
    offset=0
    while True:
        try:
            updates=tg("getUpdates",{"timeout":30,"offset":offset,"allowed_updates":json.dumps(["message","callback_query"])},timeout=40)
            for u in updates or []:
                offset=max(offset,int(u.get("update_id",0))+1)
                try:
                    if "message" in u: handle_message(u["message"])
                    elif "callback_query" in u: handle_callback(u["callback_query"])
                except Exception as inner:
                    print("update error",type(inner).__name__,file=sys.stderr)
        except urllib.error.HTTPError as ex:
            print("telegram http",ex.code,file=sys.stderr); time.sleep(5)
        except Exception as ex:
            print("telegram error",type(ex).__name__,file=sys.stderr); time.sleep(5)

if __name__=="__main__":
    raise SystemExit(main())