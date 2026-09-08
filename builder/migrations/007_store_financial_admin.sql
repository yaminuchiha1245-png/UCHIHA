-- UCHIHA Builder migration 007: idempotent owner adjustments and store-owner notifications.
CREATE TABLE IF NOT EXISTS admin_idempotency_records (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  resource_id UUID,
  response_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, actor_user_id, scope, idempotency_key)
);

CREATE TABLE IF NOT EXISTS store_admin_notifications (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (
    notification_type IN ('customer_registered', 'deposit_submitted', 'order_paid', 'wallet_adjusted')
  ),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_idempotency_scope
  ON admin_idempotency_records(tenant_id, store_id, actor_user_id, scope, created_at);
CREATE INDEX IF NOT EXISTS idx_store_admin_notifications
  ON store_admin_notifications(tenant_id, store_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_store_customers_search
  ON store_customers(tenant_id, store_id, email, display_name);
