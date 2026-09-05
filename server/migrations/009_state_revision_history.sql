-- Game Zone v1.0 RC9
-- Adds integrity metadata and retained point-in-time history to the single-writer
-- PostgreSQL JSONB snapshot runtime.

ALTER TABLE game_zone_state
  ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

ALTER TABLE game_zone_state
  ADD COLUMN IF NOT EXISTS data_sha256 TEXT;

ALTER TABLE game_zone_state
  ADD COLUMN IF NOT EXISTS data_hmac TEXT;

CREATE TABLE IF NOT EXISTS game_zone_state_history (
  revision BIGINT PRIMARY KEY,
  data JSONB NOT NULL,
  data_sha256 TEXT NOT NULL,
  data_hmac TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_zone_state_history_created
  ON game_zone_state_history(created_at DESC);
