# إعداد Binance التلقائي في UCHIHA عبر شبكة TRON

أضف المتغيرات التالية داخل **Railway → UCHIHA → Variables**:

```env
BINANCE_AUTO_PAY_ENABLED=1
BINANCE_COIN=USDT
BINANCE_NETWORK=TRX
BINANCE_VERIFICATION_MODE=reference
BINANCE_VERIFICATION_PROVIDER=trongrid
BINANCE_DEPOSIT_ADDRESS=ضع_عنوان_إيداع_USDT_TRC20_الذي_يبدأ_T
TRONGRID_API_KEY=ضع_مفتاح_TronGrid_هنا
BINANCE_MIN_AMOUNT=1
BINANCE_MAX_AMOUNT=1000
BINANCE_POLL_SECONDS=60
BINANCE_PAYMENT_WINDOW_MINUTES=120
```

يدعم النظام أيضًا اسم التفعيل القديم:

```env
BINANCE_PAYMENT_ENABLED=1
```

## الحصول على القيم

1. من Binance افتح **إيداع → USDT → شبكة TRON (TRC20)** وانسخ عنوان الإيداع
   العام الذي يبدأ بالحرف `T`. ضعه في `BINANCE_DEPOSIT_ADDRESS`.
2. أنشئ حسابًا في [TronGrid](https://www.trongrid.io/) ثم أنشئ API Key من لوحة
   التحكم وضع قيمته في `TRONGRID_API_KEY`.
3. لا تضع مفتاح المحفظة الخاص أو عبارة الاسترداد مطلقًا. TronGrid هنا للقراءة فقط.

لا يحتاج هذا الوضع إلى `BINANCE_API_KEY` أو `BINANCE_API_SECRET`، لذلك لا يتأثر
بحظر Binance API الجغرافي على خادم Railway.

## طريقة اعتماد الدفعة

يعرض البوت المبلغ نفسه الذي اختاره العميل دون زيادة. بعد نجاح التحويل يرسل العميل
`TXID / Hash` من تفاصيل العملية، ثم يقرأ البوت المعاملة المثبتة على شبكة TRON ويتحقق من:

- نجاح المعاملة وتثبيتها على الشبكة.
- أن التحويل صادر عن عقد USDT الرسمي على TRON.
- المبلغ والعملة والشبكة والعنوان.
- وقوع العملية ضمن مهلة الطلب.
- عدم استخدام المعرف في أي طلب سابق.

رقم طلب السحب الداخلي لا يكفي؛ المطلوب هو `TXID / Transaction Hash` المؤلف من
64 خانة سداسية والقابل للعرض على مستكشف TRON.

## الاختبار بعد النشر

1. افتح البوت بحساب الأدمن.
2. افتح **لوحة الإدارة → مركز Binance**.
3. اضغط **فحص الربط**.
4. يجب أن تظهر رسالة نجاح وعنوان الإيداع ورقم آخر كتلة TRON.
5. اضغط **مزامنة الآن** للتأكد من أن الفحص اليدوي يعمل.
6. نفّذ اختبارًا بمبلغ صغير قبل اعتماد النظام تجاريًا.

لا تضع `TRONGRID_API_KEY` أو أي مفاتيح حساسة داخل GitHub أو هذا الملف.
