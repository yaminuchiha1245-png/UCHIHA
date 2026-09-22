from __future__ import annotations

import html
import json
import os
import secrets
import time
import urllib.error
import urllib.request

from credential_vault import CredentialVault
from provider_store import ProviderStore
from site_routing import encode_route
from v37_gateway import V37Gateway, V37GatewayError

TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
API = f"https://api.telegram.org/bot{TOKEN}"
WEBAPP_URL = os.getenv("UCHIHA_RADIUS_TELEGRAM_WEBAPP_URL","https://radius.uchiha-builder.com/telegram/")
INSTALLER_URL = os.getenv(
    "UCHIHA_RADIUS_SITE_AGENT_INSTALLER_URL",
    WEBAPP_URL.rstrip("/").rsplit("/telegram",1)[0] + "/site-agent/install.sh",
)
STORE = ProviderStore(os.getenv("UCHIHA_RADIUS_PROVIDER_DB","/var/lib/uchiha-radius/provider.sqlite3"))
VAULT = CredentialVault.from_env()
PENDING: dict[int,str] = {}
V37: V37Gateway | None = None
try:
    secret_file = os.getenv("UCHIHA_RADIUS_V37_HMAC_SECRET_FILE","").strip()
    secret_value = os.getenv("UCHIHA_RADIUS_V37_HMAC_SECRET","").strip()
    base_url = os.getenv("UCHIHA_RADIUS_V37_BASE_URL","http://127.0.0.1:8792")
    key_id = os.getenv("UCHIHA_RADIUS_V37_HMAC_KEY_ID","telegram-provider")
    public_host = os.getenv("UCHIHA_RADIUS_PUBLIC_ORIGIN","https://radius.uchiha-builder.com").split("://",1)[-1].split("/",1)[0]
    if secret_file:
        V37 = V37Gateway.from_secret_file(
            base_url,
            key_id=key_id,
            secret_file=secret_file,
            public_host=public_host,
        )
    elif secret_value:
        V37 = V37Gateway(
            base_url,
            key_id=key_id,
            secret=secret_value,
            public_host=public_host,
        )
except Exception:
    V37 = None

owner = int(os.getenv("UCHIHA_RADIUS_OWNER_TELEGRAM_ID","0") or 0)
if owner:
    STORE.bootstrap_owner(
        owner,
        provider_name=os.getenv("UCHIHA_RADIUS_DEFAULT_PROVIDER_NAME","UCHIHA Provider"),
        provider_code=os.getenv("UCHIHA_RADIUS_DEFAULT_PROVIDER_CODE","UCHIHA"),
    )


def esc(value) -> str:
    return html.escape(str(value or ""), quote=True)


def call(method: str, payload: dict) -> dict:
    request = urllib.request.Request(
        f"{API}/{method}",
        data=json.dumps(payload,ensure_ascii=False).encode(),
        headers={"Content-Type":"application/json"},
    )
    with urllib.request.urlopen(request,timeout=35) as response:
        return json.loads(response.read().decode())


def private_operator_chat(chat: dict, user: dict) -> bool:
    """Never show provider records or one-time credentials in group chats."""
    try:
        return (chat.get("type") == "private"
                and int(chat.get("id") or 0) > 0
                and int(chat.get("id") or 0) == int(user.get("id") or 0))
    except (TypeError, ValueError, AttributeError):
        return False


def keyboard() -> dict:
    return {"inline_keyboard":[
      [{"text":"📊 الرئيسية","callback_data":"dashboard"},{"text":"🩺 حالة المنظومة","callback_data":"system_status"}],
      [{"text":"👥 المشتركون","callback_data":"subscribers"},{"text":"📦 الباقات","callback_data":"plans"}],
      [{"text":"📡 الراوترات","callback_data":"routers"},{"text":"🌐 الجلسات","callback_data":"sessions"}],
      [{"text":"💳 الفواتير","callback_data":"billing"},{"text":"🧾 سجل التدقيق","callback_data":"audit"}],
      [{"text":"➕ مشترك","callback_data":"add_subscriber"},{"text":"➕ باقة","callback_data":"add_plan"}],
      [{"text":"➕ تسجيل MikroTik","callback_data":"add_router"},{"text":"🔗 ربط MikroTik","callback_data":"agent_setup"}],
      [{"text":"🧩 تعليمات الربط","callback_data":"agent_help"}],
      [{"text":"🖥 فتح واجهة RADIUS الكاملة","web_app":{"url":WEBAPP_URL}}],
    ]}


def send(chat_id: int, text: str, reply_markup: dict | None = None) -> None:
    payload={"chat_id":chat_id,"text":text,"parse_mode":"HTML","disable_web_page_preview":True}
    payload["reply_markup"] = reply_markup or keyboard()
    call("sendMessage",payload)


