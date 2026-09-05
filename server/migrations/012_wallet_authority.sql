-- Game Zone v1.0 RC12
-- PostgreSQL wallet authority cutover.
-- Wallet account balances become a locked SQL authority/precondition for normal financial persistence.

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
