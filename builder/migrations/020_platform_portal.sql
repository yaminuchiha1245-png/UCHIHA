-- Public platform portal, neutral showcase content and extensible integration contracts.
-- This migration is additive. Existing store/payment/provider flows remain intact.

CREATE TABLE IF NOT EXISTS platform_services (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  service_key TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  icon_key TEXT NOT NULL DEFAULT 'code',
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description_ar TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  features_ar JSONB NOT NULL DEFAULT '[]',
  features_en JSONB NOT NULL DEFAULT '[]',
  starting_price_minor BIGINT CHECK (starting_price_minor IS NULL OR starting_price_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  estimated_duration_ar TEXT,
  estimated_duration_en TEXT,
  request_schema JSONB NOT NULL DEFAULT '{}',
  whatsapp_template_ar TEXT NOT NULL DEFAULT '',
  whatsapp_template_en TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'coming_soon')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (tenant_id IS NULL AND store_id IS NULL) OR
    (tenant_id IS NOT NULL AND store_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS service_requests (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES platform_services(id),
  user_id UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  customer_internal_id TEXT,
  locale TEXT NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar', 'en')),
  details TEXT NOT NULL,
  source_page TEXT NOT NULL DEFAULT '/',
  status TEXT NOT NULL DEFAULT 'new' CHECK (
    status IN ('new', 'contacted', 'quoted', 'approved', 'in_progress', 'completed', 'cancelled', 'rejected')
  ),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  assigned_to UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (customer_email IS NOT NULL OR customer_phone IS NOT NULL),
  CHECK (
    (tenant_id IS NULL AND store_id IS NULL) OR
    (tenant_id IS NOT NULL AND store_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS contact_methods (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  method_type TEXT NOT NULL CHECK (
    method_type IN ('whatsapp', 'telegram', 'email', 'instagram', 'tiktok', 'facebook', 'discord', 'phone', 'website', 'custom')
  ),
  icon_key TEXT NOT NULL DEFAULT 'message',
  icon_url TEXT,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description_ar TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL,
  message_template_ar TEXT NOT NULL DEFAULT '',
  message_template_en TEXT NOT NULL DEFAULT '',
  working_hours_ar TEXT,
  working_hours_en TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'disabled')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (tenant_id IS NULL AND store_id IS NULL) OR
    (tenant_id IS NOT NULL AND store_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS platform_payment_methods (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  method_key TEXT NOT NULL UNIQUE,
  method_type TEXT NOT NULL,
  logo_url TEXT,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  currency TEXT NOT NULL,
  network TEXT,
  beneficiary_name TEXT,
  account_identifier TEXT,
  qr_mode TEXT NOT NULL DEFAULT 'none' CHECK (qr_mode IN ('none', 'generated', 'uploaded')),
  qr_data TEXT,
  qr_image_url TEXT,
  minimum_amount_minor BIGINT CHECK (minimum_amount_minor IS NULL OR minimum_amount_minor >= 0),
  maximum_amount_minor BIGINT CHECK (maximum_amount_minor IS NULL OR maximum_amount_minor >= 0),
  status TEXT NOT NULL DEFAULT 'coming_soon' CHECK (status IN ('active', 'hidden', 'disabled', 'coming_soon')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (tenant_id IS NULL AND store_id IS NULL) OR
    (tenant_id IS NOT NULL AND store_id IS NOT NULL)
  ),
  CHECK (maximum_amount_minor IS NULL OR minimum_amount_minor IS NULL OR maximum_amount_minor >= minimum_amount_minor),
  CHECK (qr_mode <> 'generated' OR qr_data IS NOT NULL),
  CHECK (qr_mode <> 'uploaded' OR qr_image_url IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS payment_method_instructions (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  payment_method_id UUID REFERENCES payment_methods(id) ON DELETE CASCADE,
  platform_payment_method_id UUID REFERENCES platform_payment_methods(id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale IN ('ar', 'en')),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  warning TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (payment_method_id IS NOT NULL AND platform_payment_method_id IS NULL) OR
    (payment_method_id IS NULL AND platform_payment_method_id IS NOT NULL)
  ),
  CHECK (
    (tenant_id IS NULL AND store_id IS NULL) OR
    (tenant_id IS NOT NULL AND store_id IS NOT NULL)
  ),
  UNIQUE (payment_method_id, locale, sort_order),
  UNIQUE (platform_payment_method_id, locale, sort_order)
);

CREATE TABLE IF NOT EXISTS platform_banners (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  title_ar TEXT NOT NULL,
  title_en TEXT NOT NULL,
  subtitle_ar TEXT NOT NULL DEFAULT '',
  subtitle_en TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL,
  link_url TEXT NOT NULL DEFAULT '/services',
  action_label_ar TEXT NOT NULL DEFAULT '',
  action_label_en TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (tenant_id IS NULL AND store_id IS NULL) OR
    (tenant_id IS NOT NULL AND store_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS portfolio_items (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  title_ar TEXT NOT NULL,
  title_en TEXT NOT NULL,
  description_ar TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  target_url TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'demo' CHECK (item_type IN ('demo', 'live', 'case_study')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (tenant_id IS NULL AND store_id IS NULL) OR
    (tenant_id IS NOT NULL AND store_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS api_provider_credentials (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES api_providers(id) ON DELETE CASCADE,
  credential_key TEXT NOT NULL DEFAULT 'primary',
  credentials_ciphertext TEXT NOT NULL,
  encryption_version INTEGER NOT NULL DEFAULT 1,
  last_rotated_at TIMESTAMPTZ,
  created_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, credential_key)
);

CREATE TABLE IF NOT EXISTS api_service_options (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES api_providers(id) ON DELETE CASCADE,
  api_service_id UUID NOT NULL REFERENCES api_services(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  extra_cost_minor BIGINT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (api_service_id, external_id)
);

CREATE TABLE IF NOT EXISTS api_service_fields (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES api_providers(id) ON DELETE CASCADE,
  api_service_id UUID NOT NULL REFERENCES api_services(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text' CHECK (
    field_type IN ('text', 'textarea', 'number', 'email', 'tel', 'url', 'select', 'radio', 'checkbox')
  ),
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  validation JSONB NOT NULL DEFAULT '{}',
  options JSONB NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (api_service_id, field_key)
);

CREATE TABLE IF NOT EXISTS provider_errors (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES api_providers(id) ON DELETE CASCADE,
  provider_order_id UUID REFERENCES provider_orders(id) ON DELETE CASCADE,
  sync_log_id UUID REFERENCES provider_sync_logs(id) ON DELETE CASCADE,
  error_code TEXT NOT NULL,
  error_category TEXT NOT NULL DEFAULT 'provider',
  safe_message TEXT NOT NULL,
  retryable BOOLEAN NOT NULL DEFAULT FALSE,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (tenant_id IS NULL AND store_id IS NULL) OR
    (tenant_id IS NOT NULL AND store_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS provider_webhook_events (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES api_providers(id) ON DELETE CASCADE,
  provider_order_id UUID REFERENCES provider_orders(id) ON DELETE SET NULL,
  event_key TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  received_status TEXT,
  outcome TEXT NOT NULL DEFAULT 'received' CHECK (
    outcome IN ('received', 'applied', 'duplicate', 'unmatched', 'rejected')
  ),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE (provider_id, event_key),
  CHECK (
    (tenant_id IS NULL AND store_id IS NULL) OR
    (tenant_id IS NOT NULL AND store_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'platform' CHECK (scope IN ('platform', 'tenant', 'store')),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  setting_value JSONB NOT NULL DEFAULT '{}',
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (scope = 'platform' AND tenant_id IS NULL AND store_id IS NULL) OR
    (scope = 'tenant' AND tenant_id IS NOT NULL AND store_id IS NULL) OR
    (scope = 'store' AND tenant_id IS NOT NULL AND store_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_data JSONB,
  after_data JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (tenant_id IS NULL AND store_id IS NULL) OR
    (tenant_id IS NOT NULL AND store_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS infrastructure_integrations (
  id UUID PRIMARY KEY,
  integration_kind TEXT NOT NULL CHECK (integration_kind IN ('hosting', 'domain')),
  public_alias TEXT NOT NULL,
  internal_name TEXT NOT NULL,
  adapter_key TEXT NOT NULL,
  base_url TEXT,
  credentials_ciphertext TEXT,
  capabilities JSONB NOT NULL DEFAULT '[]',
  mode TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live', 'disabled')),
  connection_status TEXT NOT NULL DEFAULT 'not_configured',
  created_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (integration_kind, public_alias)
);

CREATE TABLE IF NOT EXISTS infrastructure_orders (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES infrastructure_integrations(id),
  order_kind TEXT NOT NULL CHECK (order_kind IN ('hosting_purchase', 'hosting_renewal', 'domain_register', 'domain_transfer', 'domain_renewal')),
  external_order_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'submitted', 'processing', 'completed', 'failed', 'cancelled', 'requires_review')
  ),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_payload JSONB NOT NULL DEFAULT '{}',
  response_payload JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE payment_methods
  DROP CONSTRAINT IF EXISTS payment_methods_method_type_check;

ALTER TABLE payment_methods
  ADD CONSTRAINT payment_methods_method_type_check CHECK (
    method_type IN (
      'binance_pay', 'usdt_trc20', 'usdt_bep20', 'sham_cash', 'bank_transfer',
      'payeer', 'paypal', 'stripe', 'cash_on_delivery', 'crypto', 'manual', 'custom'
    )
  );

ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS currency TEXT;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS network TEXT;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS beneficiary_name TEXT;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS account_identifier TEXT;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS qr_mode TEXT NOT NULL DEFAULT 'none';
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS qr_data TEXT;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS qr_image_url TEXT;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES platform_users(id) ON DELETE SET NULL;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES platform_users(id) ON DELETE SET NULL;

ALTER TABLE api_providers ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '[]';
ALTER TABLE api_providers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE api_providers ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES platform_users(id) ON DELETE SET NULL;
ALTER TABLE api_providers ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES platform_users(id) ON DELETE SET NULL;

ALTER TABLE api_categories ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE api_categories ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES platform_users(id) ON DELETE SET NULL;
ALTER TABLE api_categories ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES platform_users(id) ON DELETE SET NULL;

ALTER TABLE api_services ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE api_services ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES platform_users(id) ON DELETE SET NULL;
ALTER TABLE api_services ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES platform_users(id) ON DELETE SET NULL;

ALTER TABLE provider_order_attempts ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE CASCADE;
ALTER TABLE provider_order_attempts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE provider_orders ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_orders ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
ALTER TABLE provider_orders ADD COLUMN IF NOT EXISTS next_status_check_at TIMESTAMPTZ;
ALTER TABLE provider_orders ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ;
ALTER TABLE provider_sync_logs ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE provider_sync_logs ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE CASCADE;
ALTER TABLE provider_sync_logs ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
ALTER TABLE provider_sync_logs
  ADD CONSTRAINT provider_sync_logs_scope_check CHECK (
    (tenant_id IS NULL AND store_id IS NULL) OR
    (tenant_id IS NOT NULL AND store_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_platform_services_public
  ON platform_services(status, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_service_requests_status
  ON service_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_service_requests_scope
  ON service_requests(tenant_id, store_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_methods_public
  ON contact_methods(status, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_platform_payment_methods_public
  ON platform_payment_methods(status, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_platform_banners_public
  ON platform_banners(status, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_provider_credentials_provider
  ON api_provider_credentials(provider_id, credential_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_providers_public_alias_unique
  ON api_providers(public_alias);
CREATE INDEX IF NOT EXISTS idx_api_service_options_service
  ON api_service_options(api_service_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_api_service_fields_service
  ON api_service_fields(api_service_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_provider_errors_queue
  ON provider_errors(provider_id, resolved_at, retryable, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_provider_webhook_events_provider
  ON provider_webhook_events(provider_id, received_at);
CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_entity
  ON platform_audit_logs(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_infrastructure_orders_scope
  ON infrastructure_orders(tenant_id, store_id, status, created_at);
