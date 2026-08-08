# UCHIHA AI Bot — Production Launch Runbook

هذا الملف هو مرجع الإطلاق النهائي لمنتج بوت الذكاء الاصطناعي.

## المعمارية المعتمدة

- موقع UCHIHA: عرض المنتج، الشراء، إدخال/تغيير Telegram Bot Token، وإدخال Telegram ID للمالك فقط.
- إدارة البوت المشتَرى: داخل Telegram عبر `/admin` فقط.
- OpenAI: مفتاح مستقل لكل بوت مشتَرى، يُدخل من `/admin` ويُخزن مشفرًا.
- لا يوجد `OPENAI_API_KEY` مركزي للمنصة.
- لا يوجد Setup Bot مركزي.
- مدير UCHIHA يستخدم الويب فقط لتسعير المنتج وحالته ومراقبة عدد النسخ والاستخدام الإجمالي.

## 1. شروط بيئة الإنتاج

تأكد أن بيئة API تحتوي على القيم الصحيحة التالية بدون طباعة الأسرار في السجلات:

```text
NODE_ENV=production
REQUIRE_PERSISTENT_DATABASE=true
DATABASE_MODE=postgres
APP_BASE_URL=https://<public-domain>
COOKIE_SECURE=true
TELEGRAM_MODE=live
RATE_LIMIT_ENABLED=true
PREVIEW_MEMORY_MODE=false
DEMO_SEED=false
ALLOW_DEMO_BILLING=false
APP_ENCRYPTION_KEY=<production-secret>
```

يجب ألا يوجد اعتماد على:

```text
OPENAI_API_KEY
UCHIHA_AI_SETUP_BOT_TOKEN
UCHIHA_AI_SETUP_BOT_USERNAME
AI_PLATFORM_DAILY_REQUEST_LIMIT
```

## 2. قاعدة البيانات

ابدأ التطبيق/الهجرة على PostgreSQL الإنتاجي. يجب أن تصل `schema_migrations` إلى 32، وأن تكون migration التالية موجودة بالاسم:

```text
032_ai_bot_telegram_identity_unique
```

كما يجب وجود الفهرس:

```text
idx_ai_bot_instances_telegram_bot_id_unique
```

Migration 032 تصلح أي تكرار تاريخي لـ`telegram_bot_id` قبل إنشاء الفهرس الفريد. النسخة المكررة غير المعتمدة تتحول إلى `failed` حتى يعيد مالكها ربط Token صحيح بدل أن يتشارك بوتان نفس Telegram identity.

## 3. فحص الكود قبل النشر

في بيئة اختبار منفصلة فقط، وليس على قاعدة بيانات الإنتاج:

```bash
npm ci
npm run check
npm run lint
npm run build
npm test
```

إذا كانت اختبارات PostgreSQL ستعمل، استخدم `TEST_DATABASE_URL` لقاعدة اختبار مؤقتة فقط. لا تستخدم قاعدة الإنتاج للاختبارات.

## 4. فحص الإنتاج بعد تشغيل الحاويات

من داخل حاوية/API الإنتاج:

```bash
npm run verify:production
npm run verify:ai-launch
```

لا يُفتح البيع إذا كان `verify:ai-launch` يرجع `ready: false`.

الفحص يتحقق من:

- Production mode.
- PostgreSQL دائم.
- APP_BASE_URL عام عبر HTTPS.
- Secure Cookie.
- Telegram live.
- Rate limiting.
- Demo modes معطلة.
- APP_ENCRYPTION_KEY موجود.
- Migration 032 مطبقة بالاسم.
- Unique Telegram bot identity index موجود فعليًا.
- المنتج موجود في الكتالوج.
- السعر أكبر من صفر.
- العملة صحيحة.
- حالة المنتج Active.

## 5. تسعير المنتج

ادخل بحساب مدير المنصة ثم افتح:

```text
/platform-ai-product
```

حدد:

- سعر البيع.
- العملة.
- حالة المنتج.

السيرفر يمنع تحويل المنتج إلى `active` إذا بيئة الإنتاج أو Migration 032 غير جاهزة.

## 6. اختبار شراء حقيقي قبل فتحه للجميع

استخدم حساب عميل تجريبي حقيقي ورصيدًا مخصصًا للاختبار:

1. افتح منتج بوت AI.
2. نفّذ شراء واحد.
3. تأكد أن الرصيد خُصم مرة واحدة فقط.
4. أعد إرسال نفس محاولة الشراء في حالة انقطاع الشبكة وتأكد أن Idempotency تعيد نفس الطلب بدون خصم ثانٍ.
5. أنشئ Telegram Bot تجريبيًا عبر BotFather.
6. أدخل Bot Token داخل الموقع.
7. أدخل Telegram ID الصحيح للمالك.
8. تأكد أن الموقع يعرض Token مقنّعًا فقط بعد الحفظ.
9. افتح البوت واضغط Start.
10. اكتب `/admin` من حساب المالك.
11. جرّب `/admin` من حساب آخر وتأكد أنه مرفوض.

## 7. اختبار OpenAI من داخل البوت

من `/admin`:

1. افتح إعداد OpenAI.
2. أنشئ API Key من رابط OpenAI إذا لزم.
3. أرسل المفتاح للبوت.
4. تأكد أن المفتاح يظهر مقنّعًا فقط بعد الحفظ.
5. تأكد أن رسالة المفتاح حُذفت تلقائيًا؛ إذا تعذر Telegram في الحذف تظهر رسالة واضحة تطلب حذفها يدويًا.
6. اضغط `اختبار OpenAI الآن`.
7. يجب أن ينجح طلب Responses API الفعلي.

## 8. اختبار تجربة المستخدم

- `UCHIHA AI V1`: مجاني وزره Primary/أزرق.
- `UCHIHA AI V2`: مقفول لغير PRO.
- افتح V2 من مستخدم مجاني وتأكد أن شاشة الاشتراك تظهر.
- امنح المستخدم PRO من `/admin` وأعد المحاولة.
- جرّب محادثة عامة.
- جرّب البرمجة.
- جرّب التعليم والدراسة.
- جرّب إنشاء صورة.
- جرّب بدء محادثة جديدة وتأكد أن سياق Responses API يبدأ من جديد.

## 9. اختبار إدارة النماذج

من `/admin`:

- غيّر الاسم التجاري للنموذج.
- غيّر OpenAI model الحقيقي إلى نموذج متاح للمفتاح.
- بدّل Free / PRO.
- أوقف وشغّل نموذجًا.
- أضف نموذجًا مخصصًا.
- احذف نموذجًا مخصصًا.
- تأكد أن V1/V2 لا يمكن حذفهما.
- تأكد أن آخر نموذج مجاني فعال لا يمكن حذفه أو تعطيله.
- الحد الأقصى 12 نموذجًا لكل بوت.

## 10. اختبار المستخدمين والحدود

- منح PRO لمستخدم موجود.
- محاولة منح PRO لـTelegram ID لم يدخل البوت: يجب أن يفشل بوضوح.
- حظر/فك حظر مستخدم موجود.
- اختبار حد Free اليومي.
- اختبار حد PRO اليومي.
- اختبار حد الصور.
- الطلبات الفاشلة عند مزود AI تُحسب ضمن حد الحماية اليومي كذلك.

## 11. اختبار تغيير Bot Token

- غيّر Token لنفس Telegram Bot وتأكد أن البوت يعود للعمل.
- جرّب Token لنفس Telegram bot_id على منتج ثانٍ: يجب أن يرجع `telegram_bot_in_use`.
- جرّب عمليتي Token متزامنتين لنفس المنتج: الثانية يجب أن ترجع `provisioning_in_progress` أثناء القفل.
- إذا فشل تغيير Token، يجب أن ترجع هوية Telegram والحالة السابقة تلقائيًا.

## 12. قرار الإطلاق

لا يعتبر المنتج Live حتى تتحقق جميع النقاط التالية:

- CI أو بيئة اختبار مستقلة نفذت Syntax/Lint/Build/Tests بنجاح.
- VPS يعمل بالإصدار المطلوب.
- Migrations حتى 032 مطبقة.
- `npm run verify:production` ناجح.
- `npm run verify:ai-launch` يرجع `ready: true`.
- السعر مضبوط من مدير UCHIHA.
- شراء تجريبي حقيقي نجح.
- BotFather Token حقيقي نجح.
- `/admin` الحقيقي نجح.
- OpenAI Key حقيقي + Live Test نجحا.
- V1/V2/PRO/Image smoke test نجح.

بعدها فقط يتم فتح المنتج للبيع العام.