def agent_help_text() -> str:
    return (
        "<b>ربط MikroTik بمزود UCHIHA RADIUS</b>\n\n"
        "1) سجّل MikroTik من زر <b>تسجيل MikroTik</b>.\n"
        "2) اضغط <b>ربط MikroTik</b> واختر الجهاز لتحصل على رمز ربط لمرة واحدة.\n"
        "3) على جهاز Linux داخل نفس شبكة المزود، نزّل مثبت Site Agent من:\n"
        f"<code>{esc(INSTALLER_URL)}</code>\n"
        "4) شغّل المثبت كمسؤول. سيطلب رمز الربط وIP الداخلي وبيانات RouterOS محليًا.\n"
        "5) بيانات دخول MikroTik لا تُرسل إلى Telegram ولا إلى السيرفر المركزي؛ تبقى داخل موقع المزود.\n"
        "6) بعد نجاح التثبيت ارجع إلى البوت واضغط <b>الحالة</b> بجانب الجهاز.\n\n"
        "المثبت يجهز FreeRADIUS وSite Agent وGateway، ويترك إعداد MikroTik النهائي للمراجعة قبل تطبيقه."
    )


PAGE_SIZE = 8
PAGE_KINDS = frozenset({"subscribers", "plans", "routers", "sessions", "billing"})


def page_buttons(kind: str, page: int, total: int, *, prefix: str = "page") -> list[list[dict]]:
    pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    buttons = []
    if page > 0:
        buttons.append({"text": "◀️ السابقة", "callback_data": f"{prefix}:{kind}:{page-1}"})
    buttons.append({"text": f"{page+1}/{pages}", "callback_data": f"{prefix}:{kind}:{page}"})
    if page + 1 < pages:
        buttons.append({"text": "التالية ▶️", "callback_data": f"{prefix}:{kind}:{page+1}"})
    return [buttons]


def agent_router_keyboard(access, page: int = 0) -> dict:
    items, page, total = STORE.paged_records(access, "routers", page, PAGE_SIZE)
    rows = []
    for router in items:
        rid = str(router["id"])
        label = str(router.get("name") or router.get("code") or rid)
        rows.append([
            {"text": f"🔗 {label}"[:40], "callback_data": f"agent:{rid}"},
            {"text": "📶 الحالة", "callback_data": f"ast:{rid}"},
        ])
    rows.extend(page_buttons("routers", page, total, prefix="agentpage"))
    rows.append([{"text": "↩️ الرئيسية", "callback_data": "dashboard"}])
    return {"inline_keyboard": rows}


def v37_role(access) -> str:
    return {
        "owner":"owner",
        "admin":"operator",
        "operator":"operator",
        "viewer":"auditor",
    }.get(access.role,"auditor")


def gateway_actor(access) -> str:
    return f"telegram-bot:{access.telegram_user_id}:{access.provider_id}"


def subscribers_keyboard(access, page: int = 0) -> dict:
    items, page, total = STORE.paged_records(access, "subscribers", page, PAGE_SIZE)
    rows = []
    for item in items:
        sid = str(item["id"])
        status = str(item.get("status") or "")
        icon = "🟢" if status == "active" else "⏸" if status == "suspended" else "⚪"
        name = str(item.get("full_name") or item.get("username") or sid)
        rows.append([{"text": f"{icon} {name}"[:48], "callback_data": f"sub:{sid}"}])
    rows.extend(page_buttons("subscribers", page, total))
    rows.append([{"text": "🔎 بحث عن مشترك", "callback_data": "search_subscribers"}])
    if can_write(access):
        rows.append([{"text": "➕ مشترك", "callback_data": "add_subscriber"}])
    rows.append([{"text": "🏠 الرئيسية", "callback_data": "dashboard"}])
    return {"inline_keyboard": rows}


def subscriber_detail(access, subscriber_id: str) -> str:
    item = STORE.get_subscriber(access, subscriber_id)
    if not item:
        return "تعذر العثور على المشترك لدى مزودك."
    return (
        "<b>بيانات المشترك</b>\n\n"
        f"الاسم: <b>{esc(item.get('full_name'))}</b>\n"
        f"المستخدم: <code>{esc(item.get('username'))}</code>\n"
        f"الباقة: {esc(item.get('plan') or '—')}\n"
        f"الحالة: <b>{esc(item.get('status') or '—')}</b>\n\n"
        "بيانات تسجيل الدخول السرية غير معروضة."
    )


def subscriber_actions_keyboard(access, subscriber_id: str) -> dict:
    item = STORE.get_subscriber(access, subscriber_id)
    rows = []
    if item and can_write(access):
        status = str(item.get("status") or "")
        if status == "active":
            rows.append([{"text": "⏸ تعليق المشترك", "callback_data": f"subact:suspend:{subscriber_id}"}])
        elif status == "suspended":
            rows.append([{"text": "▶️ إعادة التفعيل", "callback_data": f"subact:resume:{subscriber_id}"}])
    rows.append([{"text": "↩️ المشتركون", "callback_data": "subscribers"}])
    return {"inline_keyboard": rows}


