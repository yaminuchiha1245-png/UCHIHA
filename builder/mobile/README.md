# UCHIHA Mobile

تطبيق واحد لمالك المشروع على Android وiOS. لا يُنشئ نسخة تطبيق منفصلة لكل متجر؛
المتاجر الموجهة للعملاء تبدأ كتطبيقات PWA، بينما يدير المالك جميع مشاريعه من هذا
التطبيق عبر Backend API وقاعدة PostgreSQL نفسيهما.

## البناء

```bash
npm install
npm run sync
npm run apk:debug
```

يتطلب Android SDK وJava وفق متطلبات إصدار Capacitor المثبت. ينتج ملف Debug عادة في:

`android/app/build/outputs/apk/debug/app-debug.apk`

كما تبني GitHub Actions نسخة Debug قابلة للتثبيت بعد كل رفع على فرع
`builder/**` وتحفظها 14 يومًا باسم `uchiha-owner-android-debug`. هذه النسخة
للاختبار الداخلي، أما نسخة Google Play فتحتاج مفتاح توقيع Release سريًا.

أما iOS فيتطلب macOS وXcode وحساب Apple Developer وشهادات Signing، ثم:

```bash
npm run open:ios
```

ملف `capacitor.config.json` يستخدم رابط Railway الحالي كتطبيق مالك تجريبي. قبل
التوزيع على المتاجر يجب نقل مصادقة التطبيق إلى Tokens أصلية وإضافة خصائص Native
مثل Push Notifications ورفع الإثبات بالكاميرا وBiometrics؛ هذا يمنع أن يكون إصدار
iOS مجرد غلاف لموقع.

جميع الأيقونات وشاشات البدء مولّدة من هوية UCHIHA الأصلية الموجودة في
`assets/logo.svg`، ولا تتضمن أي شعار أو شخصية محمية.
