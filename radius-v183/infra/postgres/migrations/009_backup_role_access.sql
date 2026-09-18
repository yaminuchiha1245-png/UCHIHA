CREATE OR REPLACE FUNCTION app.has_tenant_access(row_tenant_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT CURRENT_USER IN ('uchiha_platform', 'uchiha_backup')
    OR row_tenant_id = COALESCE(current_setting('app.tenant_id', true), '');
$$;