def subscriber_confirmation_keyboard(action: str, subscriber_id: str) -> dict:
    name = "تأكيد التعليق" if action == "suspend" else "تأكيد إعادة التفعيل"
    return {"inline_keyboard": [
        [{"text": f"✅ {name}", "callback_data": f"subconfirm:{action}:{subscriber_id}"}],
        [{"text": "إلغاء", "callback_data": f"sub:{subscriber_id}"}],
    ]}


def change_subscriber_status(access, subscriber_id: str, action: str) -> tuple[bool, str]:
    if not can_write(access):
        return False, "صلاحيتك للقراءة فقط."
    transitions = {"suspend": ("active", "suspended"), "resume": ("suspended", "active")}
    if action not in transitions:
        return False, "العملية غير مدعومة."
    before, after = transitions[action]
    item = STORE.get_subscriber(access, subscriber_id)
    if not item:
        return False, "المشترك غير موجود لدى مزودك."
    if item.get("status") != before:
        return False, "تغيرت حالة المشترك. راجع بياناته الحالية قبل إعادة المحاولة."
    try:
        STORE.update_status(access, "subscriber", subscriber_id, after, expected=before)
    except (RuntimeError, KeyError):
        return False, "تغيرت بيانات المشترك. افتح بياناته مجددًا."
    except PermissionError:
        return False, "صلاحيتك لا تسمح بتعديل المشترك."
    if after == "suspended":
        return True, "تم تعليق الحساب في قاعدة البيانات. سيتوقف قبول الاتصالات الجديدة بعد مزامنة Site Agent؛ افصل الجلسة الحالية بصورة منفصلة إذا لزم الأمر."
    return True, "تمت إعادة تفعيل الحساب. سيظهر لدى Site Agent في دورة المزامنة التالية."


def session_by_id(access, session_id: str):
    return STORE.get_session(access, session_id)


def sessions_keyboard(access, page: int = 0) -> dict:
    items, page, total = STORE.paged_records(access, "sessions", page, PAGE_SIZE)
    rows=[]
    for item in items:
        sid=str(item.get("id") or "")
        username=str(item.get("username") or sid)
        state=str(item.get("status") or "")
        icon="🟢" if state=="online" else "⚫"
        rows.append([{"text":f"{icon} {username}"[:48],"callback_data":f"sess:{sid}"}])
    rows.extend(page_buttons("sessions", page, total))
    rows.append([{"text":"↩️ الرئيسية","callback_data":"dashboard"}])
    return {"inline_keyboard":rows}


def session_action_keyboard(session_id: str, can_control: bool) -> dict:
    rows=[]
    if can_control:
        rows.append([
            {"text":"🔄 إعادة مصادقة","callback_data":f"sact:reauthenticate:{session_id}"},
            {"text":"🔎 مراجعة","callback_data":f"sact:review:{session_id}"},
        ])
        rows.append([
            {"text":"⛔ قطع الجلسة","callback_data":f"sact:disconnect:{session_id}"},
        ])
    rows.append([
        {"text":"↩️ الجلسات","callback_data":"sessions"},
        {"text":"🏠 الرئيسية","callback_data":"dashboard"},
    ])
    return {"inline_keyboard":rows}


def session_confirmation_keyboard(operation: str, session_id: str) -> dict:
    label={
        "disconnect":"✅ تأكيد قطع الجلسة",
        "reauthenticate":"✅ تأكيد إعادة المصادقة",
        "review":"✅ تأكيد المراجعة",
    }.get(operation,"✅ تأكيد")
    return {"inline_keyboard":[
        [{"text":label,"callback_data":f"sconfirm:{operation}:{session_id}"}],
        [{"text":"إلغاء","callback_data":f"sess:{session_id}"}],
    ]}


def session_detail(access, session_id: str) -> str:
    item=session_by_id(access,session_id)
    if not item:
        return "تعذر العثور على الجلسة."
    return (
        "<b>تفاصيل جلسة RADIUS</b>\n\n"
        f"المستخدم: <code>{esc(item.get('username'))}</code>\n"
        f"الجلسة: <code>{esc(item.get('id'))}</code>\n"
        f"الراوتر: <code>{esc(item.get('nas') or item.get('router_name') or item.get('router_id') or '—')}</code>\n"
        f"IP: <code>{esc(item.get('framed_ip') or '—')}</code>\n"
        f"النوع: {esc(item.get('access_kind') or 'RADIUS')}\n"
        f"الحالة: <b>{esc(item.get('status') or '—')}</b>\n"
        f"الدخول: {int(item.get('input_octets') or 0)} B\n"
        f"الخروج: {int(item.get('output_octets') or 0)} B"
    )


