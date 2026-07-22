# Uchiha Store

منصة متجر رقمية عربية متكاملة، مهيأة للجوال وPWA، وتشمل:

- بوت متجر Telegram مبني على aiogram.
- بوت إدارة المنصة والمستأجرين.
- واجهة عميل داكنة RTL بتسجيل دخول وإنشاء حساب.
- واجهة متجر ويب تقرأ المنتجات الحقيقية فقط من قاعدة JS4Card المشتركة.
- تنفيذ طلبات JS4Card مباشرة من الخادم مع منع الخصم أو الطلب المكرر.
- رصيد وطلبات موحدة بين الموقع وبوت Uchiha.
- ربط تلقائي آمن مع البوت عبر رابط Telegram لمرة واحدة وصلاحية 10 دقائق.
- لوحة إدارة خاصة لصاحب المتجر على `/admin`.
- تحكم كامل بصور السلايدر والأقسام وترتيبها وبيانات الدعم والألوان.
- إدارة العملاء والأرصدة والطلبات وطلبات الشحن وطرق الدفع.
- دفع Binance USDT-TRC20 تلقائي بتحقق مباشر من شبكة TRON ومركز عمليات داخل لوحة الإدارة.
- مركز Sham Cash مستقل ومجهز لاختبار API Token مستقبلًا بأمان.

## صفحات المتجر

- `/` أو `/shop`: تطبيق العميل.
- `/admin`: لوحة صاحب المتجر.
- `/v1/storefront/health`: فحص جاهزية Railway.

تظهر واجهة تسجيل الدخول أو إنشاء الحساب أولًا. بعد الدخول تُحمّل الأقسام والمنتجات الحقيقية من قاعدة المتجر؛ لا توجد منتجات تجريبية داخل الواجهة.

## متغيرات واجهة المتجر

أضف القيم الحساسة في Railway فقط، ولا تضعها داخل GitHub:

```dotenv
STOREFRONT_SESSION_SECRET=قيمة-عشوائية-طويلة-جدا
STOREFRONT_ADMIN_USERNAME=admin
STOREFRONT_ADMIN_PASSWORD=كلمة-مرور-قوية-خاصة-بالمالك
STOREFRONT_TELEGRAM_URL=https://t.me/UchihaStoreBot
STOREFRONT_COOKIE_SECURE=1
```

يبقى `API_TOKEN` سرًا داخل Railway، وجميع طلبات JS4Card تمر من الخادم ولا يصل الرمز إلى المتصفح.

## Binance

أضيف مركز Binance داخل لوحة الأدمن لإدارة الدفع التلقائي، ويشمل:

- اختبار اتصال TronGrid وقراءة شبكة TRON دون الاعتماد على Binance API.
- مزامنة فورية للدفعات المنتظرة.
- سجل الدفعات والأخطاء.
- تشغيل وإيقاف استقبال دفعات Binance من لوحة الإدارة.
- دعم متغير Railway القديم `BINANCE_PAYMENT_ENABLED`.
- توحيد أسماء الشبكات مثل `TRC20` إلى `TRX`.
- تحويل المبلغ الذي اختاره العميل نفسه من دون كسور تعريفية.
- التحقق من `TXID / Hash` الذي يرسله العميل على شبكة TRON المثبتة.
- فحص عقد USDT الرسمي والمبلغ والشبكة والعنوان ووقت العملية قبل الاعتماد.
- منع إضافة الرصيد مرتين أو اعتماد نفس `TXID` لأكثر من طلب.

راجع [`BINANCE_SETUP.md`](BINANCE_SETUP.md) لإعداد متغيرات Railway بأمان.

## Sham Cash

يظهر **مركز Sham Cash** داخل لوحة إدارة البوت حتى قبل إضافة التوكن. المركز يعرض جاهزية الربط، طرق الدفع والطلبات المرتبطة، ويختبر التوكن مستقبلًا من الخادم فقط.

ضع القيم التي تمنحك إياها جهة Sham Cash داخل Railway Variables:

```dotenv
SHAMCASH_API_ENABLED=1
SHAMCASH_API_TOKEN=
SHAMCASH_API_BASE_URL=
SHAMCASH_ACCOUNT_ID=
```

لا يعتمد النظام أي دفعة Sham Cash تلقائيًا قبل مطابقة توثيق الحركات الرسمي وإجراء اختبار فعلي؛ إلى ذلك الحين تبقى طريقة شام كاش اليدوية الحالية آمنة وقابلة للإدارة.

## التشغيل

```bash
pip install -r requirements.txt
python storefront_launcher.py
```

## الاختبارات

```bash
python -m unittest tests/test_binance_compat.py
python -m unittest tests/test_storefront_core.py
python -m unittest tests/test_shamcash_admin.py
python tests/binance_integration_smoke.py
python -m compileall -q .
```

لا تضع مفاتيح API أو ملفات `.env` الحقيقية داخل GitHub.
