# UCHIHA Builder

Vertical Slice تشغيلية لمنصة المتاجر المركزية متعددة العملاء.

هذه الحزمة مستقلة داخل مجلد `builder/`. لا تغيّر نقطة تشغيل UCHIHA Store القديمة، ولا تستخدم `store.db` أو `uchiha_platform.db` أو `merchant_data`.

## ما يعمل الآن

- مشروع موحّد يضم الموقع ولوحة الويب والبوتات وتطبيقات الهاتف كمكوّنات مستقلة
  فوق Backend API وقاعدة PostgreSQL نفسيهما.
- كتالوج خدمات مركزي وحالات تجهيز منفصلة لكل مكوّن في المشروع.
- تسجيل حساب وجلسة آمنة مع CSRF.
- اشتراك واحد قابل للتحرير باسم UCHIHA Full.
- كل اشتراك ينشئ متجرًا واحدًا فقط.
- إنشاء Tenant وStore ورابط فرعي بواسطة Queue وWorker.
- منع تكرار المتجر باستخدام Idempotency.
- Design Tokens وقالب ومعاينة مباشرة.
- معالج إنشاء واضح من 7 خطوات مع حفظ تلقائي للمسودة.
- لوحة إدارة عربية RTL.
- واجهة متجر تعتمد الأقسام الرئيسية ثم الفرعية، ولا تحمل المنتجات في الرئيسية.
- بانر واحد يدعم صورة أو GIF أو فيديو متكرر مع رابط اختياري.
- إضافة قسم ومنتج وظهورهما في مصدر بيانات الموقع.
- بوت متجر وبوت إدارة منفصلان مع فحص `getMe` في الوضع الحقيقي.
- تشفير توكنات البوتات وWebhook secrets بـ AES-256-GCM.
- Webhooks مركزية بدل Polling.
- Provider Adapter موحد، وأول مصدر يظهر للتاجر باسم `UCHIHA API 1`.
- مزامنة أقسام وخدمات تجريبية واستيرادها إلى متجر.
- الحفاظ على الاسم والوصف والصورة وسعر البيع المحلي أثناء المزامنة.
- أوضاع تسعير ثابت ونسبة وسعر يدوي.
- طلب API تجريبي Idempotent لا يرسل أي طلب خارجي.
- 17 خدمة أولية داخل قسم خدمات البرمجة، وكلها بيانات قابلة للتحرير.
- مخطط PostgreSQL مركزي مع `tenant_id` وسياسات RLS للإنتاج.
- اختبار End-to-End للعزل بين متجرين.
- حساب مستقل لعملاء كل متجر مع جلسة وCSRF وCookie منفصلة لكل Store.
- واجهة حساب موحّدة ومسارات منفصلة للمحفظة والدفعات والطلبات والحماية وTelegram
  وتوثيق الهوية وواجهة المطور ومن نحن.
- TOTP حقيقي مع Recovery Codes وتحدي تسجيل دخول وإدارة جلسات وسجل أمان.
- مركز دعم خارجي ديناميكي عبر WhatsApp وTelegram والبريد والهاتف والقنوات التي يفعّلها المتجر.
- شاشة مالك لإعداد تجربة الحساب وقنوات الدعم ومراجعة KYC من `/admin/:storeId/account-settings`.
- API قراءة للأقسام والمنتجات فقط بمفاتيح Hashed وصلاحيات وRate Limit وIP Allowlist.
- سلة شراء داخل المتجر تدفع من Ledger المحفظة مع إعادة تحقق خادمية وIdempotency.
- محفظة عميل وسجل Ledger وإشعارات داخل المتجر.
- طلبات شحن رصيد مع العمولة والصافي وإثبات تحويل PNG/JPEG/WEBP.
- مراجعة طلبات الإيداع بالقبول أو الرفض مع سبب واضح وسجل تدقيق مالي.
- شراء المنتجات من الرصيد داخل Transaction واحدة مع Row Locks وIdempotency.
- بقي نظام المحادثات الداخلي القديم محفوظًا للتوافق، بينما واجهة المتجر الجديدة تستخدم مركز دعم خارجي ديناميكي.
- مستويات ولاء محسوبة من الطلبات المدفوعة.
- اختيار أي عملة أساسية يدعمها النظام، وعملات عرض لا تُفعّل إلا بسعر تحويل
  صريح ومؤرخ.
