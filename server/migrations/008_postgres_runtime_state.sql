-- Game Zone v0.8
-- Runtime state table used by the optional PostgreSQL snapshot driver.
-- This lets the existing synchronous service layer persist to PostgreSQL
-- without changing every endpoint at once. The normalized schema remains
-- available for the later full repository migration.

CREATE TABLE IF NOT EXISTS game_zone_state (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  data_sha256 TEXT,
  data_hmac TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
