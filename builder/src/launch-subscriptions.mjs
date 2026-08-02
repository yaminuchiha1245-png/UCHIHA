import { randomUUID } from "node:crypto";
import { sha256 } from "./security.mjs";
import {
  LaunchSalesError,
  UUID_PATTERN,
  authenticateLaunchUser,
  jsonValue,
  offerDto,
  optionalText,
  requestDto,
  requiredText,
  requireLaunchCsrf,
  subscriptionDto
} from "./launch-sales-common.mjs";

export function installLaunchSubscriptionRoutes(app, { db }) {
  app.get("/api/subscription-status", async (request) => {
    const user = await authenticateLaunchUser(db, request);
    const [subscriptionResult, requestResult, offerResult] = await Promise.all([
      db.query(
        `SELECT s.*, o.name AS offer_name, o.currency, o.price_minor
         FROM subscriptions s
         JOIN subscription_offers o ON o.id=s.offer_id
         WHERE s.user_id=$1 AND s.tenant_id IS NULL
           AND s.status IN ('trial','active') AND s.ends_at>NOW()
         ORDER BY s.created_at DESC LIMIT 1`,
        [user.id]
      ),
      db.query(
        `SELECT id, user_id, customer_name, customer_email, status, details,
                metadata, created_at, updated_at
         FROM service_requests
         WHERE user_id=$1 AND source_page='/create-store'
         ORDER BY created_at DESC LIMIT 50`,
        [user.id]
      ),
      db.query(
        `SELECT * FROM subscription_offers
         WHERE sale_enabled=TRUE ORDER BY updated_at DESC, created_at DESC LIMIT 1`
      )
    ]);
    return {
      subscription: subscriptionDto(subscriptionResult.rows[0]),
      request: requestDto(
        requestResult.rows.find((row) => jsonValue(row.metadata, {}).requestType === "subscription_activation")
      ),
      offer: offerDto(offerResult.rows[0])
    };
  });

  app.post("/api/subscription-requests", async (request, reply) => {
    const user = await authenticateLaunchUser(db, request);
    requireLaunchCsrf(request, user);
    const idempotencyKey = requiredText(
      request.headers["idempotency-key"],
      "Idempotency-Key",
      160
    );
    const body = request.body || {};
    const paymentMethodId = requiredText(body.paymentMethodId, "طريقة الدفع", 80);
    if (!UUID_PATTERN.test(paymentMethodId)) {
      throw new LaunchSalesError(422, "invalid_payment_method", "طريقة الدفع غير صالحة");
    }
    const reference = requiredText(body.reference, "رقم العملية أو مرجع التحويل", 240);
    const note = optionalText(body.note, 1200);

    const [offerResult, methodResult, serviceResult, activeResult, openResult, referenceResult] = await Promise.all([
      db.query(
        `SELECT * FROM subscription_offers
         WHERE sale_enabled=TRUE AND price_minor>0
         ORDER BY updated_at DESC, created_at DESC LIMIT 1`
      ),
      db.query(
        `SELECT id, method_key, name_ar, name_en, currency, network,
                account_identifier, qr_data, qr_image_url
         FROM platform_payment_methods
         WHERE id=$1 AND tenant_id IS NULL AND store_id IS NULL AND status='active'`,
        [paymentMethodId]
      ),
      db.query(
        `SELECT id FROM platform_services
         WHERE service_key='ecommerce-store' AND tenant_id IS NULL AND store_id IS NULL
           AND status='active' LIMIT 1`
      ),
      db.query(
        `SELECT id FROM subscriptions
         WHERE user_id=$1 AND tenant_id IS NULL
           AND status IN ('trial','active') AND ends_at>NOW()
         LIMIT 1`,
        [user.id]
      ),
      db.query(
        `SELECT id, user_id, customer_name, customer_email, status, details,
                metadata, created_at, updated_at
         FROM service_requests
         WHERE user_id=$1 AND source_page='/create-store'
           AND status NOT IN ('completed','cancelled','rejected')
         ORDER BY created_at DESC LIMIT 50`,
        [user.id]
      ),
      db.query(
        `SELECT id, user_id, status, metadata
         FROM service_requests
         WHERE source_page='/create-store' AND status NOT IN ('cancelled','rejected')
         ORDER BY created_at DESC LIMIT 1000`
      )
    ]);

    if (activeResult.rows[0]) return { subscriptionActive: true, request: null };
    const openActivationRequest = openResult.rows.find(
      (row) => jsonValue(row.metadata, {}).requestType === "subscription_activation"
    );
    if (openActivationRequest) {
      return {
        subscriptionActive: false,
        duplicate: true,
        request: requestDto(openActivationRequest)
      };
    }

    const reusedReference = referenceResult.rows.find((row) => {
      const metadata = jsonValue(row.metadata, {});
      return metadata.requestType === "subscription_activation"
        && String(metadata.paymentMethodId || "") === paymentMethodId
        && String(metadata.paymentReference || "").trim().toLowerCase() === reference.toLowerCase();
    });
    if (reusedReference) {
      throw new LaunchSalesError(
        409,
        "payment_reference_used",
        "مرجع التحويل مستخدم في طلب سابق. تواصل مع الدعم إذا كان ذلك غير صحيح"
      );
    }

    const offer = offerResult.rows[0];
    const method = methodResult.rows[0];
    const service = serviceResult.rows[0];
    if (!offer) {
      throw new LaunchSalesError(409, "offer_unavailable", "اشتراك UCHIHA Full غير متاح حاليًا");
    }
    if (!method || !(method.account_identifier || method.qr_data || method.qr_image_url)) {
      throw new LaunchSalesError(
        422,
        "payment_method_unavailable",
        "طريقة الدفع غير مهيأة للاستقبال"
      );
    }
    if (!service) {
      throw new LaunchSalesError(500, "service_unavailable", "خدمة إنشاء المتجر غير مهيأة");
    }

    const normalized = { userId: user.id, offerId: offer.id, paymentMethodId, reference, note };
    const requestHash = sha256(JSON.stringify(normalized));
    const previous = await db.query(
      `SELECT id, user_id, customer_name, customer_email, status, details,
              metadata, request_hash, created_at, updated_at
       FROM service_requests WHERE idempotency_key=$1`,
      [idempotencyKey]
    );
    if (previous.rows[0]) {
      if (previous.rows[0].request_hash !== requestHash) {
        throw new LaunchSalesError(
          409,
          "idempotency_conflict",
          "استخدم مفتاح طلب جديدًا لهذه البيانات"
        );
      }
      return {
        subscriptionActive: false,
        duplicate: true,
        request: requestDto(previous.rows[0])
      };
    }

    const id = randomUUID();
    const metadata = {
      requestType: "subscription_activation",
      offerId: offer.id,
      offerName: offer.name,
      amountMinor: Number(offer.price_minor),
      currency: offer.currency,
      paymentMethodId: method.id,
      paymentMethodKey: method.method_key,
      paymentMethodName: method.name_ar || method.name_en,
      paymentNetwork: method.network || null,
      paymentReference: reference
    };
    const details = [
      `طلب تفعيل اشتراك ${offer.name}`,
      `طريقة الدفع: ${method.name_ar || method.name_en}`,
      method.network ? `الشبكة: ${method.network}` : "",
      `مرجع التحويل: ${reference}`,
      note ? `ملاحظة العميل: ${note}` : ""
    ].filter(Boolean).join("\n");

    await db.query(
      `INSERT INTO service_requests (
         id, service_id, user_id, customer_name, customer_email, customer_phone,
         customer_internal_id, locale, details, source_page, idempotency_key,
         request_hash, metadata, created_by
       ) VALUES ($1,$2,$3,$4,$5,NULL,$3,'ar',$6,'/create-store',$7,$8,$9,$3)`,
      [
        id,
        service.id,
        user.id,
        user.display_name,
        user.email,
        details,
        idempotencyKey,
        requestHash,
        JSON.stringify(metadata)
      ]
    );
    reply.code(201);
    return {
      subscriptionActive: false,
      request: requestDto({
        id,
        user_id: user.id,
        customer_name: user.display_name,
        customer_email: user.email,
        status: "new",
        details,
        metadata,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    };
  });
}
