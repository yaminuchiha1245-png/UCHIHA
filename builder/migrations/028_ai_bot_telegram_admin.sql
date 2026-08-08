-- UCHIHA Builder migration 028: purchase-only platform handoff and Telegram-native AI bot administration.
-- Each purchased bot owns its OpenAI credential; secrets remain encrypted server-side.

ALTER TABLE ai_bot_instances
  ADD COLUMN IF NOT EXISTS openai_api_key_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS openai_key_masked TEXT,
  ADD COLUMN IF NOT EXISTS openai_key_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS setup_code_hash TEXT,
  ADD COLUMN IF NOT EXISTS setup_code_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ai_bot_instances_openai_key_fingerprint
  ON ai_bot_instances (openai_key_fingerprint)
  WHERE openai_key_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_bot_instances_setup_code
  ON ai_bot_instances (setup_code_hash, setup_code_expires_at)
  WHERE setup_code_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_bot_setup_sessions (
  telegram_user_id TEXT PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES ai_bot_instances(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'awaiting_bot_token',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (state IN ('awaiting_bot_token'))
);

CREATE INDEX IF NOT EXISTS idx_ai_bot_setup_sessions_expiry
  ON ai_bot_setup_sessions (expires_at);

CREATE TABLE IF NOT EXISTS ai_bot_admin_sessions (
  instance_id UUID NOT NULL REFERENCES ai_bot_instances(id) ON DELETE CASCADE,
  telegram_user_id TEXT NOT NULL,
  state TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (instance_id, telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_bot_admin_sessions_expiry
  ON ai_bot_admin_sessions (expires_at);
