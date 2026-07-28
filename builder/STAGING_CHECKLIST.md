# UCHIHA Builder — Staging Checklist

هذه القائمة تخص خدمة جديدة مستقلة فقط. يمنع ربطها بخدمة أو قاعدة بيانات UCHIHA Store القديمة.

## قبل الإنشاء

- إنشاء Railway Project أو Service جديدة باسم واضح مثل `uchiha-builder-staging`.
- إنشاء PostgreSQL جديدة وفارغة وربطها بالخدمة الجديدة فقط.
- استخدام Domain أو Subdomain تجريبي جديد.
- إبقاء PR #23 مسودة وعدم الدمج في `main`.

## متغيرات البيئة المطلوبة

- `NODE_ENV=production`
- `DATABASE_MODE=postgres`
- `DATABASE_URL` من PostgreSQL الجديدة.
- `APP_BASE_URL` رابط الـStaging الجديد.
- `STORE_BASE_DOMAIN` نطاق تجريبي جديد.
- `COOKIE_SECURE=true`
- `APP_ENCRYPTION_KEY` مفتاح Base64 جديد بطول 32 بايت.
- `DEMO_SEED=true` للمعاينة الآمنة فقط.
- `ALLOW_DEMO_BILLING=true` في Staging فقط.
- `TELEGRAM_MODE=fake` حتى توفير بوتات تجريبية مستقلة.
- `UCHIHA_API_1_MODE=test` حتى توفير بيانات اعتماد تجريبية.
- `RATE_LIMIT_ENABLED=true`.

## فحوص الإطلاق

1. تشغيل migrations على PostgreSQL الجديدة.
2. نجاح `/health` مع `database=postgresql`.
3. إنشاء حساب ومتجر تجريبي دون بيانات حقيقية.
4. التحقق من العزل بين متجرين.
5. اختبار القوالب الثلاثة على الهاتف والكمبيوتر.
6. اختبار البحث والتحميل التدريجي بآلاف المنتجات التجريبية.
7. اختبار الإيداع والقبول والرفض وعدم تكرار الرصيد.
8. التأكد أن السجلات لا تعرض Tokens أو بيانات المزود.
9. فحص `npm run check` و`npm test` وGitHub Actions.
10. عدم تحويل Staging إلى Production قبل Object Storage وRate Limiter مشترك واختبار PostgreSQL حي.

## عناصر لا تُفعّل تلقائيًا

- لا نشر على Railway القديمة.
- لا Telegram Tokens حقيقية.
- لا مزود حقيقي.
- لا بوابة دفع حقيقية.
- لا Merge إلى `main`.
