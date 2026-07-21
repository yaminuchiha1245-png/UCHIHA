# إعداد Binance التلقائي في UCHIHA

أضف المتغيرات التالية داخل **Railway → UCHIHA → Variables**:

```env
BINANCE_AUTO_PAY_ENABLED=1
BINANCE_API_KEY=ضع_المفتاح_هنا
BINANCE_API_SECRET=ضع_السر_هنا
BINANCE_COIN=USDT
BINANCE_NETWORK=TRX
BINANCE_MIN_AMOUNT=5
BINANCE_MAX_AMOUNT=1000
BINANCE_POLL_SECONDS=60
BINANCE_PAYMENT_WINDOW_MINUTES=120
```

يدعم النظام أيضًا اسم التفعيل القديم:

```env
BINANCE_PAYMENT_ENABLED=1
```

## صلاحيات المفتاح

استخدم مفتاحًا مخصصًا للمتجر وبصلاحية قراءة المحفظة فقط. لا تفعّل التداول ولا السحب. فعّل تقييد عنوان IP إذا كان عنوان خادمك ثابتًا.

## الاختبار بعد النشر

1. افتح البوت بحساب الأدمن.
2. افتح **لوحة الإدارة → مركز Binance**.
3. اضغط **اختبار الاتصال**.
4. يجب أن تظهر رسالة نجاح وعنوان الإيداع وعدد إيداعات آخر 24 ساعة.
5. اضغط **مزامنة الآن** للتأكد من أن الفحص اليدوي يعمل.
6. نفّذ اختبارًا بمبلغ صغير قبل اعتماد النظام تجاريًا.

لا تضع مفاتيح Binance داخل GitHub أو هذا الملف.