def audit_listing(access) -> str:
    items=STORE.workflow_actions(access)[:12]
    if not items:
        return "<b>سجل التدقيق</b>\nلا توجد عمليات مسجلة بعد."
    lines=["<b>سجل التدقيق</b>"]
    for item in items:
        lines.append(
            f"• <code>{esc(item.get('id'))}</code> · "
            f"{esc(item.get('title'))} · {esc(item.get('status'))}"
        )
    return "\n".join(lines)


def system_status(access) -> str:
    data=STORE.dashboard(access)
    routers=STORE.list_routers(access)
    agent_online=0
    agent_registered=0
    for router in routers:
        status=STORE.site_agent_status(access,str(router.get("id") or ""))
        if status.get("registered"):
            agent_registered+=1
        if status.get("online"):
            agent_online+=1

    v37_text="غير مهيأ"
    adapter="—"
    if V37 is not None:
        try:
            response=V37.request(
                "GET",
                "/api/connectors/radius/health",
                actor=gateway_actor(access),
                role=v37_role(access),
            )
            if response.status==200:
                body=response.json()
                v37_text="متصل" if body.get("ok") else "غير جاهز"
                adapter=str(body.get("adapterMode") or body.get("adapter") or "—")
            else:
                v37_text=f"HTTP {response.status}"
        except Exception:
            v37_text="غير متصل"

    return (
        "<b>حالة منظومة UCHIHA RADIUS</b>\n\n"
        f"Backend v37: <b>{esc(v37_text)}</b>\n"
        f"الوضع: <code>{esc(adapter)}</code>\n"
        f"Site Agent: <b>{agent_online}/{agent_registered}</b> متصل\n"
        f"الراوترات: <b>{data['totals']['nodes']}</b>\n"
        f"الجلسات المتصلة: <b>{data['gateway']['snapshot']['activeSessions']}</b>\n"
        f"المشتركون: <b>{data['totals']['subscribers']}</b>"
    )


def execute_session_operation(access, session_id: str, operation: str) -> tuple[bool,str]:
    if operation not in {"disconnect","reauthenticate","review"}:
        return False,"العملية غير مدعومة."
    if operation in {"disconnect","reauthenticate"} and not can_write(access):
        return False,"صلاحيتك لا تسمح بتنفيذ أمر شبكي."
    if V37 is None:
        return False,"Backend v37 غير مهيأ للبوت."

    item=session_by_id(access,session_id)
    if not item:
        return False,"الجلسة غير موجودة."
    route=STORE.router_route(
        access,
        str(item.get("nas") or item.get("router_name") or ""),
        str(item.get("id") or ""),
    )
    if not route:
        return False,"الجلسة غير مربوطة براوتر المزود."
    router_id,router_code=route
    request_id=f"BOT-{int(time.time())}-{secrets.token_hex(4)}"
    payload={
        "requestId":request_id,
        "operation":operation,
        "requestedAt":str(int(time.time())),
        "session":{
            "id":str(item.get("id") or ""),
            "user":str(item.get("username") or ""),
            "ip":str(item.get("framed_ip") or ""),
            "nas":encode_route(access.provider_id,router_id,str(item.get("nas") or router_code)),
            "authServer":os.getenv("UCHIHA_RADIUS_AUTH_SERVER_LABEL","UCHIHA-RADIUS"),
            "kind":str(item.get("access_kind") or "RADIUS"),
        },
    }
    try:
        response=V37.request(
            "POST",
            "/api/connectors/radius",
            actor=gateway_actor(access),
            role=v37_role(access),
            payload=payload,
        )
    except V37GatewayError:
        return False,"تعذر الاتصال بـ Backend v37."

    try:
        body=response.json()
    except Exception:
        body={}
    if response.status not in (200,201,202):
        code=(body.get("error") or {}).get("code") if isinstance(body.get("error"),dict) else body.get("error")
        return False,f"رفض Backend v37 العملية: {code or response.status}"

    command_id=str(body.get("commandId") or body.get("requestId") or request_id)
    if body.get("commandId"):
        STORE.remember_command(access,command_id,operation)
    effect=str(body.get("effect") or body.get("status") or "queued")
    return True,f"تم قبول العملية · <code>{esc(command_id)}</code> · {esc(effect)}"


def resolve(user: dict):
    uid=int(user.get("id") or 0)
    name=" ".join(str(user.get(k) or "") for k in ("first_name","last_name")).strip()
    return STORE.resolve_telegram(uid,display_name=name)


def can_write(access) -> bool:
    return bool(access and access.role in ("owner","admin","operator"))