- PWA قابلة للتثبيت ومشروع تطبيق مالك موحّد لـAndroid وiOS داخل `mobile/`.

تفاصيل حدود المنصة ومسار دمج قدرات البوتات موجودة في
`UNIFIED_PLATFORM_ARCHITECTURE.md`.

## تجربة محلية سريعة

يتطلب Node.js 22 أو أحدث:

```bash
npm install
npm run dev:demo
```

ثم افتح:

```text
http://localhost:4100
```

الوضع التجريبي:

- يستخدم PostgreSQL محاكية في الذاكرة للاختبارات المحلية فقط.
- لا يحفظ البيانات بعد إيقاف العملية.
- لا يتصل بأي مزود خارجي.
- يقبل توكنات Telegram ذات شكل صحيح ويستخدم بوابة وهمية، فلا يرسل Webhook حقيقيًا.
- يقرأ السعر والمدة التجريبيين من `src/demo-seed.json` كبيانات Seed، وليسا شرطًا ثابتًا في منطق الاشتراك.

مثالان صالحان لاختبار البوتين محليًا:

```text
100001:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456
100002:ABCDEFGHIJKLMNOPQRSTUVWXYZ654321
```

لا تستخدم توكنات حقيقية في الوضع التجريبي، ولا تحفظ أي سر في المستودع.

## معاينة Railway بالذاكرة — لا تحتاج PostgreSQL

صورة Docker في فرع `builder/v1-platform` تبدأ افتراضيًا بوضع Preview آمن ومؤقت:

```env
PREVIEW_MEMORY_MODE=true
REQUIRE_PERSISTENT_DATABASE=false
DEMO_SEED=true
ALLOW_DEMO_BILLING=true
TELEGRAM_MODE=fake
UCHIHA_API_1_MODE=test
```

في هذا الوضع:

- لا يحتاج التطبيق إلى `DATABASE_URL` ولا يحاول الاتصال بقاعدة خارجية.
- يبني مخططًا معزولًا داخل الذاكرة ويحمّل متجر `UCHIHA Store` التجريبي.
- يضيف منتجات وأقسامًا وطلبات ودفعات ومحفظة وهمية فقط.
- يعيد `/ready` حالة HTTP 200 مع `status=demo-ready` و`persistent=false`.
- يظهر تنبيه صغير يوضح أن البيانات مؤقتة وقد تُعاد تهيئتها بعد Restart.
- يجبر Telegram على `fake` والمزود على `test` حتى لو أُرسلت قيمة live بالخطأ.
- لا ينفذ دفعًا حقيقيًا ولا يرسل Webhook أو طلب مزود خارجي.

بيانات المعاينة الثابتة، وهي عامة وليست أسرار إنتاج:

```text
Platform Admin: preview-admin@uchiha.local / UchihaPreview-Admin-2026!
Store Customer: preview-customer@uchiha.local / UchihaPreview-Customer-2026!
```

للتبديل لاحقًا إلى التشغيل الدائم لا يلزم تغيير الكود. اضبط فقط:

```env
PREVIEW_MEMORY_MODE=false
REQUIRE_PERSISTENT_DATABASE=true
DATABASE_MODE=postgres
DATABASE_URL=<Railway PostgreSQL Reference>
DEMO_SEED=false
ALLOW_DEMO_BILLING=false
TELEGRAM_MODE=fake
UCHIHA_API_1_MODE=test
APP_ENCRYPTION_KEY=<32-byte base64 key>
```

عندها يصبح `/ready` صارمًا ويفشل إذا لم تكن PostgreSQL متاحة. لا تُدخل مفاتيح
أو توكنات حقيقية في وضع المعاينة، ويبدأ الخادم دائمًا من `src/start.mjs`.

## تشغيل PostgreSQL

1. انسخ `.env.example` إلى ملف بيئي خارج Git.
2. أنشئ مفتاح تشفير جديد:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

3. اضبط `DATABASE_URL` و`APP_ENCRYPTION_KEY`.
4. ضع قيم UCHIHA Full الأولية في المتغيرات البيئية.
5. أنشئ مدير المنصة وشغّل بيانات البداية:

```bash
npm run bootstrap
```

6. شغّل الـ API والـ Worker في عمليتين منفصلتين:

```bash
npm start
npm run worker
```

