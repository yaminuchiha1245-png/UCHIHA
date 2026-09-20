#!/usr/bin/env python3
import html
import json
import os
import sys
import time
import datetime as dt
import pathlib
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, "/opt/uchiha/telegram-control")
from common import (
    infra, projects, github_repositories, secret_index, approvals, audit_events,
    is_admin, claim_admin, bot_token, operational_state, restart_container,
    restart_nginx, refresh_infrastructure, create_database_backup, list_backups,
    safe_container_logs, database_stats, current_alerts, put_secret, delete_secret
)
from project_manager import (
    catalog as managed_catalog, get_project as get_managed_project,
    start_project as start_managed_project, stop_project as stop_managed_project,
    mark_paid as mark_managed_paid, renew_project as renew_managed_project,
    upsert_project as upsert_managed_project, update_billing as update_managed_billing,
    set_timer as set_managed_timer, add_version as add_managed_version,
    available_runtime_targets, delete_project as delete_managed_project
)

TOKEN = bot_token()
WEBAPP_URL = os.environ.get("TELEGRAM_WEBAPP_URL","https://panel.uchiha-builder.com/telegram-control/").strip()
API = f"https://api.telegram.org/bot{TOKEN}" if TOKEN else ""
SESSION_PATH = pathlib.Path("/var/lib/uchiha-telegram-control/bot-sessions.json")

def _load_sessions():
    try:
        x=json.loads(SESSION_PATH.read_text(encoding="utf-8"))
        return x if isinstance(x,dict) else {}
    except Exception:
        return {}

def _save_sessions(data):
    SESSION_PATH.parent.mkdir(parents=True,exist_ok=True)
    tmp=SESSION_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(data,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    os.chmod(tmp,0o600)
    os.replace(tmp,SESSION_PATH)

def get_session(user_id):
    return _load_sessions().get(str(user_id))

def set_session(user_id, action, **data):
    rows=_load_sessions()
    rows[str(user_id)]={"action":action,"data":data,"at":time.time()}
    _save_sessions(rows)

def clear_session(user_id):
    rows=_load_sessions()
    rows.pop(str(user_id),None)
    _save_sessions(rows)

def prompt(chat_id,text,cancel_to="home"):
    return tg("sendMessage",{
        "chat_id":chat_id,"parse_mode":"HTML","text":text,
        "reply_markup":keyboard([[{"text":"إلغاء","callback_data":cancel_to}]])
    })

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
        [{"text":"🐙 GitHub","callback_data":"github"},{"text":"🧾 سجل التدقيق","callback_data":"audit"}],
        [{"text":"🛠 العمليات","callback_data":"operations"},{"text":"💾 النسخ الاحتياطية","callback_data":"backups"}],
        [{"text":"🚨 التنبيهات","callback_data":"alerts"},{"text":"⚙️ الإعدادات","callback_data":"settings"}],
        [{"text":"🔄 تحديث الآن","callback_data":"refresh"}],
        [{"text":"📊 فتح لوحة الإحصائيات المتقدمة","web_app":{"url":WEBAPP_URL}}]
    ])

