-- Tenant-aware policies for the platform portal and future infrastructure orders.

-- Enforce that every store-scoped row points to a store owned by the same tenant.
-- The composite key on stores is created by PostgreSQL-only migration 014.
ALTER TABLE platform_services
  ADD CONSTRAINT platform_services_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT platform_services_id_scope_key UNIQUE (id, tenant_id, store_id);
ALTER TABLE service_requests
  ADD CONSTRAINT service_requests_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT service_requests_service_scope_fk
  FOREIGN KEY (service_id, tenant_id, store_id)
  REFERENCES platform_services(id, tenant_id, store_id);
ALTER TABLE contact_methods
  ADD CONSTRAINT contact_methods_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE platform_payment_methods
  ADD CONSTRAINT platform_payment_methods_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT platform_payment_methods_id_scope_key UNIQUE (id, tenant_id, store_id);
ALTER TABLE payment_method_instructions
  ADD CONSTRAINT payment_instructions_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT payment_instructions_platform_method_scope_fk
  FOREIGN KEY (platform_payment_method_id, tenant_id, store_id)
  REFERENCES platform_payment_methods(id, tenant_id, store_id);
ALTER TABLE platform_banners
  ADD CONSTRAINT platform_banners_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE portfolio_items
  ADD CONSTRAINT portfolio_items_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE provider_errors
  ADD CONSTRAINT provider_errors_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE provider_webhook_events
  ADD CONSTRAINT provider_webhook_events_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE system_settings
  ADD CONSTRAINT system_settings_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE platform_audit_logs
  ADD CONSTRAINT platform_audit_logs_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE infrastructure_orders
  ADD CONSTRAINT infrastructure_orders_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE provider_order_attempts
  ADD CONSTRAINT provider_order_attempts_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE provider_sync_logs
  ADD CONSTRAINT provider_sync_logs_store_scope_fk
  FOREIGN KEY (store_id, tenant_id) REFERENCES stores(id, tenant_id) ON DELETE CASCADE;

ALTER TABLE platform_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_services FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_services_scope ON platform_services;
CREATE POLICY platform_services_scope ON platform_services
  USING (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_requests_scope ON service_requests;
CREATE POLICY service_requests_scope ON service_requests
  USING (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE contact_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_methods FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_methods_scope ON contact_methods;
CREATE POLICY contact_methods_scope ON contact_methods
  USING (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE platform_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_payment_methods FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_payment_methods_scope ON platform_payment_methods;
CREATE POLICY platform_payment_methods_scope ON platform_payment_methods
  USING (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE payment_method_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_method_instructions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_method_instructions_scope ON payment_method_instructions;
CREATE POLICY payment_method_instructions_scope ON payment_method_instructions
  USING (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE platform_banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_banners FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_banners_scope ON platform_banners;
CREATE POLICY platform_banners_scope ON platform_banners
  USING (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE portfolio_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portfolio_items_scope ON portfolio_items;
CREATE POLICY portfolio_items_scope ON portfolio_items
  USING (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE provider_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_errors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_errors_scope ON provider_errors;
CREATE POLICY provider_errors_scope ON provider_errors
  USING (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS system_settings_scope ON system_settings;
CREATE POLICY system_settings_scope ON system_settings
  USING (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE provider_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_webhook_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_webhook_events_scope ON provider_webhook_events;
CREATE POLICY provider_webhook_events_scope ON provider_webhook_events
  USING (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  );

ALTER TABLE infrastructure_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE infrastructure_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS infrastructure_orders_scope ON infrastructure_orders;
CREATE POLICY infrastructure_orders_scope ON infrastructure_orders
  USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));

ALTER TABLE platform_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_audit_logs_scope ON platform_audit_logs;
CREATE POLICY platform_audit_logs_scope ON platform_audit_logs
  USING (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  )
  WITH CHECK (
    tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', TRUE)
  );
