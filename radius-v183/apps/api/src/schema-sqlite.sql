PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  google_sub TEXT UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  platform_role TEXT NOT NULL DEFAULT 'none' CHECK (platform_role IN ('none', 'support', 'platform_owner')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_accounts (
  telegram_user_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telegram_accounts_user ON telegram_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_accounts_tenant ON telegram_accounts(tenant_id);

-- One-time codes are issued only to an authenticated existing network member.
-- The code itself is never stored, logged, or returned in subsequent reads.
CREATE TABLE IF NOT EXISTS telegram_link_challenges (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telegram_link_user ON telegram_link_challenges(user_id, tenant_id, expires_at);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL DEFAULT 'USD',
  time_zone TEXT NOT NULL DEFAULT 'Asia/Damascus',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'collector', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  installation_hash TEXT,
  telegram_user_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscription_products (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  currency TEXT NOT NULL,
  billing_period TEXT NOT NULL CHECK (billing_period IN ('monthly', 'yearly')),
  limits_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES subscription_products(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'trialing', 'active', 'grace', 'past_due', 'canceled', 'expired')),
  provider TEXT,
  external_id TEXT,
  checkout_url TEXT,
  checkout_expires_at TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activation_codes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES subscription_products(id),
  code_hash TEXT NOT NULL UNIQUE,
  code_hint TEXT NOT NULL,
  duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 3660),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'revoked')),
  expires_at TEXT NOT NULL,
  redeemed_at TEXT,
  redeemed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  issued_to_name TEXT,
  issued_to_email TEXT,
  issued_to_phone TEXT,
  note TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_installations (
  id TEXT PRIMARY KEY,
  installation_hash TEXT NOT NULL UNIQUE,
  installation_hint TEXT NOT NULL,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  activation_code_id TEXT REFERENCES activation_codes(id) ON DELETE SET NULL,
  platform TEXT NOT NULL DEFAULT 'unknown' CHECK (platform IN ('android', 'web', 'unknown')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  activated_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS activation_codes_tenant_status_idx ON activation_codes(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS app_installations_tenant_status_idx ON app_installations(tenant_id, status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  policy_id TEXT REFERENCES radius_policies(id) ON DELETE SET NULL,
  ip_pool_id TEXT REFERENCES ip_pools(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  speed_down_mbps INTEGER NOT NULL CHECK (speed_down_mbps > 0),
  speed_up_mbps INTEGER NOT NULL CHECK (speed_up_mbps > 0),
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'weekly', 'custom')),
  quota_bytes INTEGER CHECK (quota_bytes IS NULL OR quota_bytes > 0),
  quota_period TEXT NOT NULL DEFAULT 'none' CHECK (quota_period IN ('none', 'daily', 'monthly')),
  quota_action TEXT NOT NULL DEFAULT 'block' CHECK (quota_action IN ('block', 'throttle')),
  throttle_down_mbps INTEGER CHECK (throttle_down_mbps IS NULL OR throttle_down_mbps > 0),
  throttle_up_mbps INTEGER CHECK (throttle_up_mbps IS NULL OR throttle_up_mbps > 0),
  duration_days INTEGER NOT NULL DEFAULT 30 CHECK (duration_days BETWEEN 1 AND 3660),
  simultaneous_use INTEGER NOT NULL DEFAULT 1 CHECK (simultaneous_use BETWEEN 1 AND 100),
  scope_type TEXT NOT NULL DEFAULT 'all' CHECK (scope_type IN ('all', 'device', 'site')),
  scope_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id TEXT REFERENCES plans(id),
  policy_id TEXT REFERENCES radius_policies(id) ON DELETE SET NULL,
  ip_pool_id TEXT REFERENCES ip_pools(id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  radius_secret_ciphertext TEXT,
  credential_version INTEGER NOT NULL DEFAULT 0,
  full_name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'expired', 'pending')),
  balance_minor INTEGER NOT NULL DEFAULT 0,
  service_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, username)
);

