"""Dedicated V1-83 Telegram management bot. NEVER touches v101's provider store.

Only the already-paired Telegram owner can operate the initial deployment.
Every read and write goes through V1-83's tenant-scoped API, signed using the
existing root-owned bot token. Telegram user IDs alone never authenticate HTTP.
"""
from __future__ import annotations

import decimal
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

PUBLIC_WEBAPP = "https://radius.uchiha-builder.com/v183/"
API_BASE = "http://127.0.0.1:8794/api/v1"
PAGE_SIZE = 7
# Non-sensitive, allowlisted WebApp destinations; authorization happens in the API.
WEBAPP_ROUTES = frozenset({
    "dashboard", "subscribers", "add-subscriber", "plans", "add-plan",
    "mikrotik", "add-mikrotik", "mikrotik-status", "site-agent",
    "sessions", "invoices", "support", "add-ticket", "reports",
    "sites", "add-site", "vouchers", "resellers", "telegram", "subscription",
})
OFFSET_PATH = Path("/var/lib/uchiha-radius-v183/telegram-offset")
REASON = "طلب مؤكد من مالك بوت UCHIHA RADIUS"


def escape(value):
    return html.escape(str(value if value is not None else "—"), quote=True)


def signed_init_data(bot_token: str, owner_id: int, now: int | None = None) -> str:
    fields = {
        "auth_date": str(int(now if now is not None else time.time())),
        "query_id": "bot_service_" + secrets.token_hex(12),
        "user": json.dumps({"id": owner_id, "first_name": "UCHIHA"}, separators=(",", ":")),
    }
    to_sign = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
    return urllib.parse.urlencode(fields)


def price_minor(value: str) -> int:
    amount = decimal.Decimal(value.strip())
    if not amount.is_finite() or amount < 0 or amount > 10_000_000:
        raise ValueError("المبلغ غير صالح")
    cents = amount * 100
    if cents != cents.to_integral_value():
        raise ValueError("أدخل رقمًا لا يزيد على منزلتين عشريتين")
    return int(cents)


def fmt_price(minor, currency="USD") -> str:
    return f"{decimal.Decimal(int(minor or 0)) / 100:.2f} {currency}"


class ApiError(Exception):
    pass


class V183Api:
    def __init__(self, bot_token: str, owner_id: int, base: str = API_BASE,
                 *, require_platform_owner: bool = True):
        self.bot_token, self.owner_id, self.base = bot_token, owner_id, base.rstrip("/")
        self.require_platform_owner = require_platform_owner
        digest = hashlib.sha256(bot_token.encode()).hexdigest()
        self.installation_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"UCHIHA-v183-bot:{digest}:{owner_id}"))
        self.access_token = None
        self.expiry = 0.0
        self.tenant_id = None

    def _transport(self, path: str, payload=None, method: str = "GET", key: str | None = None, auth: bool = True):
        headers = {
            "accept": "application/json", "x-installation-id": self.installation_id,
            "x-uchiha-platform": "web", "user-agent": "UCHIHA-RADIUS-V183-Bot/1",
        }
        if payload is not None:
            headers["content-type"] = "application/json"
        if auth and self.access_token:
            headers["authorization"] = "Bearer " + self.access_token
        if auth and self.tenant_id:
            headers["x-tenant-id"] = self.tenant_id
        if key:
            headers["idempotency-key"] = key
        url = self.base + path
        req = urllib.request.Request(url, method=method, headers=headers,
            data=json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=12) as result:
                response = json.load(result)
                return response.get("data", response)
        except urllib.error.HTTPError as exc:
            code = exc.code
            try:
                response = json.loads(exc.read(2048))
                message = response.get("error", {}).get("message") or response.get("message")
            except (ValueError, AttributeError):
                message = None
            raise ApiError(f"V1-83 API {code}: {message or 'تعذر تنفيذ الطلب'}") from None
        except (OSError, ValueError) as exc:
            raise ApiError("تعذر الاتصال بخادم V1-83: " + type(exc).__name__) from None

    def claim_link(self, code: str):
        # This endpoint checks BOTH the 15-minute single-use web-issued code
        # and this bot's valid Telegram HMAC; no account ID is trusted from chat.
        return self._transport("/auth/telegram-link/claim",
            {"initData": signed_init_data(self.bot_token, self.owner_id),
             "code": code}, "POST", auth=False)

    def login(self):
        data = self._transport("/auth/telegram", {"initData": signed_init_data(self.bot_token, self.owner_id)}, "POST", auth=False)
        self.access_token = data["token"]
        self.expiry = time.monotonic() + 1800
        self.tenant_id = data.get("tenantId") or None
        me = self._transport("/auth/me")
        if self.require_platform_owner and (me.get("role") != "owner" or
                me.get("user", {}).get("platformRole") != "platform_owner"):
            self.access_token = None
            raise ApiError("حساب البوت لا يمتلك صلاحية المالك في V1-83")
        self.tenant_id = me.get("tenantId")
        if not self.tenant_id:
            raise ApiError("حساب المالك غير مرتبط بمزود V1-83")
        return me

    def request(self, path: str, payload=None, method="GET", *, key=None):
        if not self.access_token or time.monotonic() >= self.expiry:
            self.login()
        try:
            return self._transport(path, payload, method, key)
        except ApiError as error:
            if method == "GET" and " 401:" in str(error):
                self.access_token = None
                self.login()
                return self._transport(path, payload, method, key)
            raise


