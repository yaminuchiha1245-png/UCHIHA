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

export function installLaunchSubscriptionAdminRoutes(app, { db }) {
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
