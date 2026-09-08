-- UCHIHA Builder migration 003: store-customer accounts, wallets, payment methods and deposit review.
CREATE TABLE IF NOT EXISTS store_customers (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, email)
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  token_hash TEXT PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  csrf_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_wallets (
  customer_id UUID PRIMARY KEY REFERENCES store_customers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  balance_minor BIGINT NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  method_type TEXT NOT NULL CHECK (method_type IN ('binance_pay', 'usdt_trc20', 'sham_cash', 'bank_transfer', 'manual')),
  instructions TEXT NOT NULL DEFAULT '',
  destination_data JSONB NOT NULL DEFAULT '{}',
  commission_bps INTEGER NOT NULL DEFAULT 0 CHECK (commission_bps BETWEEN 0 AND 10000),
  fixed_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (fixed_fee_minor >= 0),
  minimum_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (minimum_amount_minor >= 0),
  maximum_amount_minor BIGINT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deposit_requests (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  payment_method_id UUID NOT NULL REFERENCES payment_methods(id),
  requested_amount_minor BIGINT NOT NULL CHECK (requested_amount_minor > 0),
  commission_minor BIGINT NOT NULL CHECK (commission_minor >= 0),
  net_amount_minor BIGINT NOT NULL CHECK (net_amount_minor > 0),
  currency TEXT NOT NULL,
  proof_data TEXT NOT NULL,
  proof_mime TEXT NOT NULL,
  reference_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  review_reason TEXT,
  reviewed_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('deposit', 'purchase', 'refund', 'adjustment')),
  amount_minor BIGINT NOT NULL,
  balance_after_minor BIGINT NOT NULL CHECK (balance_after_minor >= 0),
  currency TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id UUID NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reference_type, reference_id, entry_type)
);

CREATE INDEX IF NOT EXISTS idx_store_customers_store ON store_customers(tenant_id, store_id, status);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer ON customer_sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_methods_store ON payment_methods(tenant_id, store_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_deposits_store_status ON deposit_requests(tenant_id, store_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_deposits_customer ON deposit_requests(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_customer ON wallet_ledger(customer_id, created_at);