CREATE TABLE IF NOT EXISTS network_devices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id TEXT REFERENCES network_sites(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  branch TEXT,
  host TEXT NOT NULL,
  api_port INTEGER NOT NULL DEFAULT 8728 CHECK (api_port BETWEEN 1 AND 65535),
  connection_method TEXT NOT NULL CHECK (connection_method IN ('api', 'vpn', 'agent')),
  username TEXT,
  secret_ciphertext TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'online', 'offline', 'error')),
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS radius_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscriber_id TEXT REFERENCES subscribers(id) ON DELETE SET NULL,
  device_id TEXT REFERENCES network_devices(id) ON DELETE SET NULL,
  external_session_id TEXT NOT NULL,
  username TEXT NOT NULL,
  framed_ip TEXT,
  nas_ip TEXT,
  started_at TEXT NOT NULL,
  stopped_at TEXT,
  input_bytes INTEGER NOT NULL DEFAULT 0,
  output_bytes INTEGER NOT NULL DEFAULT 0,
  terminate_cause TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped')),
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, external_session_id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE RESTRICT,
  number TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  paid_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partial', 'paid', 'void', 'overdue')),
  due_at TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, number)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  method TEXT NOT NULL CHECK (method IN ('cash', 'transfer', 'card', 'other')),
  reference TEXT,
  received_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  acknowledged_by_user_id TEXT REFERENCES users(id),
  acknowledged_at TEXT,
  resolved_by_user_id TEXT REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('telegram', 'radius', 'mikrotik_agent', 'billing')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'error', 'disabled')),
  config_json TEXT NOT NULL DEFAULT '{}',
  secret_ciphertext TEXT,
  last_error TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, type)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  actor_user_id TEXT REFERENCES users(id),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'connector', 'webhook')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  reason TEXT,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  route TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, key, route)
);

CREATE TABLE IF NOT EXISTS connector_nonces (
  tenant_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, nonce)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  UNIQUE (provider, external_id)
);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  locked_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS network_sites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  address TEXT,
  latitude REAL,
  longitude REAL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS ip_pools (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id TEXT REFERENCES network_sites(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  cidr TEXT NOT NULL,
  gateway TEXT,
  dns_json TEXT NOT NULL DEFAULT '[]',
  purpose TEXT NOT NULL CHECK (purpose IN ('pppoe', 'hotspot', 'static', 'management')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, name),
  UNIQUE (tenant_id, cidr)
);

CREATE TABLE IF NOT EXISTS radius_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  auth_methods_json TEXT NOT NULL DEFAULT '[]',
  simultaneous_use INTEGER NOT NULL DEFAULT 1 CHECK (simultaneous_use BETWEEN 1 AND 100),
  idle_timeout_seconds INTEGER CHECK (idle_timeout_seconds IS NULL OR idle_timeout_seconds BETWEEN 60 AND 86400),
  session_timeout_seconds INTEGER CHECK (session_timeout_seconds IS NULL OR session_timeout_seconds BETWEEN 300 AND 31536000),
  interim_interval_seconds INTEGER NOT NULL DEFAULT 300 CHECK (interim_interval_seconds BETWEEN 60 AND 3600),
  rate_limit_down_mbps INTEGER CHECK (rate_limit_down_mbps IS NULL OR rate_limit_down_mbps > 0),
  rate_limit_up_mbps INTEGER CHECK (rate_limit_up_mbps IS NULL OR rate_limit_up_mbps > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS resellers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id TEXT REFERENCES network_sites(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  commission_bps INTEGER NOT NULL DEFAULT 0 CHECK (commission_bps BETWEEN 0 AND 10000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  balance_minor INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS voucher_batches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  reseller_id TEXT REFERENCES resellers(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 250),
  valid_days INTEGER NOT NULL CHECK (valid_days BETWEEN 1 AND 3650),
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'exhausted', 'canceled')),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS vouchers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES voucher_batches(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'assigned', 'active', 'used', 'revoked')),
  subscriber_id TEXT REFERENCES subscribers(id) ON DELETE SET NULL,
  activated_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, username)
);