def dashboard(access) -> str:
    data=STORE.dashboard(access); provider=STORE.provider(access)
    return (
        f"<b>UCHIHA RADIUS · {esc(provider['name'])}</b>\n\n"
        f"👥 المشتركون: <b>{data['totals']['subscribers']}</b>\n"
        f"📡 الراوترات: <b>{data['totals']['nodes']}</b>\n"
        f"🌐 المتصلون الآن: <b>{data['gateway']['snapshot']['activeSessions']}</b>\n"
        f"💳 الفواتير المفتوحة: <b>{data['totals']['openInvoices']}</b>\n\n"
        f"الصلاحية: <code>{esc(access.role)}</code>"
    )


def listing(access, kind: str, page: int = 0) -> str:
    items, actual, total = STORE.paged_records(access, kind, page, PAGE_SIZE)
    titles = {
        "subscribers": "المشتركون", "plans": "الباقات", "routers": "الراوترات",
        "sessions": "الجلسات الحقيقية", "billing": "الفواتير",
    }
    lines = [f"<b>{titles[kind]}</b> · {total} سجل · صفحة {actual+1}/{max(1,(total+PAGE_SIZE-1)//PAGE_SIZE)}"]
    for item in items:
        if kind == "subscribers":
            lines.append(f"• {esc(item['full_name'])} · <code>{esc(item['username'])}</code> · {esc(item['status'])}")
        elif kind == "plans":
            lines.append(f"• {esc(item['name'])} · {item['download_mbps']:g}/{item['upload_mbps']:g} Mbps · {item['price']:g}")
        elif kind == "routers":
            lines.append(f"• {esc(item['name'])} · <code>{esc(item['management_ip'])}</code> · {esc(item['status'])}")
        elif kind == "sessions":
            lines.append(f"• <code>{esc(item['username'])}</code> · {esc(item.get('router_name') or item.get('router_id') or '—')} · {esc(item['status'])}")
        elif kind == "billing":
            lines.append(f"• {esc(item['account'])} · {item['amount']:g} · {esc(item['status'])}")
    if not items:
        lines.append("لا توجد سجلات في هذا القسم بعد.")
    return "\n".join(lines)


def generic_page_keyboard(access, kind: str, page: int = 0) -> dict:
    _, actual, total = STORE.paged_records(access, kind, page, PAGE_SIZE)
    rows = page_buttons(kind, actual, total)
    rows.append([{"text": "🏠 الرئيسية", "callback_data": "dashboard"}])
    return {"inline_keyboard": rows}


def send_page(chat_id: int, access, kind: str, page: int = 0) -> None:
    if kind not in PAGE_KINDS:
        send(chat_id, "القسم غير معروف.")
        return
    _, actual, _ = STORE.paged_records(access, kind, page, PAGE_SIZE)
    if kind == "subscribers":
        keys = subscribers_keyboard(access, actual)
    elif kind == "sessions":
        keys = sessions_keyboard(access, actual)
    else:
        keys = generic_page_keyboard(access, kind, actual)
    send(chat_id, listing(access, kind, actual), keys)


def prompt(chat_id: int, uid: int, state: str) -> None:
    PENDING[uid]=state
    if state=="search_subscribers":
        send(chat_id,"<b>البحث عن مشترك</b>\nأرسل جزءًا من الاسم أو اسم المستخدم (حتى 64 حرفًا).\nللإلغاء: /cancel")
    elif state=="add_subscriber":
        send(chat_id,
             "<b>إضافة مشترك</b>\nأرسل 3 أو 4 أسطر بالترتيب:\n"
             "1) الاسم الكامل\n2) اسم المستخدم RADIUS\n3) اسم الباقة أو ID\n"
             "4) كلمة مرور RADIUS (اختياري؛ إذا تركتها سيولد النظام كلمة قوية)\n\n"
             "كلمة المرور تظهر مرة واحدة فقط.\nللإلغاء: /cancel")
    elif state=="add_plan":
        send(chat_id,
             "<b>إضافة باقة</b>\nأرسل سطرًا واحدًا بهذا الشكل:\n"
             "<code>اسم الباقة | تنزيل Mbps | رفع Mbps | حصة GB | مدة بالأيام | السعر</code>\n\nللإلغاء: /cancel")
    elif state=="add_router":
        send(chat_id,
             "<b>تسجيل MikroTik</b>\nأرسل:\n"
             "<code>اسم الجهاز | عنوان IP الداخلي | المنطقة اختياري</code>\n\n"
             "لن يطلب البوت كلمة مرور MikroTik ولن يخزنها داخل Telegram. بيانات الجهاز السرية تبقى في Gateway الربط.\n\nللإلغاء: /cancel")


