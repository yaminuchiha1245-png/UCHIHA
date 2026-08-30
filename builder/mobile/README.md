# UCHIHA Mobile

تطبيق واحد لمالك المشروع على Android وiOS. لا يُنشئ نسخة تطبيق منفصلة لكل متجر؛
المتاجر الموجهة للعملاء تبدأ كتطبيقات PWA، بينما يدير المالك جميع مشاريعه من هذا
التطبيق عبر Backend API وقاعدة PostgreSQL نفسيهما.

## الإنتاج

تطبيق المالك يتصل ببيئة الإنتاج عبر:

`https://uchiha-builder.com`

هذا هو عنوان الإنتاج العام الذي يوجّه إلى خادم UCHIHA على الـVPS مع HTTPS، ولا يعتمد التطبيق على Railway.
يسمح التطبيق أيضًا بالتنقل داخل نطاقات `*.uchiha-builder.com` للخدمات الفرعية التابعة لنفس المنصة.

## البناء

```bash
npm install
npm run sync
npm run apk:debug
npm run apk:release
```

يتطلب Android SDK وJava وفق متطلبات إصدار Capacitor المثبت. ينتج ملف Debug عادة في:

`android/app/build/outputs/apk/debug/app-debug.apk`

نسخ Release الخاصة بالتوزيع يجب أن تُوقّع بمفتاح UCHIHA Release نفسه في كل تحديث حتى تبقى قابلة للترقية فوق النسخ السابقة.

أما iOS فيتطلب macOS وXcode وحساب Apple Developer وشهادات Signing، ثم:

```bash
npm run open:ios
```

قبل التوزيع على المتاجر يجب استكمال خصائص Native مثل Push Notifications ورفع الإثبات بالكاميرا وBiometrics بحسب خطة التطبيق.

جميع الأيقونات وشاشات البدء مولّدة من هوية UCHIHA الأصلية الموجودة في
`assets/logo.svg`، ولا تتضمن أي شعار أو شخصية محمية.
