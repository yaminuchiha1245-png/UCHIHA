WITH ranked_pending AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY tenant_id, product_id ORDER BY created_at DESC, id DESC) AS position
  FROM tenant_subscriptions
  WHERE status = 'pending'
)
UPDATE tenant_subscriptions
SET status = 'canceled', updated_at = NOW()
WHERE id IN (SELECT id FROM ranked_pending WHERE position > 1);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_subscriptions_one_pending_product_idx
  ON tenant_subscriptions(tenant_id, product_id)
  WHERE status = 'pending';
