"""Context-sensitive Telegram screens for the actual V1-83 provider API.

Each command replaces the preceding action keyboard. The MikroTik flow does
not reuse the dashboard buttons or invent an active router/agent connection.
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
from v183_bot import V183Bot, ApiError, PUBLIC_WEBAPP, escape, fmt_price, REASON, PAGE_SIZE


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
            [self.btn("🎫 الدعم الفني", "ops:list:tickets:0"), self.btn("🚨 التنبيهات", "ops:list:alerts:0")],
            [self.btn("📈 التقارير", "ops:report"), self.btn("⚙️ إدارة إضافية", "ops:menu")],
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
        self.send(chat, "<b>تسجيل MikroTik</b>\nأرسل اسم الجهاز وIP الداخلي:"
            "\n<code>الاسم | 192.168.88.1</code>"
            "\nثم ستظهر شاشة مراجعة قبل الحفظ. لا ترسل بيانات تسجيل الدخول.",
            {"inline_keyboard": [
                [self.btn("❌ إلغاء", "cancel")],
                [self.btn("⬅️ إدارة MikroTik", "router:home")],
            ]})

    def accept_draft(self, chat, text):
        draft = self.drafts.get(chat)
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
        message = (callback or {}).get("message") or {}
        authorized = bool(callback and self._owner_private(
            message.get("chat") or {}, callback.get("from") or {}))
        self._edit_message_id = message.get("message_id") if authorized else None
        try:
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
