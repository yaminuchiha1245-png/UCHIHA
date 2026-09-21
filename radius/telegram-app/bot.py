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


def keyboard() -> dict:
    return {"inline_keyboard":[
      [{"text":"📊 الرئيسية","callback_data":"dashboard"},{"text":"👥 المشتركون","callback_data":"subscribers"}],
      [{"text":"📦 الباقات","callback_data":"plans"},{"text":"📡 الراوترات","callback_data":"routers"}],
      [{"text":"🌐 الجلسات","callback_data":"sessions"},{"text":"💳 الفواتير","callback_data":"billing"}],
      [{"text":"➕ مشترك","callback_data":"add_subscriber"},{"text":"➕ باقة","callback_data":"add_plan"}],
      [{"text":"➕ تسجيل MikroTik","callback_data":"add_router"},{"text":"🔗 ربط MikroTik","callback_data":"agent_setup"}],
      [{"text":"🖥 فتح واجهة RADIUS الكاملة","web_app":{"url":WEBAPP_URL}}],
    ]}


def send(chat_id: int, text: str, reply_markup: dict | None = None) -> None:
    payload={"chat_id":chat_id,"text":text,"parse_mode":"HTML","disable_web_page_preview":True}
    payload["reply_markup"] = reply_markup or keyboard()
    call("sendMessage",payload)


def agent_router_keyboard(access) -> dict:
    rows=[]
    for router in STORE.list_routers(access)[:12]:
        rid=str(router["id"])
        label=str(router.get("name") or router.get("code") or rid)
        rows.append([
            {"text":f"🔗 {label}"[:40],"callback_data":f"agent:{rid}"},
            {"text":"📶 الحالة","callback_data":f"ast:{rid}"},
        ])
    rows.append([{"text":"↩️ الرئيسية","callback_data":"dashboard"}])
    return {"inline_keyboard":rows}


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


def listing(access, kind: str) -> str:
    if kind=="subscribers":
        items=STORE.list_subscribers(access)[:12]
        return "<b>المشتركون</b>\n"+("\n".join(
            f"• {esc(x['full_name'])} · <code>{esc(x['username'])}</code> · {esc(x['status'])}" for x in items
        ) or "لا يوجد مشتركون بعد.")
    if kind=="plans":
        items=STORE.list_plans(access)[:12]
        return "<b>الباقات</b>\n"+("\n".join(
            f"• {esc(x['name'])} · {x['download_mbps']:g}/{x['upload_mbps']:g} Mbps · {x['price']:g}" for x in items
        ) or "لا توجد باقات بعد.")
    if kind=="routers":
        items=STORE.list_routers(access)[:12]
        return "<b>الراوترات</b>\n"+("\n".join(
            f"• {esc(x['name'])} · <code>{esc(x['management_ip'])}</code> · {esc(x['status'])}" for x in items
        ) or "لا توجد راوترات بعد.")
    if kind=="sessions":
        items=STORE.list_sessions(access)[:12]
        return "<b>الجلسات الحقيقية</b>\n"+("\n".join(
            f"• <code>{esc(x['username'])}</code> · {esc(x.get('router_id') or '—')} · {esc(x['status'])}" for x in items
        ) or "لا توجد جلسات محاسبة حقيقية بعد.")
    items=STORE.list_invoices(access)[:12]
    return "<b>الفواتير</b>\n"+("\n".join(
        f"• {esc(x['account'])} · {x['amount']:g} · {esc(x['status'])}" for x in items
    ) or "لا توجد فواتير بعد.")


def prompt(chat_id: int, uid: int, state: str) -> None:
    PENDING[uid]=state
    if state=="add_subscriber":
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
        chat_id=int((message.get("chat") or {}).get("id") or 0)
        access=resolve(message.get("from") or {})
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
        send(chat_id,dashboard(access))
        return

    query=update.get("callback_query")
    if not query:
        return
    access=resolve(query.get("from") or {})
    chat_id=int((((query.get("message") or {}).get("chat") or {}).get("id")) or 0)
    try:
        call("answerCallbackQuery",{"callback_query_id":query.get("id")})
    except Exception:
        pass
    if not access or not chat_id:
        return
    data=str(query.get("data") or "")
    if data=="dashboard":
        send(chat_id,dashboard(access))
    elif data in {"subscribers","plans","routers","sessions","billing"}:
        send(chat_id,listing(access,data))
    elif data in {"add_subscriber","add_plan","add_router"}:
        if not can_write(access):
            send(chat_id,"صلاحيتك للقراءة فقط.")
        else:
            prompt(chat_id,access.telegram_user_id,data)
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
            "اختر الجهاز. سيصدر النظام رمز ربط جديدًا مرة واحدة، والرمز السابق لنفس الجهاز سيتوقف.",
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
                "هذا الرمز يظهر الآن فقط. ضعه في Site Agent الخاص بهذا الموقع. "
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


def main() -> None:
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
            print(f"telegram retry {type(exc).__name__}: {exc}")
            time.sleep(2)


if __name__=="__main__":
    main()
