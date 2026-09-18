ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS installation_hash TEXT;

CREATE TABLE app_installations (
  id TEXT PRIMARY KEY,
  installation_hash TEXT NOT NULL UNIQUE,
  installation_hint TEXT NOT NULL,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  activation_code_id TEXT REFERENCES activation_codes(id) ON DELETE SET NULL,
  platform TEXT NOT NULL DEFAULT 'unknown' CHECK (platform IN ('android', 'web', 'unknown')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  activated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX app_installations_tenant_status_idx ON app_installations(tenant_id, status, last_seen_at DESC);