CREATE TABLE IF NOT EXISTS support_tickets (
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
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, number)
);

CREATE TABLE IF NOT EXISTS support_ticket_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'message', 'status', 'assignment', 'note')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS radius_accounting_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status_type TEXT NOT NULL CHECK (status_type IN ('start', 'interim', 'stop')),
  username TEXT NOT NULL,
  subscriber_id TEXT REFERENCES subscribers(id) ON DELETE SET NULL,
  device_id TEXT REFERENCES network_devices(id) ON DELETE SET NULL,
  framed_ip TEXT,
  nas_ip TEXT,
  input_bytes INTEGER NOT NULL DEFAULT 0,
  output_bytes INTEGER NOT NULL DEFAULT 0,
  terminate_cause TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (tenant_id, event_id)
);

CREATE TABLE IF NOT EXISTS radius_auth_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  username TEXT NOT NULL,
  subscriber_id TEXT REFERENCES subscribers(id) ON DELETE SET NULL,
  device_id TEXT REFERENCES network_devices(id) ON DELETE SET NULL,
  nas_ip TEXT,
  client_ip TEXT,
  result TEXT NOT NULL CHECK (result IN ('accept', 'reject', 'challenge', 'error')),
  reason TEXT,
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (tenant_id, event_id)
);

CREATE TABLE IF NOT EXISTS radius_nodes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  site_id TEXT REFERENCES network_sites(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'replica', 'standby')),
  endpoint TEXT,
  status TEXT NOT NULL DEFAULT 'healthy' CHECK (status IN ('healthy', 'degraded', 'offline')),
  version TEXT NOT NULL,
  cached_principals INTEGER NOT NULL DEFAULT 0,
  pending_accounting INTEGER NOT NULL DEFAULT 0,
  pending_auth INTEGER NOT NULL DEFAULT 0,
  last_directory_sync_at TEXT,
  last_error TEXT,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON tenant_subscriptions(tenant_id, status, ends_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_one_pending_product ON tenant_subscriptions(tenant_id, product_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_subscribers_tenant_status ON subscribers(tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscribers_tenant_name ON subscribers(tenant_id, full_name);
CREATE INDEX IF NOT EXISTS idx_radius_sessions_active ON radius_sessions(tenant_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(tenant_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(status, available_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_revoked ON auth_sessions(revoked_at) WHERE revoked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connector_nonces_expires ON connector_nonces(expires_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_records(expires_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON webhook_events(processed_at);
CREATE INDEX IF NOT EXISTS idx_outbox_sent_updated ON outbox(updated_at) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS idx_radius_auth_received ON radius_auth_events(received_at);
CREATE INDEX IF NOT EXISTS idx_radius_accounting_received ON radius_accounting_events(received_at);
CREATE INDEX IF NOT EXISTS idx_sites_tenant_status ON network_sites(tenant_id, status, name);
CREATE INDEX IF NOT EXISTS idx_pools_tenant_status ON ip_pools(tenant_id, status, name);
CREATE INDEX IF NOT EXISTS idx_policies_tenant_status ON radius_policies(tenant_id, status, name);
CREATE INDEX IF NOT EXISTS idx_resellers_tenant_status ON resellers(tenant_id, status, name);
CREATE INDEX IF NOT EXISTS idx_voucher_batches_tenant_created ON voucher_batches(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vouchers_batch_status ON vouchers(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_status ON support_tickets(tenant_id, status, priority, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket ON support_ticket_events(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_radius_accounting_tenant_time ON radius_accounting_events(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_radius_auth_tenant_time ON radius_auth_events(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_radius_nodes_tenant_seen ON radius_nodes(tenant_id, last_seen_at DESC);
