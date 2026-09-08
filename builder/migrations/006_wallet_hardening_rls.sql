-- UCHIHA Builder migration 006. Defense-in-depth RLS for wallet hardening tables.
ALTER TABLE customer_idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_idempotency_tenant_isolation ON customer_idempotency_records
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID);
CREATE POLICY customer_notifications_tenant_isolation ON customer_notifications
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID);