أو استخدم `docker-compose.yml` بعد ضبط:

- `POSTGRES_PASSWORD`
- `APP_ENCRYPTION_KEY`
- `APP_BASE_URL`
- `STORE_BASE_DOMAIN`

لا يحتوي Compose على كلمات مرور أو مفاتيح افتراضية.

## الاشتراك

لا يوجد في منطق التطبيق أكثر من عرض اشتراك واحد. السعر، العملة، التجديد، المدة، التجربة، الخصم، حالة البيع، وحالة التجديد محفوظة في `subscription_offers` وتُعدّل عبر:

```text
PUT /api/platform/subscription-offer
```

التفعيل التجريبي مغلق افتراضيًا، ولا يعمل إلا عندما يكون `ALLOW_DEMO_BILLING=true`.

## UCHIHA API 1

الـ API المخصص للتاجر يعيد فقط:

- الاسم المستعار `UCHIHA API 1`.
- الأقسام والخدمات العامة.
- سعر الجملة الذي تحدده UCHIHA.
- الحدود والحقول والخيارات.

لا تعيد واجهات التاجر `internal_name` أو بيانات الاعتماد أو استجابة المزود الخام. اسم المزود الحقيقي موجود في جداول المنصة فقط.

في `test_mode` ينشئ الـ Adapter رقم طلب تجريبيًا ولا ينفذ Network Request. وفي `live` يستخدم المسارات المتوافقة مع التكامل القديم:

- `/profile`
- `/content/0`
- `/products`
- `/newOrder/{serviceId}/params`
- `/check`

## حساب العميل والمحفظة والدفع

صفحات العميل الموحّدة:

```text
/store/:slug/account
/store/:slug/wallet
/store/:slug/payments
/store/:slug/orders
/store/:slug/support
/store/:slug/telegram
/store/:slug/security
/store/:slug/identity
/store/:slug/developer
/store/:slug/about
```

صفحة مراجعة صاحب المتجر:

```text
/admin/:storeId/payments
```

التدفق المنفذ حاليًا:

1. يسجل العميل حسابًا خاصًا بالمتجر، ولا تصل جلسته إلى متجر آخر.
2. يختار طريقة دفع مفعلة ويكتب المبلغ المحول.
3. يحسب الخادم والواجهة العمولة والصافي من نفس القواعد.
4. يتحقق الخادم من نوع ملف الإثبات وحجمه وتوقيعه الحقيقي، وليس الامتداد فقط.
5. ينشأ طلب الإيداع بحالة `pending` مع Idempotency خاصة بالعميل.
6. عند القبول يقفل طلب الإيداع والمحفظة، ثم يضيف الصافي إلى Ledger مرة واحدة.
7. عند الرفض يجب حفظ السبب ويظهر للعميل.
8. عند الشراء من الرصيد تقفل المحفظة والمنتجات، ثم ينشأ الطلب وتخصم المحفظة والمخزون داخل Transaction واحدة.

إعادة إرسال نفس الطلب بنفس المفتاح والمحتوى تعيد المورد نفسه من دون خصم أو إضافة ثانية. إعادة استخدام المفتاح مع Payload مختلفة تعيد `409 idempotency_mismatch`.

الجداول الإضافية المستخدمة في التدفق المالي:

- `store_customers` و`customer_sessions`.
- `customer_wallets` و`wallet_ledger`.
- `payment_methods` و`deposit_requests`.
- `customer_idempotency_records`.
- `customer_notifications`.
- `audit_logs` و`outbox_events`.

## العزل

كل Query خاصة بمتجر تحتوي `tenant_id` و`store_id`. في PostgreSQL تطبق Migration رقم `002_tenant_rls` سياسات Row-Level Security باستخدام:

```sql
current_setting('app.tenant_id', TRUE)
```

الدخول إلى لوحة متجر آخر يعيد `404` حتى عند معرفة UUID.

## الاختبارات

```bash
npm run check
npm test
```

يغطي الاختبار:

