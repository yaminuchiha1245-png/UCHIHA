-- UCHIHA Builder migration 034: proof-first wallet top-ups and durable admin-bot sessions.
-- Keeps the legacy amount+image deposit flow intact while adding the new no-amount
-- customer proof flow requested for the unified storefront.

ALTER TABLE payment_methods
  ADD COLUMN IF NOT EXISTS customer_visible BOOLEAN NOT NULL DEFAULT FALSE;

-- The launch storefront exposes only the three approved methods by default.
-- Any additional method stays hidden until the owner explicitly exposes it.
UPDATE payment_methods
SET customer_visible = TRUE
WHERE method_type IN ('sham_cash', 'binance_pay', 'usdt_trc20')
  AND status = 'active';

CREATE TABLE IF NOT EXISTS wallet_topup_proofs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  payment_method_id UUID NOT NULL REFERENCES payment_methods(id),
  currency TEXT NOT NULL,
  reference_text TEXT,
  proof_data TEXT,
  proof_mime TEXT,
  proof_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  credited_amount_minor BIGINT CHECK (credited_amount_minor IS NULL OR credited_amount_minor > 0),
  review_reason TEXT,
  reviewed_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    NULLIF(BTRIM(COALESCE(reference_text, '')), '') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(proof_data, '')), '') IS NOT NULL
  ),
  UNIQUE (customer_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_wallet_topup_proofs_store
  ON wallet_topup_proofs(tenant_id, store_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_topup_proofs_customer
  ON wallet_topup_proofs(tenant_id, store_id, customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_bot_sessions (
  connection_id UUID NOT NULL REFERENCES bot_connections(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  state_key TEXT NOT NULL,
  state_data JSONB NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connection_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_bot_sessions_expiry
  ON admin_bot_sessions(expires_at);
