-- UCHIHA Builder migration 001: central PostgreSQL schema.
CREATE TABLE IF NOT EXISTS platform_users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  csrf_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_offers (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
  renewal_price_minor BIGINT NOT NULL CHECK (renewal_price_minor >= 0),
  currency TEXT NOT NULL,
  duration_unit TEXT NOT NULL CHECK (duration_unit IN ('month', 'year', 'day')),
  duration_count INTEGER NOT NULL CHECK (duration_count > 0),
  trial_days INTEGER NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  discount_percent INTEGER NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  sale_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  renewal_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN (
      'draft', 'payment_pending', 'provisioning_store', 'provisioning_branding',
      'connecting_bots', 'ready_to_publish', 'active', 'review_required',
      'suspended', 'subscription_expired'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES platform_users(id),
  offer_id UUID NOT NULL REFERENCES subscription_offers(id),
  tenant_id UUID REFERENCES tenants(id),
  status TEXT NOT NULL CHECK (status IN ('trial', 'active', 'past_due', 'cancelled', 'expired')),
  activation_mode TEXT NOT NULL CHECK (activation_mode IN ('payment', 'trial', 'demo')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  renews_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL,
  name TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (tenant_id, role_key)
);

CREATE TABLE IF NOT EXISTS permissions (
  permission_key TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(permission_key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS membership_roles (
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, user_id, role_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships(tenant_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  activity_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL,
  language TEXT NOT NULL,
  currency TEXT NOT NULL,
  template_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  contact_data JSONB NOT NULL DEFAULT '{}',
  welcome_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_design_tokens (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  primary_color TEXT NOT NULL,
  secondary_color TEXT NOT NULL,
  background_color TEXT NOT NULL,
  surface_color TEXT NOT NULL,
  text_color TEXT NOT NULL,
  muted_text_color TEXT NOT NULL,
  border_color TEXT NOT NULL,
  success_color TEXT NOT NULL,
  warning_color TEXT NOT NULL,
  danger_color TEXT NOT NULL,
  font_family TEXT NOT NULL,
  border_radius TEXT NOT NULL,
  button_style TEXT NOT NULL,
  card_style TEXT NOT NULL,
  logo_url TEXT,
  favicon_url TEXT,
  cover_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS domains (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL UNIQUE,
  domain_type TEXT NOT NULL CHECK (domain_type IN ('subdomain', 'custom')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'active', 'failed')),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  dns_checked_at TIMESTAMPTZ,
  ssl_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bot_connections (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('storefront', 'admin')),
  telegram_bot_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  token_fingerprint TEXT NOT NULL UNIQUE,
  token_masked TEXT NOT NULL,
  webhook_secret_ciphertext TEXT NOT NULL,
  webhook_secret_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('validated', 'active', 'failed', 'revoked')),
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, purpose)
);

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  product_type TEXT NOT NULL CHECK (
    product_type IN (
      'digital', 'physical', 'service', 'subscription', 'code', 'account',
      'game_topup', 'api_service', 'programming_service'
    )
  ),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
  currency TEXT NOT NULL,
  stock_quantity INTEGER,
  min_quantity INTEGER NOT NULL DEFAULT 1 CHECK (min_quantity > 0),
  max_quantity INTEGER,
  delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('manual', 'automatic', 'provider_api')),
  source_kind TEXT NOT NULL DEFAULT 'local' CHECK (source_kind IN ('local', 'uchiha_api', 'programming')),
  fields JSONB NOT NULL DEFAULT '[]',
  options JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'unavailable')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS api_providers (
  id UUID PRIMARY KEY,
  internal_name TEXT NOT NULL UNIQUE,
  public_alias TEXT NOT NULL,
  adapter_key TEXT NOT NULL,
  base_url TEXT NOT NULL,
  currency TEXT NOT NULL,
  test_mode BOOLEAN NOT NULL DEFAULT TRUE,
  connection_status TEXT NOT NULL DEFAULT 'unknown',
  credentials_ciphertext TEXT,
  sync_settings JSONB NOT NULL DEFAULT '{}',
  retry_settings JSONB NOT NULL DEFAULT '{}',
  balance_minor BIGINT,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_categories (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES api_providers(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  public_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  raw_data JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, external_id)
);

CREATE TABLE IF NOT EXISTS api_services (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES api_providers(id) ON DELETE CASCADE,
  api_category_id UUID REFERENCES api_categories(id) ON DELETE SET NULL,
  external_id TEXT NOT NULL,
  public_name TEXT NOT NULL,
  public_description TEXT NOT NULL DEFAULT '',
  original_cost_minor BIGINT NOT NULL CHECK (original_cost_minor >= 0),
  currency TEXT NOT NULL,
  minimum_quantity INTEGER NOT NULL DEFAULT 1,
  maximum_quantity INTEGER,
  fields JSONB NOT NULL DEFAULT '[]',
  options JSONB NOT NULL DEFAULT '[]',
  provider_status TEXT NOT NULL DEFAULT 'active',
  raw_data JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, external_id)
);

CREATE TABLE IF NOT EXISTS store_imported_services (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES api_providers(id),
  api_service_id UUID NOT NULL REFERENCES api_services(id),
  product_id UUID NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  original_cost_minor BIGINT NOT NULL,
  uchiha_cost_minor BIGINT NOT NULL,
  selling_price_minor BIGINT NOT NULL,
  profit_mode TEXT NOT NULL CHECK (profit_mode IN ('fixed', 'percent', 'manual')),
  profit_value NUMERIC(14, 4) NOT NULL DEFAULT 0,
  platform_profit_minor BIGINT NOT NULL DEFAULT 0,
  merchant_profit_minor BIGINT NOT NULL DEFAULT 0,
  sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  provider_status TEXT NOT NULL,
  local_status TEXT NOT NULL,
  last_sync_at TIMESTAMPTZ,
  UNIQUE (tenant_id, api_service_id)
);

CREATE TABLE IF NOT EXISTS programming_services (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  starting_price_minor BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  estimated_duration TEXT,
  fields JSONB NOT NULL DEFAULT '[]',
  options JSONB NOT NULL DEFAULT '[]',
  resale_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_programming_services (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  programming_service_id UUID NOT NULL REFERENCES programming_services(id),
  product_id UUID NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  merchant_margin_minor BIGINT NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, programming_service_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_telegram_id TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('web', 'store_bot', 'admin')),
  status TEXT NOT NULL CHECK (
    status IN ('new', 'awaiting_payment', 'paid', 'processing', 'completed', 'partial', 'failed', 'cancelled', 'requires_review')
  ),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'refunded')),
  total_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, order_number),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name_snapshot TEXT NOT NULL,
  product_type_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_minor BIGINT NOT NULL,
  total_minor BIGINT NOT NULL,
  input_data JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS provider_orders (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES api_providers(id),
  api_service_id UUID NOT NULL REFERENCES api_services(id),
  external_order_id TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'submitted', 'processing', 'completed', 'partial', 'failed', 'cancelled', 'requires_review')
  ),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_payload JSONB NOT NULL DEFAULT '{}',
  response_payload JSONB NOT NULL DEFAULT '{}',
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provider_order_attempts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_order_id UUID NOT NULL REFERENCES provider_orders(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  response_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_order_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS provider_sync_logs (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES api_providers(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  categories_count INTEGER NOT NULL DEFAULT 0,
  services_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS provisioning_jobs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('create_store', 'connect_bots', 'publish_store')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'retry', 'completed', 'failed')),
  stage TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT NOT NULL UNIQUE,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  resource_id UUID,
  response_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, scope, idempotency_key)
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  ip_address TEXT,
  before_data JSONB,
  after_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON tenant_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_store ON categories(tenant_id, store_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_products_store ON products(tenant_id, store_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(tenant_id, store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_provisioning_queue ON provisioning_jobs(status, run_after);
CREATE INDEX IF NOT EXISTS idx_provider_orders_queue ON provider_orders(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(status, available_at);
