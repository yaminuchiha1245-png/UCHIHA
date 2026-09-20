function uniqueTenantIds(rows) {
  return [...new Set(rows.map((row) => row.tenant_id).filter(Boolean))];
}

export async function expireTenantSubscriptions(db) {
  return db.transaction(async (client) => {
    const expired = await client.query(
      `UPDATE subscriptions
       SET status='expired', renews_at=NULL
       WHERE tenant_id IS NOT NULL
         AND status IN ('trial','active','past_due')
         AND ends_at <= NOW()
       RETURNING tenant_id`
    );

    const tenantIds = uniqueTenantIds(expired.rows || []);
    for (const tenantId of tenantIds) {
      await client.query(
        `UPDATE tenants
         SET status='subscription_expired', updated_at=NOW()
         WHERE id=$1 AND status <> 'suspended'`,
        [tenantId]
      );
      await client.query(
        `UPDATE stores
         SET status='suspended', updated_at=NOW()
         WHERE tenant_id=$1
           AND status IN (
             'active','ready','ready_to_publish','connecting_bots',
             'provisioning_store','provisioning_branding'
           )`,
        [tenantId]
      );
      await client.query(
        `UPDATE provisioning_jobs
         SET status='failed', stage='subscription_expired',
             claim_token=NULL, lease_expires_at=NULL,
             last_error='Subscription expired', updated_at=NOW()
         WHERE tenant_id=$1 AND status IN ('queued','retry','running')`,
        [tenantId]
      );
      await client.query(
        `UPDATE customer_sessions AS cs
         SET revoked_at=COALESCE(cs.revoked_at, NOW())
         FROM store_customers AS c
         WHERE cs.customer_id=c.id
           AND c.tenant_id=$1
           AND cs.revoked_at IS NULL`,
        [tenantId]
      );
    }

    return { expiredSubscriptions: Number(expired.rowCount || 0), tenantIds };
  });
}

export function startSubscriptionExpiryLoop(db, logger = console, intervalMs = 60_000) {
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const result = await expireTenantSubscriptions(db);
      if (result.expiredSubscriptions > 0) {
        logger.info?.(
          {
            expiredSubscriptions: result.expiredSubscriptions,
            expiredTenants: result.tenantIds.length
          },
          "Expired tenant subscriptions were suspended"
        );
      }
    } catch (error) {
      logger.error?.(
        { errorCode: error?.code || error?.name || "subscription_expiry_failed" },
        "Subscription expiry sweep failed"
      );
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, Math.max(10_000, Number(intervalMs) || 60_000));
  timer.unref?.();
  tick();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
