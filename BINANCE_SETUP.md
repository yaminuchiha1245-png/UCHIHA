# إعداد Binance Pay ID وUSDT-TRC20 في UCHIHA

يُنشئ هذا الإعداد طريقتين منفصلتين داخل خيارات الدفع:

1. **Binance Pay ID (USDT):** يرسل العميل `Transaction ID`.
2. **USDT TRC20 (TRON):** يرسل العميل `TXID / Hash` بطول 64 خانة.

أضف المتغيرات التالية داخل **Railway → UCHIHA → Variables**:

```env
BINANCE_AUTO_PAY_ENABLED=1
BINANCE_VERIFICATION_PROVIDER=dual
BINANCE_VERIFICATION_MODE=reference
BINANCE_COIN=USDT
BINANCE_PAY_ID=ضع_رقم_Pay_ID_العام_هنا
BINANCE_API_KEY=ضع_مفتاح_Binance_للقراءة_فقط
BINANCE_API_SECRET=ضع_سر_مفتاح_Binance
BINANCE_API_BASE_URL=https://api.binance.com
BINANCE_NETWORK=TRX
BINANCE_DEPOSIT_ADDRESS=ضع_عنوان_USDT_TRC20_الذي_يبدأ_T
TRONGRID_API_KEY=ضع_مفتاح_TronGrid_هنا
TRONGRID_API_BASE_URL=https://api.trongrid.io
TRON_USDT_CONTRACT=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
BINANCE_MIN_AMOUNT=1
BINANCE_MAX_AMOUNT=1000
BINANCE_PAYMENT_WINDOW_MINUTES=120
BINANCE_POLL_SECONDS=60
BINANCE_RECV_WINDOW=5000
BINANCE_START_DELAY_SECONDS=10
```

لا تكتب عبارات المثال حرفيًا في الحقول الشخصية. استبدل فقط قيم:

- `BINANCE_PAY_ID`: رقم Pay ID العام من حسابك.
- `BINANCE_API_KEY` و`BINANCE_API_SECRET`: مفتاح مخصص للقراءة فقط.
- `BINANCE_DEPOSIT_ADDRESS`: عنوان إيداع USDT بعد اختيار شبكة TRON (TRC20) في Binance.
- `TRONGRID_API_KEY`: مفتاح قراءة من TronGrid.

## الأمان والتحقق

- لا تفعّل التداول أو السحب في مفتاح Binance مطلقًا.
- لا يُعتمد رقم يرسله العميل وحده؛ يجب أن يطابق حركة حقيقية والمبلغ نفسه والعملة والوقت.
- يتحقق مسار TRC20 من الشبكة العامة وعقد USDT الرسمي والعنوان وحالة تثبيت المعاملة.
- إذا حجبت Binance API خادم Railway، يبقى Pay ID ظاهرًا لكن طلبه ينتقل للمراجعة اليدوية من دون إضافة الرصيد. لا يؤثر ذلك في التحقق الآلي لمسار TRC20.
- يُمنع استخدام `Transaction ID` أو `TXID` نفسه أكثر من مرة.

## بعد حفظ المتغيرات

1. انتظر اكتمال إعادة النشر في Railway.
2. افتح **لوحة الإدارة → مركز Binance → فحص الربط**.
3. يجب أن ترى Pay ID وعنوان TRC20 وآخر كتلة TRON.
4. افتح الدفع كعميل وتأكد من ظهور الطريقتين منفصلتين.
5. نفّذ اختبارًا حقيقيًا صغيرًا لكل طريقة قبل فتحها تجاريًا.

لا تضع المفاتيح في GitHub أو في رسائل تيليجرام.
