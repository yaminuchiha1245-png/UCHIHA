# نشر UCHIHA RADIUS

## 1. المتطلبات

- خادم Linux مدعوم وNode.js 24.
- PostgreSQL 16 أو أحدث مع SSL ونسخ احتياطي مُدار.
- النطاق الفرعي `radius.uchiha-builder.com` وشهادة TLS، من دون تعديل موقع `uchiha-builder.com` الرئيسي.
- أربعة حسابات قاعدة بيانات مختلفة: `uchiha_migrator` و`uchiha_runtime` و`uchiha_platform` و`uchiha_backup` (قراءة فقط).
- أدوات PostgreSQL العميلة `psql` و`pg_dump` و`pg_restore` من إصدار لا يقل عن إصدار الخادم، مع Bash وcoreutils وflock.

## 2. تجهيز قاعدة البيانات

أنشئ كلمات مرور مستقلة وعشوائية، ثم شغّل من جذر المشروع:

```bash
POSTGRES_ADMIN_URL='postgresql://admin:...@db/uchiha_radius' \
RUNTIME_DATABASE_PASSWORD='...' \
PLATFORM_DATABASE_PASSWORD='...' \
MIGRATOR_DATABASE_PASSWORD='...' \
BACKUP_DATABASE_PASSWORD='...' \
MIGRATION_DATABASE_URL='postgresql://uchiha_migrator:...@db/uchiha_radius' \
./scripts/bootstrap-postgres.sh
```

لا تحفظ القيم السابقة في Git أو سجل الأوامر. استخدم Vault أو مدير أسرار الاستضافة.

## 3. إعداد الخدمة

1. انسخ `.env.example` إلى `/etc/uchiha-radius/api.env` بصلاحية `0600`.
2. ضع روابط قاعدة البيانات المنفصلة والقيم الحقيقية لـGoogle وTelegram والدفع.
3. اجعل `NODE_ENV=production` و`ALLOW_DEV_AUTH=false` و`TRUST_PROXY=true` و`OUTBOX_WORKER_ENABLED=false` لخدمة API.
4. اجعل `CORS_ORIGINS` يحتوي نطاق الويب الحقيقي و`https://localhost` لتطبيقي Capacitor فقط، ولا تستخدم `*`.
5. إذا فُعّل الدفع الآلي، اضبط `BILLING_CHECKOUT_ENDPOINT` و`BILLING_CHECKOUT_TOKEN` معًا، وحدد نطاقات صفحات الدفع في `BILLING_CHECKOUT_ALLOWED_HOSTS`.
6. انسخ وحدتي `api` و`worker` من `infra/systemd` ثم شغّل `systemctl daemon-reload`.
7. شغّل الخدمتين وافحص `/health` و`/ready`، ولا تعرض `/metrics` دون رمز المراقبة المستقل.

## 4. HTTPS

انسخ إعداد Nginx المجهز لـ`radius.uchiha-builder.com`، أنشئ الشهادة، ثم افحص الإعداد بـ`nginx -t` قبل إعادة التحميل.

## 5. Telegram وGoogle

- أنشئ Web OAuth Client واضبط `GOOGLE_CLIENT_ID`. لتطبيق Android أنشئ Android OAuth Client لكل من `com.uchiha.radius.provider` و`com.uchiha.radius.owner` ولكل شهادة توقيع (debug/release/Play)، مع إبقاء Web Client ID هو الجمهور الذي يتحقق منه الخادم.
- اضبط Telegram webhook على `https://DOMAIN/webhooks/telegram` مع secret header مطابق.
- لا تُدخل Bot Token في تطبيق الهاتف؛ يبقى في خدمة العامل فقط.

## 6. النسخ الاحتياطي

أنشئ `/etc/uchiha-radius/backup.env` بصلاحية `0600` ويحتوي `BACKUP_DATABASE_URL` و`BACKUP_DIRECTORY=/var/backups/uchiha-radius` ومدة الاحتفاظ الاختيارية. انسخ وحدتي `uchiha-radius-backup.service` و`uchiha-radius-backup.timer`، ثم فعّل المؤقت. تُنشأ النسخة بصلاحيات خاصة مع checksum وفحص catalog؛ احفظ نسخة مشفرة خارج الخادم ونفّذ تجربة استعادة دورية في قاعدة مؤقتة غير إنتاجية.

