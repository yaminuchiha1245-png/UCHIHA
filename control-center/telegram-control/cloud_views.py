#!/usr/bin/env python3
"""Telegram-only screens for the cloud monitor. UI never mutates cloud services."""
import datetime as dt
import html
import time

from cloud_monitor import METRICS, list_links, get_link, snapshot, usage_report
from project_manager import catalog

def esc(v):
    return html.escape(str(v if v is not None and v != "" else "غير متاح"))

def buttons(rows):
    import json
    return json.dumps({"inline_keyboard": rows}, ensure_ascii=False, separators=(",", ":"))

def home():
    links = list_links()
    # Avoid double counting fixed provider charges when a backend serves several apps.
    distinct = {}
    for row in links:
        distinct.setdefault((row["provider"], row["remote_id"]), row)
        if distinct[(row["provider"], row["remote_id"])]["fixed_usd"] is None and row["fixed_usd"] is not None:
            distinct[(row["provider"], row["remote_id"])] = row
    costs = [r["fixed_usd"] for r in distinct.values() if r["fixed_usd"] is not None]
    near_limit = []
    for row in links:
        if row["plan"] != "free":
            continue
        view = snapshot(row["id"])
        for metric, measurement in view["metrics"].items():
            limit = view["limits"].get(metric)
            if (metric in METRICS and limit and limit["unit"] == measurement["unit"]
                and metric != "api_requests_window" and not metric.endswith("_hour")
                and time.time() - measurement["epoch"] < 3600
                and measurement["value"] >= 0.95 * limit["amount"]):
                near_limit.append(row["project_id"])
                break
    lines = ["<b>☁️ إدارة الخدمات السحابية والتطبيقات</b>", "",
             f"المشاريع المربوطة: <b>{len(set(r['project_id'] for r in links))}</b> | الخدمات: <b>{len(links)}</b>",
             f"مجانية (تصنيف يدوي): {sum(r['plan']=='free' for r in links)} | مدفوعة: {sum(r['plan']=='paid' for r in links)}",
             f"🟠 مشاريع مجانية قد تحتاج ترقية: <b>{len(set(near_limit))}</b>",
             f"تكاليف ثابتة مُدخلة: <b>USD {sum(costs):,.2f}</b> ({len(costs)} خدمات فريدة فقط)",
             "<i>ليست فاتورة فعلية؛ الرسوم المشتركة بين عدة مشاريع والمنظمة غير محسوبة بدقة.</i>", ""]
    if not links: lines.append("لا يوجد ربط بعد. اختر ➕ ربط مشروع.")
    for r in links[:18]:
        lines.append(f"{'⚠️' if r['error'] else '☁️'} <b>{esc(r['project_id'])}</b> · {esc(r['provider'])} · <code>{esc(r['remote_id'])}</code>")
    if len(links)>18: lines.append(f"... و{len(links)-18} خدمات إضافية.")
    rows = [[{"text": r["project_id"][:23]+" / "+r["provider"],"callback_data":"cloud:link:"+r["id"]}]
            for r in links[:25]]
    rows.extend([
        [{"text":"➕ ربط مشروع","callback_data":"cloud:add"}],
        [{"text":"📅 تقرير يوم","callback_data":"cloud:report:1"},{"text":"🗓 تقرير 30 يوم","callback_data":"cloud:report:30"}],
        [{"text":"🔄 تحديث الصفحة","callback_data":"cloud"},{"text":"🏠 الرئيسية","callback_data":"home"}]
    ])
    return "\n".join(lines)[:3900], buttons(rows)

def select_project():
    projects = catalog()
    rows = [[{"text":p["name"][:43],"callback_data":"cloud:pick:"+p["id"]}] for p in projects[:28]]
    rows.append([{"text":"↩️ الخدمات","callback_data":"cloud"}])
    return "<b>☁️ اختر المشروع المراد ربطه</b>\n\nاختر مشروعاً من سجل UCHIHA الحالي.", buttons(rows)

def project(pid):
    item = next((x for x in catalog() if x["id"]==pid), None)
    links = [x for x in list_links() if x["project_id"]==pid]
    if not item: return "المشروع غير موجود.", buttons([[{"text":"↩️ الخدمات","callback_data":"cloud"}]])
    rows = [[{"text":x["provider"]+" / "+x["remote_id"][:25],"callback_data":"cloud:link:"+x["id"]}] for x in links]
    rows.append([{"text":"➕ ربط مزود","callback_data":"cloud:addfor:"+pid}])
    rows.append([{"text":"↩️ الخدمات","callback_data":"cloud"},{"text":"📦 المشروع","callback_data":"proj:"+pid}])
    return f"<b>☁️ {esc(item['name'])}</b>\n\nعدد خدمات البيانات المربوطة: {len(links)}", buttons(rows)

