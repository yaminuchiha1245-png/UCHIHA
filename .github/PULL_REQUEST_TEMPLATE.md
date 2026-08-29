# UCHIHA Pull Request

## المشروع

- [ ] UCHIHA Store — `main`
- [ ] UCHIHA Builder — `builder/v1-platform`
- [ ] UCHIHA Debt Store — `debt-store-build`
- [ ] Repository / Infrastructure

## الهدف

اشرح النتيجة المطلوبة من هذا التغيير باختصار.

## ماذا تغيّر؟

- 
- 
- 

## الاختبارات

- [ ] Syntax / compile ناجح.
- [ ] Unit tests المطلوبة ناجحة.
- [ ] Integration/Smoke tests المطلوبة ناجحة أو موضح سبب عدم تشغيلها.
- [ ] تم اختبار الواجهة/الجهاز إذا كان التغيير مرئيًا أو خاصًا بـAndroid.

## حماية البيانات والمال

- [ ] لا توجد أسرار أو `.env` أو مفاتيح حقيقية داخل التغييرات.
- [ ] لا يوجد مسار يستطيع إضافة رصيد أو تنفيذ طلب مرتين.
- [ ] أي تغيير مالي يحافظ على Idempotency والتحقق الخادمي.
- [ ] أي Migration جديدة قابلة للتطبيق بوضوح ولا تحذف بيانات دون خطة صريحة.

## Production / Deployment

- [ ] لا يحتاج نشرًا.
- [ ] يحتاج Staging أولًا.
- [ ] يحتاج Production بعد نجاح بوابات التحقق.

إذا كان هذا PR يخص Builder، اذكر نتيجة `smoke-vps.sh` و`launch-audit.sh` عند الحاجة.

## الرجوع للخلف

اشرح كيف نرجع عن التغيير إذا سبب مشكلة في الإنتاج.
