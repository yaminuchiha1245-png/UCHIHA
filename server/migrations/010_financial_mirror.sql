-- Game Zone v1.0 RC10
-- Normalized financial mirror for users/orders/transactions/top-ups.
-- The active source of truth is still the single-writer game_zone_state snapshot.
-- Mirror rows are updated atomically in the same PostgreSQL transaction.

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
