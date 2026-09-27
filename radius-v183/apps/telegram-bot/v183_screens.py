"""Context-sensitive Telegram screens for the actual V1-83 provider API.

Each command replaces the preceding action keyboard. The MikroTik flow does
not reuse the dashboard buttons or invent an active router/agent connection.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import time
import uuid
import urllib.parse
from v183_bot import V183Bot, V183Api, ApiError, PUBLIC_WEBAPP, escape, fmt_price, REASON, PAGE_SIZE
from v183_member_routers import MemberRouterActions, probe_router_tls
from v183_member_workflows import MemberWorkflows


class V183ScreenBot(MemberWorkflows, MemberRouterActions, V183Bot):
    def __init__(self, token, owner, *, api=None, telegram=None, member_api_factory=None):
        super().__init__(token, owner, api=api, telegram=telegram)
        self.member_api_factory = member_api_factory or (
            lambda uid: V183Api(token, uid, require_platform_owner=False))
        self.member_apis = {}
        self.member_router_drafts = {}
        self.member_router_confirms = {}
        self.member_router_deletes = {}
        self.owner_router_pending = {}
        self.member_workflow_drafts = {}
        self.member_workflow_confirms = {}
        self.identities = {}

    @staticmethod
    def row_home():
        return [
            V183Bot.btn("⬅️ الرئيسية", "home"),
            V183Bot.btn("🖥 واجهة الويب V1-83", web=True),
        ]

    def send(self, chat, text, keys=None):
        # Only the dashboard has a full keyboard. Context pages replace the
        # tapped message instead of stacking repeated menus in the chat.
        if keys is None:
            keys = {"inline_keyboard": [self.row_home()]}
        current = getattr(self, "_edit_message_id", None)
        if current:
            try:
                return self.telegram("editMessageText", {
                    "chat_id": chat, "message_id": current, "text": text,
                    "parse_mode": "HTML", "reply_markup": keys,
                    "link_preview_options": {"is_disabled": True},
                })
            except RuntimeError:
                # The old v101 inline keyboard may be too old to edit.
                self._edit_message_id = None
        return super().send(chat, text, keys)

    def menu(self):
        # Telegram renders the dashboard button as a full-width first row.
        # The complete platform-owner management functions remain in advanced.
        return {"inline_keyboard": [
            [self.btn("🚀 فتح لوحة التحكم", web=True, route="dashboard")],
            [self.btn("➕ إدارة وإضافة MikroTik", "router:list")],
            [self.btn("➕ إضافة مشترك", "new:subscriber")],
            [self.btn("👥 المشتركون", "list:subscribers:0")],
            [self.btn("💳 التحصيل والدفعات", "list:invoices:0")],
            [self.btn("⚙️ الإدارة المتقدمة", "owner:advanced")],
        ]}

    def member_menu(self, me):
        role, writable = me.get("role"), me.get("canWrite") is True
        rows = [[self.btn("🚀 فتح لوحة التحكم", web=True, route="dashboard")]]
        if writable and role in ("owner", "admin"):
            rows.append([self.btn("➕ إدارة وإضافة MikroTik", "mr:list:0")])
        if writable and role in ("owner", "admin", "operator"):
            rows.append([self.btn("➕ إضافة مشترك", "ms:new")])
        rows.extend([
            [self.btn("👥 المشتركون", "ms:list:0")],
            [self.btn("💳 التحصيل والدفعات", "mb:list:0")],
            [self.btn("⚙️ الإدارة المتقدمة", "member:advanced")],
        ])
        return {"inline_keyboard": rows}

    def owner_advanced(self, chat):
        self.send(chat, "<b>⚙️ الإدارة المتقدمة — صاحب المنصة</b>\n"
                  "جميع الوظائف السابقة متاحة هنا دون ازدحام الرئيسية.".replace("\n", "\n"),
                  {"inline_keyboard": [
                      [self.btn("📡 أجهزة MikroTik", "router:home"),
                       self.btn("🩺 حالة الشبكة", "router:status")],
                      [self.btn("📦 الباقات", "list:plans:0"),
                       self.btn("➕ إضافة باقة", "new:plan")],
                      [self.btn("🌐 الجلسات", web=True, route="sessions"),
                       self.btn("📍 الفروع", web=True, route="sites")],
                      [self.btn("🎫 تذاكر الدعم", "ops:list:tickets:0"),
                       self.btn("🚨 التنبيهات", "ops:list:alerts:0")],
                      [self.btn("📈 التقارير", "ops:report"),
                       self.btn("🧾 سجل التدقيق", "list:audit:0")],
                      [self.btn("🩺 الخادم", "health"),
                       self.btn("🛠 إدارة المنصة", "ops:menu")],
                      [self.btn("👤 ملف Telegram", "owner:profile"),
                       self.btn("🎟️ البطاقات", web=True, route="vouchers")],
                      [self.btn("🎫 الدعم", web=True, route="support"),
                       self.btn("🤝 الوكلاء", web=True, route="resellers")],
                      [self.btn("⬅️ الرئيسية", "home")],
                  ]})

    def member_advanced(self, chat, uid):
        api, me = self.member_router_api(uid)
        role = me.get("role")
        rows = [
            [self.btn("📦 الباقات", web=True, route="plans")],
            [self.btn("📈 التقارير", web=True, route="reports"),
             self.btn("🎫 الدعم", web=True, route="support")],
            [self.btn("🎟️ البطاقات", web=True, route="vouchers"),
             self.btn("🤝 الوكلاء", web=True, route="resellers")],
        ]
        if role != "collector":
            rows[0].append(self.btn("🌐 الجلسات", web=True, route="sessions"))
            rows.extend([
                [self.btn("📡 MikroTik المسجلة", "mr:list:0"),
                 self.btn("🩺 فحص الشبكة", "mr:status")],
                [self.btn("📍 الفروع", web=True, route="sites"),
                 self.btn("🩺 RADIUS", web=True, route="mikrotik-status")],
                [self.btn("🖥 MikroTik في الويب", web=True, route="mikrotik")],
            ])
        if me.get("canWrite") is True and role in ("owner", "admin"):
            rows.extend([
                [self.btn("➕ إضافة باقة", web=True, route="add-plan"),
                 self.btn("➕ إضافة فرع", web=True, route="add-site")],
                [self.btn("🛰️ ربط Site Agent", web=True, route="site-agent")],
            ])
        if me.get("canWrite") is True and role in ("owner", "admin", "operator"):
            rows.append([self.btn("🎫 إنشاء تذكرة", web=True, route="add-ticket")])
        rows.extend([[self.btn("👤 ملف Telegram", "member:profile")],
                     [self.btn("⬅️ الرئيسية", "member:menu")]])
        self.send(chat, "<b>⚙️ أدوات شبكتك الإضافية</b>\n"
                  "🏢 " + escape(me.get("tenantName")) +
                  "\nتظهر الأدوات المتاحة لصلاحيتك فقط.".replace("\n", "\n"),
                  {"inline_keyboard": rows})

    def _remember_identity(self, uid, actor):
        if len(self.identities) >= 128 and uid not in self.identities:
            self.identities.pop(next(iter(self.identities)))
        self.identities[uid] = {key: actor.get(key) for key in
                                ("first_name", "last_name", "username", "id")}

    def identity_line(self, uid):
        user = self.identities.get(uid) or {}
        name = " ".join(str(user.get(p) or "").strip() for p in ("first_name", "last_name")).strip()
        username = user.get("username")
        return ("👤 " + escape(name or "حساب Telegram") +
                ("  ·  @" + escape(username) if username else "") +
                "\n🆔 <code>" + str(uid) + "</code>")

    def telegram_profile(self, chat, uid, *, platform=False):
        me = self.api.request("/auth/me") if platform else self.member_router_api(uid)[1]
        title = "صاحب المنصة" if platform else escape(me.get("tenantName"))
        caption = "<b>👤 الملف الشخصي — UCHIHA RADIUS</b>\n"
        caption += self.identity_line(uid) + "\n🏢 " + title + "\n"
        caption += "🔐 الدور: " + escape(me.get("role"))
        photo = None
        try:
            result = self.telegram("getUserProfilePhotos", {"user_id": uid, "limit": 1})
            photos = ((result or {}).get("result") or {}).get("photos") or []
            if photos and photos[0]:
                photo = photos[0][-1].get("file_id")
        except RuntimeError:
            pass  # Telegram privacy/API restrictions: use bundled avatar.
        keys = {"inline_keyboard": [[self.btn("⬅️ الرئيسية",
                                            "home" if platform else "member:menu")]]}
        picture = {"chat_id": chat, "photo": photo or "attach://avatar",
                   "caption": caption, "parse_mode": "HTML", "reply_markup": keys}
        try:
            self.telegram("sendPhoto", picture)
        except RuntimeError:
            if not photo:
                raise
            # A stale Telegram photo ID falls back to our local branded avatar.
            self.telegram("sendPhoto", {**picture, "photo": "attach://avatar"})

    def member_home(self, chat, telegram_id):
        api = self.member_apis.get(telegram_id)
        if api is None:
            api = self.member_api_factory(telegram_id)
            # Prevent unbounded growth from unknown/unlinked Telegram IDs.
            if len(self.member_apis) >= 128:
                self.member_apis.pop(next(iter(self.member_apis)))
            self.member_apis[telegram_id] = api
        try:
            me = api.request("/auth/me")
            if not me.get("tenantId") or me.get("role") not in (
                    "owner", "admin", "operator", "collector", "viewer"):
                raise ApiError("حساب تيليغرام غير مرتبط بعضوية شبكة فعالة")
        except ApiError:
            self.member_apis.pop(telegram_id, None)
            self.send(chat, "حساب تيليغرام غير مرتبط بعد بعضوية شبكة V1-83.\n"
                      "افتح موقع الراديوس من المتصفح الذي تستخدمه عادةً، وسجّل الدخول بحساب شبكتك، "
                      "ثم ادخل قسم تيليغرام واضغط «إصدار رمز ربط حسابي».\n"
                      "أرسل الرمز في هذه المحادثة بصيغة /link ثم مسافة ثم الرمز. "
                      "لا ترسل كلمات مرور MikroTik.",
                      {"inline_keyboard": [[{"text": "🌐 فتح موقع راديوس للربط",
                                            "url": PUBLIC_WEBAPP + "?open=telegram"}]]})
            return
        self.send(chat, "<b>UCHIHA RADIUS V1-83</b>\n"
                  + "🏢 الشبكة: " + escape(me.get("tenantName")) + "\n"
                  + self.identity_line(telegram_id) + "\n"
                  + "🔐 الصلاحية: " + escape(me.get("role")) + "\n\n"
                  + "اختر العملية المطلوبة. الأدوات الأخرى في الإدارة المتقدمة.",
                  self.member_menu(me))

    def home(self, chat):
        data = self.api.request("/dashboard")
        m = data.get("metrics") or {}
        subscription = data.get("subscription") or {}
        self.send(chat,
            "<b>UCHIHA RADIUS V1-83</b>\n"
            + self.identity_line(self.owner) + "\n"
            "<i>الأرقام المباشرة من قاعدة مزودك، لا بيانات تجريبية.</i>\n\n"
            f"👥 المشتركـون: <b>{int(m.get('subscribers') or 0)}</b>\n"
            f"🟢 النشطون: <b>{int(m.get('activeSubscribers') or 0)}</b>\n"
            f"🌐 الجلسات: <b>{int(m.get('activeSessions') or 0)}</b>\n"
            f"📡 أجهزة MikroTik المسجلة: <b>{int(m.get('devices') or 0)}</b>\n"
            f"📡 أجهزة بحالة online: <b>{int(m.get('onlineDevices') or 0)}</b>\n"
            f"💳 الفواتير المفتوحة: <b>{int(m.get('openInvoices') or 0)}</b>\n"
            f"📦 الاشتراك: {escape(subscription.get('status') or 'غير متاح')}",
            self.menu())

    def router_keys(self):
        return {"inline_keyboard": [
            [self.btn("➕ إضافة MikroTik بالأزرار", "router:new")],
            [self.btn("📡 الراوترات المسجلة", "router:list")],
            [self.btn("🖥 الأجهزة بالويب", web=True, route="mikrotik")],
            [self.btn("🩺 فحص الاتصالات الحقيقية", "router:status")],
            [self.btn("🔗 خطوات ربط Site Agent", "router:setup")],
            self.row_home(),
        ]}

    def router_home(self, chat):
        devices = self.api.request("/devices").get("items") or []
        nodes = self.api.request("/radius/nodes").get("items") or []
        online = sum(1 for d in devices if d.get("status") == "online")
        healthy = sum(1 for n in nodes if n.get("status") == "healthy")
        self.send(chat,
            "<b>إدارة MikroTik — V1-83</b>\n\n"
            f"📡 الراوترات المسجلة: <b>{len(devices)}</b>\n"
            f"🟡 أجهزة بحالة online مسجلة (تحقق عبر الفحص): <b>{online}</b>\n"
            f"🛰️ وكلاء RADIUS: <b>{len(nodes)}</b> (السليم: {healthy})\n\n"
            "اختر الوظيفة المطلوبة؛ كل زر يفتح شاشة مستقلة.",
            self.router_keys())

    def router_list(self, chat, offset=0):
        devices = self.api.request("/devices").get("items") or []
        total = len(devices)
        offset = max(0, min(int(offset), max(0, total - 1)))
        offset -= offset % 7
        shown = devices[offset:offset + 7]
        keys = [
            [self.btn("📡 " + str(d.get("name") or "MikroTik")[:28],
                "router:detail:" + str(d["id"]))]
            for d in shown if d.get("id") and len(("router:detail:" + str(d["id"])).encode("utf-8")) <= 64
        ]
        if offset:
            keys.append([self.btn("◀ الأجهزة السابقة", "router:list:" + str(max(0, offset - 7)))])
        if offset + 7 < total:
            keys.append([self.btn("الأجهزة التالية ▶", "router:list:" + str(offset + 7))])
        keys.extend([
            [self.btn("➕ تسجيل MikroTik جديد", "router:new")],
            [self.btn("🩺 فحص الاتصال", "router:status")],
            [self.btn("⬅️ إدارة MikroTik", "router:home")],
            [self.btn("🖥 فتح إدارة الأجهزة بالويب", web=True, route="mikrotik")],
        ])
        entries = "\n".join(
            "• " + escape(d.get("name")) + " — " +
            escape(d.get("status") or "pending")
            for d in shown
        )
        self.send(chat, "<b>📡 إدارة أجهزة MikroTik</b>\n"
            + "اختر جهازًا لتعديل بياناته أو حذف سجله، أو أضف جهازًا جديدًا.\n\n"
            + (entries or "لم تُضَف أجهزة حتى الآن.")
            + ("\n\nالأجهزة المسجلة: " + str(total) if devices else "")
            + "\nالحذف لا يقطع الجهاز الفعلي ولا يمس سجلات المحاسبة.",
            {"inline_keyboard": keys})

    def router_detail(self, chat, router_id):
        if not router_id.startswith("dev_") or len(router_id) > 60:
            raise ValueError("معرّف الراوتر غير صالح")
        devices = self.api.request("/devices").get("items") or []
        router = next((d for d in devices if str(d.get("id")) == router_id), None)
        if router is None:
            self.send(chat, "هذا الراوتر غير موجود في مساحة V1-83.",
                {"inline_keyboard": [[self.btn("⬅️ الراوترات", "router:list")]]})
            return
        online = router.get("status") == "online"
        self.send(chat,
            f"<b>راوتر: {escape(router.get('name'))}</b>\n\n"
            f"📍 العنوان: <code>{escape(router.get('host'))}</code>\n"
            f"🔌 المنفذ: {escape(router.get('api_port'))}\n"
            f"⚙️ الربط: {escape(router.get('connection_method'))}\n"
            f"📊 الحالة الفعلية: {'🟢 متصل' if online else '⚪ لم يُثبَت الاتصال'}\n"
            f"🕒 آخر استجابة: {escape(router.get('last_seen_at'))}\n\n"
            "بيانات MikroTik الحساسة تبقى داخل شبكة المزود؛ لا ترسلها في المحادثة.",
            {"inline_keyboard": [
                [self.router_web_btn("🔐 أكمل ربط هذا الجهاز بالويب", router_id)],
                [self.btn("✍️ تعديل الاسم والعنوان والمنفذ", "router:edit:" + router_id)]
                if len(("router:edit:" + router_id).encode("utf-8")) <= 64 else
                [self.router_web_btn("✍️ تعديل هذا الجهاز بالويب", router_id)],
                [self.btn("🗑 حذف سجل هذا الجهاز", "router:d:" + router_id)]
                if len(("router:d:" + router_id).encode("utf-8")) <= 64 else
                [self.router_web_btn("🖥 إدارة هذا الجهاز بالويب", router_id)],
                [self.btn("🩺 فحص منفذ TLS بدون كلمة مرور", "router:preflight:" + router_id)]
                if len(("router:preflight:" + router_id).encode("utf-8")) <= 64 else
                [self.router_web_btn("🩺 فحص الاتصال بالويب", router_id)],
                [self.btn("🩺 فحص الاتصال", "router:status")],
                [self.router_agent_btn("🛰️ ربط هذا الجهاز عبر Site Agent", router_id)],
                [self.btn("⬅️ قائمة الراوترات", "router:list")],
                [self.btn("⬅️ الرئيسية", "home")],
                [self.btn("🖥 فتح الأجهزة بالويب", web=True, route="mikrotik")],
            ]})

    def owner_router_edit_start(self, chat, router_id):
        if not re.fullmatch(r"dev_[A-Za-z0-9_-]{8,55}", router_id):
            raise ValueError("معرّف الجهاز غير صالح")
        row = next((r for r in (self.api.request("/devices").get("items") or [])
                    if str(r.get("id")) == router_id), None)
        if not row or not row.get("updated_at"):
            raise ValueError("الجهاز غير متاح، افتح قائمة الأجهزة")
        self.owner_router_pending.pop(chat, None)
        self.drafts[chat] = {
            "action": "device_edit", "target": router_id,
            "expectedHost": row["host"], "expectedUpdatedAt": row["updated_at"],
            "time": time.monotonic()
        }
        self.send(chat, "<b>✍️ تعديل MikroTik</b>\n"
                  "📡 " + escape(row.get("name")) + "\n"
                  "📍 <code>" + escape(row.get("host")) + "</code>\n\n"
                  "أرسل: <code>الاسم الجديد | عنوان IP | 8729</code>\n"
                  "المنفذ 8729 هو API-SSL المشفّر. لا ترسل كلمة المرور.",
                  {"inline_keyboard": [
                      [self.btn("❌ إلغاء التعديل", "router:cancel")],
                      [self.btn("📡 العودة للأجهزة", "router:list")],
                  ]})

    def owner_router_delete_ask(self, chat, router_id):
        if not re.fullmatch(r"dev_[A-Za-z0-9_-]{8,55}", router_id):
            raise ValueError("معرّف الجهاز غير صالح")
        row = next((r for r in (self.api.request("/devices").get("items") or [])
                    if str(r.get("id")) == router_id), None)
        if not row or not row.get("updated_at"):
            raise ValueError("الجهاز غير متاح، افتح قائمة الأجهزة")
        nonce = secrets.token_urlsafe(9)
        self.owner_router_pending[chat] = {
            "action": "delete", "deviceId": router_id,
            "expectedHost": row["host"], "expectedUpdatedAt": row["updated_at"],
            "name": row.get("name") or "MikroTik",
            "nonce": nonce, "key": str(uuid.uuid4()), "time": time.monotonic()
        }
        self.send(chat, "<b>🗑 تأكيد حذف سجل MikroTik</b>\n"
                  "📡 " + escape(row.get("name")) + "\n"
                  "📍 <code>" + escape(row.get("host")) + "</code>\n\n"
                  "يحذف هذا الإجراء السجل من شبكتك فقط، لا جهاز MikroTik نفسه. "
                  "إذا كانت جلسات المشتركين نشطة أو أوامر فصل معلقة فلن يتم الحذف.",
                  {"inline_keyboard": [
                      [self.btn("🗑 نعم، احذف السجل", "router:yes:" + nonce)],
                      [self.btn("❌ تراجع", "router:cancel")],
                  ]})

    def owner_router_confirm(self, chat, nonce):
        pending = self.owner_router_pending.get(chat)
        if not pending or pending["nonce"] != nonce or time.monotonic() - pending["time"] > 600:
            self.owner_router_pending.pop(chat, None)
            self.send(chat, "⚠️ انتهت صلاحية تأكيد MikroTik أو أُلغيت العملية؛ أعد فتح القائمة.",
                      {"inline_keyboard": [[self.btn("📡 الأجهزة", "router:list")]]})
            return
        if not pending.get("write_attempted"):
            row = next((r for r in (self.api.request("/devices").get("items") or [])
                        if r.get("id") == pending["deviceId"]), None)
            if (not row or row.get("host") != pending["expectedHost"] or
                    row.get("updated_at") != pending["expectedUpdatedAt"]):
                self.owner_router_pending.pop(chat, None)
                self.send(chat, "⚠️ تغير الجهاز بعد عرض التأكيد؛ افتح القائمة من جديد.",
                          {"inline_keyboard": [[self.btn("📡 الأجهزة", "router:list")]]})
                return
        pending["write_attempted"] = True
        router_id = pending["deviceId"]
        uri = "/devices/" + urllib.parse.quote(router_id, safe="")
        payload = ({"expectedHost": pending["expectedHost"],
                    "expectedUpdatedAt": pending["expectedUpdatedAt"],
                    "reason": "حذف مؤكد من بوت صاحب منصة UCHIHA RADIUS"}
                   if pending["action"] == "delete" else pending["payload"])
        try:
            result = self.api.request(uri, payload,
                                      "DELETE" if pending["action"] == "delete" else "PATCH",
                                      key=pending["key"])
        except ApiError as error:
            if any(marker in str(error) for marker in ("API 403:", "API 404:", "API 409:")):
                self.owner_router_pending.pop(chat, None)
                self.send(chat, "⚠️ لم ينفذ التعديل أو الحذف: " + escape(str(error)),
                          {"inline_keyboard": [[self.btn("📡 مراجعة الأجهزة", "router:list")]]})
                return
            self.send(chat, "⚠️ لم تصل نتيجة مؤكدة؛ ربما حُفظ الإجراء. "
                      "أعد المحاولة بنفس المفتاح، ولا تنشئ عملية أخرى.\n"
                      + escape(str(error)),
                      {"inline_keyboard": [
                          [self.btn("🔁 إعادة المحاولة نفسها", "router:yes:" + nonce)],
                          [self.btn("📡 مراجعة الأجهزة", "router:list")],
                      ]})
            return
        if result.get("id") != router_id or (
                pending["action"] == "delete" and not result.get("deleted")):
            self.send(chat, "⚠️ استجابة غير مؤكدة؛ أعد مراجعة قائمة الأجهزة.",
                      {"inline_keyboard": [[self.btn("📡 مراجعة الأجهزة", "router:list")]]})
            return
        self.owner_router_pending.pop(chat, None)
        self.send(chat, ("✅ حُذف سجل " if pending["action"] == "delete" else "✅ تم تعديل سجل ")
                  + "<b>" + escape(pending["name"]) + "</b>.\n"
                  + ("لم نحذف الجهاز الفعلي ولا سجلات المحاسبة."
                     if pending["action"] == "delete" else
                     "يمكنك متابعة ربط الجهاز نفسه من صفحة التفاصيل."),
                  {"inline_keyboard": [
                      [self.btn("📡 عرض الأجهزة", "router:list")],
                      [self.btn("➕ تسجيل جهاز جديد", "router:new")],
                  ]})

    def router_preflight(self, chat, router_id):
        if not re.fullmatch(r"dev_[A-Za-z0-9_-]{8,55}", router_id):
            raise ValueError("معرّف الجهاز غير صالح")
        devices = self.api.request("/devices").get("items") or []
        device = next((r for r in devices if str(r.get("id") or "") == router_id), None)
        if not device:
            raise ValueError("الراوتر غير مسجل ضمن حسابك")
        try:
            probe_router_tls(self.api, device)
            result = "✅ فحص TLS والشهادة نجح. ما زالت بيانات دخول RouterOS بحاجة للتحقق من واجهة الويب."
        except ApiError as error:
            result = ("⚠️ فشل فحص الاتصال المشفّر: " + escape(str(error)) +
                      "\nلا تكشف API-SSL للإنترنت. عند عدم وجود مسار مباشر استخدم Site Agent أو VPN.")
        self.send(chat, "<b>فحص منفذ MikroTik</b>\n" +
                  "📍 <code>" + escape(device.get("host")) + "</code>\n" + result,
                  {"inline_keyboard": [
                      [self.router_web_btn("🔐 أكمل ربط هذا الجهاز بالويب", router_id)],
                      [self.router_agent_btn("🛰️ Site Agent لهذا الجهاز", router_id)],
                      [self.btn("⬅️ الجهاز", "router:detail:" + router_id)]
                  ]})

    def router_status(self, chat):
        overview = self.api.request("/radius/overview")
        nodes = self.api.request("/radius/nodes").get("items") or []
        states = "\n".join(
            f"• {escape(n.get('name'))}: {escape(n.get('status'))}, آخر نبضة {escape(n.get('lastSeenAt'))}"
            for n in nodes[:10]
        )
        self.send(chat,
            "<b>فحص MikroTik / RADIUS الفعلي</b>\n\n"
            f"🔗 التكامل: {escape(overview.get('status'))}\n"
            f"🔐 مفتاح Agent: {'صادر' if overview.get('credentialConfigured') else 'غير صادر'}\n"
            f"🛰️ اتصال موقّع: {'✅ يعمل' if overview.get('agentConnected') else '⚪ غير متصل'}\n"
            f"📶 الوكلاء المتصلون: {int(overview.get('agentsOnline') or 0)} / {int(overview.get('agentsTotal') or 0)}\n"
            f"📡 الأجهزة: {int(overview.get('devices') or 0)}\n"
            f"🟢 الأجهزة المتصلة: {int(overview.get('onlineDevices') or 0)}\n"
            f"🌐 الجلسات: {int(overview.get('activeSessions') or 0)}\n"
            f"🧪 طلبات المصادقة خلال 24 ساعة: {int((overview.get('last24Hours') or {}).get('authenticationRequests') or 0)}\n"
            f"🛰️ الوكلاء: {len(nodes)}\n"
            + (states if states else "\nلا يوجد Site Agent متصل بعد.")
            + "\n\nلا نعتبر تسجيل الراوتر وحده إثباتًا لنجاح الاتصال.",
            {"inline_keyboard": [
                [self.btn("🔄 تحديث الفحص", "router:status")],
                [self.btn("🔗 خطوات ربط Site Agent", "router:setup")],
                [self.btn("⬅️ إدارة MikroTik", "router:home")],
            ]})

    def router_setup(self, chat):
        self.send(chat,
            "<b>ربط MikroTik على نسخة V1-83</b>\n\n"
            "1. سجّل الجهاز عبر زر إضافة MikroTik في البوت، أو اختر سجله الحالي إذا كان مسجلًا.\n"
            "2. افتح زر «أكمل ربط هذا الجهاز» لإدخال بيانات الإدارة في الويب بأمان.\n"
            "3. إن كان عنوان الراوتر داخل شبكة خاصة، اختر Site Agent من الويب بدل كشف المنفذ للإنترنت.\n"
            "4. أصدر مفتاح Site Agent عبر الويب واحفظه محليًا في شبكة المزود.\n"
            "5. ثبّت Site Agent بجانب الراوتر واضبط API-SSL محليًا، ثم افتح «فحص الاتصال».\n\n"
            "✅ الربط الفعلي يتطلب فحص TLS وهوية RouterOS، مباشرةً أو عبر نبضات الوكيل الموقّعة.\n"
            "⚠️ لا ترسل المفتاح أو كلمات مرور MikroTik داخل محادثة تيليغرام.",
            {"inline_keyboard": [
                [self.btn("🖥 ربط Site Agent بالواجهة", web=True, route="site-agent")],
                [self.btn("➕ تسجيل MikroTik", "router:new")],
                [self.btn("🩺 فحص الاتصال", "router:status")],
                [self.btn("⬅️ إدارة MikroTik", "router:home")],
            ]})

    def ops_menu(self, chat):
        self.send(chat, "<b>إدارة V1-83 الإضافية</b>\nكل قسم يعرض سجلات المزود الفعلية فقط.",
            {"inline_keyboard": [
                [self.btn("🤝 الوكلاء", "ops:list:resellers:0"),
                 self.btn("🎟️ دفعات البطاقات", "ops:list:vouchers:0")],
                [self.btn("👨‍💼 الفريق", "ops:list:team:0"),
                 self.btn("📍 المواقع", "ops:list:sites:0")],
                [self.btn("🔌 التكاملات", "ops:list:integrations:0"),
                 self.btn("📈 التقارير", "ops:report")],
                [self.btn("🎫 الدعم الفني", "ops:list:tickets:0"),
                 self.btn("🚨 التنبيهات", "ops:list:alerts:0")],
                self.row_home(),
            ]})

    def ops_report(self, chat):
        report = self.api.request("/reports/summary")
        subscribers = report.get("subscribers") or {}
        sessions = report.get("sessions") or {}
        traffic = report.get("traffic") or {}
        billing = report.get("billing") or {}
        support = report.get("support") or {}
        auth = report.get("authentication") or {}
        total_traffic_gb = (int(traffic.get("inputBytes") or 0)
                            + int(traffic.get("outputBytes") or 0)) / 1_000_000_000
        self.send(chat, "<b>التقارير الفعلية — V1-83</b>\n"
            "العمليات وحركة الشبكة خلال آخر 30 يومًا، والمشتركون حاليًا.\n\n"
            f"👥 المشتركون: {int(subscribers.get('total') or 0)}"
            f" (النشطون: {int(subscribers.get('active') or 0)})\n"
            f"🌐 الجلسات: {int(sessions.get('total') or 0)}\n"
            f"📶 حركة البيانات: {total_traffic_gb:.3f} GB (عشري)\n"
            f"💳 عدد الفواتير: {int(billing.get('invoices') or 0)}\n"
            f"🎫 التذاكر المفتوحة: {int(support.get('open') or 0)}\n"
            f"🔐 قبول/رفض المصادقة: {int(auth.get('accepted') or 0)}/"
            f"{int(auth.get('rejected') or 0)}\n\n"
            "عرض المبالغ المالية التفصيلية متاح في واجهة الويب بعملة المزود.",
            {"inline_keyboard": [[self.btn("🔄 تحديث", "ops:report")],
                                 [self.btn("⚙️ الأقسام الإضافية", "ops:menu")],
                                 self.row_home()]})

    def ops_format(self, category, item):
        if category == "tickets":
            return (f"🎫 {escape(item.get('number'))}: "
                    f"{escape(str(item.get('title') or '')[:85])}\n"
                    f"   {escape(item.get('priority'))} · {escape(item.get('status'))}")
        if category == "alerts":
            return (f"🚨 {escape(str(item.get('title') or '')[:100])}\n"
                    f"   {escape(item.get('severity'))} · {escape(item.get('status'))}")
        if category == "vouchers":
            return (f"🎟️ {escape(item.get('code'))} · {escape(item.get('planName'))}\n"
                    f"   المتاحة: {int(item.get('available') or 0)} / {int(item.get('quantity') or 0)}")
        if category == "resellers":
            return (f"🤝 {escape(item.get('name'))} · {escape(item.get('status'))}"
                    f" · دفعات البطاقات: {int(item.get('voucherBatches') or 0)}")
        if category == "team":
            return (f"👤 {escape(item.get('displayName'))} · "
                    f"{escape(item.get('role'))} · {escape(item.get('status'))}")
        if category == "sites":
            return (f"📍 {escape(item.get('name'))} · {escape(item.get('status'))}"
                    f" · الأجهزة: {int(item.get('devices') or 0)}")
        if category == "integrations":
            return (f"🔌 {escape(item.get('type'))} · {escape(item.get('status'))}"
                    f"\n   آخر اتصال: {escape(item.get('lastSeenAt'))}")
        raise ValueError("Unknown operations category")

    def ops_list(self, chat, category, offset):
        paths = {"tickets": "/support/tickets", "alerts": "/alerts",
                 "vouchers": "/voucher-batches", "resellers": "/resellers",
                 "team": "/team", "sites": "/sites", "integrations": "/integrations"}
        labels = {"tickets": "تذاكر الدعم", "alerts": "التنبيهات",
                  "vouchers": "دفعات البطاقات", "resellers": "الوكلاء",
                  "team": "أعضاء الفريق", "sites": "مواقع الشبكة",
                  "integrations": "حالة التكاملات"}
        if category not in paths or offset < 0 or offset > 100000:
            raise ValueError("Unknown operations listing")
        remote_page = category in ("tickets", "alerts", "vouchers")
        query = f"?limit={PAGE_SIZE}&offset={offset}" if remote_page else ""
        data = self.api.request(paths[category] + query)
        all_items = data.get("items") or []
        rows = all_items if remote_page else all_items[offset:offset+PAGE_SIZE]
        reported_total = (data.get("pagination") or {}).get("total")
        total = int(reported_total) if reported_total is not None else (
            None if category == "alerts" else len(all_items))
        lines = [f"<b>{labels[category]} — V1-83</b>",
                 f"الصفحة: {offset // PAGE_SIZE + 1}" +
                 (f" · الإجمالي: {total}" if total is not None else ""), ""]
        lines.extend(self.ops_format(category, item) for item in rows)
        if not rows:
            lines.append("لا توجد سجلات حالياً.")
        keys = []
        for item in rows:
            identifier = str(item.get("id") or "")
            if category == "tickets" and identifier:
                callback = "ops:ticket:" + identifier
                if len(callback.encode("utf-8")) <= 64:
                    keys.append([self.btn("🎫 " + str(item.get("number") or "")[:26], callback)])
            if category == "alerts" and item.get("status") == "open" and identifier:
                callback = "ops:ack:" + identifier
                if len(callback.encode("utf-8")) <= 64:
                    keys.append([self.btn("✓ إقرار: " + str(item.get("title") or "")[:23], callback)])
        buttons = []
        if offset:
            buttons.append(self.btn("⬅️ السابق", f"ops:list:{category}:{max(0,offset-PAGE_SIZE)}"))
        has_more = offset + len(rows) < total if total is not None else len(rows) == PAGE_SIZE
        if has_more:
            buttons.append(self.btn("التالي ➡️", f"ops:list:{category}:{offset+PAGE_SIZE}"))
        if buttons:
            keys.append(buttons)
        keys.extend([[self.btn("🔄 تحديث", f"ops:list:{category}:{offset}")],
                     [self.btn("⚙️ الأقسام الإضافية", "ops:menu")],
                     self.row_home()])
        self.send(chat, "\n".join(lines), {"inline_keyboard": keys})

    def ops_ticket(self, chat, ticket_id):
        if not re.fullmatch(r"tkt_[A-Za-z0-9_-]{8,55}", ticket_id):
            raise ValueError("Invalid support ticket")
        ticket = self.api.request("/support/tickets/" + urllib.parse.quote(ticket_id, safe=""))
        status = ticket.get("status") or "open"
        lines = [
            "<b>تذكرة الدعم " + escape(ticket.get("number")) + "</b>",
            "العنوان: " + escape(ticket.get("title")),
            "الأولوية: " + escape(ticket.get("priority")),
            "الحالة: " + escape(status),
            "المشترك: " + escape(ticket.get("subscriberName")),
            "الجهاز: " + escape(ticket.get("deviceName")),
            "\n" + escape(str(ticket.get("description") or "")[:700]),
        ]
        events = ticket.get("events") or []
        if events:
            lines.append("\n<b>آخر التحديثات:</b>")
            for event in events[-3:]:
                lines.append("• " + escape(event.get("eventType")) + ": " +
                             escape(str(event.get("body") or "")[:250]))
        keys = []
        if status != "closed":
            keys.append([self.btn("💬 إرسال رد", "ops:reply:" + ticket_id)])
        if status in ("open", "in_progress"):
            keys.append([self.btn("✅ تم الحل", "ops:resolve:" + ticket_id)])
        if status == "resolved":
            keys.append([self.btn("🔒 إغلاق التذكرة", "ops:close:" + ticket_id)])
        if status in ("resolved", "closed"):
            keys.append([self.btn("↩️ إعادة فتح", "ops:reopen:" + ticket_id)])
        keys.extend([[self.btn("⬅️ تذاكر الدعم", "ops:list:tickets:0")],
                     self.row_home()])
        self.send(chat, "\n".join(lines), {"inline_keyboard": keys})

    def start_draft(self, chat, action, target=""):
        if action == "ticket_reply":
            if not re.fullmatch(r"tkt_[A-Za-z0-9_-]{8,45}", target):
                raise ValueError("Invalid support ticket")
            self.drafts[chat] = {"action": action, "target": target, "time": time.monotonic()}
            self.send(chat, "<b>الرد على تذكرة الدعم</b>\nأرسل نص الرد (حتى 4000 حرف)."
                "\nسيُعرض عليك النص للمراجعة قبل حفظه. لا ترسل أسرار الشبكة.",
                {"inline_keyboard": [[self.btn("❌ إلغاء", "cancel")],
                                     [self.btn("⬅️ التذكرة", "ops:ticket:" + target)]]})
            return
        if action != "device":
            return super().start_draft(chat, action, target)
        self.drafts[chat] = {"action": action, "target": target, "time": time.monotonic()}
        self.send(chat, "<b>تسجيل MikroTik بالأزرار</b>\n"
            "إذا كان الجهاز مسجلًا بالفعل، افتح السجل الموجود وأكمل ربطه بدل إنشاء نسخة ثانية.\n"
            "أرسل الاسم وIP الحقيقي:\n<code>الاسم | 192.168.88.1</code>"
            "\nثم ستظهر شاشة مراجعة قبل الحفظ. لا ترسل بيانات تسجيل الدخول.",
            {"inline_keyboard": [
                [self.btn("❌ إلغاء", "cancel")],
                [self.btn("⬅️ إدارة MikroTik", "router:home")],
            ]})

    def accept_draft(self, chat, text):
        draft = self.drafts.get(chat)
        if draft and draft.get("action") == "device_edit":
            if time.monotonic() - draft["time"] > 300:
                self.drafts.pop(chat, None)
                self.send(chat, "انتهت مهلة التعديل؛ افتح الجهاز مجددًا.")
                return True
            parts = [part.strip() for part in text.split("|")]
            if (len(parts) != 3 or not 2 <= len(parts[0]) <= 100 or
                    not re.fullmatch(r"[A-Za-z0-9.:-]{3,253}", parts[1]) or
                    parts[2] != "8729"):
                self.send(chat, "الصيغة المطلوبة: <code>الاسم | IP | 8729</code>",
                          {"inline_keyboard": [
                              [self.btn("❌ إلغاء", "router:cancel")],
                          ]})
                return True
            rows = self.api.request("/devices").get("items") or []
            device = next((r for r in rows if r.get("id") == draft["target"]), None)
            if (not device or device.get("host") != draft["expectedHost"] or
                    device.get("updated_at") != draft["expectedUpdatedAt"]):
                self.drafts.pop(chat, None)
                self.send(chat, "⚠️ تغيرت بيانات الجهاز؛ افتحه من القائمة قبل التعديل.",
                          {"inline_keyboard": [[self.btn("📡 الأجهزة", "router:list")]]})
                return True
            nonce = secrets.token_urlsafe(9)
            self.owner_router_pending[chat] = {
                "action": "edit", "deviceId": draft["target"],
                "expectedHost": draft["expectedHost"],
                "expectedUpdatedAt": draft["expectedUpdatedAt"],
                "name": parts[0], "nonce": nonce,
                "payload": {"name": parts[0], "host": parts[1], "apiPort": 8729,
                            "expectedHost": draft["expectedHost"],
                            "expectedUpdatedAt": draft["expectedUpdatedAt"],
                            "reason": "تعديل مؤكّد من بوت صاحب منصة UCHIHA RADIUS"},
                "key": str(uuid.uuid4()), "time": time.monotonic()
            }
            self.drafts.pop(chat, None)
            self.send(chat, "<b>راجع التعديل قبل التنفيذ</b>\n"
                      "📡 " + escape(parts[0]) + "\n"
                      "📍 <code>" + escape(parts[1]) + "</code>\n"
                      "🔒 API-SSL: 8729\n"
                      "تغيير بيانات الإدارة يعيد حالة الاتصال إلى انتظار التحقق.",
                      {"inline_keyboard": [
                          [self.btn("✅ تنفيذ التعديل", "router:yes:" + nonce)],
                          [self.btn("❌ تراجع", "router:cancel")],
                      ]})
            return True
        if draft and draft.get("action") == "device":
            parts = [part.strip() for part in text.split("|")]
            if len(parts) == 2 and re.fullmatch(r"[A-Za-z0-9.:-]{3,253}", parts[1]):
                # Legacy retries may have changed the port from 8728 to 8729:
                # never add the same physical router as a third device.
                current = self.api.request("/devices").get("items") or []
                duplicate = next((r for r in current
                    if str(r.get("host") or "").lower() == parts[1].lower()
                    and r.get("site_id") is None), None)
                if duplicate:
                    self.drafts.pop(chat, None)
                    old_id = str(duplicate.get("id") or "")
                    buttons = [[self.router_web_btn(
                        "🔐 ربط السجل الموجود في الويب", old_id)]] \
                        if re.fullmatch(r"dev_[A-Za-z0-9_-]{8,55}", old_id) else []
                    buttons.append([self.btn("📡 الراوترات المسجلة", "router:list")])
                    self.send(chat, "⚠️ عنوان هذا الراوتر مسجل سابقًا باسم <b>"
                        + escape(duplicate.get("name")) +
                        "</b>. استخدم نفس السجل لإكمال الربط بدل إنشاء جهاز مكرر.",
                        {"inline_keyboard": buttons})
                    return True
        if not draft or draft.get("action") != "ticket_reply":
            return super().accept_draft(chat, text)
        if time.monotonic() - draft["time"] > 300:
            self.drafts.pop(chat, None)
            self.send(chat, "انتهت مهلة الرد. افتح التذكرة مجددًا.")
            return True
        body = text.strip()
        if not (1 <= len(body) <= 4000):
            self.send(chat, "أرسل نصًا من حرف إلى 4000 حرف أو اضغط إلغاء.",
                      {"inline_keyboard": [[self.btn("❌ إلغاء", "cancel")]]})
            return True
        self.drafts.pop(chat, None)
        self.ask_confirmation(chat, "ticket_reply", draft["target"],
                              display="إرسال رد إلى التذكرة:\n" + body[:550],
                              payload={"body": body})
        return True

    def confirm(self, chat, nonce):
        pending = self.confirms.get(nonce)
        allowed = {"ticket_reply", "ticket_resolve", "ticket_close",
                   "ticket_reopen", "alert_ack"}
        if pending and pending.get("action") == "device":
            if time.monotonic() - pending["time"] > 600:
                self.confirms.pop(nonce, None)
                self.send(chat, "انتهت صلاحية تأكيد الجهاز. افتح نموذج الإضافة من جديد.")
                return
            # Check for an existing router before the first write only.
            # If the first POST committed but its reply was lost, asking the
            # backend to replay the SAME key must take precedence over a
            # duplicate-host check against the record we just created.
            if not pending.get("write_attempted"):
                host = pending["payload"]["host"]
                records = self.api.request("/devices").get("items") or []
                duplicate = next((d for d in records if
                    str(d.get("host") or "").lower() == host.lower()
                    and not d.get("site_id")), None)
                if duplicate:
                    self.confirms.pop(nonce, None)
                    identifier = str(duplicate.get("id") or "")
                    keys = []
                    if re.fullmatch(r"dev_[A-Za-z0-9_-]{8,55}", identifier):
                        keys.append([self.router_web_btn(
                            "🔐 أكمل ربط الجهاز الموجود", identifier)])
                        keys.append([self.router_agent_btn(
                            "🛰️ Site Agent لنفس الجهاز", identifier)])
                    keys.append([self.btn("📡 الأجهزة المحفوظة", "router:list")])
                    self.send(chat, "⚠️ هذا العنوان مسجل أصلًا باسم <b>" +
                              escape(duplicate.get("name")) +
                              "</b>. لم ننشئ جهازًا مكررًا. أكمل ربط السجل الموجود بالويب.",
                              {"inline_keyboard": keys})
                    return
            pending["write_attempted"] = True
            try:
                result = self.api.request(
                    "/devices", pending["payload"], "POST",
                    key=pending["idempotency"])
            except ApiError as error:
                # We cannot know whether the backend committed before the
                # response was lost. Never start a new registration silently.
                self.send(chat,
                    "⚠️ لم تصل نتيجة نهائية لتسجيل MikroTik؛ ربما حُفظ الجهاز بالفعل.\n"
                    "راجع الأجهزة المحفوظة قبل إنشاء سجل جديد.\n"
                    "يمكن إعادة إرسال نفس العملية والمفتاح لمنع التكرار.\n\n"
                    "التفاصيل: " + escape(str(error)),
                    {"inline_keyboard": [
                        [self.btn("🔁 إعادة المحاولة بنفس العملية", "confirm:" + nonce)],
                        [self.btn("📡 مراجعة الأجهزة", "router:list")],
                        self.row_home(),
                    ]})
                return
            self.confirms.pop(nonce, None)
            identifier = str(result.get("id") or "")
            keys = []
            if re.fullmatch(r"dev_[A-Za-z0-9_-]{8,55}", identifier):
                keys.append([self.router_web_btn("🔐 أكمل ربط هذا الجهاز بالويب", identifier)])
            if re.fullmatch(r"dev_[A-Za-z0-9_-]{8,55}", identifier):
                keys.append([self.router_agent_btn(
                    "🛰️ Site Agent لنفس الجهاز", identifier)])
            else:
                keys.append([self.btn("🛰️ Site Agent", web=True,
                                      route="site-agent")])
            keys.append([self.btn("📡 الأجهزة", "router:list")])
            self.send(chat, "✅ تم تسجيل MikroTik ضمن قاعدة بيانات الراديوس.\\n".replace("\\n","\n") +
                      "الاسم: " + escape(result.get("name")) +
                      "\nالحالة: بانتظار اختبار الاتصال الفعلي.\n" +
                      "أكمل الحساب المشفر في واجهة الويب؛ لا ترسل كلمة المرور للبوت.",
                      {"inline_keyboard": keys})
            return
        # The platform owner's normal subscriber/billing actions also need a
        # visible same-key replay when the API commits but the reply is lost.
        # The ordinary base confirmation owns the route/payload and pops the
        # nonce only after receiving a successful response.
        if pending and pending.get("action") in (
                "payment", "subscriber", "plan",
                "suspend", "activate", "renew"):
            try:
                return super().confirm(chat, nonce)
            except ApiError:
                # A failed POST's outcome is unknown: never silently submit a
                # fresh financial operation or discard its idempotency key.
                action = pending["action"]
                back = ("list:invoices:0" if action == "payment" else
                        "list:plans:0" if action == "plan" else
                        "list:subscribers:0")
                self.send(chat,
                    "⚠️ تعذر تأكيد نتيجة العملية؛ ربما حُفظت بالفعل.\n"
                    "راجع السجل الفعلي أولًا. يمكنك إعادة إرسال العملية "
                    "بنفس مفتاحها قبل انتهاء صلاحية التأكيد.\n"
                    "لا تبدأ عملية جديدة لنفس الدفعة أو المشترك.",
                    {"inline_keyboard": [
                        [self.btn("🔁 إعادة المحاولة بنفس العملية",
                                  "confirm:" + nonce)],
                        [self.btn("📋 مراجعة السجل", back)],
                        self.row_home(),
                    ]})
                return
        if not pending or pending.get("action") not in allowed:
            return super().confirm(chat, nonce)
        if time.monotonic() - pending["time"] > 600:
            self.confirms.pop(nonce, None)
            self.send(chat, "انتهت صلاحية التأكيد. افتح العملية من جديد.")
            return
        action = pending["action"]
        identifier = pending["target"]
        prefix = "alt_" if action == "alert_ack" else "tkt_"
        if not re.fullmatch(prefix + r"[A-Za-z0-9_-]{8,45}", identifier):
            self.confirms.pop(nonce, None)
            raise ValueError("Invalid operation target")
        if action == "alert_ack":
            url = "/alerts/" + urllib.parse.quote(identifier, safe="") + "/acknowledge"
            method, payload = "POST", None
        elif action == "ticket_reply":
            url = "/support/tickets/" + urllib.parse.quote(identifier, safe="") + "/messages"
            method, payload = "POST", pending["payload"]
        else:
            url = "/support/tickets/" + urllib.parse.quote(identifier, safe="")
            method = "PATCH"
            target_status = {"ticket_resolve": "resolved", "ticket_close": "closed",
                             "ticket_reopen": "open"}[action]
            payload = {"status": target_status, "reason": REASON}
        self.api.request(url, payload, method, key=pending["idempotency"])
        self.confirms.pop(nonce, None)
        back = ("ops:list:alerts:0" if action == "alert_ack"
                else "ops:ticket:" + identifier)
        self.send(chat, "✅ تم حفظ العملية فعليًا في V1-83.",
                  {"inline_keyboard": [[self.btn("⬅️ الرجوع", back)],
                                       self.row_home()]})

    def handle(self, update):
        callback = update.get("callback_query")
        message = (callback or {}).get("message") if callback else update.get("message")
        message = message or {}
        actor = (callback or {}).get("from") if callback else message.get("from")
        actor = actor or {}
        chat = message.get("chat") or {}
        try:
            user_id = int(actor.get("id") or 0)
            chat_id = int(chat.get("id") or 0)
        except (TypeError, ValueError):
            return
        if chat.get("type") == "private" and chat_id == user_id and user_id > 0:
            self._remember_identity(user_id, actor)
        if user_id != self.owner:
            # Ordinary users must be explicitly linked in telegram_accounts and
            # hold an active provider membership. Never inherit the owner API.
            if chat.get("type") != "private" or chat_id != user_id or user_id < 1:
                return
            if callback:
                action = str(callback.get("data") or "")
                if (action in ("member:menu", "member:advanced", "member:profile") or
                        action.startswith(("mr:", "ms:", "mb:", "mw:"))):
                    self.answer(callback)
                    self._edit_message_id = message.get("message_id")
                    try:
                        if action == "member:menu":
                            for state in (self.member_router_drafts, self.member_router_confirms,
                                          self.member_router_deletes, self.member_workflow_drafts,
                                          self.member_workflow_confirms):
                                state.pop(user_id, None)
                            self.member_home(chat_id, user_id)
                        elif action == "member:advanced":
                            self.member_advanced(chat_id, user_id)
                        elif action == "member:profile":
                            self.telegram_profile(chat_id, user_id)
                        elif action.startswith("mr:"):
                            self.member_router_callback(chat_id, user_id, action)
                        else:
                            self.member_workflow_callback(chat_id, user_id, action)
                    except ApiError as error:
                        self.send(chat_id, "⚠️ " + escape(str(error)) + "\nاستخدم /start للحصول على قائمة محدثة.",
                                  {"inline_keyboard": [[self.btn("⬅️ القائمة", "member:menu")]]})
                    finally:
                        self._edit_message_id = None
                    return
                self.answer(callback, "استخدم /start للحصول على أزرار حسابك")
                return
            command = str(message.get("text") or "").strip()
            if command.startswith("/link"):
                parts = command.split()
                if len(parts) != 2 or not re.fullmatch(r"UCHL-[A-Za-z0-9_-]{43}", parts[1]):
                    self.send(chat_id, "افتح حسابك الموثّق في موقع الراديوس من المتصفح، ثم قسم تيليغرام > إصدار رمز ربط حسابي. أرسل /link والرمز خلال 15 دقيقة.",
                              {"inline_keyboard": [[{"text": "🌐 موقع الراديوس",
                                                    "url": PUBLIC_WEBAPP + "?open=telegram"}]]})
                    return
                try:
                    api = self.member_api_factory(user_id)
                    api.claim_link(parts[1])
                    self.member_apis.pop(user_id, None)
                    self.member_home(chat_id, user_id)
                except ApiError:
                    self.send(chat_id, "لم ينجح الربط. تأكد من صحة الرمز وعدم انتهاء مدته، وأن حسابك غير مرتبط برقم تيليغرام آخر.",
                              {"inline_keyboard": [[{"text": "🌐 إصدار رمز جديد من حسابك",
                                                    "url": PUBLIC_WEBAPP + "?open=telegram"}]]})
                return
            if command == "/cancel":
                self.member_router_drafts.pop(user_id, None)
                self.member_router_confirms.pop(user_id, None)
                self.member_workflow_drafts.pop(user_id, None)
                self.member_workflow_confirms.pop(user_id, None)
                self.member_home(chat_id, user_id)
            elif command.startswith("/start") or command in ("/menu", "/app"):
                self.member_router_drafts.pop(user_id, None)
                self.member_router_confirms.pop(user_id, None)
                self.member_workflow_drafts.pop(user_id, None)
                self.member_workflow_confirms.pop(user_id, None)
                self.member_home(chat_id, user_id)
            elif command in ("/addmikrotik", "/addsubscriber", "/subscribers",
                             "/payments", "/advanced", "/profile"):
                try:
                    if command == "/addmikrotik":
                        self.member_router_list(chat_id, user_id)
                    elif command == "/addsubscriber":
                        self.member_subscriber_start(chat_id, user_id)
                    elif command == "/subscribers":
                        self.member_subscriber_list(chat_id, user_id)
                    elif command == "/payments":
                        self.member_invoice_list(chat_id, user_id)
                    elif command == "/advanced":
                        self.member_advanced(chat_id, user_id)
                    else:
                        self.telegram_profile(chat_id, user_id)
                except ApiError as error:
                    self.send(chat_id, "⚠️ " + escape(str(error)),
                              {"inline_keyboard": [[self.btn("⬅️ القائمة", "member:menu")]]})
            elif command in ("/mikrotik", "/devices"):
                try:
                    self.member_router_list(chat_id, user_id)
                except ApiError as error:
                    self.send(chat_id, "⚠️ " + escape(str(error)),
                              {"inline_keyboard": [[self.btn("⬅️ القائمة", "member:menu")]]})
            elif command == "/status":
                try:
                    self.member_router_status(chat_id, user_id)
                except ApiError as error:
                    self.send(chat_id, "⚠️ " + escape(str(error)),
                              {"inline_keyboard": [[self.btn("⬅️ القائمة", "member:menu")]]})
            elif command and self.member_workflow_drafts.get(user_id):
                try:
                    self.member_workflow_draft_message(chat_id, user_id, command)
                except ApiError as error:
                    self.member_workflow_drafts.pop(user_id, None)
                    self.send(chat_id, "⚠️ " + escape(str(error)) + "\nافتح نموذجًا جديدًا.")
            elif command and self.member_router_drafts.get(user_id):
                try:
                    self.member_router_draft_message(chat_id, user_id, command)
                except ApiError as error:
                    self.member_router_drafts.pop(user_id, None)
                    self.send(chat_id, "⚠️ " + escape(str(error)) + "\nافتح نموذجًا جديدًا.")
            elif command:
                self.send(chat_id, "استخدم /start لعرض أزرار شبكتك.",
                          {"inline_keyboard": [[self.btn("🖥 القائمة", "member:menu")]]})
            return
        authorized = bool(callback and self._owner_private(
            chat, actor))
        self._edit_message_id = message.get("message_id") if authorized else None
        try:
            owner_command = str(message.get("text") or "").strip() if not callback else ""
            if callback and str(callback.get("data") or "") in ("owner:advanced", "owner:profile"):
                if not authorized:
                    self.answer(callback, "هذا الحساب غير مخوّل")
                    return
                self.answer(callback)
                if callback["data"] == "owner:advanced":
                    self.owner_advanced(chat_id)
                else:
                    self.telegram_profile(chat_id, self.owner, platform=True)
                return
            if not callback and owner_command in ("/advanced", "/profile", "/payments",
                                                   "/addsubscriber", "/addmikrotik"):
                if not self._owner_private(chat, actor):
                    return
                if owner_command == "/advanced": self.owner_advanced(chat_id)
                elif owner_command == "/profile": self.telegram_profile(chat_id, self.owner, platform=True)
                elif owner_command == "/payments": self.listing(chat_id, "invoices", 0)
                elif owner_command == "/addsubscriber": self.start_draft(chat_id, "subscriber")
                else: self.start_draft(chat_id, "device")
                return
            if not callback and owner_command in ("/mikrotik", "/devices"):
                if self._owner_private(chat, actor):
                    self.router_home(chat_id)
                return
            if callback:
                data = str(callback.get("data") or "")
                if data.startswith("ops:"):
                    if not authorized:
                        self.answer(callback, "هذا الحساب غير مخوّل")
                        return
                    self.answer(callback)
                    chat = self.owner
                    if data == "ops:menu":
                        self.ops_menu(chat)
                    elif data == "ops:report":
                        self.ops_report(chat)
                    elif data.startswith("ops:list:"):
                        match = re.fullmatch(r"ops:list:([a-z-]+):([0-9]{1,6})", data)
                        if not match:
                            raise ValueError("Invalid operations page")
                        self.ops_list(chat, match.group(1), int(match.group(2)))
                    elif data.startswith("ops:ticket:"):
                        self.ops_ticket(chat, data[len("ops:ticket:"):])
                    elif data.startswith("ops:ack:"):
                        identifier = data[len("ops:ack:"):]
                        if not re.fullmatch(r"alt_[A-Za-z0-9_-]{8,45}", identifier):
                            raise ValueError("Invalid alert")
                        self.ask_confirmation(chat, "alert_ack", identifier,
                                              display="إقرار التنبيه المحدد")
                    else:
                        match = re.fullmatch(
                            r"ops:(reply|resolve|close|reopen):(tkt_[A-Za-z0-9_-]{8,45})",
                            data)
                        if not match:
                            raise ValueError("Unknown operations action")
                        verb, identifier = match.groups()
                        if verb == "reply":
                            self.start_draft(chat, "ticket_reply", identifier)
                        else:
                            descriptions = {"resolve": "تعليم التذكرة كمحلولة",
                                            "close": "إغلاق التذكرة",
                                            "reopen": "إعادة فتح التذكرة"}
                            self.ask_confirmation(chat, "ticket_" + verb, identifier,
                                                  display=descriptions[verb])
                    return
                if data.startswith("router:") or data in ("list:devices:0", "new:device", "add_router"):
                    if not authorized:
                        self.answer(callback, "هذا الحساب غير مخوّل")
                        return
                    self.answer(callback)
                    chat = self.owner
                    if data == "router:home": self.router_home(chat)
                    elif data in ("router:list", "list:devices:0"): self.router_list(chat)
                    elif re.fullmatch(r"router:list:[0-9]{1,6}", data): self.router_list(chat, int(data.rsplit(":", 1)[1]))
                    elif data in ("router:new", "new:device", "add_router"): self.start_draft(chat, "device")
                    elif data.startswith("router:edit:"): self.owner_router_edit_start(chat, data[len("router:edit:"):])
                    elif data.startswith("router:d:"): self.owner_router_delete_ask(chat, data[len("router:d:"):])
                    elif data.startswith("router:yes:"): self.owner_router_confirm(chat, data[len("router:yes:"):])
                    elif data == "router:cancel":
                        self.owner_router_pending.pop(chat, None)
                        self.drafts.pop(chat, None)
                        self.router_list(chat)
                    elif data == "router:status": self.router_status(chat)
                    elif data == "router:setup": self.router_setup(chat)
                    elif data.startswith("router:detail:"): self.router_detail(chat, data[14:])
                    elif data.startswith("router:preflight:"): self.router_preflight(chat, data[len("router:preflight:"):])
                    else: self.router_home(chat)
                    return
            return super().handle(update)
        finally:
            self._edit_message_id = None


def main():
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    owner = int(os.environ["UCHIHA_RADIUS_OWNER_TELEGRAM_ID"])
    V183ScreenBot(token, owner).serve()


if __name__ == "__main__":
    main()
