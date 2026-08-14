import { randomUUID } from "node:crypto";
import {
  LaunchSalesError,
  TERMINAL_REQUEST_STATUSES,
  UUID_PATTERN,
  authenticateLaunchUser,
  durationEnd,
  jsonValue,
  requestDto,
  requiredText,
  requireLaunchAdmin,
  requireLaunchCsrf,
  subscriptionDto,
  writeLaunchAudit
} from "./launch-sales-common.mjs";

function isActivationRequest(row) {
  return jsonValue(row?.metadata, {}).requestType === "subscription_activation";
}

function integer(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new LaunchSalesError(422, "invalid_subscription_offer", `${field} غير صالح`);
  }
  return number;
}

function boolean(value, field) {
  if (typeof value !== "boolean") {
    throw new LaunchSalesError(422, "invalid_subscription_offer", `${field} غير صالح`);
  }
  return value;
}

function offerAdminDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    priceMinor: Number(row.price_minor || 0),
    renewalPriceMinor: Number(row.renewal_price_minor || 0),
    currency: row.currency,
    durationUnit: row.duration_unit,
    durationCount: Number(row.duration_count || 0),
    trialDays: Number(row.trial_days || 0),
    discountPercent: Number(row.discount_percent || 0),
    saleEnabled: Boolean(row.sale_enabled),
    renewalEnabled: Boolean(row.renewal_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function installLaunchSubscriptionAdminRoutes(app, { db }) {
  app.get("/api/subscription-offer", async (request) => {
    const user = await authenticateLaunchUser(db, request);
    requireLaunchAdmin(user);
    const offer = (
      await db.query(
        `SELECT * FROM subscription_offers
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1`
      )
    ).rows[0] || null;
    return { offer: offerAdminDto(offer) };
  });

  app.put("/api/platform/subscription-offer", async (request) => {
    const user = await authenticateLaunchUser(db, request);
    requireLaunchAdmin(user);
    requireLaunchCsrf(request, user);
    const body = request.body || {};
    const name = requiredText(body.name, "اسم الاشتراك", 120);
    const priceMinor = integer(body.priceMinor, "سعر الاشتراك", { min: 0 });
    const renewalPriceMinor = integer(body.renewalPriceMinor, "سعر التجديد", { min: 0 });
    const currency = requiredText(body.currency, "العملة", 12).toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(currency)) {
      throw new LaunchSalesError(422, "invalid_subscription_offer", "رمز العملة غير صالح");
    }
    const durationUnit = requiredText(body.durationUnit, "وحدة المدة", 10);
    if (!["day", "month", "year"].includes(durationUnit)) {
      throw new LaunchSalesError(422, "invalid_subscription_offer", "وحدة مدة الاشتراك غير صالحة");
    }
    const durationCount = integer(body.durationCount, "مدة الاشتراك", { min: 1, max: 3650 });
    const saleEnabled = boolean(body.saleEnabled, "حالة البيع");
    const renewalEnabled = boolean(body.renewalEnabled, "حالة التجديد");
    if (saleEnabled && priceMinor <= 0) {
      throw new LaunchSalesError(422, "invalid_subscription_offer", "سعر الاشتراك يجب أن يكون أكبر من صفر عند تفعيل البيع");
    }
    if (renewalEnabled && renewalPriceMinor <= 0) {
      throw new LaunchSalesError(422, "invalid_subscription_offer", "سعر التجديد يجب أن يكون أكبر من صفر عند تفعيل التجديد");
    }

    const result = await db.transaction(async (client) => {
      const current = (
        await client.query(
          `SELECT * FROM subscription_offers
           ORDER BY updated_at DESC, created_at DESC
           LIMIT 1
           FOR UPDATE`
        )
      ).rows[0] || null;
      const trialDays = body.trialDays === undefined
        ? Number(current?.trial_days || 0)
        : integer(body.trialDays, "أيام التجربة", { min: 0, max: 3650 });
      const discountPercent = body.discountPercent === undefined
        ? Number(current?.discount_percent || 0)
        : integer(body.discountPercent, "نسبة الخصم", { min: 0, max: 100 });

      let saved;
      if (current) {
        saved = (
          await client.query(
            `UPDATE subscription_offers
             SET name=$2,
                 price_minor=$3,
                 renewal_price_minor=$4,
                 currency=$5,
                 duration_unit=$6,
                 duration_count=$7,
                 trial_days=$8,
                 discount_percent=$9,
                 sale_enabled=$10,
                 renewal_enabled=$11,
                 updated_at=NOW()
             WHERE id=$1
             RETURNING *`,
            [
              current.id,
              name,
              priceMinor,
              renewalPriceMinor,
              currency,
              durationUnit,
              durationCount,
              trialDays,
              discountPercent,
              saleEnabled,
              renewalEnabled
            ]
          )
        ).rows[0];
      } else {
        saved = (
          await client.query(
            `INSERT INTO subscription_offers (
               id, name, price_minor, renewal_price_minor, currency,
               duration_unit, duration_count, trial_days, discount_percent,
               sale_enabled, renewal_enabled
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING *`,
            [
              randomUUID(),
              name,
              priceMinor,
              renewalPriceMinor,
              currency,
              durationUnit,
              durationCount,
              trialDays,
              discountPercent,
              saleEnabled,
              renewalEnabled
            ]
          )
        ).rows[0];
      }
      return { current, saved };
    });

    await writeLaunchAudit(
      db,
      request,
      user,
      "platform.subscription_offer_updated",
      result.saved.id,
      result.current ? offerAdminDto(result.current) : null,
      offerAdminDto(result.saved),
      "subscription_offer"
    );
    return { offer: offerAdminDto(result.saved) };
  });

  app.get("/api/platform/subscription-requests", async (request) => {
    const user = await authenticateLaunchUser(db, request);
    requireLaunchAdmin(user);
    const rows = (
      await db.query(
        `SELECT sr.id, sr.user_id, sr.customer_name, sr.customer_email, sr.status,
                sr.details, sr.metadata, sr.created_at, sr.updated_at
         FROM service_requests sr
         WHERE sr.source_page='/create-store'
         ORDER BY CASE WHEN sr.status IN ('completed','rejected','cancelled') THEN 1 ELSE 0 END,
                  sr.created_at DESC
         LIMIT 250`
      )
    ).rows.filter(isActivationRequest);
    return { requests: rows.map(requestDto) };
  });

  app.post("/api/platform/subscription-requests/:requestId/review", async (request) => {
    const user = await authenticateLaunchUser(db, request);
    requireLaunchAdmin(user);
    requireLaunchCsrf(request, user);
    const id = requiredText(request.params.requestId, "طلب الاشتراك", 80);
    if (!UUID_PATTERN.test(id)) {
      throw new LaunchSalesError(422, "invalid_request", "طلب الاشتراك غير صالح");
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
           WHERE sr.id=$1 AND sr.source_page='/create-store'
           FOR UPDATE`,
          [id]
        )
      ).rows[0];
      if (!current || !isActivationRequest(current)) {
        throw new LaunchSalesError(
          404,
          "subscription_request_not_found",
          "طلب الاشتراك غير موجود"
        );
      }
      if (TERMINAL_REQUEST_STATUSES.has(current.status)) {
        return { current, request: current, subscription: null, duplicate: true };
      }

      if (decision === "reject") {
        const rejected = (
          await client.query(
            `UPDATE service_requests
             SET status='rejected', updated_by=$2, updated_at=NOW()
             WHERE id=$1
             RETURNING id, user_id, customer_name, customer_email, status,
                       details, metadata, created_at, updated_at`,
            [id, user.id]
          )
        ).rows[0];
        return { current, request: rejected, subscription: null, duplicate: false };
      }

      const metadata = jsonValue(current.metadata, {});
      let subscription = (
        await client.query(
          `SELECT * FROM subscriptions
           WHERE user_id=$1 AND tenant_id IS NULL
             AND status IN ('trial','active') AND ends_at>NOW()
           ORDER BY created_at DESC LIMIT 1
           FOR UPDATE`,
          [current.user_id]
        )
      ).rows[0];
      if (!subscription) {
        const offer = metadata.offerId
          ? (
              await client.query(
                `SELECT * FROM subscription_offers
                 WHERE id=$1 LIMIT 1`,
                [metadata.offerId]
              )
            ).rows[0]
          : (
              await client.query(
                `SELECT * FROM subscription_offers
                 WHERE sale_enabled=TRUE ORDER BY created_at LIMIT 1`
              )
            ).rows[0];
        if (!offer) {
          throw new LaunchSalesError(409, "offer_unavailable", "اشتراك البيع غير متاح");
        }
        const capturedAmount = Number(metadata.amountMinor);
        const currentAmount = Number(offer.price_minor);
        const capturedCurrency = String(metadata.currency || "").toUpperCase();
        const currentCurrency = String(offer.currency || "").toUpperCase();
        if (!Number.isFinite(capturedAmount)
            || capturedAmount !== currentAmount
            || !capturedCurrency
            || capturedCurrency !== currentCurrency) {
          throw new LaunchSalesError(
            409,
            "offer_changed",
            "تغيّر سعر الاشتراك أو عملته بعد إرسال طلب الدفع. راجع الطلب قبل الاعتماد"
          );
        }
        const startsAt = new Date();
        const endsAt = durationEnd(startsAt, offer.duration_unit, Number(offer.duration_count));
        subscription = {
          id: randomUUID(),
          user_id: current.user_id,
          offer_id: offer.id,
          offer_name: offer.name,
          currency: offer.currency,
          price_minor: offer.price_minor,
          status: "active",
          activation_mode: "payment",
          starts_at: startsAt,
          ends_at: endsAt,
          renews_at: endsAt
        };
        await client.query(
          `INSERT INTO subscriptions (
             id, user_id, offer_id, status, activation_mode, starts_at, ends_at, renews_at
           ) VALUES ($1,$2,$3,'active','payment',$4,$5,$5)`,
          [subscription.id, subscription.user_id, subscription.offer_id, startsAt, endsAt]
        );
      }

      const completed = (
        await client.query(
          `UPDATE service_requests
           SET status='completed', updated_by=$2, updated_at=NOW()
           WHERE id=$1
           RETURNING id, user_id, customer_name, customer_email, status,
                     details, metadata, created_at, updated_at`,
          [id, user.id]
        )
      ).rows[0];
      return { current, request: completed, subscription, duplicate: false };
    });

    if (result.duplicate) {
      return { request: requestDto(result.request), duplicate: true };
    }

    const action = decision === "approve"
      ? "platform.subscription_request_approved"
      : "platform.subscription_request_rejected";
    await writeLaunchAudit(
      db,
      request,
      user,
      action,
      id,
      { status: result.current.status },
      decision === "approve"
        ? {
            status: "completed",
            subscriptionId: result.subscription.id,
            userId: result.current.user_id
          }
        : { status: "rejected" }
    );

    return {
      request: requestDto(result.request),
      subscription: subscriptionDto(result.subscription)
    };
  });
}