def handle_pending(chat_id: int, access, text: str) -> bool:
    uid=access.telegram_user_id
    state=PENDING.get(uid)
    if not state:
        return False
    if text.strip().lower()=="/cancel":
        PENDING.pop(uid,None)
        send(chat_id,"تم إلغاء العملية.")
        return True
    if state=="search_subscribers":
        needle = text.strip()
        if not needle or len(needle) > 64:
            send(chat_id,"أرسل اسمًا أو جزءًا من اسم مستخدم بحد أقصى 64 حرفًا، أو /cancel.")
            return True
        items = STORE.search_subscribers(access, needle, PAGE_SIZE)
        PENDING.pop(uid,None)
        rows = [[{"text": f"🔎 {str(item.get('full_name') or item['username'])}"[:48],
                  "callback_data": f"sub:{item['id']}"}] for item in items]
        rows.append([{"text":"↩️ المشتركون","callback_data":"subscribers"}])
        lines = [f"<b>نتائج البحث</b> · {len(items)} نتائج معروضة"]
        lines.extend(f"• {esc(item['full_name'])} · <code>{esc(item['username'])}</code>" for item in items)
        if not items:
            lines.append("لا توجد نتائج مطابقة.")
        send(chat_id,"\n".join(lines),{"inline_keyboard":rows})
        return True
    if not can_write(access):
        PENDING.pop(uid,None)
        send(chat_id,"صلاحيتك للقراءة فقط.")
        return True
    try:
        if state=="add_subscriber":
            rows=[x.strip() for x in text.splitlines() if x.strip()]
            if len(rows) not in (3,4):
                send(chat_id,"أرسل 3 أو 4 أسطر: الاسم، اسم المستخدم، الباقة، وكلمة المرور اختياريًا.")
                return True
            password=VAULT.validate_password(rows[3]) if len(rows)==4 else VAULT.generate_password()
            item=STORE.create_subscriber(access,{"full_name":rows[0],"username":rows[1],"plan":rows[2]})
            STORE.set_subscriber_credential(access,str(item["id"]),VAULT.encrypt(password))
            PENDING.pop(uid,None)
            send(
                chat_id,
                f"✅ تم إنشاء المشترك <b>{esc(item['full_name'])}</b>.\n"
                f"اسم المستخدم: <code>{esc(item['username'])}</code>\n"
                f"كلمة مرور RADIUS: <code>{esc(password)}</code>\n\n"
                "⚠️ احفظ كلمة المرور الآن؛ لن يعرضها البوت مرة ثانية.",
            )
            return True

        if state=="add_plan":
            parts=[x.strip() for x in text.split("|")]
            if len(parts)!=6:
                send(chat_id,"الصيغة غير صحيحة. استخدم 6 قيم مفصولة بعلامة |.")
                return True
            item=STORE.create_plan(access,{
                "name":parts[0],"download_mbps":parts[1],"upload_mbps":parts[2],
                "quota_gb":parts[3],"duration_days":parts[4],"price":parts[5],
            })
            PENDING.pop(uid,None)
            send(chat_id,f"✅ تم إنشاء الباقة <b>{esc(item['name'])}</b>.")
            return True

        if state=="add_router":
            parts=[x.strip() for x in text.split("|")]
            if len(parts) not in (2,3):
                send(chat_id,"استخدم: اسم الجهاز | IP الداخلي | المنطقة اختياري")
                return True
            item=STORE.create_router(access,{
                "name":parts[0],
                "management_ip":parts[1],
                "region":parts[2] if len(parts)==3 else "A",
            })
            PENDING.pop(uid,None)
            send(chat_id,
                 f"✅ تم تسجيل <b>{esc(item['name'])}</b> على <code>{esc(item['management_ip'])}</code>.\n"
                 "التسجيل لا يرسل أي أمر للجهاز؛ الربط الفعلي يتم عبر Gateway آمن ثم Backend v37.")
            return True
    except Exception as exc:
        send(chat_id,f"تعذر الحفظ: <code>{esc(type(exc).__name__)}</code>. تحقق من القيم وحاول مجددًا.")
        return True
    return False


