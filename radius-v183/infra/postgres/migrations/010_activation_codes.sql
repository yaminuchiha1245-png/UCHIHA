CREATE TABLE activation_codes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES subscription_products(id),
  code_hash TEXT NOT NULL UNIQUE,
  code_hint TEXT NOT NULL,
  duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 3660),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'revoked')),
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  redeemed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  issued_to_name TEXT,
  issued_to_email TEXT,
  issued_to_phone TEXT,
  note TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX activation_codes_tenant_status_idx ON activation_codes(tenant_id, status, created_at DESC);

ALTER TABLE activation_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE activation_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY activation_codes_tenant_policy ON activation_codes
  USING (app.has_tenant_access(tenant_id))
  WITH CHECK (app.has_tenant_access(tenant_id));
