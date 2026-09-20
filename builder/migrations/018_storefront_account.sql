-- UCHIHA Builder migration 018: customer account experience, security,
-- Telegram linking, identity verification and read-only storefront API.
-- UCHIHA Store remains a seeded tenant; every setting below is tenant scoped.

ALTER TABLE store_customers ADD COLUMN avatar_url TEXT;
ALTER TABLE store_customers ADD COLUMN preferred_currency TEXT;
ALTER TABLE store_customers ADD COLUMN balance_hidden BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE store_customers ADD COLUMN telegram_user_id TEXT;
ALTER TABLE store_customers ADD COLUMN telegram_username TEXT;
ALTER TABLE store_customers ADD COLUMN telegram_linked_at TIMESTAMPTZ;

ALTER TABLE customer_sessions ADD COLUMN last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE customer_sessions ADD COLUMN revoked_reason TEXT;

ALTER TABLE payment_methods ADD COLUMN currency TEXT;
ALTER TABLE payment_methods ADD COLUMN logo_url TEXT;
ALTER TABLE payment_methods ADD COLUMN qr_url TEXT;
ALTER TABLE payment_methods ADD COLUMN network TEXT;
ALTER TABLE payment_methods ADD COLUMN commission_minimum_minor BIGINT NOT NULL DEFAULT 0;
ALTER TABLE payment_methods ADD COLUMN proof_max_bytes INTEGER NOT NULL DEFAULT 1500000;

ALTER TABLE orders ADD COLUMN rejection_reason TEXT;
ALTER TABLE orders ADD COLUMN delivery_data JSONB NOT NULL DEFAULT '{}';
ALTER TABLE orders ADD COLUMN execution_stages JSONB NOT NULL DEFAULT '[]';

ALTER TABLE order_items ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE customer_notifications
  DROP CONSTRAINT customer_notifications_notification_type_check;
ALTER TABLE customer_notifications
  ADD CONSTRAINT customer_notifications_notification_type_check CHECK (
    notification_type IN (
      'deposit_submitted', 'deposit_approved', 'deposit_rejected', 'order_paid',
      'wallet_adjusted', 'identity_updated', 'security_alert'
    )
  );

-- Keep the legacy entry_type column for compatibility with the existing worker and
-- introduce the richer operation taxonomy requested by the new wallet UI.
ALTER TABLE wallet_ledger ADD COLUMN operation_type TEXT NOT NULL DEFAULT 'admin_adjustment'
  CHECK (operation_type IN (
    'deposit', 'purchase', 'refund', 'deduction', 'admin_adjustment',
    'internal_transfer', 'fee', 'hold', 'unhold'
  ));
ALTER TABLE wallet_ledger ADD COLUMN balance_before_minor BIGINT NOT NULL DEFAULT 0;
ALTER TABLE wallet_ledger ADD COLUMN fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (fee_minor >= 0);

UPDATE wallet_ledger
SET operation_type = CASE entry_type
  WHEN 'deposit' THEN 'deposit'
  WHEN 'purchase' THEN 'purchase'
  WHEN 'refund' THEN 'refund'
  ELSE 'admin_adjustment'
END,
balance_before_minor = balance_after_minor - amount_minor;

CREATE TABLE IF NOT EXISTS store_experience_settings (
  store_id UUID PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  identity_verification_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  identity_file_max_bytes INTEGER NOT NULL DEFAULT 4000000
    CHECK (identity_file_max_bytes BETWEEN 100000 AND 15000000),
  identity_retention_days INTEGER NOT NULL DEFAULT 365
    CHECK (identity_retention_days BETWEEN 1 AND 3650),
  floating_support_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  light_mode_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  storefront_api_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  internal_transfer_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  withdrawal_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  builder_promo_url TEXT,
  builder_promo_image_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_support_channels (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL CHECK (
    channel_type IN ('whatsapp', 'telegram', 'instagram', 'email', 'tiktok', 'discord', 'phone', 'custom')
  ),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL,
  message_template TEXT NOT NULL DEFAULT '',
  icon_url TEXT,
  working_hours TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, channel_type, target)
);

CREATE TABLE IF NOT EXISTS customer_security_settings (
  customer_id UUID PRIMARY KEY REFERENCES store_customers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  totp_secret_ciphertext TEXT,
  totp_pending_secret_ciphertext TEXT,
  totp_confirmed_at TIMESTAMPTZ,
  recovery_codes_generated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_recovery_codes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, code_hash)
);

CREATE TABLE IF NOT EXISTS customer_security_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_login_challenges (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telegram_link_codes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  telegram_user_id TEXT NOT NULL,
  telegram_username TEXT,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS identity_verification_requests (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  document_type TEXT NOT NULL DEFAULT '',
  document_number_ciphertext TEXT,
  birth_date DATE,
  nationality TEXT NOT NULL DEFAULT '',
  additional_details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'pending_review', 'changes_required', 'verified', 'rejected')
  ),
  review_note TEXT,
  reviewed_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, customer_id)
);

CREATE TABLE IF NOT EXISTS identity_verification_files (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES identity_verification_requests(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  file_kind TEXT NOT NULL CHECK (file_kind IN ('front', 'back', 'selfie')),
  mime_type TEXT NOT NULL,
  content_ciphertext TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id, file_kind)
);

CREATE TABLE IF NOT EXISTS identity_verification_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES identity_verification_requests(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_api_keys (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Storefront Catalog API',
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '["categories:read","products:read"]',
  ip_allowlist JSONB NOT NULL DEFAULT '[]',
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60 CHECK (rate_limit_per_minute BETWEEN 1 AND 10000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  last_used_at TIMESTAMPTZ,
  created_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_by_customer_id UUID REFERENCES store_customers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS store_api_rate_windows (
  key_id UUID NOT NULL REFERENCES store_api_keys(id) ON DELETE CASCADE,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (key_id, window_started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_store_customer_telegram_unique
  ON store_customers(store_id, telegram_user_id)
  WHERE telegram_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_channels_store
  ON store_support_channels(tenant_id, store_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_security_events_customer
  ON customer_security_events(tenant_id, store_id, customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_login_challenges_lookup
  ON customer_login_challenges(tenant_id, store_id, token_hash, expires_at);
CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_lookup
  ON telegram_link_codes(tenant_id, store_id, code_hash, expires_at);
CREATE INDEX IF NOT EXISTS idx_identity_requests_store
  ON identity_verification_requests(tenant_id, store_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_identity_events_request
  ON identity_verification_events(tenant_id, store_id, request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_store_api_keys_lookup
  ON store_api_keys(tenant_id, store_id, status, token_hash);
