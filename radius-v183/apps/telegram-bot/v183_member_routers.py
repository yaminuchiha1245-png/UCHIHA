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


def probe_router_tls(api, row):
    """Read-only TLS probe; never sends or receives a router password."""
    device_id = str(row.get("id") or "")
    if not ID_PATTERN.fullmatch(device_id):
        raise ApiError("معرّف الراوتر غير صالح")
    raw_port = int(row.get("api_port") or 8729)
    port = 443 if raw_port == 443 else 8729
    transport = "rest-https" if port == 443 else "api-ssl"
    return api.request("/devices/" + urllib.parse.quote(device_id, safe="") +
                       "/direct-preflight", {
                           "transport": transport, "host": str(row.get("host") or ""),
                           "apiPort": port, "confirmedOwned": True,
                       }, "POST")


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

    @staticmethod
    def member_router_diagnostics(api):
        # Only the tenant-scoped server knows if a fresh signed agent or
        # direct RouterOS identity check actually succeeded. A saved
        # status='online' or duplicate NAS record is NOT proof.
        report = api.request("/devices/connection-diagnostics")
        if not isinstance(report, dict) or not isinstance(report.get("items"), list):
            raise ApiError("تعذر التحقق من اتصال MikroTik الحقيقي؛ أعد الفحص لاحقًا")
        return report

    def member_router_list(self, chat, uid, offset=0):
        api, me = self.member_router_api(uid)
        if me["role"] == "collector":
            raise ApiError("ليس لديك صلاحية عرض أجهزة MikroTik")
        devices = api.request("/devices").get("items") or []
        diagnostics = self.member_router_diagnostics(api)
        checks = {str(item.get("id")): item for item in diagnostics["items"]}
        total = len(devices)
        unique = diagnostics.get("uniqueEndpoints", total)
        # One MikroTik may be registered twice at 8728/8729 or REST 443.
        # Sharing an IP at the same site could also be port-forwarded NAT;
        # warn the provider, but never merge or delete an unknown device.
        host_counts = {}
        for device in devices:
            host_key = (device.get("site_id"), str(device.get("host") or "").lower())
            host_counts[host_key] = host_counts.get(host_key, 0) + 1
        unique_hosts = len(host_counts)
        verified = sum(checks.get(str(device.get("id")), {}).get("verifiedOnline") is True
                       for device in devices)
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
            keys.append([self.btn("➕ تسجيل MikroTik بالأزرار", "mr:new")])
        keys.append([self.btn("🖥 الواجهة الكاملة", web=True, route="mikrotik")])
        self.send(chat, "<b>أجهزة MikroTik الخاصة بشبكتك</b>\n"
                  + "🏢 " + escape(me.get("tenantName")) + "\n"
                  + "🗂️ السجلات المحفوظة: <b>" + str(total) + "</b>\n"
                  + "🔌 نقاط إدارة مميزة (IP + منفذ): <b>" + str(unique) + "</b>\n"
                  + "📍 عناوين IP داخل المواقع: <b>" + str(unique_hosts) + "</b>\n"
                  + "🟢 الاتصال المثبت: <b>" + str(verified) + "</b>\n\n"
                  + ("\n".join(
                        "• " + escape(d.get("name")) + " — "
                        + ("🟢 متصل" if checks.get(str(d.get("id")), {}).get("verifiedOnline") is True
                           else "⚪ بانتظار التحقق")
                        + (" (⚠️ سجل مكرر أو عنوان مشترك)"
                           if host_counts.get((d.get("site_id"),
                              str(d.get("host") or "").lower()), 0) > 1 else "")
                        for d in devices[offset:offset + 7])
                     or "لا توجد أجهزة مسجلة حاليًا.")
                  + ("\n\n⚠️ أكثر من سجل يشترك في IP واحد، وربما بمنفذين مختلفين. "
                     "تأكد هل هو الراوتر نفسه أو تحويل منافذ لجهازين قبل إضافة أي سجل جديد."
                     if unique_hosts < total else "")
                  + "\n\nالحالة تعتمد على فحص RouterOS حديث، لا على حفظ الجهاز.",
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
        diagnostics = self.member_router_diagnostics(api)
        check = next((item for item in diagnostics["items"]
                      if str(item.get("id")) == device_id), {})
        verified = check.get("verifiedOnline") is True
        duplicate_ip = sum(
            row.get("site_id") == device.get("site_id") and
            str(row.get("host") or "").lower() == str(device.get("host") or "").lower()
            for row in rows) > 1
        keys = [[self.btn("🔄 تحديث بيانات الجهاز", "mr:detail:" + device_id)]]
        if self._member_can_edit(me) and len(("mr:edit:" + device_id).encode()) <= 64:
            keys.append([self.btn("✍️ تعديل الاسم والعنوان والمنفذ", "mr:edit:" + device_id)])
        if self._member_can_edit(me):
            if len(("mr:preflight:" + device_id).encode("utf-8")) <= 64:
                keys.append([self.btn("🩺 فحص الوصول المشفّر أولًا", "mr:preflight:" + device_id)])
            keys.append([self.router_web_btn("🔐 ربط هذا الجهاز في الويب", device_id)])
            keys.append([self.router_agent_btn("🛰️ ربط هذا الجهاز عبر Site Agent", device_id)])
        keys.extend([[self.btn("🩺 الحالة الفعلية", "mr:status")],
                     [self.btn("⬅️ جميع الأجهزة", "mr:list:0")]])
        self.send(chat, "<b>" + escape(device.get("name")) + "</b>\n"
                  + "📍 IP: <code>" + escape(device.get("host")) + "</code>\n"
                  + "🔌 المنفذ: <code>" + escape(device.get("api_port")) + "</code>\n"
                  + "🖥 النوع: " + escape(device.get("connection_method")) + "\n"
                  + "🔎 الاتصال المثبت: <b>" + ("🟢 متصل فعليًا" if verified
                      else "⚪ لم يثبت الاتصال بعد") + "</b>\n"
                  + "🕒 آخر فحص حقيقي: " + escape(check.get("lastVerifiedAt"))
                  + ("\n⚠️ يوجد سجل آخر بنفس IP؛ قد يكون تكرارًا أو تحويل منافذ."
                     if duplicate_ip else "")
                  + "\n\nلا ترسل كلمة مرور الراوتر عبر تيليغرام.",
                  self._mr_keys(*keys))

    def member_router_preflight(self, chat, uid, device_id):
        if not ID_PATTERN.fullmatch(device_id):
            raise ApiError("معرّف الراوتر غير صالح")
        api, me = self.member_router_api(uid)
        if not self._member_can_edit(me):
            raise ApiError("فحص الربط متاح فقط لمالك الشبكة والمدير المخوّل")
        devices = api.request("/devices").get("items") or []
        row = next((d for d in devices if d.get("id") == device_id), None)
        if not row:
            raise ApiError("هذا الراوتر ليس ضمن شبكتك")
        try:
            proof = probe_router_tls(api, row)
            result = ("✅ استجاب المنفذ المشفّر وتم التحقق من شهادة TLS.\\n"
                      "⚠️ لم يتم اختبار اسم المستخدم أو كلمة المرور أو خدمة RADIUS بعد.")
        except ApiError as error:
            result = ("⚠️ تعذر الوصول المشفّر إلى الراوتر من الخادم: " +
                      escape(str(error)) + "\\n"
                      "إن كان الجهاز داخل شبكة خاصة أو عنوانه غير قابل للوصول "
                      "فاستخدم Site Agent أو VPN، ولا تكشف منفذ RouterOS للإنترنت.")
        self.send(chat, "<b>فحص وصول MikroTik</b>\\n".replace("\\n", "\n") +
                  "📡 " + escape(row.get("name")) + " / <code>" +
                  escape(row.get("host")) + "</code>\\n".replace("\\n", "\n") +
                  result.replace("\\n", "\n"),
                  self._mr_keys(
                      [self.router_web_btn("🔐 متابعة ربط الجهاز في الويب", device_id)],
                      [self.router_agent_btn("🛰️ Site Agent لهذا الجهاز", device_id)],
                      [self.btn("📡 الأجهزة", "mr:list:0")]))

    def member_router_status(self, chat, uid):
        api, me = self.member_router_api(uid)
        if me["role"] == "collector":
            raise ApiError("ليس لديك صلاحية فحص الأجهزة")
        overview = api.request("/radius/overview")
        devices = api.request("/devices").get("items") or []
        diagnostics = self.member_router_diagnostics(api)
        verified = diagnostics.get("verifiedOnline", 0)
        unique = diagnostics.get("uniqueEndpoints", len(devices))
        unique_ips = len({(d.get("site_id"), str(d.get("host") or "").lower())
                          for d in devices})
        self.send(chat, "<b>الفحص الحقيقي لشبكتك</b>\n\n"
                  + "🏢 " + escape(me.get("tenantName")) + "\n"
                  + "🔑 مفتاح Site Agent: " + ("صادر" if overview.get("credentialConfigured") else "غير صادر") + "\n"
                  + "🛰️ نبضات موقعة: " + ("🟢 متصلة" if overview.get("agentConnected") else "⚪ غير متصلة") + "\n"
                  + "🗂️ السجلات: <b>" + str(len(devices)) + "</b>\n"
                  + "🔌 نقاط إدارة مميزة: <b>" + str(unique) + "</b>\n"
                  + "📍 عناوين IP داخل المواقع: <b>" + str(unique_ips) + "</b>\n"
                  + "✅ فحص MikroTik ناجح: <b>" + str(verified) + "</b>\n"
                  + "🕒 آخر نبضة: " + escape(overview.get("lastSeenAt"))
                  + "\n\nاتصال إدارة الراوتر يُثبت فقط بعد فحص TLS وهوية RouterOS، "
                    "ولا يثبت وحده مصادقة مشتركي PPPoE أو Hotspot.",
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
            prompt = ("<b>تسجيل MikroTik من أزرار البوت</b>\n"
                      "إذا كان الراوتر مسجلًا من قبل، افتح سجله الموجود بدل إنشاء نسخة ثانية.\n"
                      "أرسل: <code>اسم الراوتر | عنوان IP الحقيقي</code>\n"
                      "سنسجل المنفذ 8729 ونفتح الجهاز نفسه في الويب لإكمال الربط الآمن.")
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
            if draft["kind"] == "new":
                devices = api.request("/devices").get("items") or []
                old = next((r for r in devices if str(r.get("host") or "").lower() == host.lower()
                            and r.get("site_id") is None), None)
                if old:
                    self.member_router_drafts.pop(uid, None)
                    old_id = str(old.get("id") or "")
                    controls = [[self.btn("📡 افتح السجل الحالي", "mr:detail:" + old_id)]] if ID_PATTERN.fullmatch(old_id) else []
                    if self._member_can_edit(me) and ID_PATTERN.fullmatch(old_id):
                        controls.append([self.router_web_btn("🔐 ربط السجل الموجود في الويب", old_id)])
                    self.send(chat, "⚠️ هذا العنوان مسجل سابقًا باسم <b>" + escape(old.get("name")) +
                              "</b>. لن ننشئ جهازًا مكررًا بسبب اختلاف المنفذ.\n"
                              "راجع عنوان الإدارة الحقيقي ثم أكمل ربط السجل نفسه.",
                              self._mr_keys(*controls))
                    return True
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
        # Only new registration can safely replay after an unknown outcome:
        # the same API idempotency key returns the already registered router.
        # Edits still verify the original host/port to prevent stale overwrites.
        if pending["kind"] == "new" and pending.get("write_attempted"):
            url, method = "/devices", "POST"
        elif pending["kind"] == "edit":
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
            # The first confirmation must recheck for another existing router.
            saved = api.request("/devices").get("items") or []
            duplicate = next((r for r in saved if
                              str(r.get("host") or "").lower() ==
                              pending["payload"]["host"].lower() and
                              r.get("site_id") is None), None)
            if duplicate:
                self.member_router_confirms.pop(uid, None)
                self.send(chat, "⚠️ سبق تسجيل هذا العنوان؛ لم ننشئ نسخة ثانية.",
                          self._mr_keys([self.btn("📡 الأجهزة", "mr:list:0")]))
                return
            url, method = "/devices", "POST"
        if pending["kind"] == "new":
            pending["write_attempted"] = True
            try:
                result = api.request(url, pending["payload"], method,
                                     key=pending["idempotency"])
            except ApiError as error:
                self.send(chat,
                          "⚠️ لم تصل نتيجة نهائية لتسجيل MikroTik؛ ربما حُفظ الجهاز بالفعل.\n"
                          "راجع قائمة الأجهزة قبل بدء تسجيل آخر. إعادة المحاولة تستخدم"
                          " نفس مفتاح العملية ولن تضيف سجلًا ثانيًا إن نجح الطلب الأول.\n\n"
                          "التفاصيل: " + escape(str(error)),
                          self._mr_keys(
                              [self.btn("🔁 إعادة المحاولة بنفس السجل",
                                        "mr:confirm:" + nonce)],
                              [self.btn("📡 مراجعة الأجهزة", "mr:list:0")]))
                return
        else:
            result = api.request(url, pending["payload"], method,
                                 key=pending["idempotency"])
        self.member_router_confirms.pop(uid, None)
        registered_id = str(result.get("id") or pending.get("deviceId") or "")
        next_steps = [[self.router_web_btn("🔐 أكمل ربط هذا الجهاز في الويب", registered_id)]] \
            if ID_PATTERN.fullmatch(registered_id) else []
        next_steps.extend([
            [self.router_agent_btn("🛰️ البديل للراوتر الداخلي: Site Agent", registered_id)]
            if ID_PATTERN.fullmatch(registered_id) else
            [self.btn("🛰️ Site Agent", web=True, route="site-agent")],
            [self.btn("📡 العودة للأجهزة", "mr:list:0")],
        ])
        self.send(chat, "✅ تم " + ("تعديل" if pending["kind"] == "edit" else "تسجيل")
                  + " MikroTik في شبكتك، والسجل نفسه ظاهر في تطبيق الويب.\n"
                  + "📡 الجهاز: " + escape(result.get("name")) + "\n"
                  + "🔎 الحالة: " + escape(result.get("status") or "pending")
                  + "\n\nأكمل تسجيل الدخول المشفّر من زر الويب، ولا ترسل "
                    "كلمة مرور الراوتر في المحادثة. إذا كان الجهاز داخل شبكة "
                    "خاصة استخدم Site Agent أو VPN.",
                  self._mr_keys(*next_steps))

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
        elif action.startswith("mr:preflight:"):
            self.member_router_preflight(chat, uid, action[len("mr:preflight:"):])
        elif action.startswith("mr:edit:"):
            self.member_router_start(chat, uid, "edit", action[len("mr:edit:"):])
        elif action.startswith("mr:confirm:"):
            self.member_router_confirm(chat, uid, action[len("mr:confirm:"):])
        else:
            raise ApiError("زر غير معروف؛ استخدم /start للحصول على قائمة جديدة")
