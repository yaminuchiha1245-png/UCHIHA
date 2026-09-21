from __future__ import annotations

import json
import os
import time
import urllib.request

from provider_store import ProviderStore

TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
API = f"https://api.telegram.org/bot{TOKEN}"
WEBAPP_URL = os.getenv("UCHIHA_RADIUS_TELEGRAM_WEBAPP_URL","https://radius.uchiha-builder.com/telegram/")
STORE = ProviderStore(os.getenv("UCHIHA_RADIUS_PROVIDER_DB","/var/lib/uchiha-radius/provider.sqlite3"))

owner = int(os.getenv("UCHIHA_RADIUS_OWNER_TELEGRAM_ID","0") or 0)
if owner:
    STORE.bootstrap_owner(owner,
        provider_name=os.getenv("UCHIHA_RADIUS_DEFAULT_PROVIDER_NAME","UCHIHA Provider"),
        provider_code=os.getenv("UCHIHA_RADIUS_DEFAULT_PROVIDER_CODE","UCHIHA"))


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
      [{"text":"🖥 فتح واجهة RADIUS الكاملة","web_app":{"url":WEBAPP_URL}}]
    ]}


def send(chat_id: int, text: str) -> None:
    call("sendMessage",{"chat_id":chat_id,"text":text,"parse_mode":"HTML","reply_markup":keyboard()})


def resolve(user: dict):
    uid=int(user.get("id") or 0)
    name=" ".join(str(user.get(k) or "") for k in ("first_name","last_name")).strip()
    return STORE.resolve_telegram(uid,display_name=name)


def dashboard(access) -> str:
    data=STORE.dashboard(access); provider=STORE.provider(access)
    return (f"<b>UCHIHA RADIUS · {provider['name']}</b>\n\n"
            f"👥 المشتركون: <b>{data['totals']['subscribers']}</b>\n"
            f"📡 الراوترات: <b>{data['totals']['nodes']}</b>\n"
            f"🌐 المتصلون الآن: <b>{data['gateway']['snapshot']['activeSessions']}</b>\n"
            f"💳 الفواتير المفتوحة: <b>{data['totals']['openInvoices']}</b>")


def listing(access, kind: str) -> str:
    if kind=="subscribers":
        items=STORE.list_subscribers(access)[:12]
        return "<b>المشتركون</b>\n"+("\n".join(f"• {x['full_name']} · <code>{x['username']}</code> · {x['status']}" for x in items) or "لا يوجد مشتركون بعد.")
    if kind=="plans":
        items=STORE.list_plans(access)[:12]
        return "<b>الباقات</b>\n"+("\n".join(f"• {x['name']} · {x['download_mbps']:g}/{x['upload_mbps']:g} Mbps" for x in items) or "لا توجد باقات بعد.")
    if kind=="routers":
        items=STORE.list_routers(access)[:12]
        return "<b>الراوترات</b>\n"+("\n".join(f"• {x['name']} · <code>{x['management_ip']}</code> · {x['status']}" for x in items) or "لا توجد راوترات بعد.")
    if kind=="sessions":
        items=STORE.list_sessions(access)[:12]
        return "<b>الجلسات</b>\n"+("\n".join(f"• <code>{x['username']}</code> · {x['status']}" for x in items) or "لا توجد جلسات محاسبة حقيقية بعد.")
    items=STORE.list_invoices(access)[:12]
    return "<b>الفواتير</b>\n"+("\n".join(f"• {x['account']} · {x['amount']:g} · {x['status']}" for x in items) or "لا توجد فواتير بعد.")


def handle(update: dict) -> None:
    message=update.get("message")
    if message:
        chat_id=int((message.get("chat") or {}).get("id") or 0)
        access=resolve(message.get("from") or {})
        if not access:
            send(chat_id,"هذا الحساب غير مربوط بمزود داخل UCHIHA RADIUS."); return
        send(chat_id,dashboard(access)); return

    query=update.get("callback_query")
    if not query: return
    access=resolve(query.get("from") or {})
    chat_id=int((((query.get("message") or {}).get("chat") or {}).get("id")) or 0)
    try: call("answerCallbackQuery",{"callback_query_id":query.get("id")})
    except Exception: pass
    if not access or not chat_id: return
    data=str(query.get("data") or "")
    send(chat_id,dashboard(access) if data=="dashboard" else listing(access,data))


def main() -> None:
    offset=0
    while True:
        try:
            result=call("getUpdates",{"offset":offset,"timeout":30,"allowed_updates":["message","callback_query"]})
            for update in result.get("result",[]):
                offset=max(offset,int(update["update_id"])+1)
                handle(update)
        except Exception as exc:
            print(f"telegram retry {type(exc).__name__}: {exc}")
            time.sleep(2)


if __name__=="__main__":
    main()
