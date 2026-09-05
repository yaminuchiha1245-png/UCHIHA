-- Game Zone v1.0 RC11
-- Immutable pseudonymous financial mutation journal.
-- Every wallet-balance mutation must be explained by one or more new state transactions.

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
CREATE INDEX IF NOT EXISTS idx_gz_financial_journal_revision
  ON game_zone_financial_journal(state_revision);
CREATE INDEX IF NOT EXISTS idx_gz_financial_journal_subject
  ON game_zone_financial_journal(subject_key);

CREATE TABLE IF NOT EXISTS game_zone_financial_journal_meta (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(id=1),
  cutover_revision BIGINT NOT NULL,
  last_state_revision BIGINT NOT NULL,
  entry_count BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
