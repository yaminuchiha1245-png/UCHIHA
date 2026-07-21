# UCHIHA STORE

متجر تيليجرام ومنصة إدارة عربية مع واجهة متجر عامة، تكامل JS4Card، ودفعات Binance USDT تلقائية.

## تشغيل المشروع

```bash
pip install -r requirements.txt
python storefront_launcher.py
```

على Railway يتم التشغيل تلقائيًا من خلال `railway.json`.

## مركز Binance

النسخة تتضمن مركزًا مستقلًا داخل:

**لوحة الإدارة → مركز Binance**

ويحتوي على:

- اختبار اتصال فعلي مع Binance Wallet API.
- مزامنة فورية للدفعات.
- متابعة الدفعات المنتظرة والمؤكدة.
- سجل أخطاء وتشخيص بدون كشف المفاتيح.
- إيقاف وتشغيل استقبال الدفعات من لوحة الأدمن.
- حماية من اعتماد العملية نفسها أو إضافة الرصيد مرتين.

راجع [BINANCE_SETUP.md](BINANCE_SETUP.md) لإعداد متغيرات Railway.

## اختبارات Binance

```bash
python -m unittest tests/test_binance_compat.py
python tests/binance_integration_smoke.py
python uchiha.py --check-code
```

اختبار التكامل يحاكي إيداع Binance مؤكدًا ويتحقق من إضافة الرصيد مرة واحدة فقط.

## الأمان

لا ترفع `.env` أو مفاتيح API أو قواعد البيانات إلى GitHub. استخدم Railway Variables للأسرار.
