#!/usr/bin/env python3
"""UCHIHA Debt Store Telegram admin. Python 3.10+; standard library only."""
from __future__ import annotations

import base64
import fcntl
import html
import json
import logging
import os
import re
import secrets
import signal
import sqlite3
import sys
import time
import threading
import urllib.error
import urllib.request
from datetime import date, timedelta, datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
log = logging.getLogger("debt-admin")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
AMT = Decimal("0.0001")
MAX_AMOUNT = Decimal("1000000")


def load_env(path: Path) -> dict[str, str]:
    values = dict(os.environ)
    if path.exists():
        # Environment variables override the file, which stays mode 0600.
        for raw in path.read_text(encoding="utf-8").splitlines():
            if not raw or raw.startswith("#") or "=" not in raw:
                continue
            k, v = raw.split("=", 1)
            if k.isidentifier() and k not in os.environ:
                values[k] = v.strip()
    return values


def money(v: Any, *, signed: bool = False) -> Decimal:
    try:
        n = Decimal(str(v).strip())
        if not n.is_finite() or abs(n) > MAX_AMOUNT or (n == 0 and signed) or (n <= 0 and not signed):
            raise ValueError("invalid amount")
        rounded=n.quantize(AMT, rounding=ROUND_HALF_UP)
        if rounded == 0:
            raise ValueError("amount below minimum precision")
        return rounded
    except (ValueError, InvalidOperation, TypeError) as exc:
        raise ValueError("المبلغ غير صحيح؛ اكتب رقمًا أكبر من الصفر وبحد أقصى مليون.") from exc


def fmt(v: Any) -> str:
    try:
        n = Decimal(str(v))
        return format(n.quantize(AMT), "f").rstrip("0").rstrip(".") or "0"
    except (InvalidOperation, ValueError):
        return "0"


def esc(v: Any) -> str:
    return html.escape(str(v if v is not None else ""), quote=False)


def keyboard(rows: list[list[tuple[str, str]]]) -> dict[str, Any]:
    return {"inline_keyboard": [
        [{"text": label, "callback_data": payload} for label, payload in row]
        for row in rows
    ]}


BACK = [("◀️ الرئيسية", "home")]


class TransportError(Exception):
    """Remote timeout or transport failure; operation may already have committed."""


class ApiError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class JsonHttp:
    """Single injectable HTTP client, with redacted errors and strict HTTPS."""
    def __init__(self, opener: Any = None) -> None:
        self.open = opener or urllib.request.urlopen

    def post(self, url: str, payload: dict[str, Any], headers: dict[str, str],
             timeout: int = 45) -> dict[str, Any]:
        if not url.startswith("https://"):
            raise ValueError("HTTPS required")
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        req = urllib.request.Request(
            url, data=data, headers={"Content-Type": "application/json", **headers}, method="POST"
        )
        try:
            with self.open(req, timeout=timeout) as resp:
                body = resp.read(8_000_000)
            out = json.loads(body)
            if not isinstance(out, dict):
                raise TransportError("invalid response")
            return out
        except urllib.error.HTTPError as exc:
            # NEVER log the URL (Telegram embeds its bot token in the URL).
            if exc.code in (400, 401, 403):
                raise ApiError("UNAUTHORIZED" if exc.code in (401, 403) else "BAD_REQUEST") from None
            raise TransportError("remote service failure") from None
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            raise TransportError("network failure") from None


