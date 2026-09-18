# عقد ربط بوابة الدفع

يدعم UCHIHA RADIUS وضعين من دون تغيير الواجهة:

1. إذا تُرك `BILLING_CHECKOUT_ENDPOINT` و`BILLING_CHECKOUT_TOKEN` فارغين، يُحفظ طلب الاشتراك للمراجعة اليدوية من تطبيق المالك ولا تُنشأ مهمة فاشلة.
2. عند ضبط القيمتين، يرسل العامل طلب إنشاء Checkout إلى خدمة الدفع، ثم يظهر الرابط الآمن للمزود ويفتح بعد موافقته.

عند تفعيل الربط، اضبط `BILLING_CHECKOUT_ALLOWED_HOSTS` بقائمة أسماء مضيفين مفصولة بفواصل، مثل `pay.provider.example,checkout.provider.example`. يرفض الخادم أي رابط دفع خارج هذه القائمة أو يحتوي بيانات دخول داخل الرابط.

## طلب إنشاء Checkout

يرسل العامل `POST` إلى `BILLING_CHECKOUT_ENDPOINT` مع:

- `Authorization: Bearer <BILLING_CHECKOUT_TOKEN>`
- `X-Idempotency-Key: <job-id>`
- جسم JSON يحوي `subscriptionId` و`tenantId` و`customerEmail` وبيانات المنتج والمبلغ والعملة، إضافة إلى `successUrl` و`cancelUrl` و`webhookUrl`.

على المحول إعادة استجابة JSON ناجحة بالشكل الآتي:

```json
{
  "provider": "provider-code",
  "externalId": "checkout-or-subscription-id",
  "checkoutUrl": "https://secure-payment.example/session/id",
  "expiresAt": "2026-09-09T20:00:00.000Z"
}
```

`checkoutUrl` يجب أن يستخدم HTTPS. يجب على خدمة المحول احترام `X-Idempotency-Key` حتى لا تنشئ دفعتين عند إعادة المحاولة.

## Webhook تحديث الاشتراك

يرسل المحول إلى `/webhooks/billing` جسم الحدث الخام، مع:

- `X-UCHIHA-Timestamp`: Unix time بالثواني.
- `X-UCHIHA-Signature`: ‏HMAC-SHA256 بالنظام `timestamp.rawBody` باستخدام `BILLING_WEBHOOK_SECRET`.

المسار يقبل حدث `subscription.updated` ويمنع تكرار `id` نفسه. لا تُعد البوابة جاهزة للإنتاج قبل اختبار النجاح والفشل والإلغاء والاسترداد في بيئة Staging لدى المزود المختار.
