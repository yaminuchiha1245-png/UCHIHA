"""Provider-scoped subscriber and collection flows for the official V1-83 bot.

Every read, preview and confirmed write uses the Telegram actor's own API
session. The platform owner API is never used by an ordinary provider member.
"""
from __future__ import annotations

import re
import secrets
import time
import urllib.parse
import uuid

from v183_bot import ApiError, escape, fmt_price, price_minor

SUB_ID = re.compile(r"cus_[A-Za-z0-9_-]{8,55}\Z")
INV_ID = re.compile(r"inv_[A-Za-z0-9_-]{8,55}\Z")
USERNAME = re.compile(r"[A-Za-z0-9._@-]{3,64}\Z")
PAGE = 7
TTL = 600
PAYMENT_REASON = "دفعة نقدية مؤكدة من مستخدم Telegram مخول في شبكة المزوّد"


class MemberWorkflows:
    def _workflow_keys(self, *rows):
        return {"inline_keyboard": [*rows, [self.btn("⬅️ القائمة الرئيسية", "member:menu")]]}

    def _workflow_access(self, uid, allowed=None, write=False):
        api, me = self.member_router_api(uid)
        if allowed is not None and me["role"] not in allowed:
            raise ApiError("لا تملك صلاحية هذه الوظيفة")
        if write and me.get("canWrite") is not True:
            raise ApiError("حسابك لا يملك صلاحية التعديل")
        return api, me

    @staticmethod
    def _workflow_page(api, kind, offset):
        offset = int(offset)
        if offset < 0 or offset > 999999 or offset % PAGE:
            raise ApiError("رقم الصفحة غير صالح")
        result = api.request(f"/{kind}?limit={PAGE}&offset={offset}")
        return result.get("items") or [], result.get("pagination") or {}

    def member_subscriber_list(self, chat, uid, offset=0):
        api, me = self._workflow_access(uid)
        items, page = self._workflow_page(api, "subscribers", offset)
        total = int(page.get("total") or 0)
        rows = []
        for item in items:
            sid = str(item.get("id") or "")
            if SUB_ID.fullmatch(sid) and len(("ms:detail:" + sid).encode()) <= 64:
                rows.append([self.btn("👤 " + str(item.get("fullName") or item.get("username") or "مشترك")[:30],
                                      "ms:detail:" + sid)])
        nav = []
        if offset:
            nav.append(self.btn("◀️ السابق", f"ms:list:{offset-PAGE}"))
        if len(items) == PAGE and (total == 0 or offset + PAGE < total):
            nav.append(self.btn("التالي ▶️", f"ms:list:{offset+PAGE}"))
        if nav:
            rows.append(nav)
        if me.get("canWrite") is True and me["role"] in ("owner", "admin", "operator"):
            rows.append([self.btn("➕ إضافة مشترك", "ms:new")])
        rows.append([self.btn("🖥 المشتركون في الويب", web=True, route="subscribers")])
        summary = "\n".join("• " + escape(i.get("fullName") or i.get("username")) +
                            " — " + escape(i.get("status")) for i in items)
        self.send(chat, "<b>مشتركو شبكتك</b>\n🏢 " + escape(me.get("tenantName")) +
                  "\n" + (f"المجموع: <b>{total}</b>\n\n" if total else "\n") +
                  (summary or "لا يوجد مشتركون في هذه الصفحة."),
                  self._workflow_keys(*rows))

    def member_subscriber_detail(self, chat, uid, sid):
        if not SUB_ID.fullmatch(sid):
            raise ApiError("معرف المشترك غير صالح")
        api, me = self._workflow_access(uid)
        item = api.request("/subscribers/" + urllib.parse.quote(sid, safe=""))
        rows = [[self.btn("⬅️ المشتركون", "ms:list:0")],
                [self.btn("🖥 تفاصيل المشترك في الويب", web=True, route="subscribers")]]
        self.send(chat, "<b>" + escape(item.get("fullName")) + "</b>\n" +
                  "👤 اسم المستخدم: <code>" + escape(item.get("username")) + "</code>\n" +
                  "📦 الباقة: " + escape((item.get("plan") or {}).get("name")) + "\n" +
                  "📍 الحالة: " + escape(item.get("status")) +
                  "\n\nالتفعيل وتعيين كلمة المرور متاحان وفق صلاحياتك في الويب.",
                  self._workflow_keys(*rows))

    def member_subscriber_start(self, chat, uid):
        api, me = self._workflow_access(uid, ("owner", "admin", "operator"), write=True)
        self.member_router_drafts.pop(uid, None)
        self.member_router_confirms.pop(uid, None)
        self.member_workflow_confirms.pop(uid, None)
        self.member_workflow_drafts[uid] = {"kind": "subscriber", "tenant": me["tenantId"],
                                           "time": time.monotonic()}
        self.send(chat, "<b>➕ إضافة مشترك إلى " + escape(me.get("tenantName")) + "</b>\n\n" +
                  "أرسل: <code>الاسم الكامل | اسم_المستخدم</code>\n" +
                  "مثال: <code>أحمد خالد | ahmad123</code>\n\n" +
                  "سيُسجّل في قاعدة البيانات المشتركة مع الويب، بدون كلمة مرور. " +
                  "عيّن كلمة المرور وفعّل الاشتراك لاحقًا عبر لوحة التحكم.",
                  self._workflow_keys([self.btn("❌ إلغاء", "mw:cancel")]))

    def member_invoice_list(self, chat, uid, offset=0):
        api, me = self._workflow_access(uid)
        items, page = self._workflow_page(api, "invoices", offset)
        total = int(page.get("total") or 0)
        rows = []
        for item in items:
            iid = str(item.get("id") or "")
            action = f"mb:invoice:{offset}:{iid}"
            if INV_ID.fullmatch(iid) and len(action.encode()) <= 64:
                rows.append([self.btn("💳 " + str(item.get("number") or iid)[:28], action)])
        nav = []
        if offset:
            nav.append(self.btn("◀️ السابق", f"mb:list:{offset-PAGE}"))
        if len(items) == PAGE and (total == 0 or offset + PAGE < total):
            nav.append(self.btn("التالي ▶️", f"mb:list:{offset+PAGE}"))
        if nav:
            rows.append(nav)
        rows.extend([[self.btn("🖥 التحصيل الكامل في الويب", web=True, route="invoices")],
                     [self.btn("🧾 سجل الدفعات", web=True, route="invoices")]])
        self.send(chat, "<b>التحصيل والدفعات</b>\n🏢 " + escape(me.get("tenantName")) +
                  (f"\nإجمالي الفواتير: {total}" if total else "") + "\n\n" +
                  ("\n".join("• " + escape(i.get("number")) + " — " +
                   fmt_price(i.get("amountMinor"), i.get("currency") or "USD") +
                   " (" + escape(i.get("status")) + ")" for i in items)
                   or "لا توجد فواتير في هذه الصفحة.") +
                  "\n\nاختر الفاتورة لمراجعة المتبقي قبل تسجيل أي دفعة.",
                  self._workflow_keys(*rows))

    def _invoice_from_page(self, api, offset, invoice_id):
        if not INV_ID.fullmatch(invoice_id):
            raise ApiError("معرف الفاتورة غير صالح")
        items, _ = self._workflow_page(api, "invoices", offset)
        invoice = next((i for i in items if i.get("id") == invoice_id), None)
        if not invoice:
            raise ApiError("الفاتورة غير موجودة في شبكتك أو تغير ترتيبها؛ افتح القائمة مجددًا")
        return invoice

    def member_invoice_detail(self, chat, uid, offset, iid):
        api, me = self._workflow_access(uid)
        invoice = self._invoice_from_page(api, offset, iid)
        currency = invoice.get("currency") or "USD"
        amount = int(invoice.get("amountMinor") or 0)
        paid = int(invoice.get("paidMinor") or 0)
        remaining = max(0, amount - paid)
        rows = []
        if (remaining and invoice.get("status") != "void" and
                me.get("canWrite") is True and me["role"] in ("owner", "admin", "collector")):
            rows.append([self.btn("💰 تسجيل دفعة نقدية", f"mb:pay:{offset}:{iid}")])
        rows.extend([[self.btn("⬅️ الفواتير", f"mb:list:{offset}")],
                     [self.btn("🖥 التحصيل في الويب", web=True, route="invoices")]])
        self.send(chat, "<b>فاتورة " + escape(invoice.get("number")) + "</b>\n" +
                  "👤 المشترك: " + escape(invoice.get("subscriberName")) + "\n" +
                  "💳 القيمة: " + fmt_price(amount, currency) + "\n" +
                  "✅ المدفوع: " + fmt_price(paid, currency) + "\n" +
                  "⏳ المتبقي: <b>" + fmt_price(remaining, currency) + "</b>\n" +
                  "📍 الحالة: " + escape(invoice.get("status")),
                  self._workflow_keys(*rows))

    def member_payment_start(self, chat, uid, offset, iid):
        api, me = self._workflow_access(uid, ("owner", "admin", "collector"), write=True)
        item = self._invoice_from_page(api, offset, iid)
        balance = int(item.get("amountMinor") or 0) - int(item.get("paidMinor") or 0)
        if balance <= 0 or item.get("status") == "void":
            raise ApiError("لا يوجد رصيد مستحق في هذه الفاتورة")
        self.member_workflow_confirms.pop(uid, None)
        self.member_workflow_drafts[uid] = {
            "kind": "payment", "tenant": me["tenantId"], "invoice": iid,
            "offset": offset, "currency": item.get("currency") or "USD",
            "time": time.monotonic()}
        self.send(chat, "<b>تسجيل تحصيل نقدي</b>\n" +
                  "الفاتورة: " + escape(item.get("number")) + "\n" +
                  "المتبقي: " + fmt_price(balance, item.get("currency") or "USD") + "\n\n" +
                  "أرسل المبلغ المستلم فعلًا، مثال: <code>25.50</code>.\n" +
                  "لن تُسجّل دفعة قبل تأكيدك.",
                  self._workflow_keys([self.btn("❌ إلغاء", "mw:cancel")]))

    def member_workflow_draft_message(self, chat, uid, text):
        draft = self.member_workflow_drafts.get(uid)
        if not draft:
            return False
        if time.monotonic() - draft["time"] > 300:
            self.member_workflow_drafts.pop(uid, None)
            self.send(chat, "انتهت مهلة النموذج؛ افتحه مجددًا.")
            return True
        if text.startswith("/"):
            self.send(chat, "أرسل البيانات المطلوبة، أو /cancel للإلغاء.")
            return True
        api, me = self._workflow_access(uid, write=True)
        role_set = ("owner", "admin", "operator") if draft["kind"] == "subscriber" else ("owner", "admin", "collector")
        if me["tenantId"] != draft["tenant"] or me["role"] not in role_set:
            self.member_workflow_drafts.pop(uid, None)
            raise ApiError("تغيرت صلاحياتك؛ افتح العملية من جديد")
        try:
            if draft["kind"] == "subscriber":
                parts = [part.strip() for part in text.split("|")]
                if len(parts) != 2 or not 2 <= len(parts[0]) <= 120 or not USERNAME.fullmatch(parts[1]):
                    raise ValueError("الصيغة: الاسم الكامل | اسم_المستخدم (3–64 حرفًا لاتينيًا)")
                payload = {"fullName": parts[0], "username": parts[1]}
                preview = "👤 " + escape(parts[0]) + "\nاسم المستخدم: <code>" + escape(parts[1]) + "</code>\n"
                preview += "سيُنشأ الحساب دون كلمة مرور وبانتظار تفعيله."
            else:
                amount = price_minor(text)
                if amount <= 0:
                    raise ValueError("المبلغ يجب أن يكون أكبر من صفر")
                invoice = self._invoice_from_page(api, draft["offset"], draft["invoice"])
                balance = int(invoice.get("amountMinor") or 0) - int(invoice.get("paidMinor") or 0)
                if invoice.get("status") == "void" or amount > balance:
                    raise ValueError("المبلغ أكبر من المتبقي أو الفاتورة ملغاة")
                payload = {"amountMinor": amount, "method": "cash", "reason": PAYMENT_REASON}
                preview = ("دفعة نقدية: <b>" + fmt_price(amount, draft["currency"]) +
                           "</b>\nالفاتورة: " + escape(invoice.get("number")) +
                           "\nلا تؤكد إلا إذا استُلم المبلغ فعلًا.")
        except (ValueError, ArithmeticError) as error:
            self.send(chat, "⚠️ " + escape(error) + "\nأعد إدخال البيانات أو /cancel.")
            return True
        nonce = secrets.token_urlsafe(9)
        self.member_workflow_confirms[uid] = {**draft, "nonce": nonce, "payload": payload,
                                             "key": str(uuid.uuid4()), "time": time.monotonic()}
        self.member_workflow_drafts.pop(uid, None)
        self.send(chat, "<b>مراجعة العملية</b>\n\n" + preview +
                  "\n\nلن تُنفّذ قبل الضغط على التأكيد.",
                  self._workflow_keys([self.btn("✅ تأكيد", "mw:confirm:" + nonce),
                                       self.btn("❌ إلغاء", "mw:cancel")]))
        return True

    def member_workflow_confirm(self, chat, uid, nonce):
        pending = self.member_workflow_confirms.get(uid)
        if not pending or pending["nonce"] != nonce or time.monotonic() - pending["time"] > TTL:
            self.member_workflow_confirms.pop(uid, None)
            raise ApiError("انتهت صلاحية التأكيد؛ افتح نموذجًا جديدًا")
        allowed = ("owner", "admin", "operator") if pending["kind"] == "subscriber" else ("owner", "admin", "collector")
        api, me = self._workflow_access(uid, allowed, write=True)
        if me["tenantId"] != pending["tenant"]:
            self.member_workflow_confirms.pop(uid, None)
            raise ApiError("تغيرت الشبكة المرتبطة بحسابك؛ أعد العملية")
        if pending["kind"] == "subscriber":
            # Same provider's current records only; backend enforces final uniqueness.
            result = api.request("/subscribers?" + urllib.parse.urlencode({
                "q": pending["payload"]["username"], "limit": 20}))
            existing = next((s for s in result.get("items", [])
                             if str(s.get("username") or "").casefold() ==
                             pending["payload"]["username"].casefold()), None)
            if existing:
                self.member_workflow_confirms.pop(uid, None)
                self.send(chat, "⚠️ اسم المستخدم مسجل مسبقًا ضمن شبكتك؛ لم يُنشأ مشترك مكرر.",
                          self._workflow_keys([self.btn("👥 المشتركون", "ms:list:0")]))
                return
            url = "/subscribers"
        else:
            invoice = self._invoice_from_page(api, pending["offset"], pending["invoice"])
            balance = int(invoice.get("amountMinor") or 0) - int(invoice.get("paidMinor") or 0)
            if invoice.get("status") == "void" or pending["payload"]["amountMinor"] > balance:
                self.member_workflow_confirms.pop(uid, None)
                raise ApiError("تغير رصيد الفاتورة؛ راجع المتبقي قبل تسجيل دفعة جديدة")
            url = "/invoices/" + urllib.parse.quote(pending["invoice"], safe="") + "/payments"
        api.request(url, pending["payload"], "POST", key=pending["key"])
        self.member_workflow_confirms.pop(uid, None)
        if pending["kind"] == "subscriber":
            self.send(chat, "✅ سُجّل المشترك في قاعدة بيانات شبكتك المشتركة مع الويب.\n"
                      "لا توجد كلمة مرور بعد؛ عيّنها وفعّل المشترك في لوحة التحكم.",
                      self._workflow_keys([self.btn("➕ مشترك آخر", "ms:new"),
                                           self.btn("👥 المشتركون", "ms:list:0")],
                                          [self.btn("🖥 استكمال الإعداد في الويب", web=True,
                                                    route="subscribers")]))
        else:
            self.send(chat, "✅ سُجّلت الدفعة النقدية بعد تأكيدك في شبكة مزوّدك.",
                      self._workflow_keys([self.btn("💳 التحصيل والدفعات", "mb:list:0")]))

    def member_workflow_callback(self, chat, uid, action):
        if action == "mw:cancel":
            self.member_workflow_drafts.pop(uid, None)
            self.member_workflow_confirms.pop(uid, None)
            return self.member_home(chat, uid)
        if action == "ms:new":
            return self.member_subscriber_start(chat, uid)
        if action == "ms:list:0":
            return self.member_subscriber_list(chat, uid)
        if re.fullmatch(r"ms:list:\d{1,6}", action):
            return self.member_subscriber_list(chat, uid, int(action.split(":")[-1]))
        if action.startswith("ms:detail:"):
            return self.member_subscriber_detail(chat, uid, action[len("ms:detail:"):])
        if re.fullmatch(r"mb:list:\d{1,6}", action):
            return self.member_invoice_list(chat, uid, int(action.split(":")[-1]))
        match = re.fullmatch(r"mb:(invoice|pay):(\d{1,6}):(inv_[A-Za-z0-9_-]{8,55})", action)
        if match:
            kind, offset, invoice = match.groups()
            return (self.member_invoice_detail(chat, uid, int(offset), invoice)
                    if kind == "invoice" else self.member_payment_start(chat, uid, int(offset), invoice))
        if action.startswith("mw:confirm:"):
            return self.member_workflow_confirm(chat, uid, action[len("mw:confirm:"):])
        raise ApiError("زر غير معروف؛ استخدم /start لإظهار القائمة")

