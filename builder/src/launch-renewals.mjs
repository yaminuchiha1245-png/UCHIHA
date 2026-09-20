import { randomUUID } from "node:crypto";
import { sha256 } from "./security.mjs";
import {
  LaunchSalesError,
  TERMINAL_REQUEST_STATUSES,
  UUID_PATTERN,
  authenticateLaunchUser,
  durationEnd,
  jsonValue,
  optionalText,
  requestDto,
  requiredText,
  requireLaunchAdmin,
  requireLaunchCsrf,
  writeLaunchAudit
} from "./launch-sales-common.mjs";

function isRenewalRequest(row) {
  return jsonValue(row?.metadata, {}).requestType === "subscription_renewal";
}

function renewalDto(row) {
  if (!row) return null;
  return {
    subscriptionId: row.id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name || null,
    tenantStatus: row.tenant_status || null,
    storeId: row.store_id || null,
    storeName: row.store_name || null,
    storeSlug: row.store_slug || null,
    storeStatus: row.store_status || null,
    status: row.status,
    offerId: row.offer_id,
    offerName: row.offer_name || null,
    renewalEnabled: Boolean(row.renewal_enabled),
    renewalPriceMinor: Number(row.renewal_price_minor || 0),
    currency: row.currency,
    durationUnit: row.duration_unit,
    durationCount: Number(row.duration_count || 0),
    startsAt: row.starts_at,
    endsAt: row.ends_at
  };
}

