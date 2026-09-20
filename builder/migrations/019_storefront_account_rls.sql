-- UCHIHA Builder migration 019: tenant isolation policies for storefront account tables.

ALTER TABLE store_experience_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_support_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_security_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_login_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_link_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_verification_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_verification_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_verification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_api_rate_windows ENABLE ROW LEVEL SECURITY;

CREATE POLICY store_experience_settings_tenant_policy ON store_experience_settings
  USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));
CREATE POLICY store_support_channels_tenant_policy ON store_support_channels
  USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));
CREATE POLICY customer_security_settings_tenant_policy ON customer_security_settings
  USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));
CREATE POLICY customer_recovery_codes_tenant_policy ON customer_recovery_codes
  USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));
CREATE POLICY customer_security_events_tenant_policy ON customer_security_events
  USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));
CREATE POLICY customer_login_challenges_tenant_policy ON customer_login_challenges
  USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));
CREATE POLICY telegram_link_codes_tenant_policy ON telegram_link_codes
  USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));
CREATE POLICY identity_verification_requests_tenant_policy ON identity_verification_requests
  USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));
CREATE POLICY identity_verification_files_tenant_policy ON identity_verification_files
  USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));
CREATE POLICY identity_verification_events_tenant_policy ON identity_verification_events
  USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));
CREATE POLICY store_api_keys_tenant_policy ON store_api_keys
  USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));

CREATE POLICY store_api_rate_windows_tenant_policy ON store_api_rate_windows
  USING (EXISTS (
    SELECT 1
    FROM store_api_keys
    WHERE store_api_keys.id = store_api_rate_windows.key_id
      AND store_api_keys.tenant_id::text = current_setting('app.tenant_id', TRUE)
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM store_api_keys
    WHERE store_api_keys.id = store_api_rate_windows.key_id
      AND store_api_keys.tenant_id::text = current_setting('app.tenant_id', TRUE)
  ));
