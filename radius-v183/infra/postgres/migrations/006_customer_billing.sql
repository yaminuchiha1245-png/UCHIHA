ALTER TABLE invoices ADD COLUMN period_start TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN period_end TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN void_reason TEXT;

CREATE UNIQUE INDEX invoices_subscriber_period_idx
  ON invoices(tenant_id, subscriber_id, period_start)
  WHERE period_start IS NOT NULL AND status <> 'void';

CREATE INDEX payments_tenant_created_idx ON payments(tenant_id, created_at DESC);
