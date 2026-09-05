-- Game Zone v1.0 RC13 PostgreSQL blueprint
-- NOTE: the active RC13 runtime still uses the revisioned single-writer game_zone_state JSONB snapshot.
-- These normalized tables are the planned path for a later multi-writer repository migration.
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, description TEXT,
  sort_order INT NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
  priority INT NOT NULL DEFAULT 10, timeout_ms INT NOT NULL DEFAULT 12000,
  secret_env TEXT, base_url TEXT, order_path TEXT
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, category_id TEXT REFERENCES categories(id), name TEXT NOT NULL, icon TEXT,
  description TEXT, price NUMERIC(14,2) NOT NULL, cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD', input_label TEXT, delivery TEXT,
  provider_primary TEXT REFERENCES providers(id), provider_backup TEXT REFERENCES providers(id),
  provider_product_id TEXT, active BOOLEAN NOT NULL DEFAULT TRUE, featured BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, order_no TEXT UNIQUE NOT NULL, telegram_id BIGINT NOT NULL,
  product_id TEXT NOT NULL, product_name TEXT NOT NULL, customer_input TEXT,
  base_price NUMERIC(14,2) NOT NULL, discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  final_price NUMERIC(14,2) NOT NULL, cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  profit NUMERIC(14,2) NOT NULL DEFAULT 0, currency VARCHAR(8) NOT NULL,
  status TEXT NOT NULL, provider_primary TEXT, provider_backup TEXT, provider_used TEXT,
  provider_order_id TEXT, provider_message TEXT, coupon_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, telegram_id BIGINT NOT NULL, type TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL, currency VARCHAR(8) NOT NULL, reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS topups (
  id TEXT PRIMARY KEY, telegram_id BIGINT NOT NULL, amount NUMERIC(14,2) NOT NULL,
  currency VARCHAR(8) NOT NULL, method TEXT NOT NULL, status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY, type TEXT NOT NULL, value NUMERIC(14,2) NOT NULL,
  max_discount NUMERIC(14,2), active BOOLEAN NOT NULL DEFAULT TRUE,
  uses INT NOT NULL DEFAULT 0, max_uses INT
);
CREATE TABLE IF NOT EXISTS provider_logs (
  id BIGSERIAL PRIMARY KEY, provider_id TEXT, order_no TEXT, ok BOOLEAN NOT NULL,
  duration_ms INT, status TEXT, provider_order_id TEXT, error TEXT, http_status INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS admin_audit (
  id BIGSERIAL PRIMARY KEY, action TEXT NOT NULL, meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS favorites (
  telegram_id BIGINT NOT NULL, product_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (telegram_id, product_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, telegram_id BIGINT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info', ref TEXT, read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_telegram_id ON orders(telegram_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_logs_created_at ON provider_logs(created_at DESC);


CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  telegram_id BIGINT NOT NULL,
  subject TEXT,
  message TEXT NOT NULL,
  reply TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  audience TEXT NOT NULL,
  total INT NOT NULL DEFAULT 0,
  sent INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- v0.7 security / inventory / provider status additions
ALTER TABLE providers ADD COLUMN IF NOT EXISTS status_path TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_request_per_user
  ON orders(telegram_id, client_request_id)
  WHERE client_request_id IS NOT NULL AND client_request_id <> '';

CREATE TABLE IF NOT EXISTS inventory_codes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  value_enc TEXT,
  encrypted BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'available',
  order_no TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_product_status ON inventory_codes(product_id, status);

CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at DESC);


-- v0.8 runtime snapshot storage.
CREATE TABLE IF NOT EXISTS game_zone_state (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  data_sha256 TEXT,
  data_hmac TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_zone_state_history (
  revision BIGINT PRIMARY KEY,
  data JSONB NOT NULL,
  data_sha256 TEXT NOT NULL,
  data_hmac TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_game_zone_state_history_created
  ON game_zone_state_history(created_at DESC);


-- RC10 normalized financial mirror.
CREATE TABLE IF NOT EXISTS game_zone_financial_users (
  telegram_id TEXT PRIMARY KEY,
  balance NUMERIC(18,6) NOT NULL,
  currency TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_sha256 TEXT NOT NULL,
  mirror_revision BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS game_zone_financial_orders (
  id TEXT PRIMARY KEY,
  order_no TEXT,
  telegram_id TEXT NOT NULL,
  status TEXT NOT NULL,
  final_price NUMERIC(18,6) NOT NULL,
  profit NUMERIC(18,6) NOT NULL,
  refunded_at TIMESTAMPTZ,
  payload JSONB NOT NULL,
  payload_sha256 TEXT NOT NULL,
  mirror_revision BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gz_financial_orders_order_no
  ON game_zone_financial_orders(order_no)
  WHERE order_no IS NOT NULL AND order_no<>'';
CREATE INDEX IF NOT EXISTS idx_gz_financial_orders_user
  ON game_zone_financial_orders(telegram_id);
CREATE TABLE IF NOT EXISTS game_zone_financial_transactions (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount NUMERIC(18,6) NOT NULL,
  currency TEXT NOT NULL,
  reference TEXT,
  payload JSONB NOT NULL,
  payload_sha256 TEXT NOT NULL,
  mirror_revision BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gz_financial_transactions_user
  ON game_zone_financial_transactions(telegram_id);
CREATE TABLE IF NOT EXISTS game_zone_financial_topups (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  amount NUMERIC(18,6) NOT NULL,
  currency TEXT NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL,
  reference TEXT,
  payload JSONB NOT NULL,
  payload_sha256 TEXT NOT NULL,
  mirror_revision BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gz_financial_topups_user
  ON game_zone_financial_topups(telegram_id);
CREATE TABLE IF NOT EXISTS game_zone_financial_mirror_meta (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(id=1),
  state_revision BIGINT NOT NULL,
  counts JSONB NOT NULL,
  totals JSONB NOT NULL,
  digests JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- RC13 immutable pseudonymous financial mutation journal.
CREATE TABLE IF NOT EXISTS game_zone_financial_journal (
  id BIGSERIAL PRIMARY KEY,
  operation_key TEXT NOT NULL UNIQUE,
  source_transaction_id TEXT NOT NULL UNIQUE,
  subject_key TEXT,
  type TEXT NOT NULL CHECK(type IN ('topup','refund','purchase','admin_credit','admin_debit')),
  amount NUMERIC(18,6) NOT NULL CHECK(amount<>0),
  balance_before NUMERIC(18,6) CHECK(balance_before IS NULL OR balance_before>=0),
  balance_after NUMERIC(18,6) CHECK(balance_after IS NULL OR balance_after>=0),
  currency TEXT NOT NULL,
  reference TEXT,
  payload_sha256 TEXT NOT NULL,
  state_revision BIGINT NOT NULL,
  legacy_backfill BOOLEAN NOT NULL DEFAULT FALSE,
  entry_hmac TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gz_financial_journal_revision ON game_zone_financial_journal(state_revision);
CREATE INDEX IF NOT EXISTS idx_gz_financial_journal_subject ON game_zone_financial_journal(subject_key);
CREATE TABLE IF NOT EXISTS game_zone_financial_journal_meta (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(id=1),
  cutover_revision BIGINT NOT NULL,
  last_state_revision BIGINT NOT NULL,
  entry_count BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RC13 wallet authority.
CREATE TABLE IF NOT EXISTS game_zone_wallet_accounts (
  wallet_key TEXT PRIMARY KEY,
  balance NUMERIC(18,6) NOT NULL,
  currency TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_state_revision BIGINT NOT NULL,
  account_hmac TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gz_wallet_accounts_active
  ON game_zone_wallet_accounts(active);

CREATE TABLE IF NOT EXISTS game_zone_wallet_authority_meta (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(id=1),
  cutover_revision BIGINT NOT NULL,
  last_state_revision BIGINT NOT NULL,
  account_count BIGINT NOT NULL,
  active_account_count BIGINT NOT NULL,
  total_balance NUMERIC(18,6) NOT NULL,
  digest TEXT NOT NULL,
  meta_hmac TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- RC13 authoritative business records.
CREATE TABLE IF NOT EXISTS game_zone_order_authority (
  order_id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  subject_key TEXT NOT NULL,
  product_id TEXT NOT NULL,
  status TEXT NOT NULL,
  final_price NUMERIC(18,6) NOT NULL,
  currency TEXT NOT NULL,
  provider_order_id TEXT,
  provider_used TEXT,
  requires_manual_review BOOLEAN NOT NULL DEFAULT FALSE,
  immutable_digest TEXT NOT NULL,
  last_state_revision BIGINT NOT NULL,
  row_hmac TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gz_order_authority_subject
  ON game_zone_order_authority(subject_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gz_order_authority_provider_order
  ON game_zone_order_authority(provider_used,provider_order_id)
  WHERE provider_used IS NOT NULL AND provider_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS game_zone_topup_authority (
  topup_id TEXT PRIMARY KEY,
  subject_key TEXT NOT NULL,
  amount NUMERIC(18,6) NOT NULL,
  currency TEXT NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL,
  reference TEXT,
  immutable_digest TEXT NOT NULL,
  last_state_revision BIGINT NOT NULL,
  row_hmac TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gz_topup_authority_subject
  ON game_zone_topup_authority(subject_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gz_topup_authority_payment_ref
  ON game_zone_topup_authority(lower(method),lower(reference))
  WHERE reference IS NOT NULL AND reference<>'';

CREATE TABLE IF NOT EXISTS game_zone_business_authority_meta (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(id=1),
  cutover_revision BIGINT NOT NULL,
  last_state_revision BIGINT NOT NULL,
  order_count BIGINT NOT NULL,
  topup_count BIGINT NOT NULL,
  order_digest TEXT NOT NULL,
  topup_digest TEXT NOT NULL,
  meta_hmac TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
