-- UCHIHA Builder migration 005: harden wallet idempotency, financial audit and customer notifications.
ALTER TABLE orders ADD COLUMN customer_id UUID REFERENCES store_customers(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN request_hash TEXT;
ALTER TABLE orders ADD COLUMN payment_source TEXT NOT NULL DEFAULT 'external'
  CHECK (payment_source IN ('external', 'wallet', 'manual', 'demo'));

ALTER TABLE deposit_requests ADD COLUMN request_hash TEXT;
ALTER TABLE audit_logs ADD COLUMN actor_customer_id UUID REFERENCES store_customers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS customer_idempotency_records (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  resource_id UUID,
  response_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, scope, idempotency_key)
);

CREATE TABLE IF NOT EXISTS customer_notifications (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (
    notification_type IN ('deposit_submitted', 'deposit_approved', 'deposit_rejected', 'order_paid', 'wallet_adjusted')
  ),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(tenant_id, store_id, customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_customer_idempotency_scope
  ON customer_idempotency_records(tenant_id, store_id, customer_id, scope, created_at);
CREATE INDEX IF NOT EXISTS idx_customer_notifications
  ON customer_notifications(tenant_id, store_id, customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_financial
  ON audit_logs(tenant_id, action, created_at);
