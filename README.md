# UCHIHA

منصة متجر رقمية متكاملة تشمل:

- بوت متجر Telegram مبني على aiogram.
- بوت إدارة المنصة والمستأجرين.
- واجهة متجر ويب مرتبطة بكتالوج البوت.
- تكامل JS4Card للمنتجات الآلية.
- دفع Binance USDT تلقائي مع مركز عمليات داخل لوحة الإدارة.

## Binance

أضيف مركز Binance داخل لوحة الأدمن لإدارة الدفع التلقائي، ويشمل:

- اختبار الاتصال والتوقيع وصلاحية قراءة المحفظة.
- مزامنة فورية للدفعات المنتظرة.
- سجل الدفعات والأخطاء.
- تشغيل وإيقاف استقبال دفعات Binance من لوحة الإدارة.
- دعم متغير Railway القديم `BINANCE_PAYMENT_ENABLED`.
- توحيد أسماء الشبكات مثل `TRC20` إلى `TRX`.
- منع إضافة الرصيد مرتين أو اعتماد نفس `TXID` لأكثر من طلب.

راجع [`BINANCE_SETUP.md`](BINANCE_SETUP.md) لإعداد متغيرات Railway بأمان.

## التشغيل

```bash
pip install -r requirements.txt
python storefront_launcher.py
```

## الاختبارات

```bash
python -m unittest tests/test_binance_compat.py
python tests/binance_integration_smoke.py
python -m compileall -q .
```

لا تضع مفاتيح API أو ملفات `.env` الحقيقية داخل GitHub.
