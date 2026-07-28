-- UCHIHA Builder migration 010: RLS for product intelligence data.
ALTER TABLE product_input_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_input_analyses_tenant_isolation ON product_input_analyses
  USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));
