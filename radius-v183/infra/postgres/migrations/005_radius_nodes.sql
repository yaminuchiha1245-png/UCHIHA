CREATE OR REPLACE FUNCTION app.has_tenant_access(row_tenant_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT CURRENT_USER = 'uchiha_platform'
    OR row_tenant_id = COALESCE(current_setting('app.tenant_id', true), '');
$$;

CREATE TABLE radius_nodes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  site_id TEXT REFERENCES network_sites(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'replica', 'standby')),
  endpoint TEXT,
  status TEXT NOT NULL DEFAULT 'healthy' CHECK (status IN ('healthy', 'degraded', 'offline')),
  version TEXT NOT NULL,
  cached_principals INTEGER NOT NULL DEFAULT 0 CHECK (cached_principals >= 0),
  pending_accounting INTEGER NOT NULL DEFAULT 0 CHECK (pending_accounting >= 0),
  pending_auth INTEGER NOT NULL DEFAULT 0 CHECK (pending_auth >= 0),
  last_directory_sync_at TIMESTAMPTZ,
  last_error TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, agent_id)
);

CREATE INDEX radius_nodes_tenant_seen_idx ON radius_nodes(tenant_id, last_seen_at DESC);
ALTER TABLE radius_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE radius_nodes FORCE ROW LEVEL SECURITY;
CREATE POLICY radius_nodes_tenant_policy ON radius_nodes
  USING (app.has_tenant_access(tenant_id))
  WITH CHECK (app.has_tenant_access(tenant_id));