def handle(update: dict) -> None:
    message=update.get("message")
    if message:
        chat = message.get("chat") or {}
        user = message.get("from") or {}
        if not private_operator_chat(chat, user):
            return
        chat_id = int(chat.get("id") or 0)
        access=resolve(user)
        if not chat_id:
            return
        if not access:
            send(chat_id,"هذا الحساب غير مربوط بمزود داخل UCHIHA RADIUS.")
            return
        text=str(message.get("text") or "").strip()
        if handle_pending(chat_id,access,text):
            return
        if text in {"/start","/menu",""}:
            send(chat_id,dashboard(access))
            return
        if text=="/cancel":
            PENDING.pop(access.telegram_user_id,None)
            send(chat_id,"لا توجد عملية معلقة.")
            return
        if text=="/status":
            send(chat_id,system_status(access))
            return
        if text=="/audit":
            send(chat_id,audit_listing(access))
            return
        if text=="/sessions":
            send_page(chat_id,access,"sessions")
            return
        if text=="/subscribers":
            send_page(chat_id,access,"subscribers")
            return
        if text=="/app":
            send(chat_id,"افتح واجهة RADIUS الكاملة من الزر أدناه.")
            return
        send(chat_id,dashboard(access))
        return

    query=update.get("callback_query")
    if not query:
        return
    user = query.get("from") or {}
    chat = ((query.get("message") or {}).get("chat") or {})
    if not private_operator_chat(chat, user):
        if query.get("id"):
            try:
                call("answerCallbackQuery", {
                    "callback_query_id": query["id"],
                    "text": "افتح بوت UCHIHA RADIUS في محادثة خاصة.",
                    "show_alert": True,
                })
            except Exception:
                pass
        return
    access=resolve(user)
    chat_id=int(chat.get("id") or 0)
    try:
        call("answerCallbackQuery",{"callback_query_id":query.get("id")})
    except Exception:
        pass
    if not access or not chat_id:
        return
    data=str(query.get("data") or "")
    if data=="dashboard":
        send(chat_id,dashboard(access))
    elif data in PAGE_KINDS:
        send_page(chat_id,access,data)
    elif data.startswith("page:"):
        parts = data.split(":",2)
        if len(parts)!=3 or parts[1] not in PAGE_KINDS or not parts[2].isdigit():
            send(chat_id,"طلب صفحة غير صالح.")
            return
        send_page(chat_id,access,parts[1],int(parts[2]))
    elif data=="search_subscribers":
        prompt(chat_id,access.telegram_user_id,"search_subscribers")
    elif data.startswith("sub:"):
        subscriber_id = data.split(":", 1)[1]
        send(chat_id, subscriber_detail(access, subscriber_id),
             subscriber_actions_keyboard(access, subscriber_id))
    elif data.startswith("subact:"):
        parts = data.split(":", 2)
        if len(parts) != 3 or parts[1] not in {"suspend", "resume"}:
            send(chat_id, "طلب تغيير المشترك غير صالح.")
            return
        action, subscriber_id = parts[1], parts[2]
        item = STORE.get_subscriber(access, subscriber_id)
        expected = "active" if action == "suspend" else "suspended"
        if not can_write(access) or not item or item.get("status") != expected:
            send(chat_id, "غير مسموح أو تغيرت حالة المشترك؛ افتح بياناته مجددًا.")
            return
        text = "تعليق المشترك" if action == "suspend" else "إعادة تفعيل المشترك"
        send(chat_id,
             f"<b>تأكيد {text}</b>\n\nالمشترك: <code>{esc(item.get('username'))}</code>",
             subscriber_confirmation_keyboard(action, subscriber_id))
    elif data.startswith("subconfirm:"):
        parts = data.split(":", 2)
        if len(parts) != 3:
            send(chat_id, "طلب تغيير المشترك غير صالح.")
            return
        action, subscriber_id = parts[1], parts[2]
        ok, message = change_subscriber_status(access, subscriber_id, action)
        send(chat_id, ("✅ " if ok else "⚠️ ") + message,
             subscriber_actions_keyboard(access, subscriber_id))
    elif data=="system_status":
        send(chat_id,system_status(access))
    elif data=="audit":
        send(chat_id,audit_listing(access))
    elif data.startswith("sess:"):
        session_id=data.split(":",1)[1]
        send(
            chat_id,
            session_detail(access,session_id),
            session_action_keyboard(session_id,can_write(access)),
        )
    elif data.startswith("sact:"):
        parts=data.split(":",2)
        if len(parts)!=3:
            send(chat_id,"طلب جلسة غير صالح.")
            return
        operation,session_id=parts[1],parts[2]
        if operation in {"disconnect","reauthenticate"} and not can_write(access):
            send(chat_id,"صلاحيتك للقراءة فقط.")
            return
        labels={
            "disconnect":"قطع الجلسة الحالية",
            "reauthenticate":"إعادة مصادقة الجلسة",
            "review":"مراجعة الجلسة دون أمر شبكي",
        }
        send(
            chat_id,
            f"<b>تأكيد العملية</b>\n\n{esc(labels.get(operation,operation))}\n"
            f"الجلسة: <code>{esc(session_id)}</code>",
            session_confirmation_keyboard(operation,session_id),
        )
    elif data.startswith("sconfirm:"):
        parts=data.split(":",2)
        if len(parts)!=3:
            send(chat_id,"طلب جلسة غير صالح.")
            return
        operation,session_id=parts[1],parts[2]
        ok,message=execute_session_operation(access,session_id,operation)
        prefix="✅" if ok else "⚠️"
        send(chat_id,f"{prefix} {message}",session_action_keyboard(session_id,can_write(access)))
    elif data in {"add_subscriber","add_plan","add_router"}:
        if not can_write(access):
            send(chat_id,"صلاحيتك للقراءة فقط.")
        else:
            prompt(chat_id,access.telegram_user_id,data)
    elif data=="agent_help":
        send(chat_id,agent_help_text())
    elif data.startswith("agentpage:"):
        parts = data.split(":",2)
        if len(parts)!=3 or parts[1]!="routers" or not parts[2].isdigit():
            send(chat_id,"طلب صفحة ربط غير صالح.")
            return
        if access.role not in ("owner","admin"):
            send(chat_id,"الربط متاح للمالك أو المدير فقط.")
            return
        send(chat_id,"اختر جهاز MikroTik المطلوب ربطه.",agent_router_keyboard(access,int(parts[2])))
    elif data=="agent_setup":
        if access.role not in ("owner","admin"):
            send(chat_id,"ربط Gateway متاح للمالك أو المدير فقط.")
            return
        routers=STORE.list_routers(access)
        if not routers:
            send(chat_id,"سجل MikroTik أولًا، ثم ارجع إلى زر ربط MikroTik.")
            return
        send(
            chat_id,
            "<b>ربط MikroTik عبر Site Agent</b>\n"
            "اختر الجهاز. سيصدر النظام رمز ربط جديدًا مرة واحدة، والرمز السابق لنفس الجهاز سيتوقف.\n\n"
            f"مثبت المزود: <code>{esc(INSTALLER_URL)}</code>",
            agent_router_keyboard(access),
        )
    elif data.startswith("agent:"):
        if access.role not in ("owner","admin"):
            send(chat_id,"ربط Gateway متاح للمالك أو المدير فقط.")
            return
        router_id=data.split(":",1)[1]
        try:
            issued=STORE.issue_site_agent(access,router_id)
            send(
                chat_id,
                f"<b>رمز ربط {esc(issued['routerName'])}</b>\n\n"
                f"<code>{esc(issued['token'])}</code>\n\n"
                f"مثبت Site Agent: <code>{esc(INSTALLER_URL)}</code>\n\n"
                "هذا الرمز يظهر الآن فقط. أدخله في المثبت داخل شبكة المزود. "
                "لا ترسل اسم مستخدم أو كلمة مرور MikroTik إلى البوت؛ تبقى بيانات الجهاز داخل موقع المزود.",
            )
        except Exception:
            send(chat_id,"تعذر إصدار رمز الربط لهذا الجهاز.")
    elif data.startswith("ast:"):
        router_id=data.split(":",1)[1]
        status=STORE.site_agent_status(access,router_id)
        if not status.get("registered"):
            send(chat_id,"هذا الجهاز لم يُربط بـ Site Agent بعد.")
        elif status.get("online"):
            send(chat_id,f"✅ Site Agent متصل. آخر ظهور: <code>{status.get('lastSeenAt')}</code>")
        else:
            send(chat_id,f"⚠️ Site Agent مسجل لكنه غير متصل الآن. آخر ظهور: <code>{status.get('lastSeenAt') or '—'}</code>")