def back_keyboard():
    return keyboard([
        [{"text":"↩️ الرئيسية","callback_data":"home"}],
        [{"text":"📊 الإحصائيات المتقدمة","web_app":{"url":WEBAPP_URL}}]
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
    ps=managed_catalog()
    sec=secret_index()
    hist=x.get("history",{})
    due=sum(1 for p in ps if (p.get("billing") or {}).get("overdue"))
    return (
        "<b>UCHIHA Control Center</b>\n"
        "لوحة الإدارة المركزية عبر Telegram\n\n"
        f"{status_icon(s.get('health'))} <b>السيرفر:</b> {e(s.get('health'))}\n"
        f"🧠 RAM: <b>{e(s.get('memoryPercent'))}%</b> · 💾 Disk: <b>{e(s.get('diskPercent'))}%</b>\n"
        f"📦 الحاويات: <b>{e(s.get('containersRunning'))}</b> · سليمة: <b>{e(s.get('containersHealthy'))}</b>\n"
        f"🗄 PostgreSQL: <b>{e(db.get('health'))}</b> · {e(db.get('name'))}\n"
        f"🌐 الدومينات المكتشفة: <b>{len(dom.get('items',[]))}</b>\n"
        f"📦 المشاريع: <b>{len(ps)}</b> · 💰 مستحق: <b>{due}</b>\n"
        f"🔐 ملفات الأسرار: <b>{len(sec)}</b>\n"
        f"📊 عينات التقرير: <b>{e(hist.get('sampleCount',0))}</b>\n\n"
        "<i>كل الأرقام من المصادر الفعلية فقط.</i>"
    )

TYPE_LABELS={"app":"📱 تطبيق","website":"🌐 موقع","bot":"🤖 بوت","bundle":"🧩 مشروع متكامل","service":"⚙️ خدمة"}

def projects_text():
    rows=managed_catalog()
    if not rows:
        return "<b>📦 مشاريعي</b>\n\nلا توجد مشاريع في الكتالوج."
    counts={k:0 for k in TYPE_LABELS}
    online=offline=unlinked=due=0
    for p in rows:
        counts[p.get("type","service")]=counts.get(p.get("type","service"),0)+1
        st=p.get("liveStatus")
        if st=="online": online+=1
        elif st=="unlinked": unlinked+=1
        else: offline+=1
        if (p.get("billing") or {}).get("overdue"): due+=1
    return (
        "<b>📦 مشاريعي</b>\n"
        "إدارة التطبيقات والمواقع والبوتات والاشتراكات من مكان واحد.\n\n"
        f"📱 التطبيقات: <b>{counts.get('app',0)}</b> · 🌐 المواقع: <b>{counts.get('website',0)}</b> · 🤖 البوتات: <b>{counts.get('bot',0)}</b>\n"
        f"🧩 المشاريع المتكاملة: <b>{counts.get('bundle',0)}</b>\n"
        f"🟢 يعمل: <b>{online}</b> · 🔴 متوقف/جزئي: <b>{offline}</b> · ⚪️ غير مربوط: <b>{unlinked}</b>\n"
        f"💰 مستحقات هذا الشهر: <b>{due}</b>\n\n"
        "<i>اختر مشروعًا لعرض التشغيل، الإصدارات، التحديثات، المؤقت والفوترة.</i>"
    )

def projects_keyboard():
    rows=managed_catalog()
    kb=[
        [{"text":"📱 التطبيقات","callback_data":"ptype:app"},{"text":"🌐 المواقع","callback_data":"ptype:website"}],
        [{"text":"🤖 البوتات","callback_data":"ptype:bot"},{"text":"🧩 الكل","callback_data":"ptype:all"}]
    ]
    current=[]
    for p in rows[:20]:
        icon={"online":"🟢","offline":"🔴","partial":"🟡","unlinked":"⚪️"}.get(p.get("liveStatus"),"⚪️")
        current.append({"text":f"{icon} {p.get('name','')[:24]}","callback_data":"proj:"+p.get("id","")})
        if len(current)==2:
            kb.append(current); current=[]
    if current: kb.append(current)
    kb.append([{"text":"➕ إضافة مشروع جديد","callback_data":"padd"}])
    kb.append([{"text":"↩️ الرئيسية","callback_data":"home"}])
    return keyboard(kb)

def project_list_text(ptype="all"):
    rows=managed_catalog()
    if ptype!="all":
        rows=[p for p in rows if p.get("type")==ptype]
    title={"app":"📱 التطبيقات","website":"🌐 المواقع","bot":"🤖 البوتات","bundle":"🧩 المشاريع","all":"📦 كل المشاريع"}.get(ptype,"📦 المشاريع")
    out=[f"<b>{title}</b>",""]
    if not rows: out.append("لا توجد عناصر في هذا القسم.")
    for p in rows:
        icon={"online":"🟢","offline":"🔴","partial":"🟡","unlinked":"⚪️"}.get(p.get("liveStatus"),"⚪️")
        fee=p.get("billing") or {}
        fee_text=f"{fee.get('monthlyFee')} {e(fee.get('currency'))}" if fee.get("monthlyFee") else "بدون مبلغ"
        out.append(f"{icon} <b>{e(p.get('name'))}</b> · {e(TYPE_LABELS.get(p.get('type'),'خدمة'))}\n<code>{e(p.get('id'))}</code> · شهريًا: {fee_text}")
    return "\n".join(out)[:3900]

def project_list_keyboard(ptype="all"):
    rows=managed_catalog()
    if ptype!="all": rows=[p for p in rows if p.get("type")==ptype]
    kb=[]
    for p in rows[:30]:
        icon={"online":"🟢","offline":"🔴","partial":"🟡","unlinked":"⚪️"}.get(p.get("liveStatus"),"⚪️")
        kb.append([{"text":f"{icon} {p.get('name','')[:42]}","callback_data":"proj:"+p.get("id","")}])
    kb.append([{"text":"↩️ المشاريع","callback_data":"projects"},{"text":"🏠 الرئيسية","callback_data":"home"}])
    return keyboard(kb)

def managed_project_text(project_id):
    p=next((x for x in managed_catalog() if x.get("id")==project_id),None)
    if not p: return "<b>المشروع غير موجود.</b>"
    icon={"online":"🟢","offline":"🔴","partial":"🟡","unlinked":"⚪️"}.get(p.get("liveStatus"),"⚪️")
    b=p.get("billing") or {}
    versions=p.get("versions") or []
    out=[
        f"<b>{icon} {e(p.get('name'))}</b>",
        f"{e(TYPE_LABELS.get(p.get('type'),'خدمة'))} · <code>{e(p.get('id'))}</code>","",
        f"الحالة: <b>{e(p.get('liveStatus'))}</b>",
        f"العميل: <b>{e(p.get('client') or '—')}</b>",
        f"الدومين: <code>{e(p.get('domain') or '—')}</code>",
        f"GitHub: <code>{e(p.get('repository') or 'غير مربوط')}</code>",
        f"الفرع: <code>{e(p.get('branch') or '—')}</code>",
        f"الإصدار الحالي: <b>{e(p.get('currentVersion') or 'غير مسجل')}</b>","",
        f"💰 الشهري: <b>{e(b.get('monthlyFee'))} {e(b.get('currency'))}</b> · يوم الاستحقاق: <b>{e(b.get('dueDay'))}</b>",
        f"الدفع هذا الشهر: <b>{'✅ مدفوع' if b.get('paidThisMonth') else ('🔴 مستحق' if b.get('overdue') else '⏳ غير مدفوع بعد')}</b>",
        f"آخر دفع: <code>{e(b.get('lastPaidAt') or '—')}</code>",
        f"⏱ الإيقاف المجدول: <code>{e(p.get('expiresAt') or 'غير مفعّل')}</code>",
        f"Auto Stop: <b>{'ON' if p.get('autoStop') else 'OFF'}</b>","",
        "<b>المكونات:</b>"
    ]
    rs=p.get("runtimeState") or []
    if not rs: out.append("⚪️ لا يوجد Runtime مربوط بهذا المشروع بعد.")
    for x in rs:
        out.append(f"{'🟢' if x.get('active') else '🔴'} {e(x.get('kind'))}: <code>{e(x.get('name'))}</code> — {e(x.get('status'))}")
    out.append("\n<b>آخر التحديثات والإصدارات:</b>")
    if not versions: out.append("لا توجد إصدارات مسجلة بعد.")
    for v in versions[-6:][::-1]:
        out.append(f"• <b>{e(v.get('version'))}</b> · {e(v.get('kind'))}\n  {e(v.get('createdAt'))}\n  {e(v.get('notes') or '')}")
    return "\n".join(out)[:3900]

def managed_project_keyboard(project_id):
    p=next((x for x in managed_catalog() if x.get("id")==project_id),None)
    if not p: return back_keyboard()
    kb=[]
    if p.get("runtime"):
        if p.get("liveStatus")=="online":
            kb.append([{"text":"⏹ إطفاء المشروع","callback_data":"paskstop:"+project_id}])
        else:
            kb.append([{"text":"▶️ تشغيل المشروع","callback_data":"paskstart:"+project_id}])
    else:
        kb.append([{"text":"⚪️ Runtime غير مربوط","callback_data":"noop"}])
    if (p.get("billing") or {}).get("monthlyFee"):
        kb.append([
            {"text":"💵 تسجيل دفعة","callback_data":"paskpaid:"+project_id},
            {"text":"🔁 استلام + 30 يوم","callback_data":"paskrenew:"+project_id}
        ])
    kb.append([
        {"text":"🧾 الإصدارات والتحديثات","callback_data":"pversions:"+project_id},
        {"text":"⚙️ إدارة المشروع","callback_data":"pmanage:"+project_id}
    ])
    kb.append([{"text":"↩️ المشاريع","callback_data":"projects"},{"text":"🏠 الرئيسية","callback_data":"home"}])
    return keyboard(kb)

def project_manage_text(project_id):
    p=next((x for x in managed_catalog() if x.get("id")==project_id),None)
    if not p: return "<b>المشروع غير موجود.</b>"
    b=p.get("billing") or {}
    return (
        f"<b>⚙️ إدارة {e(p.get('name'))}</b>\n\n"
        f"النوع: {e(TYPE_LABELS.get(p.get('type'),'خدمة'))}\n"
        f"العميل: <b>{e(p.get('client') or '—')}</b>\n"
        f"GitHub: <code>{e(p.get('repository') or 'غير مربوط')}</code>\n"
        f"الدومين: <code>{e(p.get('domain') or 'غير مربوط')}</code>\n"
        f"الشهري: <b>{e(b.get('monthlyFee'))} {e(b.get('currency'))}</b> · الاستحقاق يوم {e(b.get('dueDay'))}\n"
        f"المؤقت: <code>{e(p.get('expiresAt') or 'غير مفعّل')}</code>\n"
        f"المكونات: <b>{len(p.get('runtime') or [])}</b>\n\n"
        "<i>كل التعديلات التالية تتم من أزرار البوت؛ الواجهة الخارجية للإحصائيات فقط.</i>"
    )

def project_manage_keyboard(project_id):
    return keyboard([
        [{"text":"✏️ الاسم","callback_data":"pedit:name:"+project_id},{"text":"👤 العميل","callback_data":"pedit:client:"+project_id}],
        [{"text":"🐙 GitHub","callback_data":"pedit:repo:"+project_id},{"text":"🌐 الدومين","callback_data":"pedit:domain:"+project_id}],
        [{"text":"💰 الفوترة","callback_data":"pbilling:"+project_id},{"text":"⏱ المؤقت","callback_data":"ptimer:"+project_id}],
        [{"text":"🔗 ربط التشغيل","callback_data":"pruntime:"+project_id},{"text":"🧾 الإصدارات","callback_data":"pversions:"+project_id}],
        [{"text":"🗑 حذف من الكتالوج","callback_data":"paskdelete:"+project_id}],
        [{"text":"↩️ المشروع","callback_data":"proj:"+project_id},{"text":"🏠 الرئيسية","callback_data":"home"}]
    ])

def project_billing_text(project_id):
    p=next((x for x in managed_catalog() if x.get("id")==project_id),None)
    if not p: return "<b>المشروع غير موجود.</b>"
    b=p.get("billing") or {}
    pays=(p.get("payments") or [])[-8:][::-1]
    out=[f"<b>💰 فوترة {e(p.get('name'))}</b>","",
         f"المبلغ الشهري: <b>{e(b.get('monthlyFee'))} {e(b.get('currency'))}</b>",
         f"يوم الاستحقاق: <b>{e(b.get('dueDay'))}</b>",
         f"هذا الشهر: <b>{'✅ مدفوع' if b.get('paidThisMonth') else ('🔴 متأخر' if b.get('overdue') else '⏳ بانتظار الدفع')}</b>",
         f"آخر دفع: <code>{e(b.get('lastPaidAt') or '—')}</code>","",
         "<b>آخر الدفعات:</b>"]
    if not pays: out.append("لا توجد دفعات مسجلة.")
    for x in pays:
        out.append(f"• {e(x.get('amount'))} {e(x.get('currency'))} · <code>{e(x.get('at'))}</code>")
    return "\n".join(out)[:3900]

def project_billing_keyboard(project_id):
    return keyboard([
        [{"text":"💵 تعديل المبلغ","callback_data":"pedit:amount:"+project_id},{"text":"💱 العملة","callback_data":"pcurrency:"+project_id}],
        [{"text":"📅 يوم الاستحقاق","callback_data":"pdue:"+project_id}],
        [{"text":"✅ تسجيل دفعة","callback_data":"paskpaid:"+project_id},{"text":"🔁 استلام +30 يوم","callback_data":"paskrenew:"+project_id}],
        [{"text":"↩️ إدارة المشروع","callback_data":"pmanage:"+project_id}]
    ])

def project_timer_text(project_id):
    p=next((x for x in managed_catalog() if x.get("id")==project_id),None)
    if not p: return "<b>المشروع غير موجود.</b>"
    return (
        f"<b>⏱ مؤقت {e(p.get('name'))}</b>\n\n"
        f"موعد الإيقاف: <code>{e(p.get('expiresAt') or 'غير مفعّل')}</code>\n"
        f"الإيقاف التلقائي: <b>{'ON' if p.get('autoStop') else 'OFF'}</b>\n\n"
        "اختر مدة جاهزة أو أدخل موعدًا مخصصًا."
    )

def project_timer_keyboard(project_id):
    return keyboard([
        [{"text":"1 يوم","callback_data":"ptset:1:"+project_id},{"text":"7 أيام","callback_data":"ptset:7:"+project_id}],
        [{"text":"30 يوم","callback_data":"ptset:30:"+project_id},{"text":"60 يوم","callback_data":"ptset:60:"+project_id}],
        [{"text":"✍️ موعد مخصص","callback_data":"ptcustom:"+project_id},{"text":"❌ إلغاء المؤقت","callback_data":"ptclear:"+project_id}],
        [{"text":"↩️ إدارة المشروع","callback_data":"pmanage:"+project_id}]
    ])

def project_versions_text(project_id,page=0):
    p=next((x for x in managed_catalog() if x.get("id")==project_id),None)
    if not p: return "<b>المشروع غير موجود.</b>"
    versions=(p.get("versions") or [])[::-1]
    page=max(0,int(page or 0)); per=8
    chunk=versions[page*per:(page+1)*per]
    out=[f"<b>🧾 إصدارات {e(p.get('name'))}</b>",f"الإجمالي: <b>{len(versions)}</b> · الصفحة <b>{page+1}</b>",""]
    if not chunk: out.append("لا توجد إصدارات في هذه الصفحة.")
    for v in chunk:
        out.append(f"• <b>{e(v.get('version'))}</b> · {e(v.get('kind'))}\n  <code>{e(v.get('createdAt'))}</code>\n  {e(v.get('notes') or '')}")
    return "\n".join(out)[:3900]

def project_versions_keyboard(project_id,page=0):
    p=next((x for x in managed_catalog() if x.get("id")==project_id),None)
    total=len((p or {}).get("versions") or [])
    per=8; max_page=max(0,(total-1)//per)
    nav=[]
    if page>0: nav.append({"text":"⬅️ أحدث","callback_data":f"pverspage:{page-1}:{project_id}"})
    if page<max_page: nav.append({"text":"أقدم ➡️","callback_data":f"pverspage:{page+1}:{project_id}"})
    rows=[[{"text":"➕ إضافة إصدار/تحديث","callback_data":"paddversion:"+project_id}]]
    if nav: rows.append(nav)
    rows.append([{"text":"↩️ المشروع","callback_data":"proj:"+project_id}])
    return keyboard(rows)

def project_runtime_text(project_id):
    p=next((x for x in managed_catalog() if x.get("id")==project_id),None)
    if not p: return "<b>المشروع غير موجود.</b>"
    out=[f"<b>🔗 تشغيل {e(p.get('name'))}</b>","", "<b>المكونات المربوطة:</b>"]
    current=p.get("runtimeState") or []
    if not current: out.append("لا يوجد Runtime مربوط.")
    for x in current:
        out.append(f"{'🟢' if x.get('active') else '🔴'} {e(x.get('kind'))}: <code>{e(x.get('name'))}</code>")
    out.append("\n<i>يمكنك إضافة مكوّن موجود فعليًا على VPS أو إزالة مكوّن من الربط. إزالة الربط لا تطفئ الخدمة.</i>")
    return "\n".join(out)[:3900]

def project_runtime_keyboard(project_id):
    p=next((x for x in managed_catalog() if x.get("id")==project_id),None)
    rows=[
        [{"text":"➕ Docker","callback_data":"praddtype:docker:"+project_id},{"text":"➕ Systemd","callback_data":"praddtype:systemd:"+project_id}]
    ]
    for x in (p or {}).get("runtime",[])[:12]:
        rows.append([{"text":"➖ "+str(x.get("name",""))[:40],"callback_data":"prremove:"+str(x.get("kind"))+":"+str(x.get("name"))+":"+project_id}])
    rows.append([{"text":"↩️ إدارة المشروع","callback_data":"pmanage:"+project_id}])
    return keyboard(rows)

def secrets_keyboard():
    rows=[]
    for p in managed_catalog()[:30]:
        rows.append([{"text":"🔐 "+p.get("name","")[:38],"callback_data":"secretproj:"+p.get("id","")}])
    rows.append([{"text":"↩️ الرئيسية","callback_data":"home"}])
    return keyboard(rows)

def secret_project_text(project_id):
    row=next((x for x in secret_index() if x.get("projectId")==project_id),None)
    p=next((x for x in managed_catalog() if x.get("id")==project_id),None)
    out=[f"<b>🔐 أسرار {e((p or {}).get('name') or project_id)}</b>",""]
    keys=(row or {}).get("keys",[])
    if not keys: out.append("لا توجد مفاتيح محفوظة.")
    for key in keys: out.append(f"• <code>{e(key)}</code> = •••••••• ✅")
    out.append("\n<i>قيمة السر لا تُعرض بعد الحفظ.</i>")
    return "\n".join(out)

def secret_project_keyboard(project_id):
    row=next((x for x in secret_index() if x.get("projectId")==project_id),None)
    rows=[[{"text":"➕ إضافة/استبدال سر","callback_data":"secretadd:"+project_id}]]
    for key in (row or {}).get("keys",[])[:25]:
        rows.append([{"text":"🗑 "+key[:38],"callback_data":"secretdelask:"+urllib.parse.quote(key,safe='')+":"+project_id}])
    rows.append([{"text":"↩️ الأسرار","callback_data":"secrets"}])
    return keyboard(rows)

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
    out.append("🔒 <i>الإدارة تتم من أزرار البوت. قيمة السر لا تُعرض بعد الحفظ.</i>")
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

def github_text():
    data=github_repositories()
    rows=data.get("repositories",[])
    out=["<b>🐙 GitHub</b>","",
         f"الحساب: <code>{e(data.get('account'))}</code>",
         f"آخر مزامنة: <code>{e(data.get('syncedAt'))}</code>",
         f"المستودعات: <b>{len(rows)}</b>",""]
    if not rows:
        out.append("لا توجد مستودعات متزامنة.")
    for row in rows[:50]:
        out.append(
            f"• <b>{e(row.get('name'))}</b>\n"
            f"<code>{e(row.get('fullName'))}</code> · branch <code>{e(row.get('defaultBranch'))}</code>"
        )
    out.append("\n<i>هذه قائمة حقيقية من حساب GitHub المرتبط، وليست بيانات تجريبية.</i>")
    return "\n".join(out)[:3900]

def audit_text():
    rows=audit_events(20)
    out=["<b>🧾 سجل التدقيق</b>",""]
    if not rows:
        out.append("لا توجد أحداث تدقيق.")
    for x in reversed(rows):
        out.append(f"• <code>{e(x.get('at'))}</code> — <b>{e(x.get('type'))}</b> · {e(x.get('source'))}")
    return "\n".join(out)[:3900]

def operations_text():
    state=operational_state()
    out=["<b>🛠 العمليات</b>","",
         f"Nginx: <b>{e(state.get('nginx'))}</b>",
         f"Control API: <b>{e(state.get('controlCenter'))}</b>",
         f"Telegram Bot: <b>{e(state.get('bot'))}</b>","",
         "<b>الحاويات:</b>"]
    for c in state.get("containers",[])[:20]:
        mark="🟢" if c.get("healthy") is True else ("🔴" if c.get("healthy") is False else "⚪️")
        out.append(f"{mark} <code>{e(c.get('name'))}</code> — {e(c.get('status'))}")
    out.append("\n<i>إعادة التشغيل تحتاج تأكيدًا منفصلًا حتى لا تنضغط بالخطأ.</i>")
    return "\n".join(out)[:3900]

def operations_keyboard():
    rows=[
        [{"text":"🔄 تحديث القياسات","callback_data":"refresh"},{"text":"♻️ Reload Nginx","callback_data":"asknginx"}],
        [{"text":"💾 نسخة قاعدة البيانات","callback_data":"askbackup"}]
    ]
    for c in operational_state().get("containers",[])[:12]:
        name=str(c.get("name",""))
        if len(name)<=45:
            rows.append([
                {"text":"🔄 "+name,"callback_data":"askrestart:"+name},
                {"text":"📜 Logs","callback_data":"logs:"+name}
            ])
    rows.append([{"text":"↩️ الرئيسية","callback_data":"home"}])
    return keyboard(rows)

def backups_text():
    rows=list_backups()
    stats=database_stats()
    out=["<b>💾 النسخ الاحتياطية</b>","",
         f"قاعدة البيانات: <code>{e(stats.get('database'))}</code>",
         f"الحجم الحالي: <b>{e(stats.get('size'))}</b>",
         f"الاتصالات: <b>{e(stats.get('connections'))}</b> · الجداول: <b>{e(stats.get('publicTables'))}</b>",""]
    if not rows:
        out.append("لا توجد نسخ محفوظة بعد.")
    for x in rows[:20]:
        size=float(x.get("size",0))/1024/1024
        out.append(f"• <code>{e(x.get('name'))}</code> — {size:.2f} MB\n  {e(x.get('createdAt'))}")
    return "\n".join(out)[:3900]

def backups_keyboard():
    return keyboard([
        [{"text":"➕ إنشاء نسخة الآن","callback_data":"askbackup"}],
        [{"text":"↩️ الرئيسية","callback_data":"home"}]
    ])

def alerts_text():
    rows=current_alerts()
    out=["<b>🚨 التنبيهات الحالية</b>",""]
    if not rows:
        out.append("✅ لا توجد مشاكل حرجة أو تحذيرات حاليًا.")
    for x in rows:
        icon="🔴" if x.get("level")=="critical" else "🟡"
        out.append(f"{icon} <b>{e(x.get('title'))}</b>\n{e(x.get('detail'))}\n")
    out.append("<i>البوت يراقب الحالة تلقائيًا ويرسل تنبيهًا فقط عند تغيّر المشكلة أو زوالها.</i>")
    return "\n".join(out)[:3900]

def settings_text():
    return (
        "<b>⚙️ إعدادات بوت UCHIHA</b>\n\n"
        "• الوصول محصور بمديري Telegram المعتمدين.\n"
        "• Mini App مخصص للإحصائيات المتقدمة فقط ويتحقق من Telegram initData.\n"
        "• الإدارة والتشغيل والفوترة والمؤقتات تتم من أزرار البوت.\n"
        "• قيم الأسرار لا تُعرض بعد الحفظ.\n"
        "• العمليات الحساسة تحتاج تأكيدًا منفصلًا.\n"
        "• البيانات الوهمية غير مسموحة؛ أي مصدر غير مربوط يظهر كغير متاح.\n"
        "• البيانات الحساسة ومفاتيح التوقيع لا تُخزن داخل المحادثات."
    )

SCREENS={
    "home":(home_text,main_keyboard),
    "projects":(projects_text,projects_keyboard),
    "secrets":(secrets_text,secrets_keyboard),
    "servers":(servers_text,back_keyboard),
    "database":(database_text,back_keyboard),
    "domains":(domains_text,back_keyboard),
    "reports":(reports_text,back_keyboard),
    "approvals":(approvals_text,back_keyboard),
    "github":(github_text,back_keyboard),
    "audit":(audit_text,back_keyboard),
    "operations":(operations_text,operations_keyboard),
    "backups":(backups_text,backups_keyboard),
    "alerts":(alerts_text,back_keyboard),
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

def _project_by_id(pid):
    return next((x for x in managed_catalog() if x.get("id")==pid),None)

def _update_project_field(pid, field, value):
    p=_project_by_id(pid)
    if not p: raise ValueError("project_not_found")
    payload={"id":pid,"name":p.get("name") or pid}
    if field=="name": payload["name"]=value
    elif field=="client": payload["client"]="" if value=="-" else value
    elif field=="repo": payload["repository"]="" if value=="-" else value
    elif field=="domain": payload["domain"]="" if value=="-" else value
    else: raise ValueError("invalid_field")
    return upsert_managed_project(payload)

def handle_session_message(msg, session):
    chat_id=(msg.get("chat") or {}).get("id")
    user_id=(msg.get("from") or {}).get("id")
    text=str(msg.get("text","")).strip()
    action=session.get("action")
    data=session.get("data") or {}

    try:
        if action=="padd_id":
            pid=text.lower()
            if not pid or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in pid) or len(pid)<2 or len(pid)>64:
                return prompt(chat_id,"أرسل ID بسيطًا بالإنكليزية مثل <code>client-app</code>.")
            if _project_by_id(pid):
                return prompt(chat_id,"هذا ID مستخدم. أرسل ID مختلفًا.")
            set_session(user_id,"padd_name",id=pid)
            return prompt(chat_id,"أرسل <b>اسم المشروع</b> كما تريد أن يظهر في البوت.")

        if action=="padd_name":
            if not text or len(text)>120:
                return prompt(chat_id,"أرسل اسمًا واضحًا حتى 120 حرفًا.")
            data["name"]=text
            set_session(user_id,"padd_type",**data)
            return tg("sendMessage",{
                "chat_id":chat_id,"text":"اختر نوع المشروع:","reply_markup":keyboard([
                    [{"text":"📱 تطبيق","callback_data":"paddtype:app"},{"text":"🌐 موقع","callback_data":"paddtype:website"}],
                    [{"text":"🤖 بوت","callback_data":"paddtype:bot"},{"text":"🧩 مشروع متكامل","callback_data":"paddtype:bundle"}],
                    [{"text":"⚙️ خدمة","callback_data":"paddtype:service"},{"text":"إلغاء","callback_data":"projects"}]
                ])
            })

        if action=="padd_client":
            data["client"]="" if text=="-" else text[:120]
            set_session(user_id,"padd_repo",**data)
            return prompt(chat_id,"أرسل مستودع GitHub بصيغة <code>owner/repo</code> أو أرسل <code>-</code> للتخطي.","projects")

        if action=="padd_repo":
            data["repository"]="" if text=="-" else text[:200]
            set_session(user_id,"padd_domain",**data)
            return prompt(chat_id,"أرسل الدومين مثل <code>app.example.com</code> أو <code>-</code> للتخطي.","projects")

        if action=="padd_domain":
            data["domain"]="" if text=="-" else text[:253]
            item=upsert_managed_project({
                "id":data["id"],"name":data["name"],"type":data["type"],
                "client":data.get("client",""),"repository":data.get("repository",""),
                "branch":"main","domain":data.get("domain",""),"runtime":[]
            })
            clear_session(user_id)
            return tg("sendMessage",{
                "chat_id":chat_id,"parse_mode":"HTML",
                "text":"✅ <b>تم إنشاء المشروع</b>\n\n"+managed_project_text(item.get("id")),
                "reply_markup":managed_project_keyboard(item.get("id"))
            })

        if action=="pedit":
            pid=data.get("projectId"); field=data.get("field")
            if not text and field=="name": return prompt(chat_id,"الاسم لا يمكن أن يكون فارغًا.",f"pmanage:{pid}")
            _update_project_field(pid,field,text)
            clear_session(user_id)
            return tg("sendMessage",{"chat_id":chat_id,"parse_mode":"HTML","text":project_manage_text(pid),"reply_markup":project_manage_keyboard(pid)})

        if action=="pamount":
            pid=data.get("projectId")
            try: amount=float(text.replace(",","."))
            except Exception: return prompt(chat_id,"أرسل مبلغًا رقميًا فقط، مثال <code>25</code> أو <code>12.5</code>.",f"pbilling:{pid}")
            if amount<0 or amount>1000000000: return prompt(chat_id,"المبلغ خارج النطاق.",f"pbilling:{pid}")
            update_managed_billing(pid,{"monthlyFee":amount})
            clear_session(user_id)
            return tg("sendMessage",{"chat_id":chat_id,"parse_mode":"HTML","text":project_billing_text(pid),"reply_markup":project_billing_keyboard(pid)})

        if action=="ptcustom":
            pid=data.get("projectId")
            raw=text.replace(" ","T",1) if " " in text and "T" not in text else text
            try:
                parsed=dt.datetime.fromisoformat(raw.replace("Z","+00:00"))
                if parsed.tzinfo is None:
                    return prompt(chat_id,"أضف المنطقة الزمنية. مثال: <code>2026-10-20T18:00+03:00</code>",f"ptimer:{pid}")
                expires=parsed.astimezone(dt.timezone.utc).isoformat().replace("+00:00","Z")
            except Exception:
                return prompt(chat_id,"الصيغة غير صحيحة. مثال: <code>2026-10-20T18:00+03:00</code>",f"ptimer:{pid}")
            set_managed_timer(pid,expires,True)
            clear_session(user_id)
            return tg("sendMessage",{"chat_id":chat_id,"parse_mode":"HTML","text":project_timer_text(pid),"reply_markup":project_timer_keyboard(pid)})

        if action=="pversion_name":
            pid=data.get("projectId")
            if not text or len(text)>120: return prompt(chat_id,"أرسل اسم الإصدار، مثال <code>v1.5.14</code>.",f"pversions:{pid}")
            set_session(user_id,"pversion_notes",projectId=pid,version=text[:120])
            return prompt(chat_id,"أرسل ملاحظات التحديث، أو <code>-</code> بدون ملاحظات.",f"pversions:{pid}")

        if action=="pversion_notes":
            pid=data.get("projectId")
            add_managed_version(pid,data.get("version"),"" if text=="-" else text[:4000],"update")
            clear_session(user_id)
            return tg("sendMessage",{"chat_id":chat_id,"parse_mode":"HTML","text":project_versions_text(pid,0),"reply_markup":project_versions_keyboard(pid,0)})

        if action=="secret_key":
            pid=data.get("projectId")
            if not text or len(text)>100: return prompt(chat_id,"أرسل اسم المفتاح فقط، مثال <code>BOT_TOKEN</code>.",f"secretproj:{pid}")
            set_session(user_id,"secret_value",projectId=pid,key=text)
            return prompt(chat_id,"أرسل الآن <b>قيمة السر</b>. سأحذف رسالتك فورًا بعد حفظها على الخادم.",f"secretproj:{pid}")

        if action=="secret_value":
            pid=data.get("projectId"); key=data.get("key")
            try:
                put_secret(pid,key,text)
                try: tg("deleteMessage",{"chat_id":chat_id,"message_id":msg.get("message_id")})
                except Exception: pass
                clear_session(user_id)
                return tg("sendMessage",{
                    "chat_id":chat_id,"parse_mode":"HTML",
                    "text":"✅ تم حفظ السر. لن أعرض قيمته مرة أخرى.\n\n"+secret_project_text(pid),
                    "reply_markup":secret_project_keyboard(pid)
                })
            except Exception as ex:
                clear_session(user_id)
                return tg("sendMessage",{"chat_id":chat_id,"text":"تعذر حفظ السر: "+type(ex).__name__})

    except ValueError as ex:
        clear_session(user_id)
        return tg("sendMessage",{"chat_id":chat_id,"parse_mode":"HTML","text":"تعذر التنفيذ: <code>"+e(str(ex))+"</code>","reply_markup":main_keyboard()})
    except Exception:
        clear_session(user_id)
        return tg("sendMessage",{"chat_id":chat_id,"text":"حدث خطأ أثناء تنفيذ الخطوة. أعد المحاولة من الأزرار.","reply_markup":main_keyboard()})
    return None

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
    if text.startswith("/"):
        clear_session(user_id)
        if text in ("/start","/menu","/home",""):
            return send_screen(chat_id,"home")
        if text=="/projects": return send_screen(chat_id,"projects")
        if text=="/secrets": return send_screen(chat_id,"secrets")
        if text=="/server": return send_screen(chat_id,"servers")
        if text=="/domains": return send_screen(chat_id,"domains")
        if text=="/reports": return send_screen(chat_id,"reports")
        if text in ("/ops","/operations"): return send_screen(chat_id,"operations")
        if text in ("/backup","/backups"): return send_screen(chat_id,"backups")
        if text=="/alerts": return send_screen(chat_id,"alerts")
        return send_screen(chat_id,"home")
    session=get_session(user_id)
    if session:
        handled=handle_session_message(msg,session)
        if handled is not None: return handled
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

    user_id=user.get("id")

    if data in ("home","projects","secrets","settings"):
        clear_session(user_id)

    if data=="padd":
        tg("answerCallbackQuery",{"callback_query_id":qid})
        set_session(user_id,"padd_id")
        return prompt(chat_id,"<b>إضافة مشروع جديد</b>\n\nأرسل ID بالإنكليزية مثل <code>client-app</code>.","projects")

    if data.startswith("paddtype:"):
        ptype=data.split(":",1)[1]
        session=get_session(user_id)
        if not session or session.get("action")!="padd_type":
            tg("answerCallbackQuery",{"callback_query_id":qid,"text":"ابدأ الإضافة من جديد.","show_alert":"true"})
            return send_screen(chat_id,"projects",mid)
        pdata=session.get("data") or {}
        pdata["type"]=ptype if ptype in TYPE_LABELS else "service"
        set_session(user_id,"padd_client",**pdata)
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return prompt(chat_id,"أرسل <b>اسم العميل</b>، أو <code>-</code> إذا كان المشروع لك.","projects")

    if data.startswith("pmanage:"):
        pid=data.split(":",1)[1]
        clear_session(user_id)
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":project_manage_text(pid),"reply_markup":project_manage_keyboard(pid)})

    if data.startswith("pbilling:"):
        pid=data.split(":",1)[1]
        clear_session(user_id)
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":project_billing_text(pid),"reply_markup":project_billing_keyboard(pid)})

    if data.startswith("ptimer:"):
        pid=data.split(":",1)[1]
        clear_session(user_id)
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":project_timer_text(pid),"reply_markup":project_timer_keyboard(pid)})

    if data.startswith("pversions:"):
        pid=data.split(":",1)[1]
        clear_session(user_id)
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":project_versions_text(pid,0),"reply_markup":project_versions_keyboard(pid,0)})

    if data.startswith("pverspage:"):
        _,page,pid=data.split(":",2)
        page=max(0,int(page))
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":project_versions_text(pid,page),"reply_markup":project_versions_keyboard(pid,page)})

    if data.startswith("pedit:"):
        _,field,pid=data.split(":",2)
        labels={"name":"الاسم الجديد","client":"اسم العميل أو - للمسح","repo":"owner/repository أو - للمسح","domain":"الدومين أو - للمسح","amount":"المبلغ الشهري"}
        tg("answerCallbackQuery",{"callback_query_id":qid})
        if field=="amount":
            set_session(user_id,"pamount",projectId=pid)
        else:
            set_session(user_id,"pedit",projectId=pid,field=field)
        return prompt(chat_id,f"أرسل <b>{e(labels.get(field,'القيمة الجديدة'))}</b>.",f"pmanage:{pid}")

    if data.startswith("pcurrency:"):
        pid=data.split(":",1)[1]
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":"<b>اختر عملة الاشتراك الشهري</b>","reply_markup":keyboard([
            [{"text":"USD $","callback_data":"psetcurrency:USD:"+pid},{"text":"EUR €","callback_data":"psetcurrency:EUR:"+pid}],
            [{"text":"RON","callback_data":"psetcurrency:RON:"+pid},{"text":"SYP","callback_data":"psetcurrency:SYP:"+pid}],
            [{"text":"↩️ الفوترة","callback_data":"pbilling:"+pid}]
        ])})

    if data.startswith("psetcurrency:"):
        _,cur,pid=data.split(":",2)
        update_managed_billing(pid,{"currency":cur})
        tg("answerCallbackQuery",{"callback_query_id":qid,"text":"تم تعديل العملة ✅"})
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":project_billing_text(pid),"reply_markup":project_billing_keyboard(pid)})

    if data.startswith("pdue:"):
        pid=data.split(":",1)[1]
        tg("answerCallbackQuery",{"callback_query_id":qid})
        days=[1,5,10,15,20,25,28]
        rows=[]
        for i in range(0,len(days),3):
            rows.append([{"text":str(d),"callback_data":f"psetdue:{d}:{pid}"} for d in days[i:i+3]])
        rows.append([{"text":"↩️ الفوترة","callback_data":"pbilling:"+pid}])
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":"<b>اختر يوم الاستحقاق الشهري</b>","reply_markup":keyboard(rows)})

    if data.startswith("psetdue:"):
        _,day,pid=data.split(":",2)
        update_managed_billing(pid,{"dueDay":int(day)})
        tg("answerCallbackQuery",{"callback_query_id":qid,"text":"تم تعديل يوم الاستحقاق ✅"})
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":project_billing_text(pid),"reply_markup":project_billing_keyboard(pid)})

    if data.startswith("ptset:"):
        _,days,pid=data.split(":",2)
        expires=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=int(days))).isoformat().replace("+00:00","Z")
        set_managed_timer(pid,expires,True)
        tg("answerCallbackQuery",{"callback_query_id":qid,"text":f"تم ضبط المؤقت {days} يوم ✅"})
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":project_timer_text(pid),"reply_markup":project_timer_keyboard(pid)})

    if data.startswith("ptcustom:"):
        pid=data.split(":",1)[1]
        set_session(user_id,"ptcustom",projectId=pid)
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return prompt(chat_id,"أرسل الموعد مع المنطقة الزمنية مثل:\n<code>2026-10-20T18:00+03:00</code>",f"ptimer:{pid}")

    if data.startswith("ptclear:"):
        pid=data.split(":",1)[1]
        set_managed_timer(pid,"",False)
        tg("answerCallbackQuery",{"callback_query_id":qid,"text":"تم إلغاء المؤقت ✅"})
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":project_timer_text(pid),"reply_markup":project_timer_keyboard(pid)})

    if data.startswith("paddversion:"):
        pid=data.split(":",1)[1]
        set_session(user_id,"pversion_name",projectId=pid)
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return prompt(chat_id,"أرسل اسم الإصدار أو التحديث، مثال <code>v1.5.14</code>.",f"pversions:{pid}")

    if data.startswith("pruntime:"):
        pid=data.split(":",1)[1]
        clear_session(user_id)
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":project_runtime_text(pid),"reply_markup":project_runtime_keyboard(pid)})

    if data.startswith("praddtype:"):
        _,kind,pid=data.split(":",2)
        all_targets=available_runtime_targets().get(kind,[])
        priority=[x for x in all_targets if any(k in x.lower() for k in ("uchiha","game","bot","radius","debt","school","deploy"))]
        rest=[x for x in all_targets if x not in priority]
        targets=(priority+rest)[:20]
        rows=[]
        for idx,name in enumerate(targets):
            rows.append([{"text":"➕ "+name[:44],"callback_data":f"prpick:{kind}:{idx}:{pid}"}])
        rows.append([{"text":"↩️ التشغيل","callback_data":"pruntime:"+pid}])
        set_session(user_id,"runtime_candidates",projectId=pid,kind=kind,targets=targets)
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":f"<b>اختر {e(kind)} موجودًا فعليًا على VPS</b>","reply_markup":keyboard(rows)})

    if data.startswith("prpick:"):
        _,kind,idx,pid=data.split(":",3)
        session=get_session(user_id)
        targets=((session or {}).get("data") or {}).get("targets",[])
        if not session or session.get("action")!="runtime_candidates" or int(idx)>=len(targets):
            tg("answerCallbackQuery",{"callback_query_id":qid,"text":"القائمة انتهت، افتحها مجددًا.","show_alert":"true"})
            return send_screen(chat_id,"projects",mid)
        name=targets[int(idx)]
        p=_project_by_id(pid)
        runtime=list((p or {}).get("runtime") or [])
        if not any(x.get("kind")==kind and x.get("name")==name for x in runtime):
            runtime.append({"kind":kind,"name":name})
            upsert_managed_project({"id":pid,"name":p.get("name"),"runtime":runtime})
        clear_session(user_id)
        tg("answerCallbackQuery",{"callback_query_id":qid,"text":"تم الربط ✅"})
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":project_runtime_text(pid),"reply_markup":project_runtime_keyboard(pid)})

    if data.startswith("prremove:"):
        _,kind,name,pid=data.split(":",3)
        p=_project_by_id(pid)
        runtime=[x for x in ((p or {}).get("runtime") or []) if not (x.get("kind")==kind and x.get("name")==name)]
        upsert_managed_project({"id":pid,"name":p.get("name"),"runtime":runtime})
        tg("answerCallbackQuery",{"callback_query_id":qid,"text":"تم فك الربط ✅"})
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":project_runtime_text(pid),"reply_markup":project_runtime_keyboard(pid)})

    if data.startswith("paskdelete:"):
        pid=data.split(":",1)[1]
        p=_project_by_id(pid)
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":f"<b>حذف من الكتالوج؟</b>\n\n{e((p or {}).get('name') or pid)}\nلن يتم حذف ملفات أو بيانات المشروع، فقط إزالته من مركز الإدارة.","reply_markup":keyboard([[{"text":"🗑 تأكيد الحذف","callback_data":"pconfirmdelete:"+pid},{"text":"إلغاء","callback_data":"pmanage:"+pid}]])})

    if data.startswith("pconfirmdelete:"):
        pid=data.split(":",1)[1]
        delete_managed_project(pid)
        tg("answerCallbackQuery",{"callback_query_id":qid,"text":"تمت الإزالة من الكتالوج"})
        return send_screen(chat_id,"projects",mid)

    if data.startswith("secretproj:"):
        pid=data.split(":",1)[1]
        clear_session(user_id)
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":secret_project_text(pid),"reply_markup":secret_project_keyboard(pid)})

    if data.startswith("secretadd:"):
        pid=data.split(":",1)[1]
        set_session(user_id,"secret_key",projectId=pid)
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return prompt(chat_id,"أرسل اسم المفتاح، مثال <code>BOT_TOKEN</code> أو <code>API_KEY</code>.",f"secretproj:{pid}")

    if data.startswith("secretdelask:"):
        _,encoded,pid=data.split(":",2)
        key=urllib.parse.unquote(encoded)
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":f"حذف المفتاح <code>{e(key)}</code>؟","reply_markup":keyboard([[{"text":"🗑 نعم","callback_data":"secretdel:"+encoded+":"+pid},{"text":"إلغاء","callback_data":"secretproj:"+pid}]])})

    if data.startswith("secretdel:"):
        _,encoded,pid=data.split(":",2)
        key=urllib.parse.unquote(encoded)
        delete_secret(pid,key)
        tg("answerCallbackQuery",{"callback_query_id":qid,"text":"تم حذف المفتاح ✅"})
        return tg("editMessageText",{"chat_id":chat_id,"message_id":mid,"parse_mode":"HTML","text":secret_project_text(pid),"reply_markup":secret_project_keyboard(pid)})

    if data=="noop":
        return tg("answerCallbackQuery",{"callback_query_id":qid,"text":"هذا المشروع غير مربوط بتشغيل فعلي بعد.","show_alert":"true"})

    if data.startswith("ptype:"):
        ptype=data.split(":",1)[1]
        if ptype not in ("app","website","bot","bundle","all"): ptype="all"
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return tg("editMessageText",{
            "chat_id":chat_id,"message_id":mid,"parse_mode":"HTML",
            "text":project_list_text(ptype),"reply_markup":project_list_keyboard(ptype)
        })

    if data.startswith("proj:"):
        pid=data.split(":",1)[1]
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return tg("editMessageText",{
            "chat_id":chat_id,"message_id":mid,"parse_mode":"HTML",
            "text":managed_project_text(pid),"reply_markup":managed_project_keyboard(pid)
        })

    if data.startswith("paskstart:"):
        pid=data.split(":",1)[1]
        p=next((x for x in managed_catalog() if x.get("id")==pid),None)
        tg("answerCallbackQuery",{"callback_query_id":qid})
        if not p: return send_screen(chat_id,"projects",mid)
        return tg("editMessageText",{
            "chat_id":chat_id,"message_id":mid,"parse_mode":"HTML",
            "text":f"<b>تأكيد تشغيل المشروع</b>\n\n▶️ {e(p.get('name'))}\nسيتم تشغيل كل مكوناته المرتبطة بالترتيب.",
            "reply_markup":keyboard([[{"text":"✅ تشغيل","callback_data":"pconfirmstart:"+pid},{"text":"إلغاء","callback_data":"proj:"+pid}]])
        })

    if data.startswith("pconfirmstart:"):
        pid=data.split(":",1)[1]
        tg("answerCallbackQuery",{"callback_query_id":qid,"text":"جاري التشغيل…"})
        try:
            start_managed_project(pid)
            time.sleep(1)
            return tg("editMessageText",{
                "chat_id":chat_id,"message_id":mid,"parse_mode":"HTML",
                "text":managed_project_text(pid),"reply_markup":managed_project_keyboard(pid)
            })
        except Exception:
            return tg("sendMessage",{"chat_id":chat_id,"text":"❌ تعذر تشغيل المشروع. راجع مركز العمليات والسجلات."})

    if data.startswith("paskstop:"):
        pid=data.split(":",1)[1]
        p=next((x for x in managed_catalog() if x.get("id")==pid),None)
        tg("answerCallbackQuery",{"callback_query_id":qid})
        if not p: return send_screen(chat_id,"projects",mid)
        return tg("editMessageText",{
            "chat_id":chat_id,"message_id":mid,"parse_mode":"HTML",
            "text":f"<b>تأكيد إطفاء المشروع</b>\n\n⏹ {e(p.get('name'))}\nسيتم إيقاف المكونات المرتبطة فقط، ولن تُحذف البيانات.",
            "reply_markup":keyboard([[{"text":"⏹ نعم، أطفئه","callback_data":"pconfirmstop:"+pid},{"text":"إلغاء","callback_data":"proj:"+pid}]])
        })

    if data.startswith("pconfirmstop:"):
        pid=data.split(":",1)[1]
        tg("answerCallbackQuery",{"callback_query_id":qid,"text":"جاري الإيقاف…"})
        try:
            stop_managed_project(pid,"telegram")
            time.sleep(1)
            return tg("editMessageText",{
                "chat_id":chat_id,"message_id":mid,"parse_mode":"HTML",
                "text":managed_project_text(pid),"reply_markup":managed_project_keyboard(pid)
            })
        except Exception:
            return tg("sendMessage",{"chat_id":chat_id,"text":"❌ تعذر إيقاف المشروع. راجع مركز العمليات والسجلات."})

    if data.startswith("paskpaid:"):
        pid=data.split(":",1)[1]
        p=next((x for x in managed_catalog() if x.get("id")==pid),None)
        tg("answerCallbackQuery",{"callback_query_id":qid})
        if not p: return send_screen(chat_id,"projects",mid)
        b=p.get("billing") or {}
        return tg("editMessageText",{
            "chat_id":chat_id,"message_id":mid,"parse_mode":"HTML",
            "text":f"<b>تأكيد استلام الدفعة</b>\n\nالمشروع: {e(p.get('name'))}\nالمبلغ الشهري: <b>{e(b.get('monthlyFee'))} {e(b.get('currency'))}</b>",
            "reply_markup":keyboard([[{"text":"💵 تم الاستلام","callback_data":"pconfirmpaid:"+pid},{"text":"إلغاء","callback_data":"proj:"+pid}]])
        })

    if data.startswith("pconfirmpaid:"):
        pid=data.split(":",1)[1]
        tg("answerCallbackQuery",{"callback_query_id":qid,"text":"تم تسجيل الدفعة ✅"})
        try:
            mark_managed_paid(pid)
            return tg("editMessageText",{
                "chat_id":chat_id,"message_id":mid,"parse_mode":"HTML",
                "text":managed_project_text(pid),"reply_markup":managed_project_keyboard(pid)
            })
        except Exception:
            return tg("sendMessage",{"chat_id":chat_id,"text":"تعذر تسجيل الدفعة."})

    if data.startswith("paskrenew:"):
        pid=data.split(":",1)[1]
        p=next((x for x in managed_catalog() if x.get("id")==pid),None)
        tg("answerCallbackQuery",{"callback_query_id":qid})
        if not p: return send_screen(chat_id,"projects",mid)
        b=p.get("billing") or {}
        return tg("editMessageText",{
            "chat_id":chat_id,"message_id":mid,"parse_mode":"HTML",
            "text":f"<b>تأكيد الاستلام والتجديد</b>\n\nالمشروع: {e(p.get('name'))}\nالمبلغ: <b>{e(b.get('monthlyFee'))} {e(b.get('currency'))}</b>\nسيتم تسجيل الدفعة وتمديد مؤقت الإيقاف 30 يوم.",
            "reply_markup":keyboard([[{"text":"🔁 تأكيد +30 يوم","callback_data":"pconfirmrenew:"+pid},{"text":"إلغاء","callback_data":"proj:"+pid}]])
        })

    if data.startswith("pconfirmrenew:"):
        pid=data.split(":",1)[1]
        tg("answerCallbackQuery",{"callback_query_id":qid,"text":"تم التجديد 30 يوم ✅"})
        try:
            renew_managed_project(pid,30)
            return tg("editMessageText",{
                "chat_id":chat_id,"message_id":mid,"parse_mode":"HTML",
                "text":managed_project_text(pid),"reply_markup":managed_project_keyboard(pid)
            })
        except Exception:
            return tg("sendMessage",{"chat_id":chat_id,"text":"تعذر تنفيذ التجديد."})

    if data=="refresh":
        tg("answerCallbackQuery",{"callback_query_id":qid,"text":"جاري تحديث القياسات…"})
        try:
            refresh_infrastructure()
            return send_screen(chat_id,"home",mid)
        except Exception:
            return tg("sendMessage",{"chat_id":chat_id,"text":"تعذر تحديث القياسات الآن."})

    if data=="asknginx":
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return tg("editMessageText",{
            "chat_id":chat_id,"message_id":mid,"parse_mode":"HTML",
            "text":"<b>تأكيد Reload Nginx</b>\n\nسيتم فحص الإعدادات أولًا ثم إعادة تحميل Nginx بدون إيقاف السيرفر.",
            "reply_markup":keyboard([[{"text":"✅ تأكيد","callback_data":"confirmnginx"},{"text":"إلغاء","callback_data":"operations"}]])
        })

    if data=="confirmnginx":
        tg("answerCallbackQuery",{"callback_query_id":qid,"text":"جاري التنفيذ…"})
        try:
            restart_nginx()
            return send_screen(chat_id,"operations",mid)
        except Exception:
            return tg("sendMessage",{"chat_id":chat_id,"text":"❌ فشل Reload Nginx."})

    if data=="askbackup":
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return tg("editMessageText",{
            "chat_id":chat_id,"message_id":mid,"parse_mode":"HTML",
            "text":"<b>تأكيد نسخة احتياطية</b>\n\nسيتم إنشاء pg_dump فعلي لقاعدة البيانات الحالية وحفظه على VPS بصلاحيات محمية.",
            "reply_markup":keyboard([[{"text":"💾 إنشاء الآن","callback_data":"confirmbackup"},{"text":"إلغاء","callback_data":"backups"}]])
        })

    if data=="confirmbackup":
        tg("answerCallbackQuery",{"callback_query_id":qid,"text":"جاري إنشاء النسخة…"})
        try:
            item=create_database_backup()
            return tg("editMessageText",{
                "chat_id":chat_id,"message_id":mid,"parse_mode":"HTML",
                "text":f"✅ <b>تم إنشاء النسخة الاحتياطية</b>\n\n<code>{e(item.get('name'))}</code>\nالحجم: {item.get('size',0)/1024/1024:.2f} MB",
                "reply_markup":backups_keyboard()
            })
        except Exception:
            return tg("sendMessage",{"chat_id":chat_id,"text":"❌ فشل إنشاء النسخة الاحتياطية."})

    if data.startswith("askrestart:"):
        name=data.split(":",1)[1]
        tg("answerCallbackQuery",{"callback_query_id":qid})
        return tg("editMessageText",{
            "chat_id":chat_id,"message_id":mid,"parse_mode":"HTML",
            "text":f"<b>تأكيد إعادة التشغيل</b>\n\nالحاوية: <code>{e(name)}</code>\nقد تنقطع خدمتها لثوانٍ قليلة.",
            "reply_markup":keyboard([[{"text":"🔄 إعادة التشغيل","callback_data":"confirmrestart:"+name},{"text":"إلغاء","callback_data":"operations"}]])
        })

    if data.startswith("confirmrestart:"):
        name=data.split(":",1)[1]
        tg("answerCallbackQuery",{"callback_query_id":qid,"text":"جاري إعادة التشغيل…"})
        try:
            restart_container(name)
            refresh_infrastructure()
            return send_screen(chat_id,"operations",mid)
        except Exception:
            return tg("sendMessage",{"chat_id":chat_id,"text":f"❌ فشل إعادة تشغيل {e(name)}.","parse_mode":"HTML"})

    if data.startswith("logs:"):
        name=data.split(":",1)[1]
        tg("answerCallbackQuery",{"callback_query_id":qid,"text":"جاري جلب السجل…"})
        try:
            item=safe_container_logs(name,120)
            body=e(item.get("lines") or "لا توجد سجلات.")
            return tg("editMessageText",{
                "chat_id":chat_id,"message_id":mid,"parse_mode":"HTML",
                "text":f"<b>📜 Logs — {e(name)}</b>\n\n<pre>{body[:3300]}</pre>\n<i>تم إخفاء الأنماط الحساسة تلقائيًا.</i>",
                "reply_markup":keyboard([[{"text":"↩️ العمليات","callback_data":"operations"}]])
            })
        except Exception:
            return tg("sendMessage",{"chat_id":chat_id,"text":"تعذر قراءة السجل."})

    tg("answerCallbackQuery",{"callback_query_id":qid})
    return send_screen(chat_id,data,mid)

