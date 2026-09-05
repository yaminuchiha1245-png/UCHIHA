# UCHIHA Builder — Staging Checklist

هذه القائمة تخص خدمة UCHIHA Builder وقاعدة بياناتها المستقلة فقط. لا تربطها بقاعدة بيانات متجر قديم أو مشروع آخر. لا نشر على Railway القديمة.

## إعداد Railway

- خدمة Web مرتبطة بفرع `builder/v1-platform` ومسار الجذر `/builder`.
- للمعاينة البصرية الحالية يمكن تشغيل الخدمة دون PostgreSQL عبر `PREVIEW_MEMORY_MODE=true`.
- عند اختبار المسار الدائم، استخدم خدمة PostgreSQL مستقلة وفي حالة Online.
- رابط PostgreSQL الدائم يصل إلى خدمة Web عبر أحد المتغيرات المدعومة:
  - `DATABASE_URL`
  - `DATABASE_PRIVATE_URL`
  - `POSTGRES_URL`
  - `PGURL`
  - أو مجموعة `PGHOST` و`PGPORT` و`PGUSER` و`PGPASSWORD` و`PGDATABASE`.
- توليد Public Domain للخدمة. يلتقط التطبيق `RAILWAY_PUBLIC_DOMAIN` تلقائيًا عند غياب `APP_BASE_URL`.
- إبقاء PR #23 مسودة وعدم الدمج في `main` حتى اجتياز جميع فحوص الإطلاق.

## متغيرات Staging المطلوبة

- `NODE_ENV=production`
- للمعاينة المؤقتة: `PREVIEW_MEMORY_MODE=true` و`REQUIRE_PERSISTENT_DATABASE=false`.
- للمسار الدائم: `PREVIEW_MEMORY_MODE=false` و`REQUIRE_PERSISTENT_DATABASE=true` و`DATABASE_MODE=postgres` ورابط PostgreSQL مستقل.
- `COOKIE_SECURE=true`
- `APP_ENCRYPTION_KEY` مطلوب للمسار الدائم، ولا يلزم وضع سر ثابت في Memory Preview.
- `DEMO_SEED=true` خلال المعاينة الآمنة فقط.
- `ALLOW_DEMO_BILLING=true` خلال المعاينة فقط.
- `TELEGRAM_MODE=fake` حتى توفير بوتات تجريبية مستقلة.
- `UCHIHA_API_1_MODE=test` حتى توفير بيانات اعتماد تجريبية.
- `RATE_LIMIT_ENABLED=true`
- يفضّل `DATABASE_POOL_MAX=10` للخطة الصغيرة.

لا تعرض قيم الأسرار في صور الشاشة، ولا تحفظها في GitHub أو ملفات المشروع.

## فحوص الخدمة

```text
GET /health
```

يؤكد أن عملية Web تعمل. نجاحه لا يعني أن البيانات دائمة.

```text
GET /ready
```

الحالة الصحيحة قبل إدخال بيانات مهمة:

- HTTP `200`
- `status=ready`
- `database=postgresql`
- `persistent=true`
- ظهور عدد الـmigrations المطبقة.

في Memory Preview تكون الحالة الصحيحة:

- HTTP `200`
- `status=demo-ready`
- `database=memory-demo`
- `persistent=false`
- `preview=true`

HTTP `503` مع `database=memory-demo` مسموح فقط عندما يكون وضع Preview غير مفعّل، ويعني أن إعداد الإنتاج غير جاهز.

## فحص Staging الآلي

بعد ضبط رابط Railway في متغير GitHub Repository باسم:

```text
BUILDER_STAGING_URL
```

يشغّل GitHub Actions فحصًا حيًا بعد نجاح الاختبارات. ويمكن تشغيله محليًا هكذا:

```bash
SMOKE_BASE_URL=https://example.up.railway.app npm run smoke:staging
```

الفحص يتحقق من:

- الصفحة الرئيسية وHTML صالح.
- ترويسات الأمان الأساسية.
- `/health`.
- `/ready` ووجود PostgreSQL دائمة أو حالة `demo-ready` الصريحة في Memory Preview.
- `/api/public/config` ووجود القوالب الثلاثة.
- عدم تسريب مفاتيح أو روابط قاعدة البيانات في الردود العامة.

لرؤية معاينة مؤقتة فقط دون اعتبارها جاهزة للإنتاج:

```bash
SMOKE_BASE_URL=https://example.up.railway.app SMOKE_ALLOW_DEGRADED=true npm run smoke:staging
```

## فحوص المسار الكامل

1. تسجيل مستخدم جديد وتسجيل الخروج والدخول.
2. إنشاء اشتراك ومتجر تجريبي بمفتاح Idempotency.
3. إنشاء متجر ثانٍ بحساب آخر والتأكد من عودة `404` عند محاولة الوصول المتبادل.
4. اختبار القوالب الثلاثة على الهاتف والكمبيوتر.
5. إنشاء أقسام رئيسية وفرعية ومنتجات بكل أنواع الحقول الذكية.
6. اختبار البحث والتحميل التدريجي بآلاف المنتجات.
7. إنشاء عميل متجر ومحفظة وطلب إيداع وقبول ورفض.
8. اختبار شراء من الرصيد وعدم الخصم مرتين.
9. اختبار Refund وعدم إعادة الرصيد مرتين.
10. اختبار Queue وWorker واستعادة المهام بعد انتهاء Lease.
11. التأكد أن السجلات لا تعرض Tokens أو كلمات مرور أو بيانات المزود.
12. تشغيل `npm run check` و`npm test` و`npm run verify:production`.

## الانتقال من Staging إلى Production

قبل فتح التسجيل لعملاء حقيقيين:

- اجعل `/ready` يعيد `200` باستخدام PostgreSQL.
- خذ نسخة احتياطية واختبر الاستعادة.
- غيّر `APP_ENCRYPTION_KEY` الذي ظهر سابقًا إلى مفتاح جديد، قبل حفظ أي توكنات حقيقية.
- أوقف `DEMO_SEED` و`ALLOW_DEMO_BILLING`.
- فعّل بيانات Telegram والمزود الحقيقيين في بيئة منفصلة بعد الاختبار.
- اضبط الدومين النهائي و`STORE_BASE_DOMAIN`.
- استخدم Object Storage لإثباتات الدفع والصور قبل التوسع.
- شغّل `npm run maintenance` بجدول دوري مناسب.
- نفّذ اختبار تحميل وأمان ومراجعة صلاحيات نهائية.
- حوّل PR #23 إلى Ready ثم ادمجه فقط بعد نجاح كل ما سبق.