يجب أن يستخدم رابط النسخ دور `uchiha_backup` بعد الترحيل 009، وليس حساب التطبيق المحدود بمستأجر. يمنع السكربت تشغيل نسختين في الوقت نفسه وينشر الملف النهائي بعد فحصه. التحقق من checksum لا يثبت وحده قابلية استعادة البيانات أو اكتمالها.

للتدريب على الاستعادة: أنشئ قاعدة فارغة من `template0`، واضبط `RESTORE_DATABASE_URL` من مدير الأسرار، ثم نفّذ `scripts/restore-postgres.sh /absolute/path/to/backup.dump`. يرفض السكربت قاعدة فيها جداول ويستعيد ضمن معاملة واحدة. بعد الاستعادة أعد صلاحيات التشغيل من `infra/postgres/runtime-grants.sql` بهوية الإدارة المناسبة، وافحص أعداد سجلات كل مستأجر وتجربة الدخول قبل تحويل أي حركة إنتاج. لا تستخدم هذا السكربت لاستبدال قاعدة عاملة. ملف النسخ وحده لا يحتوي مفتاح تشفير التطبيق؛ احتفظ بالمفتاح مستقلًا في مدير الأسرار.

سلوك الاتصال المباشر والاستعادة موثق في [مرجع PostgreSQL](https://www.postgresql.org/docs/16/app-pgrestore.html).

## الصيانة والمراقبة

- `/health` لفحص حياة العملية؛ `/ready` لفحص اتصالات وقاعدة البيانات؛ لا تجعل موازن الحمل يعتمد على `/health` وحده.
- `/metrics` يحتاج رمز مراقبة مستقلًا، وإعداد Nginx يحصر الوصول محليًا افتراضيًا.
- مؤقت `uchiha-radius-maintenance.timer` ينظف سجلات التشغيل القديمة وفق مدد الاحتفاظ في `.env.example`؛ لا يحذف سجل التدقيق المالي. عدّل المدد وفق احتياجات التشغيل قبل التفعيل.
- فعّل مؤقت الفوترة فقط بعد التحقق من خطط المشتركين والأسعار ومواعيد الخدمة في بيئة الاختبار.

## 7. بوابة الإطلاق

نفّذ `npm ci` ثم `npm run release:check`. بعد ربط GitHub يجب أن ينجح Job PostgreSQL، بما فيه إثبات أن `rolbypassrls=false`، وأن ينجح Job Android باستخدام Java 21 وAndroid API 36. لا تُرقِّ الإصدار قبل نجاح تجربة MikroTik/FreeRADIUS والدفع وتوقيع Android في بيئة Staging.

لإنشاء حزم AAB الموقعة، أضف أسرار `ANDROID_KEYSTORE_BASE64` و`ANDROID_KEYSTORE_PASSWORD` و`ANDROID_KEY_ALIAS` و`ANDROID_KEY_PASSWORD` إلى بيئة GitHub المحمية `production`، ثم شغّل workflow ‏`UCHIHA RADIUS Android release` مع رابط API إنتاجي HTTPS ورقم إصدار متزايد.

## 8. وكيل RADIUS وRouterOS

- أصدر مفتاحًا مستقلًا لكل شبكة من تطبيق المالك؛ لا تستخدم `CONNECTOR_SIGNING_SECRET` العام في الإنتاج.
- خزّن المفتاح في `RADIUS_AGENT_SIGNING_SECRET` على مضيف RADIUS فقط.
- استخدم ملف الموجّهات الموضح في `infra/freeradius/routers.example.json` بصلاحية `0600` وشهادة CA موثوقة لـRouterOS API-SSL.
- شغّل اختبار تعليق/تفعيل حساب تجريبي وفصل جلسة تجريبية، ثم تحقق أن المهمة أصبحت `sent` في تطبيق المالك.
- اجعل `RADIUS_AGENT_DB` مسارًا قابلًا للكتابة مثل `/var/lib/uchiha-radius-agent/spool.sqlite` عند استخدام وحدة systemd المرفقة.
