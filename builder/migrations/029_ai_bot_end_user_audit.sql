-- UCHIHA Builder migration 029: support Telegram-native user administration safely.
-- PRO grants and ban/unban actions update this timestamp for operational auditing.

ALTER TABLE ai_bot_end_users
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_ai_bot_end_users_updated
  ON ai_bot_end_users (instance_id, updated_at DESC);
