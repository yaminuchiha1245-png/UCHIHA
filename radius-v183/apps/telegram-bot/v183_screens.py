"""Context-sensitive Telegram screens for the actual V1-83 provider API.

Each command replaces the preceding action keyboard. The MikroTik flow does
not reuse the dashboard buttons or invent an active router/agent connection.
"""
from __future__ import annotations

import json
import os
from v183_bot import V183Bot, ApiError, PUBLIC_WEBAPP, escape, fmt_price, REASON


class V183ScreenBot(V183Bot):
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
        return {"inline_keyboard": [
            [self.btn("📊 الرئيسية", "home"), self.btn("👥 المشتركون", "list:subscribers:0")],
            [self.btn("📦 الباقات", "list:plans:0"), self.btn("📡 MikroTik", "router:home")],
            [self.btn("🌐 الجلسات", "list:sessions:0"), self.btn("💳 الفواتير", "list:invoices:0")],
            [self.btn("🧾 سجل التدقيق", "list:audit:0"), self.btn("🩺 حالة الخادم", "health")],
            [self.btn("🖥 فتح واجهة V1-83", web=True)],
        ]}

    def home(self, chat):
        data = self.api.request("/dashboard")
        m = data.get("metrics") or {}
        subscription = data.get("subscription") or {}
        self.send(chat,
            "<b>UCHIHA RADIUS V1-83</b>\n"
            "<i>الأرقام المباشرة من قاعدة مزودك، لا بيانات تجريبية.</i>\n\n"
            f"👥 المشتركـون: <b>{int(m.get('subscribers') or 0)}</b>\n"
            f"🟢 النشطون: <b>{int(m.get('activeSubscribers') or 0)}</b>\n"
            f"🌐 الجلسات: <b>{int(m.get('activeSessions') or 0)}</b>\n"
            f"📡 أجهزة MikroTik المسجلة: <b>{int(m.get('devices') or 0)}</b>\n"
            f"✅ الأجهزة المتصلة فعليًا: <b>{int(m.get('onlineDevices') or 0)}</b>\n"
            f"💳 الفواتير المفتوحة: <b>{int(m.get('openInvoices') or 0)}</b>\n"
            f"📦 الاشتراك: {escape(subscription.get('status') or 'غير متاح')}",
            self.menu())

    def router_keys(self):
        return {"inline_keyboard": [
            [self.btn("📡 الراوترات المسجلة", "router:list")],
            [self.btn("➕ تسجيل MikroTik جديد", "router:new")],
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
            f"🟢 الراوترات المتصلة: <b>{online}</b>\n"
            f"🛰️ وكلاء RADIUS: <b>{len(nodes)}</b> (السليم: {healthy})\n\n"
            "اختر الوظيفة المطلوبة؛ كل زر يفتح شاشة مستقلة.",
            self.router_keys())

    def router_list(self, chat):
        devices = self.api.request("/devices").get("items") or []
        keys = [
            [self.btn("📡 " + str(d.get("name") or "MikroTik")[:28],
                "router:detail:" + str(d["id"]))]
            for d in devices[:35] if d.get("id") and len("router:detail:" + str(d["id"]).encode("utf-8").decode()) <= 64
        ]
        keys.extend([
            [self.btn("➕ تسجيل MikroTik جديد", "router:new")],
            [self.btn("🩺 فحص الاتصال", "router:status")],
            [self.btn("⬅️ إدارة MikroTik", "router:home"), self.btn("🖥 الويب", web=True)],
        ])
        entries = "\n".join(
            f"• {escape(d.get('name'))} — {escape(d.get('status') or 'pending')}"
            for d in devices[:25]
        )
        self.send(chat, "<b>الراوترات المسجلة</b>\n\n"
            + (entries or "لم تُضَف أجهزة حتى الآن.")
            + (f"\n\nإجمالي الأجهزة: {len(devices)}" if devices else "")
            + "\nالحالة pending تعني مسجّل بانتظار اتصال حقيقي.",
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
                [self.btn("🩺 فحص الاتصال", "router:status")],
                [self.btn("🔗 تعليمات ربط الراوتر", "router:setup")],
                [self.btn("⬅️ قائمة الراوترات", "router:list")],
                self.row_home(),
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
            "1. من شاشة «تسجيل MikroTik»، أدخل اسم الجهاز وعنوانه الداخلي.\n"
            "2. ثبّت Site Agent الخاص بنسخة V1-83 على جهاز داخل شبكة المزود.\n"
            "3. اربط الوكيل بتفويض خاص بهذا المزود ومفتاح مستقل، واضبط بيانات RouterOS محليًا فقط.\n"
            "4. بعد تشغيل الوكيل، افتح «فحص الاتصال». لا تصبح حالة الجهاز متصلة إلا عند ورود نبضات حقيقية.\n\n"
            "⚠️ إصدار تفويض Agent ومثبت إعداد تلقائي لم يُفعَّل بعد في هذه اللوحة؛"
            " لا ترسل كلمات مرور MikroTik داخل تيليغرام.",
            {"inline_keyboard": [
                [self.btn("➕ تسجيل MikroTik", "router:new")],
                [self.btn("🩺 فحص الاتصال", "router:status")],
                [self.btn("⬅️ إدارة MikroTik", "router:home")],
            ]})

    def start_draft(self, chat, action, target=""):
        if action != "device":
            return super().start_draft(chat, action, target)
        import time
        self.drafts[chat] = {"action": action, "target": target, "time": time.monotonic()}
        self.send(chat, "<b>تسجيل MikroTik</b>\nأرسل اسم الجهاز وIP الداخلي:"
            "\n<code>الاسم | 192.168.88.1</code>"
            "\nثم ستظهر شاشة مراجعة قبل الحفظ. لا ترسل بيانات تسجيل الدخول.",
            {"inline_keyboard": [
                [self.btn("❌ إلغاء", "cancel")],
                [self.btn("⬅️ إدارة MikroTik", "router:home")],
            ]})

    def handle(self, update):
        callback = update.get("callback_query")
        message = (callback or {}).get("message") or {}
        authorized = bool(callback and self._owner_private(
            message.get("chat") or {}, callback.get("from") or {}))
        self._edit_message_id = message.get("message_id") if authorized else None
        try:
            if callback:
                data = str(callback.get("data") or "")
                if data.startswith("router:") or data in ("list:devices:0", "new:device", "add_router"):
                    if not authorized:
                        self.answer(callback, "هذا الحساب غير مخوّل")
                        return
                    self.answer(callback)
                    chat = self.owner
                    if data == "router:home": self.router_home(chat)
                    elif data in ("router:list", "list:devices:0"): self.router_list(chat)
                    elif data in ("router:new", "new:device", "add_router"): self.start_draft(chat, "device")
                    elif data == "router:status": self.router_status(chat)
                    elif data == "router:setup": self.router_setup(chat)
                    elif data.startswith("router:detail:"): self.router_detail(chat, data[14:])
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
