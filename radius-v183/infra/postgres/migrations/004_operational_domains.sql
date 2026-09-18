CREATE TABLE network_sites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  address TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, name)
);

CREATE TABLE ip_pools (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id TEXT REFERENCES network_sites(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  cidr CIDR NOT NULL,
  gateway INET,
  dns_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  purpose TEXT NOT NULL CHECK (purpose IN ('pppoe', 'hotspot', 'static', 'management')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, name),
  UNIQUE (tenant_id, cidr)
);

CREATE TABLE radius_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  auth_methods_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  simultaneous_use INTEGER NOT NULL DEFAULT 1 CHECK (simultaneous_use BETWEEN 1 AND 100),
  idle_timeout_seconds INTEGER CHECK (idle_timeout_seconds IS NULL OR idle_timeout_seconds BETWEEN 60 AND 86400),
  session_timeout_seconds INTEGER CHECK (session_timeout_seconds IS NULL OR session_timeout_seconds BETWEEN 300 AND 31536000),
  interim_interval_seconds INTEGER NOT NULL DEFAULT 300 CHECK (interim_interval_seconds BETWEEN 60 AND 3600),
  rate_limit_down_mbps INTEGER CHECK (rate_limit_down_mbps IS NULL OR rate_limit_down_mbps > 0),
  rate_limit_up_mbps INTEGER CHECK (rate_limit_up_mbps IS NULL OR rate_limit_up_mbps > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, name)
);

ALTER TABLE network_devices ADD COLUMN site_id TEXT REFERENCES network_sites(id) ON DELETE SET NULL;
ALTER TABLE plans ADD COLUMN policy_id TEXT REFERENCES radius_policies(id) ON DELETE SET NULL;
ALTER TABLE plans ADD COLUMN ip_pool_id TEXT REFERENCES ip_pools(id) ON DELETE SET NULL;
ALTER TABLE subscribers ADD COLUMN policy_id TEXT REFERENCES radius_policies(id) ON DELETE SET NULL;
ALTER TABLE subscribers ADD COLUMN ip_pool_id TEXT REFERENCES ip_pools(id) ON DELETE SET NULL;
ALTER TABLE subscribers ADD COLUMN radius_secret_ciphertext TEXT;
ALTER TABLE subscribers ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE resellers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id TEXT REFERENCES network_sites(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  commission_bps INTEGER NOT NULL DEFAULT 0 CHECK (commission_bps BETWEEN 0 AND 10000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  balance_minor BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE voucher_batches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  reseller_id TEXT REFERENCES resellers(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 250),
  valid_days INTEGER NOT NULL CHECK (valid_days BETWEEN 1 AND 3650),
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'exhausted', 'canceled')),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, code)
);

CREATE TABLE vouchers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES voucher_batches(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'assigned', 'active', 'used', 'revoked')),
  subscriber_id TEXT REFERENCES subscribers(id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, username)
);

CREATE TABLE support_tickets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('network', 'subscriber', 'billing', 'radius', 'other')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  subscriber_id TEXT REFERENCES subscribers(id) ON DELETE SET NULL,
  device_id TEXT REFERENCES network_devices(id) ON DELETE SET NULL,
  assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, number)
);

CREATE TABLE support_ticket_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'message', 'status', 'assignment', 'note')),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE radius_accounting_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status_type TEXT NOT NULL CHECK (status_type IN ('start', 'interim', 'stop')),
  username TEXT NOT NULL,
  subscriber_id TEXT REFERENCES subscribers(id) ON DELETE SET NULL,
  device_id TEXT REFERENCES network_devices(id) ON DELETE SET NULL,
  framed_ip INET,
  nas_ip INET,
  input_bytes BIGINT NOT NULL DEFAULT 0,
  output_bytes BIGINT NOT NULL DEFAULT 0,
  terminate_cause TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, event_id)
);

CREATE TABLE radius_auth_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  username TEXT NOT NULL,
  subscriber_id TEXT REFERENCES subscribers(id) ON DELETE SET NULL,
  device_id TEXT REFERENCES network_devices(id) ON DELETE SET NULL,
  nas_ip INET,
  client_ip INET,
  result TEXT NOT NULL CHECK (result IN ('accept', 'reject', 'challenge', 'error')),
  reason TEXT,
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, event_id)
);

CREATE INDEX network_sites_tenant_status_idx ON network_sites(tenant_id, status, name);
CREATE INDEX ip_pools_tenant_status_idx ON ip_pools(tenant_id, status, name);
CREATE INDEX radius_policies_tenant_status_idx ON radius_policies(tenant_id, status, name);
CREATE INDEX resellers_tenant_status_idx ON resellers(tenant_id, status, name);
CREATE INDEX voucher_batches_tenant_created_idx ON voucher_batches(tenant_id, created_at DESC);
CREATE INDEX vouchers_batch_status_idx ON vouchers(batch_id, status);
CREATE INDEX support_tickets_tenant_status_idx ON support_tickets(tenant_id, status, priority, updated_at DESC);
CREATE INDEX support_ticket_events_ticket_idx ON support_ticket_events(ticket_id, created_at);
CREATE INDEX radius_accounting_tenant_time_idx ON radius_accounting_events(tenant_id, occurred_at DESC);
CREATE INDEX radius_auth_tenant_time_idx ON radius_auth_events(tenant_id, occurred_at DESC);

ALTER TABLE network_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE ip_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE radius_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE resellers ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE radius_accounting_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE radius_auth_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE network_sites FORCE ROW LEVEL SECURITY;
ALTER TABLE ip_pools FORCE ROW LEVEL SECURITY;
ALTER TABLE radius_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE resellers FORCE ROW LEVEL SECURITY;
ALTER TABLE voucher_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE vouchers FORCE ROW LEVEL SECURITY;
ALTER TABLE support_tickets FORCE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_events FORCE ROW LEVEL SECURITY;
ALTER TABLE radius_accounting_events FORCE ROW LEVEL SECURITY;
ALTER TABLE radius_auth_events FORCE ROW LEVEL SECURITY;

CREATE POLICY network_sites_tenant_policy ON network_sites USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY ip_pools_tenant_policy ON ip_pools USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY radius_policies_tenant_policy ON radius_policies USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY resellers_tenant_policy ON resellers USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY voucher_batches_tenant_policy ON voucher_batches USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY vouchers_tenant_policy ON vouchers USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY support_tickets_tenant_policy ON support_tickets USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY support_ticket_events_tenant_policy ON support_ticket_events USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY radius_accounting_events_tenant_policy ON radius_accounting_events USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY radius_auth_events_tenant_policy ON radius_auth_events USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
