-- UCHIHA Builder migration 008: RLS for owner financial administration tables.
ALTER TABLE admin_idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_admin_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_idempotency_tenant_isolation ON admin_idempotency_records
  USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));

CREATE POLICY store_admin_notifications_tenant_isolation ON store_admin_notifications
  USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));