class V183Bot:
    def __init__(self, token: str, owner: int, *, api=None, telegram=None):
        if not token or owner < 1:
            raise ValueError("Both existing bot token and paired owner ID are required")
        self.token = token
        self.owner = owner
        self.api = api or V183Api(token, owner)
        self.telegram = telegram or self._telegram_call
        self.drafts = {}
        self.confirms = {}

    def _telegram_call(self, method: str, payload: dict):
        # Never include Telegram's token-bearing request URL in an exception.
        if method == "sendPhoto" and payload.get("photo") == "attach://avatar":
            avatar = Path(__file__).with_name("assets") / "profile-default.png"
            boundary = "radius_avatar_" + secrets.token_hex(12)
            parts = []
            for key, value in payload.items():
                if key == "photo":
                    continue
                if isinstance(value, (dict, list)):
                    value = json.dumps(value, ensure_ascii=False)
                parts.append(("--" + boundary + "\r\n" +
                              'Content-Disposition: form-data; name="' + key + '"\r\n\r\n'
                              ).encode() + str(value).encode() + b"\r\n")
            parts.append(("--" + boundary + "\r\n" +
                          'Content-Disposition: form-data; name="photo"; filename="profile-default.png"\r\n' +
                          "Content-Type: image/png\r\n\r\n").encode() +
                         avatar.read_bytes() + b"\r\n")
            parts.append(("--" + boundary + "--\r\n").encode())
            body = b"".join(parts)
            headers = {"content-type": "multipart/form-data; boundary=" + boundary}
        else:
            body = json.dumps(payload, ensure_ascii=False).encode()
            headers = {"content-type": "application/json"}
        req = urllib.request.Request("https://api.telegram.org/bot" + self.token + "/" + method,
            data=body, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=40) as result:
                return json.load(result)
        except urllib.error.HTTPError as exc:
            raise RuntimeError("Telegram API request failed: HTTP " + str(exc.code)) from None
        except OSError as exc:
            raise RuntimeError("Telegram transport failed: " + type(exc).__name__) from None

    @staticmethod
    def btn(label, data=None, *, web=False, route=None):
        if web:
            if route is not None and route not in WEBAPP_ROUTES:
                raise ValueError("Invalid WebApp destination")
            url = PUBLIC_WEBAPP + ("?open=" + route if route else "")
            return {"text": label, "web_app": {"url": url}}
        return {"text": label, "callback_data": data}

    @staticmethod
    def router_web_btn(label: str, device_id: str):
        # The selected registration ID is only a navigation hint. The Mini
        # App must independently verify Telegram identity, tenant and role.
        if not re.fullmatch(r"dev_[A-Za-z0-9_-]{8,55}", device_id):
            raise ValueError("Invalid MikroTik registration")
        url = PUBLIC_WEBAPP + "?" + urllib.parse.urlencode({
            "open": "connect-mikrotik", "deviceId": device_id,
        })
        return {"text": label, "web_app": {"url": url}}

    @staticmethod
    def router_agent_btn(label: str, device_id: str):
        """Open the on-site agent for exactly this registered tenant device.

        This is a navigation hint, not an authorization token.
        """
        if not re.fullmatch(r"dev_[A-Za-z0-9_-]{8,55}", device_id):
            raise ValueError("Invalid MikroTik registration")
        url = PUBLIC_WEBAPP + "?" + urllib.parse.urlencode({
            "open": "site-agent", "deviceId": device_id,
        })
        return {"text": label, "web_app": {"url": url}}

    def menu(self):
        return {"inline_keyboard": [
            [self.btn("📊 الرئيسية", "home"), self.btn("👥 المشتركون", "list:subscribers:0")],
            [self.btn("📦 الباقات", "list:plans:0"), self.btn("📡 الراوترات", "list:devices:0")],
            [self.btn("🌐 الجلسات", "list:sessions:0"), self.btn("💳 الفواتير", "list:invoices:0")],
            [self.btn("🧾 سجل التدقيق", "list:audit:0"), self.btn("🩺 حالة المنظومة", "health")],
            [self.btn("➕ مشترك", "new:subscriber"), self.btn("➕ باقة", "new:plan")],
            [self.btn("➕ راوتر", "new:device")],
            [self.btn("🖥 فتح واجهة V1-83", web=True)],
        ]}

    def send(self, chat: int, text: str, keys=None):
        return self.telegram("sendMessage", {
            "chat_id": chat, "text": text, "parse_mode": "HTML",
            "disable_web_page_preview": True, "reply_markup": keys if keys is not None else self.menu(),
        })

    def answer(self, callback, message=""):
        if callback.get("id"):
            self.telegram("answerCallbackQuery", {"callback_query_id": callback["id"],
               "text": message[:180], "show_alert": bool(message)})

    def _owner_private(self, chat: dict, user: dict) -> bool:
        try:
            return chat.get("type") == "private" and int(chat.get("id")) == self.owner and int(user.get("id")) == self.owner
        except (TypeError, ValueError, AttributeError):
            return False

    def home(self, chat: int):
        data = self.api.request("/dashboard")
        m = data.get("metrics", {})
        sub = data.get("subscription") or {}
        self.send(chat, "<b>UCHIHA RADIUS V1-83 • بيانات فعلية</b>\n\n"
            f"👥 المشتركون: <b>{int(m.get('subscribers') or 0)}</b>\n"
            f"🟢 المشتركـون النشطون: <b>{int(m.get('activeSubscribers') or 0)}</b>\n"
            f"🌐 الجلسات المتصلة: <b>{int(m.get('activeSessions') or 0)}</b>\n"
            f"📡 الراوترات: <b>{int(m.get('devices') or 0)}</b>\n"
            f"✅ الأجهزة المتصلة: <b>{int(m.get('onlineDevices') or 0)}</b>\n"
            f"💳 الفواتير المفتوحة: <b>{int(m.get('openInvoices') or 0)}</b>\n"
            f"📦 الاشتراك: {escape(sub.get('status') or 'غير متاح')}\n\n"
            "هذه الإحصاءات من قاعدة V1-83 المستقلة، وليست بيانات نسخة v101.")

    def health(self, chat: int):
        import urllib.request as request
        try:
            with request.urlopen("http://127.0.0.1:8794/ready", timeout=4) as response:
                status = json.load(response).get("data", {}).get("ready")
        except (OSError, ValueError):
            status = False
        self.send(chat, "<b>حالة UCHIHA RADIUS V1-83</b>\n\n"
            + ("✅" if status else "⚠️") + " خادم الإدارة: " + ("متصل" if status else "بحاجة إلى فحص") + "\n"
            "🖥 واجهة V1-83: https://radius.uchiha-builder.com/v183/\n"
            "📡 MikroTik: يظهر لكل جهاز بعد إتمام الربط الحقيقي؛ لا تُعتبر الأجهزة قيد الانتظار متصلة.")

    def _format_item(self, category, item):
        if category == "subscribers":
            status = item.get("status", "?")
            return f"👤 {escape(item.get('fullName') or item.get('username'))} — <code>{escape(item.get('username'))}</code> ({escape(status)})"
        if category == "plans":
            return f"📦 {escape(item.get('name'))} • {escape(item.get('speedDownMbps'))}/{escape(item.get('speedUpMbps'))} Mbps • {fmt_price(item.get('priceMinor'))}"
        if category == "devices":
            return f"📡 {escape(item.get('name'))} • <code>{escape(item.get('host'))}</code> ({escape(item.get('status'))})"
        if category == "sessions":
            return f"🌐 <code>{escape(item.get('username'))}</code> • {escape(item.get('status'))}"
        if category == "invoices":
            return f"💳 {escape(item.get('number'))} • {escape(item.get('subscriberName'))} • {fmt_price(item.get('amountMinor'),item.get('currency','USD'))} ({escape(item.get('status'))})"
        if category == "audit":
            return f"🧾 {escape(item.get('action'))} • {escape(item.get('created_at'))}"
        return escape(item)

    def listing(self, chat: int, category: str, offset: int):
        titles = {"subscribers": "المشتركون", "plans": "الباقات", "devices": "الراوترات",
            "sessions": "الجلسات", "invoices": "الفواتير", "audit": "سجل التدقيق"}
        if category not in titles or offset < 0 or offset > 100000:
            raise ValueError("Unknown listing request")
        if category in ("plans", "devices"):
            result = self.api.request("/" + category)
            all_items = result.get("items", [])
            total = len(all_items)
            rows = all_items[offset:offset+PAGE_SIZE]
        else:
            result = self.api.request("/" + category + "?" + urllib.parse.urlencode({
                "limit": PAGE_SIZE, "offset": offset}))
            rows = result.get("items", [])
            total = int((result.get("pagination") or {}).get("total") or 0)
        lines = [f"<b>{escape(titles[category])} — V1-83</b>",
            f"الإجمالي: {total} | الصفحة: {offset // PAGE_SIZE + 1}", ""]
        lines.extend(self._format_item(category, i) for i in rows)
        if not rows:
            lines.append("لا توجد سجلات حالياً.")
        keys = []
        if category == "subscribers":
            keys.extend([[self.btn("👤 "+(i.get("username") or "")[:28],
                 "sub:" + i["id"])] for i in rows])
        if category == "invoices":
            keys.extend([[self.btn("💳 "+str(i.get("number") or "")[:28],
                 "invoice:" + i["id"])] for i in rows])
        paging = []
        if offset:
            paging.append(self.btn("السابق", f"list:{category}:{max(0,offset-PAGE_SIZE)}"))
        if offset + len(rows) < total:
            paging.append(self.btn("التالي", f"list:{category}:{offset+PAGE_SIZE}"))
        if paging:
            keys.append(paging)
        keys.append([self.btn("🏠 القائمة", "home"),
                     self.btn("🖥 واجهة V1-83", web=True)])
        self.send(chat, "\n".join(lines), {"inline_keyboard": keys})

    def subscriber(self, chat: int, sid: str):
        result = self.api.request("/subscribers/" + urllib.parse.quote(sid, safe=""))
        status = result.get("status")
        keys = []
        if status == "active":
            keys.append([self.btn("⏸ تعليق المشترك", "ask:suspend:"+sid)])
        if status in ("suspended", "pending"):
            keys.append([self.btn("▶️ تفعيل المشترك", "ask:activate:"+sid)])
        keys.append([self.btn("♻️ تجديد", "ask:renew:"+sid)])
        keys.append([self.btn("🖥 واجهة V1-83", web=True), self.btn("🏠 رجوع", "list:subscribers:0")])
        self.send(chat,
            f"<b>{escape(result.get('fullName'))}</b>\n"
            f"اسم المستخدم: <code>{escape(result.get('username'))}</code>\n"
            f"الحالة: {escape(status)}\n"
            f"الباقة: {escape((result.get('plan') or {}).get('name'))}\n"
            "التغييرات الحساسة لا تنفّذ إلا بعد التأكيد.",
            {"inline_keyboard": keys})

    def invoice(self, chat: int, invoice_id: str):
        # Use the tenant-scoped list; there is no unrestricted invoice-by-id API.
        result = self.api.request("/invoices?limit=100")
        row = next((i for i in result.get("items", []) if i["id"] == invoice_id), None)
        if not row:
            self.send(chat, "الفاتورة غير موجودة في أول 100 فاتورة. افتح الواجهة للبحث الدقيق.")
            return
        balance = int(row.get("amountMinor") or 0) - int(row.get("paidMinor") or 0)
        keys = [[self.btn("💰 تسجيل دفعة نقدية", "new:payment:"+invoice_id)]] if balance > 0 and row.get("status") != "void" else []
        keys += [[self.btn("🖥 واجهة V1-83", web=True), self.btn("🏠 القائمة", "home")]]
        self.send(chat, f"<b>فاتورة {escape(row.get('number'))}</b>\n"
            f"المشترك: {escape(row.get('subscriberName'))}\n"
            f"القيمة: {fmt_price(row.get('amountMinor'),row.get('currency','USD'))}\n"
            f"المسدّد: {fmt_price(row.get('paidMinor'),row.get('currency','USD'))}\n"
            f"المتبقي: {fmt_price(balance,row.get('currency','USD'))}\n"
            f"الحالة: {escape(row.get('status'))}\n"
            "أي تسجيل دفعة يحتاج تأكيداً صريحاً.",
            {"inline_keyboard": keys})

    def ask_confirmation(self, chat: int, action: str, target: str, *, display: str | None = None, payload=None):
        nonce = secrets.token_urlsafe(9)
        self.confirms[nonce] = {
            "action": action, "target": target, "payload": payload,
            "idempotency": str(uuid.uuid4()), "time": time.monotonic(),
        }
        labels = {"suspend": "تعليق مشترك", "activate": "تفعيل مشترك", "renew": "تجديد مشترك",
            "plan": "إنشاء باقة", "subscriber": "إنشاء مشترك قيد التفعيل",
            "device": "تسجيل راوتر قيد الربط", "payment": "تسجيل دفعة نقدية"}
        self.send(chat, "<b>تأكيد العملية</b>\n"
            + escape(display or labels.get(action, action))
            + "\n\nلن يُنفّذ الإجراء قبل ضغط زر التأكيد.",
            {"inline_keyboard": [
                [self.btn("✅ تأكيد التنفيذ", "confirm:"+nonce),
                 self.btn("❌ إلغاء", "cancel")],
            ]})

    def confirm(self, chat: int, nonce: str):
        pending = self.confirms.get(nonce)
        if not pending or time.monotonic() - pending["time"] > 600:
            self.confirms.pop(nonce, None)
            self.send(chat, "انتهت صلاحية التأكيد. افتح الزر من جديد.")
            return
        action, target, payload = pending["action"], pending["target"], pending["payload"]
        if action in ("suspend", "activate", "renew"):
            url = "/subscribers/" + urllib.parse.quote(target, safe="") + "/" + action
            payload = {"reason": REASON}
        elif action == "plan":
            url = "/plans"
        elif action == "subscriber":
            url = "/subscribers"
        elif action == "device":
            url = "/devices"
        elif action == "payment":
            url = "/invoices/" + urllib.parse.quote(target, safe="") + "/payments"
        else:
            raise ValueError("Unsupported action")
        # A fixed key per confirmation means retries cannot double-create records/payments.
        result = self.api.request(url, payload, "POST", key=pending["idempotency"])
        self.confirms.pop(nonce, None)
        outcome = result.get("status") if isinstance(result, dict) else None
        self.send(chat, "✅ <b>تم تسجيل العملية في V1-83.</b>"
             + ("\nالحالة: " + escape(outcome) if outcome else "")
             + ("\nالمشترك بانتظار تعيين بيانات الدخول والتفعيل عبر الواجهة."
                if action == "subscriber" else "")
             + ("\nالراوتر بانتظار ربط Site Agent والتحقق الفعلي."
                if action == "device" else ""))

    def start_draft(self, chat: int, action: str, target: str = ""):
        prompts = {
            "plan": "<b>إضافة باقة</b>\nأرسل بسطر واحد:\n<code>اسم الباقة | سرعة التحميل | سرعة الرفع | السعر بالدولار</code>\nمثال: <code>المنزل 20 | 20 | 5 | 10.50</code>",
            "subscriber": "<b>إضافة مشترك</b>\nأرسل: <code>الاسم الكامل | اسم المستخدم</code>\nلا تُرسل كلمات المرور إلى البوت. سيُنشأ الحساب بحالة قيد التفعيل؛ عيّن كلمة المرور عبر واجهة الويب.",
            "device": "<b>تسجيل راوتر</b>\nأرسل: <code>اسم الراوتر | عنوان IP أو المضيف</code>\nلا تُرسل بيانات دخول MikroTik. الجهاز سيبقى قيد الربط حتى ربط Site Agent.",
            "payment": "<b>تسجيل دفعة نقدية</b>\nأرسل المبلغ بالدولار، مثال: <code>25.50</code>\nتأكد أن الدفع استُلِم فعلاً. التسجيل المالي يتم فقط بعد تأكيدك.",
        }
        if action not in prompts:
            raise ValueError("Unknown draft")
        self.drafts[chat] = {"action": action, "target": target, "time": time.monotonic()}
        self.send(chat, prompts[action] + "\n\n/cancel للإلغاء.")

    def accept_draft(self, chat: int, text: str) -> bool:
        draft = self.drafts.get(chat)
        if not draft:
            return False
        if time.monotonic() - draft["time"] > 300:
            self.drafts.pop(chat, None)
            self.send(chat, "انتهت مهلة النموذج. افتح زر الإضافة من جديد.")
            return True
        kind, target = draft["action"], draft["target"]
        try:
            if kind == "payment":
                amount = price_minor(text)
                if amount <= 0:
                    raise ValueError("المبلغ يجب أن يكون أكبر من الصفر")
                payload = {"amountMinor": amount, "method": "cash", "reason": REASON}
                preview = f"تسجيل دفعة نقدية بقيمة {fmt_price(amount)} للفاتورة المختارة."
            else:
                parts = [x.strip() for x in text.split("|")]
                if kind == "plan":
                    if len(parts) != 4 or len(parts[0]) < 2:
                        raise ValueError("الصيغة: الاسم | التحميل | الرفع | السعر")
                    download, upload = int(parts[1]), int(parts[2])
                    if not (1 <= download <= 100000 and 1 <= upload <= 100000):
                        raise ValueError("يجب أن تكون سرعة التحميل والرفع أرقاماً موجبة")
                    payload = {"name": parts[0], "speedDownMbps": download,
                        "speedUpMbps": upload, "priceMinor": price_minor(parts[3]),
                        "billingCycle": "monthly"}
                    preview = f"باقة {parts[0]} بسرعة {download}/{upload} Mbps وسعر {fmt_price(payload['priceMinor'])}."
                elif kind == "subscriber":
                    if len(parts) != 2 or len(parts[0]) < 2 or not re.fullmatch(r"[A-Za-z0-9._@-]{3,64}", parts[1]):
                        raise ValueError("الصيغة: الاسم الكامل | اسم المستخدم بالإنجليزية (3 أحرف على الأقل)")
                    payload = {"fullName": parts[0], "username": parts[1]}
                    preview = f"مشترك {parts[0]} باسم مستخدم {parts[1]}، بدون كلمة مرور حالياً."
                elif kind == "device":
                    if len(parts) != 2 or len(parts[0]) < 2 or not re.fullmatch(r"[A-Za-z0-9.:-]{3,253}", parts[1]):
                        raise ValueError("الصيغة: اسم الراوتر | IP أو المضيف")
                    payload = {"name": parts[0], "host": parts[1], "apiPort": 8729, "connectionMethod": "agent"}
                    preview = f"راوتر {parts[0]} على {parts[1]}، بحالة انتظار ربط Site Agent."
                else:
                    raise ValueError("العملية غير مدعومة")
            self.drafts.pop(chat, None)
            self.ask_confirmation(chat, kind, target, display=preview, payload=payload)
        except (ValueError, decimal.InvalidOperation) as error:
            self.send(chat, "⚠️ " + escape(error) + "\nأعد إرسال البيانات أو /cancel للإلغاء.")
        return True

    def search(self, chat: int, term: str):
        if len(term) < 2 or len(term) > 80:
            self.send(chat, "اكتب /find ثم جزءاً من اسم المشترك أو اسم المستخدم، من حرفين إلى 80.")
            return
        result = self.api.request("/subscribers?" + urllib.parse.urlencode({"q": term, "limit": 12}))
        items = result.get("items", [])
        if not items:
            self.send(chat, "لا توجد نتائج لهذا البحث.")
            return
        keys = [[self.btn((i.get("fullName") or i.get("username") or "")[:33],
                      "sub:" + i["id"])] for i in items]
        keys.append([self.btn("🏠 القائمة", "home")])
        self.send(chat, f"🔍 نتائج البحث عن <b>{escape(term)}</b>: {len(items)}",
                  {"inline_keyboard": keys})

    def handle(self, update: dict):
        callback = update.get("callback_query")
        msg = (callback or {}).get("message") if callback else update.get("message")
        actor = (callback or {}).get("from") if callback else (msg or {}).get("from")
        chat = (msg or {}).get("chat") or {}
        if not self._owner_private(chat, actor or {}):
            if callback:
                self.answer(callback, "هذا الحساب غير مرتبط بمالك V1-83")
            # Never show private ISP data or even an operator keyboard in a group.
            return
        chat_id = self.owner
        command = (callback or {}).get("data") if callback else (msg or {}).get("text", "").strip()
        if not command:
            return
        if callback:
            self.answer(callback)
        if command == "/cancel" or command == "cancel":
            self.drafts.pop(chat_id, None)
            self.confirms.clear()
            self.send(chat_id, "تم إلغاء العملية. لن يُغيّر أي سجل.")
            return
        if command.startswith("/start") or command in ("/menu", "home"):
            self.home(chat_id)
            return
        if command in ("/status", "health"):
            self.health(chat_id)
            return
        if command == "/app":
            self.send(chat_id, "اضغط زر واجهة V1-83 لفتح التطبيق داخل تيليغرام.")
            return
        if command == "/subscribers":
            self.listing(chat_id, "subscribers", 0)
            return
        if command == "/sessions":
            self.listing(chat_id, "sessions", 0)
            return
        if command == "/audit":
            self.listing(chat_id, "audit", 0)
            return
        if command.startswith("/find"):
            self.search(chat_id, command[5:].strip())
            return
        if callback and command.startswith("list:"):
            _, category, offset = command.split(":", 2)
            if not re.fullmatch(r"\d{1,6}", offset):
                raise ValueError("Invalid page")
            self.listing(chat_id, category, int(offset))
            return
        if callback and command.startswith("sub:"):
            self.subscriber(chat_id, command[4:])
            return
        if callback and command.startswith("invoice:"):
            self.invoice(chat_id, command[8:])
            return
        if callback and command.startswith("ask:"):
            _, action, sid = command.split(":", 2)
            if action not in ("suspend", "activate", "renew") or not re.fullmatch(r"cus_[A-Za-z0-9_-]{8,55}", sid):
                raise ValueError("Unknown subscriber action")
            self.ask_confirmation(chat_id, action, sid)
            return
        if callback and command.startswith("new:"):
            _, kind, *target = command.split(":", 2)
            self.start_draft(chat_id, kind, target[0] if target else "")
            return
        if callback and command.startswith("confirm:"):
            self.confirm(chat_id, command[8:])
            return
        if not callback and self.accept_draft(chat_id, command):
            return
        self.send(chat_id, "استخدم أزرار اللوحة أو /find للبحث.")

    def configure(self):
        self.telegram("setMyCommands", {"commands": [
            {"command": "start", "description": "لوحة V1-83"},
            {"command": "menu", "description": "القائمة الرئيسية"},
            {"command": "app", "description": "واجهة V1-83 الكاملة"},
            {"command": "status", "description": "حالة الخادم / الشبكة"},
            {"command": "mikrotik", "description": "MikroTik داخل البوت"},
            {"command": "subscribers", "description": "المشتركون"},
            {"command": "sessions", "description": "الجلسات المتصلة"},
            {"command": "audit", "description": "سجل التدقيق"},
            {"command": "find", "description": "البحث عن مشترك"},
            {"command": "addmikrotik", "description": "إضافة MikroTik"},
            {"command": "addsubscriber", "description": "إضافة مشترك"},
            {"command": "payments", "description": "التحصيل والدفعات"},
            {"command": "advanced", "description": "الإدارة المتقدمة"},
            {"command": "profile", "description": "الملف الشخصي"},
            {"command": "cancel", "description": "إلغاء العملية"},
        ]})
        for selector in ({}, {"chat_id": self.owner}):
            self.telegram("setChatMenuButton", {
                **selector, "menu_button": {
                    "type": "web_app", "text": "فتح لوحة التحكم",
                    "web_app": {"url": PUBLIC_WEBAPP},
                },
            })

    def serve(self):
        self.configure()
        offset = 0
        try:
            offset = max(0, int(OFFSET_PATH.read_text().strip()))
        except (OSError, ValueError):
            # During cutover do not replay stale v101 keyboard actions. A user
            # can send /start after the new menu has been installed.
            try:
                backlog = self.telegram("getUpdates", {
                    "offset": -1, "timeout": 0,
                    "allowed_updates": ["message", "callback_query"],
                }).get("result", [])
                if backlog:
                    offset = max(int(item["update_id"]) for item in backlog) + 1
            except (OSError, RuntimeError, ValueError):
                # If polling is momentarily unavailable, normal Telegram
                # offset deduplication will still apply on the next pass.
                pass
        print("UCHIHA RADIUS V1-83 dedicated Telegram bot started", flush=True)
        while True:
            try:
                result = self.telegram("getUpdates", {"offset": offset, "timeout": 27,
                    "allowed_updates": ["message", "callback_query"]})
                for update in result.get("result", []):
                    update_id = int(update["update_id"])
                    if update_id < offset:
                        continue
                    try:
                        self.handle(update)
                    except (ApiError, ValueError) as error:
                        actor = (update.get("message") or update.get("callback_query") or {}).get("from", {})
                        if int(actor.get("id") or 0) == self.owner:
                            self.send(self.owner, "⚠️ " + escape(error))
                    except Exception as error:
                        print("update failure: " + type(error).__name__, flush=True)
                    finally:
                        offset = update_id + 1
                        OFFSET_PATH.parent.mkdir(parents=True, exist_ok=True)
                        tmp = OFFSET_PATH.with_suffix(".next")
                        tmp.write_text(str(offset))
                        tmp.replace(OFFSET_PATH)
            except (OSError, RuntimeError, ValueError) as error:
                # Never print urllib error objects: they may include the secret bot API URL.
                print("bot retry: " + type(error).__name__, flush=True)
                time.sleep(2)


def main():
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    owner = int(os.environ["UCHIHA_RADIUS_OWNER_TELEGRAM_ID"])
    V183Bot(token, owner).serve()


if __name__ == "__main__":
    main()