def configure():
    try:
        info=tg("getMe",{})
        if isinstance(info,dict):
            os.makedirs("/var/lib/uchiha-telegram-control",exist_ok=True)
            p="/var/lib/uchiha-telegram-control/bot-info.json"
            with open(p+".tmp","w",encoding="utf-8") as f:
                json.dump({k:info.get(k) for k in ("id","username","first_name","can_join_groups","supports_inline_queries")},f,ensure_ascii=False,separators=(",",":"))
            os.chmod(p+".tmp",0o600)
            os.replace(p+".tmp",p)
    except Exception:
        pass
    try:
        tg("setChatMenuButton",{"menu_button":json.dumps({"type":"web_app","text":"الإحصائيات","web_app":{"url":WEBAPP_URL}},ensure_ascii=False)})
    except Exception:
        pass
    try:
        tg("setMyCommands",{"commands":json.dumps([
            {"command":"start","description":"فتح لوحة UCHIHA"},
            {"command":"projects","description":"المشاريع"},
            {"command":"secrets","description":"الأسرار"},
            {"command":"server","description":"حالة السيرفر"},
            {"command":"domains","description":"الدومينات"},
            {"command":"reports","description":"التقارير"},
            {"command":"ops","description":"مركز العمليات"},
            {"command":"backups","description":"النسخ الاحتياطية"},
            {"command":"alerts","description":"التنبيهات الحالية"}
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
                except urllib.error.HTTPError as inner:
                    try:
                        detail=inner.read().decode("utf-8","replace")[:500]
                    except Exception:
                        detail=""
                    print("update http",inner.code,detail,file=sys.stderr)
                except Exception as inner:
                    print("update error",type(inner).__name__,str(inner)[:300],file=sys.stderr)
        except urllib.error.HTTPError as ex:
            print("telegram http",ex.code,file=sys.stderr); time.sleep(5)
        except Exception as ex:
            print("telegram error",type(ex).__name__,file=sys.stderr); time.sleep(5)

if __name__=="__main__":
    raise SystemExit(main())