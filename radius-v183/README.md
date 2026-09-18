# UCHIHA RADIUS

منصة تشغيل مزوّدي الإنترنت متعددة المستأجرين. يحتوي هذا المستودع على تطبيق المزود، لوحة مالك المنصة، API موحّد، استقبال Accounting من RADIUS، تكامل Telegram، ومخطط PostgreSQL محمي بسياسات عزل.

الإصدار الحالي: `1.0.0-rc.1`، نسخة مرشحة اجتازت الفحص المحلي وليست إطلاقًا نهائيًا. اكتمل ربط الأدوات التشغيلية الحالية؛ مراجعة الواجهة على الهاتف واختبارات البيئة الحقيقية ما زالت مطلوبة. التفاصيل في `docs/release-status.md` و`docs/launch-checklist.md`.

## تشغيل محلي سريع

المتطلبات: Node.js 24 أو أحدث.

```bash
cp .env.example .env
npm install
npm run db:init
npm run db:seed
npm run dev
```

ثم افتح:

- تطبيق المزود: `http://127.0.0.1:8787/provider/`
- تطبيق المالك: `http://127.0.0.1:8787/owner/`
- فحص الخادم: `http://127.0.0.1:8787/health`

في بيئة التطوير فقط يمكن تسجيل الدخول بحساب العرض من داخل الواجهة. `ALLOW_DEV_AUTH` يجب أن تكون `false` في الإنتاج.

## فحص الإصدار

```bash
npm run release:check
```

يشغّل هذا الأمر تجهيز أصول الهاتف للتطوير، وفحص الملفات والأيقونات، واختبارات الصلاحيات والعزل والاشتراكات والتوقيع والنماذج، ثم اختبار مسارات HTTP محليًا وبناء المعاينة. يمكن تشغيله مباشرةً باستخدام `node scripts/verify-local.mjs` دون عمليات npm فرعية أو تنزيلات. يُحفظ تقريره في `docs/verification/latest-local-check.json`.

## بنية المنتج

- `apps/api`: API آمن، المصادقة، الصلاحيات، الاشتراك، التدقيق، والتكاملات.
- `reference/UCHIHA-RADIUS-UI-V1-83.html`: مرجع واجهة المزود المقفول، ويُبنى منه الويب وAndroid دون إعادة تصميم.
- `apps/provider-v183-runtime`: طبقة ربط V1-83 بالـAPI الحقيقي وبالجسر الأصلي في Android.
- `apps/owner-web`: تطبيق مالك المنصة RTL منفصل.
- `apps/provider-mobile` و`apps/owner-mobile`: غلافا Android مستقلان عبر Capacitor.
- `apps/telegram-bot`: عامل إرسال التنبيهات وتشغيل webhook.
- `apps/radius-agent`: موصل محلي لـFreeRADIUS مع صف Accounting على القرص وإعادة محاولة بعد انقطاع الإنترنت؛ يحتاج تحققًا على الأجهزة الفعلية.
- `packages/contracts`: ثوابت وصلاحيات وعقود مشتركة.
- `infra/postgres`: مخطط PostgreSQL وسياسات RLS للإنتاج.
- `infra/freeradius`: عقد الربط الآمن مع FreeRADIUS.
- `docs`: المعمارية، الأمان، التشغيل وقائمة الإطلاق.

## حدود التشغيل الحالية

يمكن اختبار مسارات التطوير محليًا ببيانات تجريبية. اختبارات Google OAuth وTelegram والدفع وPostgreSQL وMikroTik الفعلية تحتاج بيئاتها وحساباتها. لا تُعامل معاينة HTML أو أصول Android على أنها تطبيق إنتاج متصل بالخادم.

## سياسة الأمان

- كل طلب بيانات يحمل `tenant_id` مأخوذًا من الجلسة، وليس من جسم الطلب.
- العمليات الكتابية تتوقف دون اشتراك فعّال.
- العمليات الحساسة تحتاج سببًا ومفتاح Idempotency وتُسجل في سجل التدقيق.
- بيانات دخول MikroTik الأولية تبقى مؤقتًا في ذاكرة تطبيق Android وتُمسح بعد التحقق؛ أسرار التكاملات الخادمية تُشفّر بـ AES-256-GCM.
- مسارات موصل RADIUS وwebhooks تتحقق من HMAC والطابع الزمني لمنع الإعادة.

راجع [docs/architecture.md](docs/architecture.md) و[docs/launch-checklist.md](docs/launch-checklist.md) قبل أي نشر.

عقد بوابة الدفع المحايد موجود في [docs/billing-adapter.md](docs/billing-adapter.md)، ويعمل النظام بمراجعة يدوية سليمة إذا لم تُربط بوابة بعد.

دليل التشغيل الكامل موجود في [docs/deployment.md](docs/deployment.md).

ملخص أدلة الجاهزية والحدود المتبقية موجود في [docs/release-status.md](docs/release-status.md).
