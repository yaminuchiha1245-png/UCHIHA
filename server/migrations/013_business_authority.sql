-- Game Zone v1.0 RC13
-- HMAC-protected authoritative order/top-up records.
-- These rows are checked as write preconditions during normal PostgreSQL persistence.

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
