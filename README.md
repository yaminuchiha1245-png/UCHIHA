# UCHIHA

مستودع المشاريع الرئيسية تحت هوية UCHIHA.

> **مهم:** هذا المستودع يحتوي عدة مشاريع موزعة على فروع مختلفة. فرع `main` ليس كل المستودع، وأسماء الفروع القديمة مثل `final` أو `complete` لا تجعلها مصدر الحقيقة.

## المشاريع الرئيسية

| المشروع | مصدر الحقيقة | الحالة | الوظيفة |
|---|---|---|---|
| **UCHIHA Store** | `main` | متقدم وقريب من الإنتاج | متجر رقمي + Telegram + لوحة إدارة + JS4Card + Binance + Sham Cash |
| **UCHIHA Builder / Platform** | `builder/v1-platform` | Release Candidate يحتاج إغلاق بوابات الإنتاج | منصة SaaS متعددة المستأجرين لإنشاء وإدارة المتاجر والخدمات |
| **UCHIHA Debt Store** | `debt-store-build` | APK Debug يبنى بنجاح؛ يحتاج Release نهائي | تطبيق Android لإدارة ديون المحل والعملاء والدفعات والعملات |

## ابدأ من هنا

- [خريطة المستودع والمشاريع](docs/REPOSITORY_MAP.md)
- [خارطة الطريق الموحدة](docs/ROADMAP.md)
- [سياسة الفروع ومصادر الحقيقة](docs/BRANCH_POLICY.md)
- [توثيق UCHIHA Store](docs/UCHIHA_STORE.md)
- [إعداد Binance](BINANCE_SETUP.md)
- [تقرير اختبارات Store](TEST_REPORT.md)
- [تقرير FABLE5](FABLE5_REPORT.md)

## 1. UCHIHA Store

المشروع الموجود على `main` ويشمل:

- بوت متجر Telegram مبني على aiogram.
- متجر ويب RTL/PWA.
- تسجيل حساب وربط Telegram.
- لوحة إدارة.
- عملاء وأرصدة وطلبات وطلبات شحن.
- JS4Card.
- Binance Pay ID.
- USDT TRC20 / TRON.
- مركز Sham Cash.

للتفاصيل راجع [`docs/UCHIHA_STORE.md`](docs/UCHIHA_STORE.md).

## 2. UCHIHA Builder

المصدر المعتمد له هو الفرع:

```text
builder/v1-platform
```

وهو مشروع مستقل عن UCHIHA Store، ويضم Backend وPostgreSQL وWorkers وMulti-Tenancy ومحفظة وطلبات ومدفوعات و2FA وKYC وPWA/Mobile ولوحة إدارة منصة.

لا يُعتبر الإصدار Production Verified قبل نجاح بوابات CI وSmoke/Audit على البيئة المستهدفة.

## 3. UCHIHA Debt Store

المصدر المعتمد له هو الفرع:

```text
debt-store-build
```

يحتوي تطبيق Android لإدارة:

- العملاء.
- المشتريات والديون.
- الدفعات.
- العملات وأسعار الصرف.
- الحاسبة.
- المؤجل والنواقص.
- السجل والإحصائيات.
- النسخ الاحتياطي والاستعادة.
- PDF/CSV.
- PIN والبصمة.

GitHub Actions يبني APK Debug قابلًا للتثبيت. المرحلة التالية هي الاختبارات على الأجهزة وبناء Signed Release APK/AAB.

## الفروع القديمة

الفروع التي تبدأ مثلًا بـ:

```text
agent/
codex/
copilot/
archive/
backup/
```

ليست مشاريع جديدة بحد ذاتها. راجع [`docs/BRANCH_POLICY.md`](docs/BRANCH_POLICY.md) قبل الاعتماد على أي منها أو حذفه.

## الأولويات الحالية

1. تثبيت UCHIHA Builder وإغلاق بوابات Production.
2. تحويل Debt Store إلى Signed Release مختبر.
3. إجراء التحقق الحي الآمن لـBinance وJS4Card في Store.
4. إكمال Sham Cash Automation بعد توفر API الحركات الرسمي.
5. تنظيف الفروع القديمة بعد المقارنة وعدم فقدان أي Commit مهم.

التفاصيل في [`docs/ROADMAP.md`](docs/ROADMAP.md).

## الأمان

لا تحفظ مفاتيح API، كلمات المرور، ملفات `.env` الحقيقية، مفاتيح التوقيع، Keystore أو أي أسرار إنتاج داخل GitHub.