class Backend:
    def __init__(self, url: str, anon_key: str, admin_id: int, secret: str, http: JsonHttp | None = None):
        if not re.fullmatch(r"[0-9a-f]{64}", secret):
            raise ValueError("Missing valid BOT_RPC_SECRET; run setup.py")
        self.url = url.rstrip("/") + "/rest/v1/rpc/debt_telegram_admin_dispatch"
        self.license_url = url.rstrip("/") + "/rest/v1/rpc/debt_telegram_admin_license_action"
        self.headers = {"apikey": anon_key}
        if not anon_key.startswith("sb_publishable_"):
            self.headers["Authorization"] = "Bearer " + anon_key
        self.secret, self.admin_id, self.http = secret, admin_id, http or JsonHttp()

    def call(self, action: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
        route = (self.license_url if action in
                 ("renew_license", "unlimited_license", "set_max_devices")
                 else self.url)
        out = self.http.post(route, {
            "p_secret": self.secret, "p_telegram_id": self.admin_id,
            "p_action": action, "p_args": args or {}
        }, self.headers, timeout=45)
        if not out.get("ok"):
            raise ApiError(str(out.get("error") or "BACKEND_ERROR"))
        return out


class Telegram:
    def __init__(self, token: str, http: JsonHttp | None = None):
        if not re.fullmatch(r"\d{5,20}:[A-Za-z0-9_-]{20,}", token):
            raise ValueError("Invalid BOT_TOKEN")
        self.url = "https://api.telegram.org/bot" + token + "/"
        self.http = http or JsonHttp()

    def call(self, action: str, **kw: Any) -> dict[str, Any]:
        result = self.http.post(self.url + action, kw, {}, timeout=50 if action == "getUpdates" else 30)
        if not result.get("ok"):
            # Telegram text contains no secrets; do not log it.
            raise ApiError("TELEGRAM_API")
        return result

    def send(self, chat_id: int, text: str, rows: list[list[tuple[str, str]]] | None = None) -> None:
        kw: dict[str, Any] = {
            "chat_id": chat_id, "text": text[:4000], "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
        if rows:
            kw["reply_markup"] = keyboard(rows)
        self.call("sendMessage", **kw)

    def edit(self, chat_id: int, message_id: int, text: str,
             rows: list[list[tuple[str, str]]] | None = None) -> None:
        kw: dict[str, Any] = {
            "chat_id": chat_id, "message_id": message_id, "text": text[:4000],
            "parse_mode": "HTML", "disable_web_page_preview": True
        }
        if rows:
            kw["reply_markup"] = keyboard(rows)
        try:
            self.call("editMessageText", **kw)
        except ApiError:
            self.send(chat_id, text, rows)

    def answer(self, callback_id: str, text: str = "") -> None:
        try:
            self.call("answerCallbackQuery", callback_query_id=callback_id, text=text[:180])
        except ApiError:
            pass

    def send_proof(self, chat_id: int, proof: str) -> None:
        found = re.fullmatch(r"data:image/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)", proof)
        if not found:
            if re.match(r"^https://[a-z0-9.-]+\\.supabase\\.co/storage/v1/object/", proof, re.I):
                self.call("sendMessage", chat_id=chat_id,
                          text="🧾 رابط إثبات التحويل: " + proof[:1500],
                          disable_web_page_preview=True)
                return
            self.send(chat_id, "لا توجد صورة إثبات قابلة للعرض.")
            return
        try:
            blob = base64.b64decode(found.group(2), validate=False)
        except Exception:
            self.send(chat_id, "تعذر قراءة صورة الإثبات.")
            return
        if not blob or len(blob) > 7_000_000:
            self.send(chat_id, "الصورة كبيرة أو غير صالحة للعرض داخل البوت.")
            return
        boundary = "u" + secrets.token_hex(12)
        mime = "image/jpeg" if found.group(1) in ("jpeg", "jpg") else "image/" + found.group(1)
        parts = [
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"chat_id\"\r\n\r\n{chat_id}\r\n".encode(),
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"proof.jpg\"\r\n"
            f"Content-Type: {mime}\r\n\r\n".encode(),
            blob, f"\r\n--{boundary}--\r\n".encode()
        ]
        req = urllib.request.Request(
            self.url + "sendPhoto", data=b"".join(parts), method="POST",
            headers={"Content-Type": "multipart/form-data; boundary=" + boundary}
        )
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                result = json.loads(resp.read(100_000))
            if not result.get("ok"):
                self.send(chat_id, "تعذر إرسال صورة إثبات التحويل.")
        except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError):
            self.send(chat_id, "تعذر إرسال صورة إثبات التحويل.")


class Storage:
    def __init__(self, filename: Path):
        filename.parent.mkdir(parents=True, exist_ok=True)
        self.filename = filename
        self.db = sqlite3.connect(str(filename), isolation_level=None, timeout=10)
        self.db.execute("pragma busy_timeout=10000")
        self.db.execute("pragma journal_mode=WAL")
        self.db.executescript("""
          create table if not exists state(key text primary key,value text not null);
          create table if not exists flow(
              admin_id integer primary key,step text not null,payload text not null,started integer not null);
          create table if not exists operations(
              id text primary key,admin_id integer not null,kind text not null,payload text not null,
              status text not null,result text,created integer not null,updated integer not null);
          create table if not exists alert_settings(
              kind text primary key check(kind in ('topup','order')),
              enabled integer not null default 1 check(enabled in (0,1)),
              seeded integer not null default 0 check(seeded in (0,1)),
              checked_at integer not null default 0);
          create table if not exists alert_log(
              kind text not null check(kind in ('topup','order')),
              item_id text not null,
              state text not null check(state in ('seeded','pending','sent','muted')),
              created_at integer not null,
              updated_at integer not null,
              primary key(kind,item_id));
          create index if not exists alert_log_queued
              on alert_log(kind,state,created_at);
          insert or ignore into alert_settings(kind) values('topup'),('order');
        """)
        filename.chmod(0o600)

    def get_offset(self) -> int:
        row = self.db.execute("select value from state where key='offset'").fetchone()
        return int(row[0]) if row else 0

    def advance_offset(self, value: int) -> None:
        self.db.execute(
            "insert into state(key,value) values('offset',?) "
            "on conflict(key) do update set value=excluded.value", (str(value),)
        )

    def flow(self, user_id: int) -> tuple[str, dict[str, Any]] | None:
        row = self.db.execute("select step,payload,started from flow where admin_id=?", (user_id,)).fetchone()
        if not row or time.time() - row[2] > 1800:
            self.clear_flow(user_id)
            return None
        return row[0], json.loads(row[1])

    def set_flow(self, user_id: int, step: str, payload: dict[str, Any]) -> None:
        self.db.execute(
            "insert into flow values(?,?,?,?) on conflict(admin_id) do update "
            "set step=excluded.step,payload=excluded.payload,started=excluded.started",
            (user_id, step, json.dumps(payload, ensure_ascii=False), int(time.time()))
        )

    def clear_flow(self, user_id: int) -> None:
        self.db.execute("delete from flow where admin_id=?", (user_id,))

    def prepare(self, admin: int, kind: str, payload: dict[str, Any]) -> str:
        opid = secrets.token_hex(16)
        now = int(time.time())
        self.db.execute("insert into operations values(?,?,?,?,?,?,?,?)",
                        (opid, admin, kind, json.dumps(payload, ensure_ascii=False),
                         "prepared", None, now, now))
        return opid

    def operation(self, opid: str) -> dict[str, Any] | None:
        row = self.db.execute(
            "select admin_id,kind,payload,status,result,created from operations where id=?", (opid,)
        ).fetchone()
        if not row:
            return None
        return {"admin_id": row[0], "kind": row[1], "payload": json.loads(row[2]),
                "status": row[3], "result": row[4], "created": row[5]}

    def op_status(self, opid: str, status: str, result: str = "") -> None:
        self.db.execute("update operations set status=?,result=?,updated=? where id=?",
                        (status, result[:1000], int(time.time()), opid))

    def recent(self, admin: int, limit: int = 12) -> list[tuple]:
        return self.db.execute(
            "select kind,status,payload,created from operations where admin_id=? "
            "order by created desc limit ?", (admin, limit)
        ).fetchall()

    @staticmethod
    def check_alert_kind(kind: str) -> None:
        if kind not in ("topup", "order"):
            raise ValueError("Invalid notification type")

    def alert_setting(self, kind: str) -> dict[str, Any]:
        self.check_alert_kind(kind)
        row=self.db.execute(
            "select enabled,seeded,checked_at from alert_settings where kind=?",
            (kind,)).fetchone()
        return {"enabled":bool(row[0]),"seeded":bool(row[1]),"checked_at":row[2]}

    def set_alert_enabled(self, kind: str, enabled: bool) -> None:
        self.check_alert_kind(kind)
        self.db.execute("update alert_settings set enabled=? where kind=?",
                        (int(enabled),kind))
        if not enabled:
            # Existing queued alerts are intentionally discarded on mute.
            self.db.execute(
                "update alert_log set state='muted',updated_at=? "
                "where kind=? and state='pending'",(int(time.time()),kind))

    def observe_alerts(self, kind: str, item_ids: list[str]) -> bool:
        self.check_alert_kind(kind)
        old=self.alert_setting(kind)
        now=int(time.time())
        state=("seeded" if not old["seeded"] else
               "pending" if old["enabled"] else "muted")
        with self.db:
            for item_id in item_ids:
                if not is_uuid(item_id):
                    continue
                self.db.execute(
                    "insert or ignore into alert_log(kind,item_id,state,created_at,updated_at) "
                    "values(?,?,?,?,?)",(kind,item_id,state,now,now))
            self.db.execute(
                "update alert_settings set seeded=1,checked_at=? where kind=?",
                (now,kind))
        return old["seeded"]

    def pending_alerts(self, kind: str, limit: int = 5) -> list[str]:
        self.check_alert_kind(kind)
        if not self.alert_setting(kind)["enabled"]:
            return []
        return [r[0] for r in self.db.execute(
            "select item_id from alert_log where kind=? and state='pending' "
            "order by created_at,item_id limit ?",(kind,max(1,min(limit,10))))]

    def mark_alert_sent(self, kind: str, item_id: str) -> None:
        self.check_alert_kind(kind)
        self.db.execute("update alert_log set state='sent',updated_at=? "
                        "where kind=? and item_id=? and state='pending'",
                        (int(time.time()),kind,item_id))

    def close(self) -> None:
        self.db.close()


ERRORS = {
    "FORBIDDEN": "ليست لديك صلاحية لهذه العملية.",
    "UNAUTHORIZED": "تعذر المصادقة. راجع إعدادات الربط.",
    "OWNER_INACTIVE": "حساب صاحب التطبيق غير مفعّل.",
    "NOT_FOUND": "المستخدم أو العملية غير موجودة.",
    "INSUFFICIENT_BALANCE": "لا يوجد رصيد كافٍ لإجراء الخصم.",
    "ALREADY_REVIEWED": "تمت مراجعة هذا الطلب مسبقًا؛ حدّث قائمة الطلبات.",
    "INVALID_REQUEST": "البيانات غير صحيحة.",
    "INVALID_EXPIRY": "تاريخ انتهاء الكود غير صالح.",
    "INVALID_LABEL": "الاسم مطلوب ويجب أن يكون بين 2 و100 حرف.",
    "INVALID_DEVICES": "عدد الأجهزة بين 1 و5.",
    "TOO_MANY_ACTIVE_DEVICES": "هناك أجهزة مفعّلة أكثر من الحد المطلوب؛ اضغط إعادة ضبط الأجهزة أولًا.",
    "ALREADY_UNLIMITED": "صلاحية المستخدم غير محدودة أصلًا، ولا تحتاج تجديدًا.",
    "INVALID_DAYS": "اختر مدة 30 أو 90 أو 365 يومًا.",
    "REPLAY_CONFLICT": "تعارض معرّف العملية؛ لم تُنفذ أي حركة جديدة.",
}


def explain(err: ApiError) -> str:
    return ERRORS.get(err.code, "حدث خطأ في الخادم: " + esc(err.code[:70]))


def is_uuid(v: str) -> bool:
    return bool(UUID.fullmatch(v))


class AdminBot:
    def __init__(self, tg: Telegram, backend: Backend, storage: Storage, admin_id: int):
        self.tg, self.api, self.db, self.admin_id = tg, backend, storage, admin_id
        self.search_term = ""
        self.stop_alerts = threading.Event()

    @staticmethod
    def menu() -> list[list[tuple[str, str]]]:
        return [
            [("💰 الأرصدة", "wallets:0"), ("👥 المستخدمون", "users:0")],
            [("🎟 إنشاء كود", "code"), ("🏦 طلبات الشحن", "topups:0")],
            [("🛒 الطلبات", "orders:0"), ("📜 سجل الأرصدة", "ledger:0")],
            [("🔔 التنبيهات", "alerts"), ("🗂 سجل الإدارة", "audit:0")],
            [("⚙️ الإعدادات", "settings")],
            [("🔄 تحديث الرئيسية", "home")]
        ]

    def panel(self, chat: int, message: int | None, text: str,
              rows: list[list[tuple[str, str]]] | None = None) -> None:
        if message is None:
            self.tg.send(chat, text, rows)
        else:
            self.tg.edit(chat, message, text, rows)

    def safe_api(self, action: str, args: dict | None = None) -> dict | None:
        try:
            return self.api.call(action, args)
        except ApiError as exc:
            self.tg.send(self.admin_id, "⚠️ " + explain(exc), [BACK])
        except TransportError:
            self.tg.send(self.admin_id, "⚠️ تعذر الاتصال بالخادم. لم تتغير بياناتك محليًا.", [BACK])
        return None

    def alerts_menu(self, chat: int, message: int | None = None,
                    store: Storage | None = None) -> None:
        db=store or self.db
        top=db.alert_setting("topup")
        orders=db.alert_setting("order")
        def status(x: dict[str, Any]) -> str:
            if not x["enabled"]:
                return "🔕 متوقف"
            return "✅ مفعل" if x["seeded"] else "⏳ سيفعّل بعد أول فحص"
        text=(
            "🔔 <b>تنبيهات بوت الديون</b>\n\n"
            f"🏦 شحن الرصيد: {status(top)}\n"
            f"🛒 الطلبات: {status(orders)}\n\n"
            "تصل التنبيهات لحساب المدير فقط مع أزرار فتح الطلب، "
            "من دون إجراء شحن أو قبول تلقائي.\n"
            "لا تُرسل إشعارات قديمة عند أول تشغيل؛ تظهر الطلبات الجديدة بعدها."
        )
        rows=[
            [(("🔕 إيقاف" if top["enabled"] else "🔔 تفعيل")+" إشعارات الشحن",
                "alert_toggle:topup")],
            [(("🔕 إيقاف" if orders["enabled"] else "🔔 تفعيل")+" إشعارات الطلبات",
                "alert_toggle:order")],
            [("🧪 تجربة تنبيه", "alert_test")],
            [("◀️ الرئيسية","home")]
        ]
        self.panel(chat,message,text,rows)

    def _list_alert_items(self, kind: str) -> list[dict[str, Any]]:
        if kind not in ("topup","order"):
            raise ValueError("Invalid notification type")
        action="topups" if kind=="topup" else "orders"
        filter_name="pending" if kind=="topup" else "open"
        collected=[]
        for offset in range(0,90,15):
            page=self.api.call(action,{"filter":filter_name,"offset":offset}).get("items",[])
            if not isinstance(page,list):
                raise TransportError("invalid admin feed")
            collected.extend(row for row in page
                             if isinstance(row,dict) and is_uuid(str(row.get("id","")))
                             and (row.get("status")=="pending" if kind=="topup"
                                  else row.get("status") in ("pending","processing","unknown")))
            if len(page)<15:
                break
        return collected

    def poll_alerts(self, db: Storage | None = None) -> None:
        """Read-only discovery, then administrator-only notification delivery.

        Operates on an independent SQLite connection in the background worker.
        Existing pending requests are baselined without sending old alerts.
        """
        store=db or self.db
        for kind in ("topup","order"):
            rows=self._list_alert_items(kind)
            store.observe_alerts(kind,[str(x["id"]) for x in rows])
            if not store.alert_setting(kind)["enabled"]:
                continue
            by_id={str(row["id"]):row for row in rows}
            for item_id in store.pending_alerts(kind):
                if not store.alert_setting(kind)["enabled"]:
                    break
                item=by_id.get(item_id)
                if not item:
                    # A burst can push older queued alerts outside the first
                    # 90 list results. Fetch the specific request instead of
                    # dropping an unnotified financial event.
                    try:
                        detail=self.api.call(
                            "topup_detail" if kind=="topup" else "order_detail",
                            {"topup_id" if kind=="topup" else "order_id":item_id})
                    except ApiError as exc:
                        if exc.code!="NOT_FOUND":
                            raise
                        store.mark_alert_sent(kind,item_id)
                        continue
                    item=detail.get("item")
                    if not isinstance(item,dict) or (
                        item.get("status")!="pending" if kind=="topup"
                        else item.get("status") not in ("pending","processing","unknown")
                    ):
                        store.mark_alert_sent(kind,item_id)
                        continue
                if kind=="topup":
                    msg=("🏦 <b>طلب شحن جديد</b>\n"
                         f"👤 {esc(item.get('label') or 'مستخدم')}\n"
                         f"💰 المبلغ المطلوب: <b>{fmt(item.get('amount_requested',0))}</b>\n"
                         "راجِع إثبات التحويل قبل اعتماد الرصيد.")
                    buttons=[[("🧾 مراجعة الشحن","topup:"+item_id)],
                             [("🏠 لوحة الإدارة","home")]]
                else:
                    msg=("🛒 <b>طلب منتجات رقمية جديد</b>\n"
                         f"👤 {esc(item.get('label') or 'مستخدم')}\n"
                         f"📦 {esc(item.get('product_name') or 'منتج')}\n"
                         f"💰 {fmt(item.get('amount',0))}\n"
                         f"الحالة: {esc(item.get('status') or 'قيد الانتظار')}")
                    buttons=[[("📦 متابعة الطلب","order:"+item_id)],
                             [("🏠 لوحة الإدارة","home")]]
                self.tg.send(self.admin_id,msg,buttons)
                # Success acknowledged by Telegram before marking sent.
                # A crash in this tiny window may produce one duplicate alert;
                # it cannot duplicate a financial operation.
                store.mark_alert_sent(kind,item_id)

    def alerts_worker(self) -> None:
        store=Storage(self.db.filename)
        try:
            while not self.stop_alerts.is_set():
                try:
                    self.poll_alerts(store)
                except (ApiError,TransportError,sqlite3.Error) as exc:
                    log.warning("Alerts temporarily unavailable (%s)",type(exc).__name__)
                except Exception:
                    log.exception("Unexpected alert worker error")
                self.stop_alerts.wait(60)
        finally:
            store.close()

    def home(self, chat: int, message: int | None = None) -> None:
        self.db.clear_flow(chat)
        x = self.safe_api("dashboard")
        if not x:
            return
        text = (
            "🏠 <b>لوحة إدارة تطبيق الديون</b>\n\n"
            f"👥 المستخدمون: <b>{x.get('users', 0)}</b> · المفعّلون: <b>{x.get('active_users', 0)}</b>\n"
            f"💰 إجمالي الأرصدة الرقمية: <b>{fmt(x.get('wallet_total',0))}</b>\n"
            f"🏦 شحن بانتظار المراجعة: <b>{x.get('pending_topups',0)}</b>\n"
            f"🛒 طلبات قيد المتابعة: <b>{x.get('pending_orders',0)}</b>\n\n"
            "اختر من الأزرار أدناه:"
        )
        self.panel(chat, message, text, self.menu())

    def users(self, chat: int, message: int | None, offset: int = 0, wallets: bool = False) -> None:
        x = self.safe_api("wallets" if wallets else "users",
                          {"offset": offset, "search": self.search_term})
        if x is None:
            return
        rows = []
        for p in x.get("items", []):
            title = (p.get("label") or "مستخدم")[:35]
            tail = f" · {fmt(p.get('balance',0))}" if wallets else (" ✅" if p.get("active") else " ⛔")
            rows.append([(title + tail, "user:" + str(p["id"]))])
        nav = []
        key = "wallets" if wallets else "users"
        if offset:
            nav.append(("⬅️ السابق", f"{key}:{max(0,offset-15)}"))
        if len(x.get("items", [])) == 15 and offset + 15 < int(x.get("total",0)):
            nav.append(("التالي ➡️", f"{key}:{offset+15}"))
        if nav:
            rows.append(nav)
        rows.extend([[("🔎 بحث بالاسم أو الهاتف", "search")], BACK])
        self.panel(chat, message, ("💰 <b>أرصدة المستخدمين</b>" if wallets else "👥 <b>إدارة المستخدمين</b>")
                   + f"\nالنتائج: {x.get('total',0)}" +
                   (f"\nالبحث: {esc(self.search_term)}" if self.search_term else ""),
                   rows)

    def user(self, chat: int, message: int | None, license_id: str) -> None:
        if not is_uuid(license_id):
            return
        x = self.safe_api("user", {"license_id": license_id})
        if not x:
            return
        u = x["user"]
        active = bool(u.get("active"))
        expiry = u.get("expires_at")
        expired = False
        if expiry:
            try:
                expired = datetime.fromisoformat(str(expiry).replace("Z","+00:00")) <= datetime.now(timezone.utc)
            except (ValueError,TypeError):
                pass
        status = ("⛔ موقوف" if not active else "⏰ منتهي" if expired else "✅ مفعل")
        text = (
            f"👤 <b>{esc(u.get('label'))}</b>\n"
            f"📞 {esc(u.get('phone') or '—')}\n"
            f"💰 الرصيد: <b>{fmt(u.get('balance',0))}</b>\n"
            f"🔐 الحالة: {status}\n"
            f"📱 الأجهزة: {u.get('devices',0)}/{u.get('max_devices',1)}\n"
            f"🎟 رمز الكود: ••••{esc(u.get('code_hint',''))}\n"
            f"🗓 الانتهاء: {esc(u.get('expires_at') or 'بلا انتهاء')}"
        )
        rows = [
            [("➕ إضافة رصيد", "wa:+" + license_id), ("➖ خصم رصيد", "wa:-" + license_id)],
            [("🔑 عرض كود التفعيل", "codeview:" + license_id)],
            [("🔄 تجديد الصلاحية", "renew:" + license_id),
             ("📱 حد الأجهزة", "devices:" + license_id)],
            [("✅ إعادة تفعيل" if not active else "⛔ إيقاف", "toggle:" + license_id)],
            [("📴 إعادة ضبط الأجهزة", "reset:" + license_id)],
            [("◀️ المستخدمون", "users:0"), ("🏠 الرئيسية", "home")]
        ]
        self.panel(chat, message, text, rows)

    def topups(self, chat: int, message: int | None, offset: int = 0, all_: bool = False) -> None:
        x = self.safe_api("topups", {"offset": offset, "filter": "all" if all_ else "pending"})
        if not x:
            return
        rows = []
        for p in x.get("items", []):
            rows.append([(f"🏦 {str(p.get('label','عميل'))[:25]} · {fmt(p.get('amount_requested'))} · {p.get('status')}",
                          "topup:" + str(p["id"]))])
        rows.append([("⏳ المعلقة", "topups:0"), ("📃 الكل", "topupsall:0")])
        nav=[]
        if offset:
            nav.append(("⬅️ السابق", f"{'topupsall' if all_ else 'topups'}:{max(0,offset-15)}"))
        if len(x.get("items", []))==15:
            nav.append(("التالي ➡️", f"{'topupsall' if all_ else 'topups'}:{offset+15}"))
        if nav: rows.append(nav)
        rows.append(BACK)
        self.panel(chat, message, "🏦 <b>طلبات شحن الرصيد</b>", rows)

    def topup(self, chat: int, message: int | None, topup_id: str) -> None:
        if not is_uuid(topup_id):
            return
        x=self.safe_api("topup_detail", {"topup_id":topup_id})
        if not x:return
        p=x.get("item")
        if not p:
            self.panel(chat,message,"هذا الطلب خارج آخر 15 طلبًا؛ افتحه من القائمة مجددًا.",[[("🏦 الطلبات","topupsall:0")]])
            return
        text=(
            f"🏦 <b>طلب شحن</b>\nالمستخدم: {esc(p.get('label'))}\n"
            f"المبلغ المطلوب: <b>{fmt(p.get('amount_requested',0))}</b>\n"
            f"الحالة: {esc(p.get('status'))}\nالتاريخ: {esc(p.get('created_at'))}\n"
            "راجِع إثبات التحويل قبل الموافقة."
        )
        rows=[[("🧾 عرض إثبات التحويل", "proof:"+topup_id)]]
        if p.get("status")=="pending":
            rows.extend([
                [("✅ الموافقة بالمبلغ المطلوب", "tapprove:"+topup_id)],
                [("✏️ الموافقة بمبلغ آخر", "tamount:"+topup_id)],
                [("❌ رفض الطلب", "treject:"+topup_id)]
            ])
        rows.append([("◀️ طلبات الشحن","topups:0"),("🏠 الرئيسية","home")])
        self.panel(chat,message,text,rows)

    def orders(self, chat: int, message: int | None, offset: int = 0, all_:bool=False) -> None:
        x=self.safe_api("orders",{"offset":offset,"filter":"all" if all_ else "open"})
        if not x:
            return
        rows=[]
        for p in x.get("items",[]):
            rows.append([(f"🛒 {str(p.get('label',''))[:15]} · {str(p.get('product_name',''))[:20]} · {p.get('status')}",
                          "order:"+str(p["id"]))])
        rows.append([("⏳ المفتوحة","orders:0"),("📃 الكل","ordersall:0")])
        nav=[]
        if offset:nav.append(("⬅️ السابق",f"{'ordersall' if all_ else 'orders'}:{max(0,offset-15)}"))
        if len(x.get("items",[]))==15:nav.append(("التالي ➡️",f"{'ordersall' if all_ else 'orders'}:{offset+15}"))
        if nav:rows.append(nav)
        rows.append(BACK)
        self.panel(chat,message,"🛒 <b>طلبات المنتجات الرقمية</b>",rows)

    def order(self, chat:int,message:int|None,order_id:str) ->None:
        if not is_uuid(order_id):return
        x=self.safe_api("order_detail", {"order_id":order_id})
        if not x:return
        p=x.get("item")
        if not p:
            self.panel(chat,message,"الطلب أقدم من آخر 15 طلبًا. افتحه من القائمة.",[[("🛒 الطلبات","ordersall:0")]])
            return
        text=(f"🛒 <b>{esc(p.get('product_name'))}</b>\nالمستخدم: {esc(p.get('label'))}\n"
              f"المبلغ: {fmt(p.get('amount'))} · الكمية: {p.get('quantity')}\n"
              f"الحالة في التطبيق: {esc(p.get('status'))}\n"
              f"حالة المزوّد: {esc(p.get('provider_status'))}\n\n"
              "⚠️ تغيير الحالة هنا يدوي فقط، ولا يعيد الرصيد أو يلغي طلب المزوّد تلقائيًا.")
        rows=[
            [("⏳ قيد الانتظار","os:pending:"+order_id),("⚙️ قيد التنفيذ","os:processing:"+order_id)],
            [("✅ مقبول","os:accepted:"+order_id),("🎉 مكتمل","os:completed:"+order_id)],
            [("❌ مرفوض","os:rejected:"+order_id),("❓ غير معروف","os:unknown:"+order_id)],
            [("◀️ الطلبات","orders:0"),("🏠 الرئيسية","home")]]
        self.panel(chat,message,text,rows)

    def ledger(self, chat:int,message:int|None,offset:int=0,admin:bool=False)->None:
        x=self.safe_api("audit" if admin else "wallet_ledger",{"offset":offset})
        if not x:return
        lines=["🗂 <b>سجل الإدارة</b>" if admin else "📜 <b>حركة الأرصدة</b>"]
        for p in x.get("items",[]):
            if admin:
                lines.append(f"• {esc(p.get('action'))} · {esc(p.get('label') or '—')}\n  {esc(p.get('created_at','')[:19])}")
            else:
                lines.append(f"• {esc(p.get('label') or '—')} · {fmt(p.get('amount'))}\n"
                             f"  {esc(p.get('kind'))} · {esc(p.get('note') or '')[:120]}")
        if len(lines)==1:lines.append("\nلا توجد عمليات.")
        kind="audit" if admin else "ledger"
        rows=[]
        if offset:rows.append([("⬅️ السابق",f"{kind}:{max(0,offset-20 if admin else offset-20)}")])
        if len(x.get("items",[]))>= (15 if admin else 20):
            rows.append([("التالي ➡️",f"{kind}:{offset+(15 if admin else 20)}")])
        rows.append(BACK)
        self.panel(chat,message,"\n\n".join(lines),rows)

    def create_operation(self, chat: int, kind: str, data: dict[str, Any],
                         headline: str) -> None:
        self.db.clear_flow(chat)
        if kind in ("wallet_adjust","renew_license","unlimited_license","set_max_devices"):
            data["request_id"]="bot:"+secrets.token_hex(16)
        opid=self.db.prepare(chat,kind,data)
        self.tg.send(chat,"🔒 <b>تأكيد العملية</b>\n\n"+headline+"\n\nلن تُنفذ إلا بعد الضغط على تأكيد.",[
            [("✅ تأكيد التنفيذ","confirm:"+opid)],
            [("إلغاء","cancel:"+opid)]
        ])

    def execute(self, chat:int,opid:str)->None:
        op=self.db.operation(opid)
        if not op or op["admin_id"]!=chat or time.time()-op["created"]>86400:
            self.tg.send(chat,"انتهت صلاحية التأكيد. افتح العملية من جديد.",[BACK]);return
        if op["status"]=="done":
            self.tg.send(chat,"✅ هذه العملية نُفذت سابقًا؛ لن تتكرر.",[BACK]);return
        if op["status"]=="cancelled":
            self.tg.send(chat,"تم إلغاء العملية.",[BACK]);return
        safe_retry = op["kind"] in ("wallet_adjust","renew_license",
                                     "unlimited_license","set_max_devices")
        # A SIGKILL can leave a previously submitted request in "pending".
        # Never resend non-idempotent requests such as code_create after reboot.
        if op["status"] in ("uncertain","pending") and not safe_retry:
            self.tg.send(chat,"⚠️ ربما وصلت العملية للخادم قبل انقطاع الاتصال. "
                              "راجع بيانات المستخدم أو الطلب أولًا، ولا تعِدها تلقائيًا.",[BACK]);return
        if op["status"]=="failed":
            self.tg.send(chat,"هذه المحاولة فشلت. أنشئ عملية جديدة بعد تصحيح السبب.",[BACK]);return
        kind,payload=op["kind"],op["payload"]
        self.db.op_status(opid,"pending")
        try:
            result=self.api.call(kind,payload)
        except ApiError as exc:
            self.db.op_status(opid,"failed",exc.code)
            self.tg.send(chat,"❌ "+explain(exc),[BACK]);return
        except TransportError:
            self.db.op_status(opid,"uncertain","NETWORK_UNKNOWN")
            buttons=[[("🔄 إعادة نفس الطلب الآمن","confirm:"+opid)]] if safe_retry else []
            buttons.append(BACK)
            self.tg.send(chat,
                "⚠️ انقطع الاتصال ولا يمكن الجزم إن وصلت العملية للخادم.\n"
                +("إعادة المحاولة آمنة لأنها تستخدم نفس معرّف العملية المحفوظ."
                  if safe_retry else "لا تعِد التنفيذ تلقائيًا؛ تحقق من قوائم الإدارة أولًا."),
                buttons)
            return
        self.db.op_status(opid,"done",str(result.get("license_id") or "OK"))
        if kind=="code_create":
            msg=("🎟 <b>تم إنشاء كود التفعيل</b>\n\n"
                 f"الاسم: {esc(payload.get('label'))}\nالكود:\n<code>{esc(result.get('code'))}</code>\n"
                 "احتفظ بالكود بمكان آمن ولا تشاركه إلا مع صاحبه.")
        elif kind=="wallet_adjust":
            msg=(f"✅ تم {'إضافة' if Decimal(str(payload['amount']))>0 else 'خصم'} الرصيد.\n"
                 f"القيمة: {fmt(payload['amount'])}\nالرصيد الجديد: {fmt(result.get('balance'))}\n"
                 +("ℹ️ هذه إعادة لنفس العملية المحفوظة؛ لم تُكرر." if result.get("replayed") else ""))
        elif kind=="renew_license":
            msg=(f"✅ تم تمديد الصلاحية {payload['days']} يومًا.\n"
                 f"🗓 تاريخ الانتهاء الجديد: {esc(str(result.get('expires_at',''))[:10])}"
                 +("\nℹ️ الطلب نفسه مُنفذ مسبقًا ولم تتكرر المدة." if result.get("replayed") else ""))
        elif kind=="unlimited_license":
            msg=("✅ أصبحت صلاحية الكود بلا تاريخ انتهاء."
                 +("\nℹ️ هذا الطلب سُجّل مسبقًا." if result.get("replayed") else ""))
        elif kind=="set_max_devices":
            msg=(f"✅ الحد الجديد للأجهزة: {result.get('max_devices')}."
                 +("\nℹ️ لم يُكرر التعديل." if result.get("replayed") else ""))
        else:
            msg="✅ تمت العملية بنجاح."
        self.tg.send(chat,msg,[BACK])

    def on_message(self, msg: dict[str,Any]) -> None:
        user=int((msg.get("from") or {}).get("id") or 0)
        chat=int((msg.get("chat") or {}).get("id") or 0)
        if msg.get("chat",{}).get("type")!="private":return
        text=str(msg.get("text") or "").strip()
        if text.split(" ",1)[0] in ("/id","/myid"):
            self.tg.send(chat,f"معرّف تلغرام الخاص بك: <code>{user}</code>")
            return
        if user!=self.admin_id or chat!=user:
            if text.startswith(("/start","/admin")):self.tg.send(chat,"هذه اللوحة مخصصة لمدير تطبيق الديون فقط.")
            return
        if text in ("/start","/admin","/home","إلغاء","/cancel"):
            self.home(chat);return
        flow=self.db.flow(chat)
        if not flow:
            self.tg.send(chat,"اختر الوظيفة من الأزرار:",[[("🏠 لوحة الإدارة","home")]])
            return
        step,p=flow
        if text.startswith("/"):
            self.db.clear_flow(chat)
            self.home(chat);return
        try:
            if step=="search":
                self.search_term=text[:80]
                self.db.clear_flow(chat)
                self.users(chat,None,0);return
            if step=="wa_amount":
                amount=money(text)
                p["amount"]=str(amount if p["sign"]=="+" else -amount)
                self.db.set_flow(chat,"wa_reason",p)
                self.tg.send(chat,"📝 اكتب سبب إضافة/خصم الرصيد (3 حروف على الأقل):")
                return
            if step=="wa_reason":
                if len(text)<3:self.tg.send(chat,"اكتب سببًا واضحًا لا يقل عن 3 حروف.");return
                p["reason"]=text[:300]
                self.create_operation(chat,"wallet_adjust",{
                    "license_id":p["license_id"],"amount":p["amount"],"reason":p["reason"]
                },f"👤 {esc(p.get('label','العميل'))}\n"
                  f"💰 المبلغ: {fmt(p['amount'])}\n📝 السبب: {esc(p['reason'])}")
                return
            if step=="code_label":
                if not 2<=len(text)<=100:raise ValueError("الاسم يجب أن يكون بين 2 و100 حرف.")
                self.db.set_flow(chat,"code_phone",{"label":text})
                self.tg.send(chat,"📞 اكتب هاتف المستخدم، أو اكتب <b>تخطي</b>:")
                return
            if step=="code_phone":
                p["phone"]="" if text=="تخطي" else text[:30]
                self.db.set_flow(chat,"code_devices",p)
                self.tg.send(chat,"📱 اختر عدد الأجهزة المسموح بها:",[
                    [("1 جهاز","cv:1"),("2 جهاز","cv:2")],
                    [("3 أجهزة","cv:3"),("5 أجهزة","cv:5")]
                ])
                return
            if step=="code_date_custom":
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}",text):
                    raise ValueError("اكتب تاريخًا بالشكل YYYY-MM-DD")
                expiry=date.fromisoformat(text)
                if expiry<=date.today():raise ValueError("اختر تاريخًا في المستقبل.")
                self.finish_code(chat,{**p,"expires_on":text});return
            if step=="reset_reason":
                if len(text)<5:raise ValueError("اكتب سببًا من 5 حروف على الأقل.")
                self.create_operation(chat,"user_reset_devices",
                  {"license_id":p["license_id"],"reason":text[:300]},
                  "📴 سيتم تسجيل خروج جميع أجهزة المستخدم وإتاحة التفعيل مجددًا.")
                return
            if step=="topup_amount":
                amount=money(text)
                self.create_operation(chat,"topup_review",
                  {"topup_id":p["topup_id"],"decision":"approved","amount":str(amount),
                   "note":"موافقة عبر بوت الإدارة"},
                  f"🏦 الموافقة على شحن الرصيد بمبلغ {fmt(amount)}.\nتحقق من إثبات التحويل.")
                return
            if step=="topup_reject_reason":
                if len(text)<3:raise ValueError("اذكر سبب الرفض.")
                self.create_operation(chat,"topup_review",
                  {"topup_id":p["topup_id"],"decision":"rejected","amount":"0","note":text[:300]},
                  f"❌ رفض الشحن.\nالسبب: {esc(text)}")
                return
            if step=="order_note":
                if len(text)<3:raise ValueError("اكتب ملاحظة واضحة.")
                self.create_operation(chat,"order_status",
                  {"order_id":p["order_id"],"status":p["status"],"note":text[:300]},
                  f"🛒 تغيير حالة الطلب إلى {esc(p['status'])}\n"
                  f"الملاحظة: {esc(text)}\n⚠️ لا يعدل حالة المزوّد أو يعيد الرصيد.")
                return
        except ValueError as exc:
            self.tg.send(chat,"⚠️ "+esc(exc));return

    def finish_code(self,chat:int,p:dict[str,Any])->None:
        self.create_operation(chat,"code_create",p,
          f"🎟 كود تفعيل جديد\nالاسم: {esc(p['label'])}\n"
          f"📞 {esc(p.get('phone') or '—')}\n"
          f"📱 عدد الأجهزة: {p.get('max_devices',1)}\n"
          f"🗓 الانتهاء: {esc(p.get('expires_on') or 'بلا انتهاء')}")

    def on_callback(self,query:dict[str,Any])->None:
        user=int((query.get("from") or {}).get("id") or 0)
        cid=query.get("id","")
        if user!=self.admin_id:
            self.tg.answer(cid,"غير مصرح");return
        msg=query.get("message") or {}
        if msg.get("chat",{}).get("type")!="private" or int(msg.get("chat",{}).get("id",0))!=user:
            self.tg.answer(cid,"لوحة الإدارة خاصة");return
        chat=user; mid=int(msg.get("message_id") or 0)
        data=str(query.get("data") or "")
        self.tg.answer(cid)
        if data!="search" and not data.startswith(("cv:","ce:")):self.db.clear_flow(chat)
        try:
            if data=="home":self.home(chat,mid);return
            if data.startswith("users:"):self.users(chat,mid,int(data.split(":")[1]));return
            if data.startswith("wallets:"):self.users(chat,mid,int(data.split(":")[1]),True);return
            if data=="search":
                self.db.set_flow(chat,"search",{})
                self.tg.send(chat,"🔎 اكتب اسم العميل أو رقم الهاتف:")
                return
            if data.startswith("user:"):self.user(chat,mid,data[5:]);return
            if data.startswith("wa:"):
                sign,uid=data[3:4],data[4:]
                if sign not in ("+","-") or not is_uuid(uid):return
                usr=self.safe_api("user",{"license_id":uid})
                if not usr:return
                p={"sign":sign,"license_id":uid,"label":usr["user"].get("label")}
                self.db.set_flow(chat,"wa_amount",p)
                self.tg.send(chat,f"💰 اكتب المبلغ الذي تريد {'إضافته' if sign=='+' else 'خصمه'}"
                                  f" من {esc(p['label'])}:")
                return
            if data.startswith("codeview:"):
                uid=data.split(":",1)[1]
                if not is_uuid(uid):return
                x=self.safe_api("user_code",{"license_id":uid})
                if x:self.tg.send(chat,f"🔑 كود {esc(x.get('label'))}:\n"
                                     f"<code>{esc(x.get('code') or 'غير متاح')}</code>",
                                     [[("◀️ العميل","user:"+uid)]])
                return
            if data.startswith("toggle:"):
                uid=data.split(":",1)[1]
                if not is_uuid(uid):return
                x=self.safe_api("user",{"license_id":uid})
                if not x:return
                active=not x["user"].get("active")
                self.create_operation(chat,"user_toggle",{"license_id":uid,"active":active},
                                      f"{'✅ إعادة تفعيل' if active else '⛔ إيقاف'} "
                                      +esc(x["user"].get("label")))
                return
            if data.startswith("renew:"):
                uid=data.split(":",1)[1]
                if not is_uuid(uid):return
                x=self.safe_api("user",{"license_id":uid})
                if not x:return
                u=x["user"]
                if u.get("expires_at") is None:
                    self.tg.send(chat,"✅ كود هذا المستخدم بلا انتهاء؛ لا حاجة للتجديد.",
                        [[("◀️ المستخدم","user:"+uid)]]);return
                self.panel(chat,mid,f"🔄 <b>تجديد صلاحية {esc(u.get('label'))}</b>\n"
                           f"انتهاء الاشتراك الحالي: {esc(str(u.get('expires_at'))[:10])}\n"
                           "إذا الاشتراك ما زال ساريًا، نضيف المدة إلى تاريخ انتهائه الحالي.",
                    [[("30 يومًا","rday:30:"+uid),("90 يومًا","rday:90:"+uid)],
                     [("365 يومًا","rday:365:"+uid),("♾️ بلا انتهاء","permanent:"+uid)],
                     [("◀️ المستخدم","user:"+uid)]])
                return
            if data.startswith("rday:"):
                parts=data.split(":",2)
                if len(parts)!=3 or parts[1] not in ("30","90","365") or not is_uuid(parts[2]):return
                days,uid=int(parts[1]),parts[2]
                x=self.safe_api("user",{"license_id":uid})
                if not x:return
                u=x["user"]
                if u.get("expires_at") is None:
                    self.tg.send(chat,"✅ صلاحية المستخدم غير محدودة أصلًا.",[[("◀️ المستخدم","user:"+uid)]]);return
                self.create_operation(chat,"renew_license",{"license_id":uid,"days":days},
                    f"🔄 تمديد صلاحية {esc(u.get('label'))} بمقدار {days} يومًا.\n"
                    "التجديد سيُضاف إلى تاريخ الانتهاء الحالي إن كان مستقبلًا.")
                return
            if data.startswith("permanent:"):
                uid=data.split(":",1)[1]
                if not is_uuid(uid):return
                x=self.safe_api("user",{"license_id":uid})
                if not x:return
                self.create_operation(chat,"unlimited_license",{"license_id":uid},
                    f"♾️ تحويل صلاحية {esc(x['user'].get('label'))} إلى بلا انتهاء.\n"
                    "لا يتغير الرصيد ولا عدد الأجهزة.")
                return
            if data.startswith("devices:"):
                uid=data.split(":",1)[1]
                if not is_uuid(uid):return
                x=self.safe_api("user",{"license_id":uid})
                if not x:return
                u=x["user"];active=int(u.get("devices",0))
                choices=[(str(n)+" أجهزة",f"dmax:{n}:{uid}")
                         for n in (1,2,3,5) if n>=active]
                self.panel(chat,mid,
                    f"📱 <b>إدارة حد الأجهزة: {esc(u.get('label'))}</b>\n"
                    f"المفعّلة الآن: {active} · الحد الحالي: {u.get('max_devices',1)}\n"
                    "لتخفيض الحد تحت عدد الأجهزة المفعّلة، أعد ضبط الأجهزة أولًا.",
                    [choices[i:i+2] for i in range(0,len(choices),2)]
                    +[[("◀️ المستخدم","user:"+uid)]])
                return
            if data.startswith("dmax:"):
                parts=data.split(":",2)
                if len(parts)!=3 or parts[1] not in ("1","2","3","5") or not is_uuid(parts[2]):return
                n,uid=int(parts[1]),parts[2]
                x=self.safe_api("user",{"license_id":uid})
                if not x:return
                self.create_operation(chat,"set_max_devices",{"license_id":uid,"max_devices":n},
                    f"📱 تغيير حد الأجهزة لدى {esc(x['user'].get('label'))} إلى {n} أجهزة.")
                return
            if data.startswith("reset:"):
                uid=data.split(":",1)[1]
                if not is_uuid(uid):return
                self.db.set_flow(chat,"reset_reason",{"license_id":uid})
                self.tg.send(chat,"📴 اكتب سبب إعادة ضبط جميع أجهزة المستخدم:");return
            if data=="code":
                self.db.set_flow(chat,"code_label",{})
                self.tg.send(chat,"🎟 اكتب اسم صاحب كود التفعيل الجديد:");return
            if data.startswith("cv:"):
                count=int(data.split(":")[1])
                flow=self.db.flow(chat)
                if not flow or flow[0]!="code_devices" or count not in (1,2,3,5):return
                p=flow[1];p["max_devices"]=count
                self.db.set_flow(chat,"code_expiry",p)
                self.tg.send(chat,"🗓 اختر صلاحية الكود:",[
                    [("بلا انتهاء","ce:0"),("30 يومًا","ce:30")],
                    [("90 يومًا","ce:90"),("سنة","ce:365")],
                    [("✍️ تاريخ مخصص","ce:custom")]
                ]);return
            if data.startswith("ce:"):
                flow=self.db.flow(chat)
                if not flow or flow[0]!="code_expiry":return
                p=flow[1];val=data.split(":",1)[1]
                if val=="custom":
                    self.db.set_flow(chat,"code_date_custom",p)
                    self.tg.send(chat,"اكتب تاريخ انتهاء الكود: YYYY-MM-DD");return
                if val not in ("0","30","90","365"):return
                p["expires_on"]="" if val=="0" else (date.today()+timedelta(days=int(val))).isoformat()
                self.finish_code(chat,p);return
            if data.startswith("topups:"):self.topups(chat,mid,int(data.split(":")[1]));return
            if data.startswith("topupsall:"):self.topups(chat,mid,int(data.split(":")[1]),True);return
            if data.startswith("topup:"):self.topup(chat,mid,data.split(":",1)[1]);return
            if data.startswith("proof:"):
                uid=data.split(":",1)[1]
                if not is_uuid(uid):return
                x=self.safe_api("topup_proof",{"topup_id":uid})
                if x:self.tg.send_proof(chat,str(x.get("proof_data") or ""))
                return
            if data.startswith("tapprove:"):
                uid=data.split(":",1)[1]
                if not is_uuid(uid):return
                x=self.safe_api("topup_detail",{"topup_id":uid})
                if not x:return
                p=x.get("item")
                if p and p.get("status")!="pending":p=None
                if not p:
                    self.tg.send(chat,"الطلب لم يعد ضمن المعلّقة. حدّث القائمة.",[BACK]);return
                self.create_operation(chat,"topup_review",
                    {"topup_id":uid,"decision":"approved","amount":fmt(p["amount_requested"]),
                     "note":"موافقة بعد مراجعة إثبات التحويل"},
                    f"✅ إضافة {fmt(p['amount_requested'])} لرصيد {esc(p.get('label'))}؟ "
                    "تأكد أنك راجعت إثبات التحويل.")
                return
            if data.startswith("tamount:"):
                uid=data.split(":",1)[1]
                if not is_uuid(uid):return
                self.db.set_flow(chat,"topup_amount",{"topup_id":uid})
                self.tg.send(chat,"اكتب المبلغ الذي ستوافق عليه بعد مراجعة الإثبات:");return
            if data.startswith("treject:"):
                uid=data.split(":",1)[1]
                if not is_uuid(uid):return
                self.db.set_flow(chat,"topup_reject_reason",{"topup_id":uid})
                self.tg.send(chat,"اكتب سبب رفض طلب الشحن:");return
            if data.startswith("orders:"):self.orders(chat,mid,int(data.split(":")[1]));return
            if data.startswith("ordersall:"):self.orders(chat,mid,int(data.split(":")[1]),True);return
            if data.startswith("order:"):self.order(chat,mid,data.split(":",1)[1]);return
            if data.startswith("os:"):
                _,status,uid=data.split(":",2)
                if not is_uuid(uid) or status not in ("pending","processing","accepted","completed","rejected","unknown"):return
                self.db.set_flow(chat,"order_note",{"order_id":uid,"status":status})
                self.tg.send(chat,"📝 اكتب ملاحظة تغيير الحالة. "
                                  "هذا تعديل يدوي فقط ولا يلغي تنفيذ المزوّد أو يعيد المبلغ.");return
            if data.startswith("ledger:"):self.ledger(chat,mid,int(data.split(":")[1]));return
            if data.startswith("audit:"):self.ledger(chat,mid,int(data.split(":")[1]),True);return
            if data=="alerts":
                self.alerts_menu(chat,mid);return
            if data.startswith("alert_toggle:"):
                kind=data.split(":",1)[1]
                if kind not in ("topup","order"):return
                current=self.db.alert_setting(kind)["enabled"]
                self.db.set_alert_enabled(kind,not current)
                self.alerts_menu(chat,mid);return
            if data=="alert_test":
                self.tg.send(chat,"🧪 <b>اختبار التنبيهات</b>\n"
                                  "هذا إشعار تجريبي فقط، دون طلب أو تعديل رصيد.",
                    [[("🔔 إعدادات التنبيهات","alerts")]])
                return
            if data=="settings":
                x=self.safe_api("ping")
                self.panel(chat,mid,"⚙️ <b>الإعدادات</b>\n"
                           f"اتصال الخادم: {'✅ متصل' if x else '❌ غير متصل'}\n"
                           f"معرّف المدير: <code>{chat}</code>\n\n"
                           "🔐 لتغيير توكن بوت تلغرام افتح setup.py على السيرفر.\n"
                           "لن يطلب البوت منك إرسال التوكن أو مفتاح Supabase داخل المحادثة.",
                           [BACK]);return
            if data.startswith("confirm:"):
                opid=data.split(":",1)[1]
                if re.fullmatch("[a-f0-9]{32}",opid):self.execute(chat,opid)
                return
            if data.startswith("cancel:"):
                opid=data.split(":",1)[1];op=self.db.operation(opid)
                if op and op["admin_id"]==chat and op["status"]=="prepared":
                    self.db.op_status(opid,"cancelled")
                    self.tg.send(chat,"تم إلغاء العملية؛ لم يُجرَ أي تغيير.",[BACK])
                else:self.tg.send(chat,"لا يمكن إلغاء عملية أُرسلت للخادم.",[BACK])
                return
            self.tg.send(chat,"زر قديم أو غير معروف؛ عد للرئيسية.",[BACK])
        except (IndexError,TypeError,ValueError):
            self.tg.send(chat,"تعذر قراءة الزر. افتح القائمة من جديد.",[BACK])

    def process(self,update:dict[str,Any])->None:
        if "message" in update:self.on_message(update["message"])
        elif "callback_query" in update:self.on_callback(update["callback_query"])

    def loop(self)->None:
        info=self.tg.call("getMe")
        name=info.get("result",{}).get("username","bot")
        print(f"UCHIHA Debt admin running (@{name}). Administrator only; Ctrl+C to stop.",flush=True)
        hook=self.tg.call("getWebhookInfo").get("result",{})
        if hook.get("url"):
            raise RuntimeError("This bot already has a webhook; remove it before starting long polling.")
        self.api.call("ping")
        try:
            self.tg.call("setMyCommands",
                scope={"type":"chat","chat_id":self.admin_id},
                commands=[
                    {"command":"start","description":"لوحة الإدارة"},
                    {"command":"id","description":"معرّف حسابي"},
                ])
        except (ApiError,TransportError):
            log.warning("Could not register Telegram bot commands; continuing")
        thread=threading.Thread(
            target=self.alerts_worker,name="debt-notifications",daemon=True)
        thread.start()
        offset=self.db.get_offset()
        failures=0
        while True:
            try:
                updates=self.tg.call("getUpdates",offset=offset,timeout=28,limit=30,
                    allowed_updates=["message","callback_query"]).get("result",[])
                failures=0
                for item in updates:
                    uid=int(item.get("update_id",offset))
                    try:
                        self.process(item)
                    except (ApiError,TransportError) as exc:
                        # No secret or PII in log messages.
                        log.warning("Unable to process update %d (%s)",uid,type(exc).__name__)
                    except Exception:
                        log.exception("Unexpected update failure (update_id=%d)",uid)
                    offset=max(offset,uid+1)
                    self.db.advance_offset(offset)
            except KeyboardInterrupt:
                raise
            except Exception:
                failures+=1
                log.warning("Bot polling interrupted; retry #%d",failures)
                time.sleep(min(30,2**min(failures,5)))


def main()->None:
    config=load_env(HERE/".env")
    needed=["BOT_TOKEN","ADMIN_TELEGRAM_ID","BOT_RPC_SECRET","SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY"]
    absent=[key for key in needed if not config.get(key)]
    if absent:
        raise SystemExit("Missing configuration: "+", ".join(absent)+". Run setup.py first.")
    admin_id=int(config["ADMIN_TELEGRAM_ID"])
    if admin_id<=0:raise SystemExit("Invalid ADMIN_TELEGRAM_ID")
    path=HERE/"bot.sqlite3"
    os.umask(0o077)
    lock=(HERE/".bot.lock").open("w")
    try:
        fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit("Another bot instance is already running.")
    logging.basicConfig(level=logging.WARNING,format="%(asctime)s %(levelname)s %(message)s")
    bot=AdminBot(Telegram(config["BOT_TOKEN"]),
                 Backend(config["SUPABASE_URL"],config["SUPABASE_PUBLISHABLE_KEY"],
                         admin_id,config["BOT_RPC_SECRET"]),
                 Storage(path),admin_id)
    bot.loop()


if __name__=="__main__":
    main()