def choose_provider(pid):
    return (f"<b>ربط خدمة بالمشروع {esc(pid)}</b>\n"
            "Supabase: مرجع المشروع. Firebase: معرف Google Cloud project.\n"
            "أسرار القراءة توضع في مخزن أسرار المشروع، لا في بيانات الربط.",
            buttons([
                [{"text":"Supabase","callback_data":"cloud:provider:supabase:"+pid}],
                [{"text":"Firebase","callback_data":"cloud:provider:firebase:"+pid}],
                [{"text":"قاعدة بيانات أخرى / قياس داخلي","callback_data":"cloud:provider:other:"+pid}],
                [{"text":"↩️ المشروع","callback_data":"cloud:project:"+pid}]
            ]))

def detail(link_id):
    x=snapshot(link_id)
    if not x: return "الربط غير موجود.", buttons([[{"text":"↩️ الخدمات","callback_data":"cloud"}]])
    lines = [f"<b>☁️ {esc(x['project_id'])}</b>",
             f"الخدمة: {esc(x['provider'])} / <code>{esc(x['remote_id'])}</code>",
             f"الباقة: <b>{esc(x['plan'])}</b> (تصنيف إداري)",
             f"آخر فحص: {esc(x['checked_at'])}",
             f"حالة الجلب: {esc(x['error'] or 'بلا أخطاء')}",
             f"التكلفة الثابتة: {('USD %.2f' % x['fixed_usd']) if x['fixed_usd'] is not None else 'غير محددة'}",
             "", "<b>📊 قياسات فعلية:</b>"]
    displayed=0
    for metric, v in x["metrics"].items():
        if metric not in METRICS: continue
        displayed+=1
        label,unit=METRICS[metric]
        freshness = 30*3600 if metric in ("db_bytes","rtdb_db_bytes") else 3600
        fresh=time.time()-v["epoch"] < freshness
        line=f"{'🟢' if fresh else '⚪️'} {esc(label)}: <b>{v['value']:,.0f} {unit}</b>"
        lim=x["limits"].get(metric)
        if lim and fresh and lim["unit"]==unit and metric!="api_requests_window" and not metric.endswith("_hour"):
            pct=100*v["value"]/lim["amount"]
            line+=f"\n  الحد: {lim['amount']:,.0f} | المتبقي: {max(0,lim['amount']-v['value']):,.0f} | <b>{pct:.1f}%</b>"
            line+=f"\n  مصدر الحد: {esc(lim['origin'])}"
        else: line+="\n  الحد/المتبقي: غير متاح"
        line+=f"\n  <i>المصدر: {esc(v['source'])} / {esc(v['period'])} / {esc(v['at'])}</i>"
        lines.append(line)
    if not displayed: lines.append("المؤشرات غير متاحة حالياً أو لم تُفعّل الصلاحيات.")
    last=x["latest_device_seen"]
    active=x["active_devices_15m"]
    lines.extend(["","<b>📱 أجهزة التطبيق والمزامنة</b>",
        f"أجهزة أرسلت نبضات آخر 15 دقيقة: {active if active is not None else (0 if last else 'غير متاح')}",
        f"آخر اتصال: {dt.datetime.fromtimestamp(last,dt.timezone.utc).isoformat() if last else 'غير متاح'}",
        f"آخر حالة مزامنة: {esc((x['sync'] or {}).get('state'))}",
        "<i>عدد الأجهزة من نبضات التطبيق فقط؛ تكلفة الفاتورة النهائية غير متاحة دون ربط الفوترة.</i>"])
    rows=[
        [{"text":"🔄 جلب جديد","callback_data":"cloud:refresh:"+link_id},{"text":"📊 ضبط حدود","callback_data":"cloud:limits:"+link_id}],
        [{"text":"💵 تكلفة شهرية ثابتة","callback_data":"cloud:cost:"+link_id},{"text":"🎫 الباقة","callback_data":"cloud:plans:"+link_id}],
        [{"text":"🔔 "+("تعطيل" if x["alerts"] else "تفعيل")+" التنبيهات","callback_data":"cloud:alerts:"+link_id}],
        [{"text":"🗑 إزالة الربط","callback_data":"cloud:askremove:"+link_id}],
        [{"text":"↩️ الخدمات","callback_data":"cloud"},{"text":"🏠 الرئيسية","callback_data":"home"}]
    ]
    return "\n".join(lines)[:3900], buttons(rows)

def report(days):
    data=usage_report(days)
    lookup={x["id"]:x for x in list_links()}
    lines=[f"<b>📊 عينات الخدمات السحابية / آخر {data['days']} يوم</b>", ""]
    if not data["samples"]: lines.append("لا توجد عينات مسجلة.")
    for s in data["samples"][:24]:
        project=lookup.get(s["link_id"],{}).get("project_id","—")
        label=METRICS.get(s["metric"],(s["metric"],))[0]
        lines.append(f"• <b>{esc(project)}</b> / {esc(label)}\n  عدد العينات: {s['sample_count']} · الأدنى: {s['low']:,.0f} · الأعلى: {s['high']:,.0f}")
    lines.append("\n<i>هذه عينات تاريخية لا تُجمع لتصبح قيمة فاتورة أو استهلاك شهر كامل.</i>")
    return "\n".join(lines)[:3900], buttons([[{"text":"↩️ الخدمات","callback_data":"cloud"}]])
