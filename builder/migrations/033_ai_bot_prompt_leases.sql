-- UCHIHA Builder migration 033: serialize normal AI prompts per purchased bot/user
-- without holding a PostgreSQL pool connection during the external OpenAI call.
-- A short lease prevents concurrent bursts from bypassing daily request/image limits.

CREATE TABLE IF NOT EXISTS ai_bot_prompt_leases (
  instance_id UUID NOT NULL REFERENCES ai_bot_instances(id) ON DELETE CASCADE,
  telegram_user_id TEXT NOT NULL,
  lease_token UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (instance_id, telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_bot_prompt_leases_expiry
  ON ai_bot_prompt_leases (expires_at);