async function ownedRenewal(db, userId, tenantId) {
  return (
    await db.query(
      `SELECT s.*, o.name AS offer_name, o.currency, o.renewal_price_minor,
              o.duration_unit, o.duration_count, o.renewal_enabled,
              t.name AS tenant_name, t.status AS tenant_status,
              st.id AS store_id, st.name AS store_name, st.slug AS store_slug,
              st.status AS store_status
       FROM subscriptions s
       JOIN subscription_offers o ON o.id=s.offer_id
       JOIN tenants t ON t.id=s.tenant_id
       JOIN stores st ON st.tenant_id=s.tenant_id
       WHERE s.user_id=$1 AND s.tenant_id=$2
         AND s.status IN ('trial','active','past_due','expired')
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [userId, tenantId]
    )
  ).rows[0];
}

export function installLaunchRenewalRoutes(app, { db }) {
  app.get("/api/subscription-renewals", async (request) => {
    const user = await authenticateLaunchUser(db, request);
    const [subscriptions, requests] = await Promise.all([
      db.query(
        `SELECT s.*, o.name AS offer_name, o.currency, o.renewal_price_minor,
                o.duration_unit, o.duration_count, o.renewal_enabled,
                t.name AS tenant_name, t.status AS tenant_status,
                st.id AS store_id, st.name AS store_name, st.slug AS store_slug,
                st.status AS store_status
         FROM subscriptions s
         JOIN subscription_offers o ON o.id=s.offer_id
         JOIN tenants t ON t.id=s.tenant_id
         JOIN stores st ON st.tenant_id=s.tenant_id
         WHERE s.user_id=$1 AND s.tenant_id IS NOT NULL
           AND s.status IN ('trial','active','past_due','expired')
         ORDER BY s.ends_at ASC`,
        [user.id]
      ),
      db.query(
        `SELECT id, user_id, customer_name, customer_email, status, details,
                metadata, created_at, updated_at
         FROM service_requests
         WHERE user_id=$1 AND source_page='/account'
         ORDER BY created_at DESC LIMIT 100`,
        [user.id]
      )
    ]);
    return {
      subscriptions: subscriptions.rows.map(renewalDto),
      requests: requests.rows.filter(isRenewalRequest).map(requestDto)
    };
  });

  app.post("/api/subscription-renewals/:tenantId/requests", async (request, reply) => {
    const user = await authenticateLaunchUser(db, request);
    requireLaunchCsrf(request, user);
    const tenantId = requiredText(request.params.tenantId, "المتجر", 80);
    if (!UUID_PATTERN.test(tenantId)) {
      throw new LaunchSalesError(422, "invalid_tenant", "المتجر غير صالح");
    }
    const idempotencyKey = requiredText(request.headers["idempotency-key"], "Idempotency-Key", 160);
    const body = request.body || {};
    const paymentMethodId = requiredText(body.paymentMethodId, "طريقة الدفع", 80);
    if (!UUID_PATTERN.test(paymentMethodId)) {
      throw new LaunchSalesError(422, "invalid_payment_method", "طريقة الدفع غير صالحة");
    }
    const reference = requiredText(body.reference, "رقم العملية أو مرجع التحويل", 240);
    const note = optionalText(body.note, 1200);

    const [subscription, methodResult, serviceResult, openResult, referenceResult] = await Promise.all([
      ownedRenewal(db, user.id, tenantId),
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
        `SELECT id, user_id, customer_name, customer_email, status, details,
                metadata, created_at, updated_at
         FROM service_requests
         WHERE user_id=$1 AND source_page='/account'
           AND status NOT IN ('completed','cancelled','rejected')
         ORDER BY created_at DESC LIMIT 100`,
        [user.id]
      ),
      db.query(
        `SELECT id, user_id, status, metadata
         FROM service_requests
         WHERE status NOT IN ('cancelled','rejected')
         ORDER BY created_at DESC LIMIT 2000`
      )
    ]);

    if (!subscription) {
      throw new LaunchSalesError(404, "subscription_not_found", "اشتراك المتجر غير موجود");
    }
    if (!subscription.renewal_enabled) {
      throw new LaunchSalesError(409, "renewal_disabled", "تجديد هذا الاشتراك غير متاح حاليًا");
    }
    if (Number(subscription.renewal_price_minor || 0) <= 0) {
      throw new LaunchSalesError(409, "renewal_price_unavailable", "سعر التجديد غير مهيأ");
    }

    const method = methodResult.rows[0];
    const service = serviceResult.rows[0];
    if (!method || !(method.account_identifier || method.qr_data || method.qr_image_url)) {
      throw new LaunchSalesError(422, "payment_method_unavailable", "طريقة الدفع غير مهيأة للاستقبال");
    }
    if (!service) {
      throw new LaunchSalesError(500, "service_unavailable", "خدمة المتجر غير مهيأة");
    }

    const openRenewal = openResult.rows.find((row) => {
      const metadata = jsonValue(row.metadata, {});
      return metadata.requestType === "subscription_renewal" && metadata.tenantId === tenantId;
    });
    if (openRenewal) {
      return { duplicate: true, request: requestDto(openRenewal), subscription: renewalDto(subscription) };
    }

    const reusedReference = referenceResult.rows.find((row) => {
      const metadata = jsonValue(row.metadata, {});
      return String(metadata.paymentMethodId || "") === paymentMethodId
        && String(metadata.paymentReference || "").trim().toLowerCase() === reference.toLowerCase();
    });
    if (reusedReference) {
      throw new LaunchSalesError(
        409,
        "payment_reference_used",
        "مرجع التحويل مستخدم في طلب سابق. تواصل مع الدعم إذا كان ذلك غير صحيح"
      );
    }

    const normalized = {
      userId: user.id,
      tenantId,
      subscriptionId: subscription.id,
      paymentMethodId,
      reference,
      note
    };
    const requestHash = sha256(JSON.stringify(normalized));
    const previous = await db.query(
      `SELECT id, user_id, customer_name, customer_email, status, details,
              metadata, request_hash, created_at, updated_at
       FROM service_requests WHERE idempotency_key=$1`,
      [idempotencyKey]
    );
    if (previous.rows[0]) {
      if (previous.rows[0].request_hash !== requestHash) {
        throw new LaunchSalesError(409, "idempotency_conflict", "استخدم مفتاح طلب جديدًا لهذه البيانات");
      }
      return { duplicate: true, request: requestDto(previous.rows[0]), subscription: renewalDto(subscription) };
    }

    const id = randomUUID();
    const metadata = {
      requestType: "subscription_renewal",
      tenantId,
      storeId: subscription.store_id,
      storeName: subscription.store_name,
      subscriptionId: subscription.id,
      offerId: subscription.offer_id,
      offerName: subscription.offer_name,
      amountMinor: Number(subscription.renewal_price_minor),
      currency: subscription.currency,
      paymentMethodId: method.id,
      paymentMethodKey: method.method_key,
      paymentMethodName: method.name_ar || method.name_en,
      paymentNetwork: method.network || null,
      paymentReference: reference
    };
    const details = [
      `طلب تجديد اشتراك ${subscription.store_name || subscription.tenant_name}`,
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
       ) VALUES ($1,$2,$3,$4,$5,NULL,$3,'ar',$6,'/account',$7,$8,$9,$3)`,
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
      duplicate: false,
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
      }),
      subscription: renewalDto(subscription)
    };
  });

  app.get("/api/platform/subscription-renewals", async (request) => {
    const user = await authenticateLaunchUser(db, request);
    requireLaunchAdmin(user);
    const rows = (
      await db.query(
        `SELECT id, user_id, customer_name, customer_email, status, details,
                metadata, created_at, updated_at
         FROM service_requests
         WHERE source_page='/account'
         ORDER BY CASE WHEN status IN ('completed','rejected','cancelled') THEN 1 ELSE 0 END,
                  created_at DESC
         LIMIT 500`
      )
    ).rows.filter(isRenewalRequest);
    return { requests: rows.map(requestDto) };
  });

  app.post("/api/platform/subscription-renewals/:requestId/review", async (request) => {
    const user = await authenticateLaunchUser(db, request);
    requireLaunchAdmin(user);
    requireLaunchCsrf(request, user);
    const requestId = requiredText(request.params.requestId, "طلب التجديد", 80);
    if (!UUID_PATTERN.test(requestId)) {
      throw new LaunchSalesError(422, "invalid_request", "طلب التجديد غير صالح");
    }
    const decision = requiredText(request.body?.decision, "القرار", 20);
    if (!["approve", "reject"].includes(decision)) {
      throw new LaunchSalesError(422, "invalid_decision", "القرار يجب أن يكون موافقة أو رفض");
    }

    const result = await db.transaction(async (client) => {
      const current = (
        await client.query(
          `SELECT sr.*, pu.email, pu.display_name
           FROM service_requests sr
           JOIN platform_users pu ON pu.id=sr.user_id
           WHERE sr.id=$1 AND sr.source_page='/account'
           FOR UPDATE`,
          [requestId]
        )
      ).rows[0];
      if (!current || !isRenewalRequest(current)) {
        throw new LaunchSalesError(404, "renewal_request_not_found", "طلب التجديد غير موجود");
      }
      if (TERMINAL_REQUEST_STATUSES.has(current.status)) {
        return { current, request: current, subscription: null, duplicate: true, reactivated: false };
      }

      if (decision === "reject") {
        const rejected = (
          await client.query(
            `UPDATE service_requests
             SET status='rejected', updated_by=$2, updated_at=NOW()
             WHERE id=$1
             RETURNING id, user_id, customer_name, customer_email, status,
                       details, metadata, created_at, updated_at`,
            [requestId, user.id]
          )
        ).rows[0];
        return { current, request: rejected, subscription: null, duplicate: false, reactivated: false };
      }

      const metadata = jsonValue(current.metadata, {});
      const subscription = (
        await client.query(
          `SELECT s.*, o.name AS offer_name, o.currency, o.renewal_price_minor,
                  o.duration_unit, o.duration_count, o.renewal_enabled,
                  t.status AS tenant_status
           FROM subscriptions s
           JOIN subscription_offers o ON o.id=s.offer_id
           JOIN tenants t ON t.id=s.tenant_id
           WHERE s.id=$1 AND s.tenant_id=$2 AND s.user_id=$3
           FOR UPDATE`,
          [metadata.subscriptionId, metadata.tenantId, current.user_id]
        )
      ).rows[0];
      if (!subscription) {
        throw new LaunchSalesError(404, "subscription_not_found", "اشتراك المتجر غير موجود");
      }
      if (!subscription.renewal_enabled) {
        throw new LaunchSalesError(409, "renewal_disabled", "تجديد هذا الاشتراك غير متاح حاليًا");
      }

      const now = new Date();
      const currentEnd = new Date(subscription.ends_at);
      const base = Number.isFinite(currentEnd.getTime()) && currentEnd > now ? currentEnd : now;
      const endsAt = durationEnd(base, subscription.duration_unit, Number(subscription.duration_count));
      const renewed = (
        await client.query(
          `UPDATE subscriptions
           SET status='active', ends_at=$2, renews_at=$2
           WHERE id=$1
           RETURNING *`,
          [subscription.id, endsAt]
        )
      ).rows[0];

      let reactivated = false;
      if (subscription.tenant_status === "subscription_expired") {
        const expiredJob = (
          await client.query(
            `SELECT id, job_type FROM provisioning_jobs
             WHERE tenant_id=$1 AND status='failed' AND stage='subscription_expired'
             ORDER BY updated_at DESC LIMIT 1
             FOR UPDATE`,
            [subscription.tenant_id]
          )
        ).rows[0];

        if (expiredJob) {
          const resumeStatus = expiredJob.job_type === "create_store" ? "provisioning_store" : "ready_to_publish";
          await client.query(
            "UPDATE tenants SET status=$2, updated_at=NOW() WHERE id=$1 AND status='subscription_expired'",
            [subscription.tenant_id, resumeStatus]
          );
          await client.query(
            "UPDATE stores SET status=$2, updated_at=NOW() WHERE tenant_id=$1 AND status='suspended'",
            [subscription.tenant_id, resumeStatus]
          );
          await client.query(
            `UPDATE provisioning_jobs
             SET status='retry', stage='subscription_renewed', attempts=0,
                 run_after=NOW(), last_error=NULL, claim_token=NULL,
                 lease_expires_at=NULL, updated_at=NOW()
             WHERE id=$1 AND tenant_id=$2 AND status='failed'`,
            [expiredJob.id, subscription.tenant_id]
          );
        } else {
          await client.query(
            "UPDATE tenants SET status='active', updated_at=NOW() WHERE id=$1 AND status='subscription_expired'",
            [subscription.tenant_id]
          );
          await client.query(
            "UPDATE stores SET status='active', updated_at=NOW() WHERE tenant_id=$1 AND status='suspended'",
            [subscription.tenant_id]
          );
        }
        reactivated = true;
      }

      const completed = (
        await client.query(
          `UPDATE service_requests
           SET status='completed', updated_by=$2, updated_at=NOW()
           WHERE id=$1
           RETURNING id, user_id, customer_name, customer_email, status,
                     details, metadata, created_at, updated_at`,
          [requestId, user.id]
        )
      ).rows[0];
      return { current, request: completed, subscription: { ...subscription, ...renewed, ends_at: endsAt }, duplicate: false, reactivated };
    });

    if (result.duplicate) {
      return { duplicate: true, request: requestDto(result.request), subscription: null, reactivated: false };
    }

    await writeLaunchAudit(
      db,
      request,
      user,
      decision === "approve" ? "platform.subscription_renewal_approved" : "platform.subscription_renewal_rejected",
      requestId,
      { status: result.current.status },
      decision === "approve"
        ? { status: "completed", subscriptionId: result.subscription.id, endsAt: result.subscription.ends_at, reactivated: result.reactivated }
        : { status: "rejected" }
    );

    return {
      duplicate: false,
      request: requestDto(result.request),
      subscription: result.subscription
        ? {
            id: result.subscription.id,
            tenantId: result.subscription.tenant_id,
            status: result.subscription.status,
            endsAt: result.subscription.ends_at
          }
        : null,
      reactivated: result.reactivated
    };
  });
}