1. التسجيل والاشتراك التجريبي.
2. إنشاء المتجر والـ Worker.
3. منع التكرار.
4. الهوية والرابط.
5. القسم والمنتج.
6. البوتين وإخفاء التوكنات.
7. متجر عام يستخدم نفس البيانات.
8. مكتبة UCHIHA API 1.
9. خدمة برمجة.
10. طلب مزود تجريبي وتنفيذ آمن.
11. Webhook موقع.
12. منع مستخدم ثانٍ من دخول المتجر الأول.
13. وجود RLS ونقاط الاستجابة للهاتف والحاسوب.
14. عزل حساب العميل وCookie الجلسة بين متجرين.
15. إنشاء الإيداع وإعادة المحاولة الآمنة ورفض تغيير Payload.
16. قبول الإيداع مرة واحدة ورفض الاعتماد المكرر.
17. التحقق من الحقول والخيارات والكمية والمخزون والعملة عند شراء المحفظة.
18. منع تكرار الطلب أو Ledger أو خصم المخزون.
19. إنشاء إشعارات وسجل Audit للعمليات المالية.
20. المشروع متعدد المكونات وحالات التجهيز.
21. تحميل الأقسام فقط في الرئيسية من دون Query للمنتجات.
22. محادثات الدعم المعزولة بين العميل ومالك المتجر.
23. أسعار عملات العرض والتحقق من منع السعر الصفري.

## Checklist قبل Staging

لا ينشر هذا الفرع فوق Railway القديمة. عند الموافقة على Staging يجب إنشاء Service وPostgreSQL وDomain مستقلة، ثم:

- ضبط `NODE_ENV=production` و`DATABASE_MODE=postgres`.
- إنشاء `APP_ENCRYPTION_KEY` عشوائي بطول 32 بايت وعدم حفظه في GitHub.
- ضبط `COOKIE_SECURE=true` وعناوين `APP_BASE_URL` و`STORE_BASE_DOMAIN` الجديدة.
- إبقاء `DEMO_SEED=false` و`ALLOW_DEMO_BILLING=false` و`UCHIHA_API_1_MODE=test` حتى الاختبارات الحية المعتمدة.
- استخدام Object Storage مستقل لإثباتات التحويل قبل قبول بيانات حقيقية.
- تشغيل Migrations ومراجعة RLS بحساب PostgreSQL غير مالك للجداول.
- تشغيل `npm run check` و`npm test` وSmoke Test ونسخة احتياطية قبل أي ترقية.
- عدم إضافة Telegram Tokens أو مفاتيح المزود إلا كمتغيرات بيئية في خدمة Staging الجديدة.

## ما لم يُفعّل خارجيًا

التدفق الحقيقي موجود، لكن هذه العناصر تحتاج أسرار وبيئة جديدة قبل تجربتها:

- PostgreSQL مستضافة للمنصة الجديدة.
- عنوان Staging جديد غير رابط UCHIHA Store القديم.
- توكنان حقيقيان من BotFather.
- مفتاح مزود UCHIHA API 1.
- بوابة دفع للاشتراك.
- Object Storage لرفع الصور بدل روابط الصور.

لا يحتاج التطوير المحلي الآمن إلى أي من هذه الأسرار.


## القوالب الأساسية والكتالوج واسع النطاق

تدعم الواجهة الآن ثلاث هويات أساسية فعلية:

- `professional-dark`: Professional Digital.
- `modern-light`: Minimal Light.
- `gaming-digital`: Dark Tech.

يمكن تعديل القالب والألوان والخط والحواف والشعار والغلاف من لوحة الإدارة عبر:

```text
PUT /api/stores/:storeId/design
```

قائمة المنتجات في لوحة الإدارة والمتجر العام تستخدم `limit` و`offset` والبحث من الخادم بدل تحميل الكتالوج كاملًا. أضيفت Migration `011_catalog_scale_indexes` لفهارس المنتجات والأقسام والطلبات وطابور مراجعة التحليل.

عندما يكون `DEMO_SEED=true` يتوفر متجر Showcase ثابت على `/store/demo` لعرض
القالب والكتالوج ومسار الطلب من دون استخدام أي مزود خارجي أو بيانات اعتماد حقيقية.

## Rate Limiting

الواجهات الحساسة للتسجيل والدخول والشراء والإيداع محمية بمحدد طلبات لكل عملية API. الإعداد الحالي مناسب لعملية API واحدة؛ عند تشغيل أكثر من Instance يجب نقل العداد إلى Redis أو API Gateway مشتركة حتى يكون الحد موحدًا بين النسخ.

راجع `STAGING_CHECKLIST.md` لإنشاء بيئة مستقلة دون لمس Railway القديمة.
