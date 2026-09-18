CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.has_tenant_access(row_tenant_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT CURRENT_USER IN ('uchiha_platform', 'uchiha_worker')
    OR row_tenant_id = COALESCE(current_setting('app.tenant_id', true), '');
$$;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  google_sub TEXT UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  platform_role TEXT NOT NULL DEFAULT 'none' CHECK (platform_role IN ('none', 'support', 'platform_owner')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX users_email_unique_ci ON users (LOWER(email));

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  time_zone TEXT NOT NULL DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'collector', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE subscription_products (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
  currency CHAR(3) NOT NULL,
  billing_period TEXT NOT NULL CHECK (billing_period IN ('monthly', 'yearly')),
  limits_json JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE tenant_subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES subscription_products(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'trialing', 'active', 'grace', 'past_due', 'canceled', 'expired')),
  provider TEXT,
  external_id TEXT,
  checkout_url TEXT,
  checkout_expires_at TIMESTAMPTZ,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  speed_down_mbps INTEGER NOT NULL CHECK (speed_down_mbps > 0),
  speed_up_mbps INTEGER NOT NULL CHECK (speed_up_mbps > 0),
  price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
  billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'weekly', 'custom')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE subscribers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id TEXT REFERENCES plans(id),
  username TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'expired', 'pending')),
  balance_minor BIGINT NOT NULL DEFAULT 0,
  service_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, username)
);

CREATE TABLE network_devices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  branch TEXT,
  host TEXT NOT NULL,
  api_port INTEGER NOT NULL DEFAULT 8728 CHECK (api_port BETWEEN 1 AND 65535),
  connection_method TEXT NOT NULL CHECK (connection_method IN ('api', 'vpn', 'agent')),
  username TEXT,
  secret_ciphertext TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'online', 'offline', 'error')),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE radius_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscriber_id TEXT REFERENCES subscribers(id) ON DELETE SET NULL,
  device_id TEXT REFERENCES network_devices(id) ON DELETE SET NULL,
  external_session_id TEXT NOT NULL,
  username TEXT NOT NULL,
  framed_ip INET,
  nas_ip INET,
  started_at TIMESTAMPTZ NOT NULL,
  stopped_at TIMESTAMPTZ,
  input_bytes BIGINT NOT NULL DEFAULT 0,
  output_bytes BIGINT NOT NULL DEFAULT 0,
  terminate_cause TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped')),
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, external_session_id)
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE RESTRICT,
  number TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  paid_minor BIGINT NOT NULL DEFAULT 0 CHECK (paid_minor >= 0 AND paid_minor <= amount_minor),
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partial', 'paid', 'void', 'overdue')),
  due_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, number)
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  method TEXT NOT NULL CHECK (method IN ('cash', 'transfer', 'card', 'other')),
  reference TEXT,
  received_by_user_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  acknowledged_by_user_id TEXT REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('telegram', 'radius', 'mikrotik_agent', 'billing')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'error', 'disabled')),
  config_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  secret_ciphertext TEXT,
  last_error TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, type)
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'connector', 'webhook')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  reason TEXT,
  before_json JSONB,
  after_json JSONB,
  request_id TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE idempotency_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  route TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, key, route)
);

CREATE TABLE connector_nonces (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, nonce)
);

CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  UNIQUE (provider, external_id)
);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL,
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX memberships_user_status_idx ON memberships(user_id, status);
CREATE INDEX tenant_subscriptions_lookup_idx ON tenant_subscriptions(tenant_id, status, ends_at DESC);
CREATE UNIQUE INDEX tenant_subscriptions_one_pending_product_idx ON tenant_subscriptions(tenant_id, product_id) WHERE status = 'pending';
CREATE INDEX subscribers_tenant_status_idx ON subscribers(tenant_id, status, updated_at DESC);
CREATE INDEX subscribers_tenant_name_idx ON subscribers(tenant_id, LOWER(full_name));
CREATE INDEX radius_sessions_active_idx ON radius_sessions(tenant_id, status, started_at DESC);
CREATE INDEX invoices_status_idx ON invoices(tenant_id, status, due_at);
CREATE INDEX alerts_open_idx ON alerts(tenant_id, status, created_at DESC);
CREATE INDEX audit_tenant_created_idx ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX outbox_pending_idx ON outbox(status, available_at) WHERE status IN ('pending', 'failed');
CREATE INDEX sessions_expiry_idx ON auth_sessions(expires_at) WHERE revoked_at IS NULL;

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE radius_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;

ALTER TABLE plans FORCE ROW LEVEL SECURITY;
ALTER TABLE subscribers FORCE ROW LEVEL SECURITY;
ALTER TABLE network_devices FORCE ROW LEVEL SECURITY;
ALTER TABLE radius_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
ALTER TABLE alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE integrations FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records FORCE ROW LEVEL SECURITY;
ALTER TABLE connector_nonces FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY plans_tenant_policy ON plans USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY subscribers_tenant_policy ON subscribers USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY devices_tenant_policy ON network_devices USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY sessions_tenant_policy ON radius_sessions USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY invoices_tenant_policy ON invoices USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY payments_tenant_policy ON payments USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY alerts_tenant_policy ON alerts USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY integrations_tenant_policy ON integrations USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY audit_tenant_policy ON audit_logs USING (tenant_id IS NULL OR app.has_tenant_access(tenant_id)) WITH CHECK (tenant_id IS NULL OR app.has_tenant_access(tenant_id));
CREATE POLICY idempotency_tenant_policy ON idempotency_records USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY nonces_tenant_policy ON connector_nonces USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY outbox_tenant_policy ON outbox USING (tenant_id IS NULL OR app.has_tenant_access(tenant_id)) WITH CHECK (tenant_id IS NULL OR app.has_tenant_access(tenant_id));