def configure_bot_ui() -> None:
    try:
        call("setMyCommands",{
            "commands":[
                {"command":"start","description":"فتح لوحة UCHIHA RADIUS"},
                {"command":"menu","description":"القائمة الرئيسية"},
                {"command":"status","description":"حالة RADIUS والربط"},
                {"command":"sessions","description":"الجلسات المتصلة"},
                {"command":"subscribers","description":"المشتركون والبحث"},
                {"command":"audit","description":"آخر عمليات التدقيق"},
                {"command":"app","description":"فتح واجهة RADIUS الكاملة"},
                {"command":"cancel","description":"إلغاء العملية الحالية"},
            ]
        })
        call("setChatMenuButton",{
            "menu_button":{
                "type":"web_app",
                "text":"UCHIHA RADIUS",
                "web_app":{"url":WEBAPP_URL},
            }
        })
    except Exception as exc:
        print(f"telegram ui setup warning {type(exc).__name__}")


def main() -> None:
    configure_bot_ui()
    offset=0
    print("UCHIHA RADIUS Telegram management bot started")
    while True:
        try:
            result=call("getUpdates",{"offset":offset,"timeout":30,"allowed_updates":["message","callback_query"]})
            for update in result.get("result",[]):
                offset=max(offset,int(update["update_id"])+1)
                handle(update)
        except (urllib.error.URLError,TimeoutError,json.JSONDecodeError):
            time.sleep(2)
        except Exception as exc:
            # urllib errors can embed the Bot API URL, which includes the secret.
            print(f"telegram retry {type(exc).__name__}")
            time.sleep(2)


if __name__=="__main__":
    main()
