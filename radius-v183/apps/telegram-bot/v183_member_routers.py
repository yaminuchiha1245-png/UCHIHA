"""Tenant-scoped, role-checked MikroTik bot screens for linked provider members.

All reads and writes use this Telegram user's own freshly verified V1-83 API.
A device registration remains pending until a signed on-site TLS probe succeeds.
"""
from __future__ import annotations

import re
import secrets
import time
import uuid
import urllib.parse
from v183_bot import ApiError, V183Api, escape, PUBLIC_WEBAPP

ID_PATTERN = re.compile(r"dev_[A-Za-z0-9_-]{8,55}\Z")
HOST_PATTERN = re.compile(r"[A-Za-z0-9.:-]{3,253}\Z")
REASON = "تعديل مؤكد لجهاز MikroTik عبر أزرار بوت مزود الشبكة"


class MemberRouterActions:
    def member_router_api(self, user_id):
        api = self.member_apis.get(user_id)
        if api is None:
            api = self.member_api_factory(user_id)
            if len(self.member_apis) >= 128:
                self.member_apis.pop(next(iter(self.member_apis)))
            self.member_apis[user_id] = api
        # Never trust a cached role or a member's UI-supplied tenant ID.
        me = api.request("/auth/me")
        if not me.get("tenantId") or me.get("role") not in (
                "owner", "admin", "operator", "collector", "viewer"):
            raise ApiError("حسابك غير مرتبط بعضوية شبكة فعالة")
        return api, me

    @staticmethod
    def _member_can_edit(me):
        return me.get("canWrite") is True and me.get("role") in ("owner", "admin")

    def _mr_keys(self, *rows):
        return {"inline_keyboard": [*rows, [self.btn("⬅️ أزرار الشبكة", "member:menu")]]}

    def member_router_list(self, chat, uid, offset=0):
        api, me = self.member_router_api(uid)
        if me["role"] == "collector":
            raise ApiError("ليس لديك صلاحية عرض أجهزة MikroTik")
        devices = api.request("/devices").get("items") or []
        total = len(devices)
        offset = max(0, min(int(offset), max(0, total - 1)))
        offset -= offset % 7
        keys = []
        for device in devices[offset:offset + 7]:
            device_id = str(device.get("id") or "")
            if ID_PATTERN.fullmatch(device_id) and len(("mr:detail:" + device_id).encode()) <= 64:
                label = "📡 " + str(device.get("name") or "MikroTik")[:22]
                keys.append([self.btn(label, "mr:detail:" + device_id)])
        pager = []
        if offset:
            pager.append(self.btn("◀ السابق", "mr:list:" + str(max(0, offset - 7))))
        if offset + 7 < total:
            pager.append(self.btn("التالي ▶", "mr:list:" + str(offset + 7)))
        if pager:
            keys.append(pager)
        keys.append([self.btn("🩺 فحص الاتصال الفعلي", "mr:status")])
        if self._member_can_edit(me):
            keys.append([self.btn("➕ تسجيل MikroTik", "mr:new")])
        keys.append([self.btn("🖥 الواجهة الكاملة", web=True, route="mikrotik")])
        self.send(chat, "<b>أجهزة MikroTik الخاصة بشبكتك</b>\n"
                  + "🏢 " + escape(me.get("tenantName")) + "\n"
                  + "📡 المسجلة: <b>" + str(total) + "</b>\n"
                  + "🟢 المتصلة فعليًا: <b>" + str(sum(d.get("status") == "online" for d in devices)) + "</b>\n\n"
                  + ("\n".join("• " + escape(d.get("name")) + " — " + escape(d.get("status"))
                               for d in devices[offset:offset + 7])
                     or "لا توجد أجهزة مسجلة حاليًا.")
                  + "\n\nالتسجيل وحده لا يثبت اتصال MikroTik.",
                  self._mr_keys(*keys))

    def member_router_detail(self, chat, uid, device_id):
        if not ID_PATTERN.fullmatch(device_id):
            raise ApiError("معرّف الجهاز غير صالح")
        api, me = self.member_router_api(uid)
        if me["role"] == "collector":
            raise ApiError("ليس لديك صلاحية عرض الأجهزة")
        rows = api.request("/devices").get("items") or []
        device = next((row for row in rows if row.get("id") == device_id), None)
        if device is None:
            raise ApiError("هذا الجهاز غير مسجل في شبكتك")
        status = device.get("status")
        keys = [[self.btn("🔄 تحديث بيانات الجهاز", "mr:detail:" + device_id)]]
        if self._member_can_edit(me) and len(("mr:edit:" + device_id).encode()) <= 64:
            keys.append([self.btn("✍️ تعديل الاسم والعنوان والمنفذ", "mr:edit:" + device_id)])
        keys.extend([[self.btn("🩺 الحالة الفعلية", "mr:status")],
                     [self.btn("⬅️ جميع الأجهزة", "mr:list:0")]])
        self.send(chat, "<b>" + escape(device.get("name")) + "</b>\n"
                  + "📍 IP: <code>" + escape(device.get("host")) + "</code>\n"
                  + "🔌 المنفذ: <code>" + escape(device.get("api_port")) + "</code>\n"
                  + "🖥 النوع: " + escape(device.get("connection_method")) + "\n"
                  + "🔎 الحالة: <b>" + ("🟢 متصل فعليًا" if status == "online"
                                     else "⚪ غير متصل بعد" if status == "pending"
                                     else escape(status)) + "</b>\n"
                  + "🕒 آخر فحص: " + escape(device.get("last_seen_at"))
                  + "\n\nلا ترسل كلمة مرور الراوتر عبر تيليغرام.",
                  self._mr_keys(*keys))

    def member_router_status(self, chat, uid):
        api, me = self.member_router_api(uid)
        if me["role"] == "collector":
            raise ApiError("ليس لديك صلاحية فحص الأجهزة")
        overview = api.request("/radius/overview")
        devices = api.request("/devices").get("items") or []
        online = sum(d.get("status") == "online" for d in devices)
        self.send(chat, "<b>الفحص الحقيقي لشبكتك</b>\n\n"
                  + "🏢 " + escape(me.get("tenantName")) + "\n"
                  + "🔑 مفتاح Site Agent: " + ("صادر" if overview.get("credentialConfigured") else "غير صادر") + "\n"
                  + "🛰️ نبضات موقعة: " + ("🟢 متصلة" if overview.get("agentConnected") else "⚪ غير متصلة") + "\n"
                  + "📡 الأجهزة المسجلة: <b>" + str(len(devices)) + "</b>\n"
                  + "✅ فحص MikroTik ناجح: <b>" + str(online) + "</b>\n"
                  + "🕒 آخر نبضة: " + escape(overview.get("lastSeenAt"))
                  + "\n\nتظهر الأجهزة متصلة فقط بعد فحص TLS موثق من داخل شبكتك.",
                  self._mr_keys([self.btn("🔄 إعادة الفحص", "mr:status")],
                                [self.btn("📡 الأجهزة", "mr:list:0")],
                                [self.btn("🔗 تثبيت Site Agent", web=True, route="site-agent")]
                                if self._member_can_edit(me) else
                                [self.btn("🖥 حالة RADIUS", web=True, route="mikrotik-status")]))

    def member_router_start(self, chat, uid, kind, device_id=None):
        api, me = self.member_router_api(uid)
        if not self._member_can_edit(me):
            raise ApiError("إضافة وتعديل الأجهزة متاحان فقط لصاحب الشبكة أو المدير باشتراك فعّال")
        if kind == "edit":
            if not device_id or not ID_PATTERN.fullmatch(device_id):
                raise ApiError("معرّف الجهاز غير صالح")
            devices = api.request("/devices").get("items") or []
            device = next((row for row in devices if row.get("id") == device_id), None)
            if not device:
                raise ApiError("الجهاز غير موجود في حسابك")
        else:
            device = None
        # Starting another form invalidates any older unused confirmation.
        self.member_router_confirms.pop(uid, None)
        self.member_router_drafts[uid] = {
            "kind": kind, "deviceId": device_id, "tenantId": me["tenantId"],
            "previousHost": device.get("host") if device else None,
            "previousPort": device.get("api_port") if device else None,
            "time": time.monotonic()
        }
        if kind == "edit":
            prompt = ("<b>تعديل بيانات MikroTik</b>\n"
                      + "الجهاز: " + escape(device.get("name")) + "\n"
                      + "الحالي: <code>" + escape(device.get("host")) + "</code> : "
                      + escape(device.get("api_port")) + "\n\n"
                      + "أرسل في سطر واحد: <code>الاسم الجديد | IP | 8729</code>")
        else:
            prompt = ("<b>تسجيل MikroTik جديد</b>\n"
                      "أرسل في سطر واحد: <code>اسم الراوتر | IP</code>\n"
                      "يُضبط المنفذ المشفر 8729 ويظل الجهاز pending حتى يتم إثبات الاتصال.")
        self.send(chat, prompt + "\n\nلا ترسل كلمة مرور الجهاز. /cancel للإلغاء.",
                  self._mr_keys([self.btn("❌ إلغاء", "mr:cancel")]))

    def member_router_draft_message(self, chat, uid, text):
        draft = self.member_router_drafts.get(uid)
        if not draft:
            return False
        if time.monotonic() - draft["time"] > 300:
            self.member_router_drafts.pop(uid, None)
            self.send(chat, "انتهت صلاحية النموذج؛ افتح الزر من جديد.",
                      self._mr_keys([self.btn("📡 الأجهزة", "mr:list:0")]))
            return True
        if text.startswith("/"):
            self.send(chat, "أرسل القيم المطلوبة فقط، أو /cancel لإلغاء النموذج.")
            return True
        try:
            api, me = self.member_router_api(uid)
            if me.get("tenantId") != draft["tenantId"] or not self._member_can_edit(me):
                raise ApiError("تغيرت صلاحيات الشبكة؛ أعد فتح النموذج")
            parts = [part.strip() for part in text.split("|")]
            if len(parts) != (3 if draft["kind"] == "edit" else 2):
                raise ValueError("الصيغة غير صحيحة")
            name, host = parts[:2]
            if not 2 <= len(name) <= 100 or not HOST_PATTERN.fullmatch(host):
                raise ValueError("الاسم أو عنوان IP غير صالح")
            if draft["kind"] == "edit":
                if parts[2] != "8729":
                    raise ValueError("استخدم المنفذ المشفر API-SSL 8729")
                payload = {"name": name, "host": host, "apiPort": 8729, "reason": REASON}
            else:
                payload = {"name": name, "host": host,
                           "apiPort": 8729, "connectionMethod": "agent"}
            nonce = secrets.token_urlsafe(9)
            self.member_router_confirms[uid] = {
                **draft, "nonce": nonce, "payload": payload,
                "idempotency": str(uuid.uuid4()), "time": time.monotonic()
            }
            self.member_router_drafts.pop(uid, None)
            self.send(chat, "<b>راجع البيانات قبل التأكيد</b>\n"
                      + "🖥 الاسم: " + escape(name) + "\n"
                      + "📍 المضيف: <code>" + escape(host) + "</code>\n"
                      + "🔒 API-SSL: 8729\n"
                      + "⚠️ العملية تسجل البيانات فقط، ولا تثبت اتصال الجهاز.",
                      self._mr_keys([self.btn("✅ تنفيذ", "mr:confirm:" + nonce),
                                     self.btn("❌ إلغاء", "mr:cancel")]))
        except ValueError as error:
            self.send(chat, "⚠️ " + escape(error) + "\nأعد إدخال البيانات أو /cancel.")
        return True

    def member_router_confirm(self, chat, uid, nonce):
        pending = self.member_router_confirms.get(uid)
        if not pending or pending["nonce"] != nonce or time.monotonic() - pending["time"] > 600:
            self.member_router_confirms.pop(uid, None)
            raise ApiError("انتهت صلاحية هذا التأكيد؛ أعد فتح النموذج")
        api, me = self.member_router_api(uid)
        if me.get("tenantId") != pending["tenantId"] or not self._member_can_edit(me):
            raise ApiError("لم تعد تملك صلاحية تنفيذ العملية")
        if pending["kind"] == "edit":
            device_id = pending["deviceId"]
            rows = api.request("/devices").get("items") or []
            previous = next((r for r in rows if r.get("id") == device_id), None)
            if not previous or previous.get("host") != pending["previousHost"] or (
                    previous.get("api_port") != pending["previousPort"]):
                self.member_router_confirms.pop(uid, None)
                raise ApiError("تغيرت بيانات الجهاز أثناء التعديل؛ راجعها قبل المتابعة")
            url = "/devices/" + urllib.parse.quote(device_id, safe="")
            method = "PATCH"
        else:
            url, method = "/devices", "POST"
        result = api.request(url, pending["payload"], method, key=pending["idempotency"])
        self.member_router_confirms.pop(uid, None)
        self.send(chat, "✅ تم " + ("تعديل" if pending["kind"] == "edit" else "تسجيل")
                  + " MikroTik داخل شبكتك.\n"
                  + "📡 الجهاز: " + escape(result.get("name")) + "\n"
                  + "🔎 الحالة: " + escape(result.get("status") or "pending")
                  + "\n\nالحالة الفعلية تتطلب تشغيل Site Agent والتحقق من RouterOS.",
                  self._mr_keys([self.btn("📡 العودة للأجهزة", "mr:list:0")]))

    def member_router_callback(self, chat, uid, action):
        if action == "mr:cancel":
            self.member_router_drafts.pop(uid, None)
            self.member_router_confirms.pop(uid, None)
            self.member_router_list(chat, uid)
        elif action == "mr:new":
            self.member_router_start(chat, uid, "new")
        elif action == "mr:status":
            self.member_router_status(chat, uid)
        elif re.fullmatch(r"mr:list:[0-9]{1,6}", action):
            self.member_router_list(chat, uid, int(action.split(":")[-1]))
        elif action.startswith("mr:detail:"):
            self.member_router_detail(chat, uid, action[len("mr:detail:"):])
        elif action.startswith("mr:edit:"):
            self.member_router_start(chat, uid, "edit", action[len("mr:edit:"):])
        elif action.startswith("mr:confirm:"):
            self.member_router_confirm(chat, uid, action[len("mr:confirm:"):])
        else:
            raise ApiError("زر غير معروف؛ استخدم /start للحصول على قائمة جديدة")
