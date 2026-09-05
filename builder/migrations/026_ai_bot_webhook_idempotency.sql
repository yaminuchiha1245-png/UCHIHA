-- UCHIHA Builder migration 026: exactly-once guard for Telegram AI bot updates.
-- Telegram may retry the same update_id after timeouts. Claiming updates before AI
-- execution prevents duplicate OpenAI spend and duplicate user replies.

CREATE TABLE IF NOT EXISTS ai_bot_telegram_updates (
  instance_id UUID NOT NULL REFERENCES ai_bot_instances(id) ON DELETE CASCADE,
  update_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  PRIMARY KEY (instance_id, update_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_bot_telegram_updates_cleanup
  ON ai_bot_telegram_updates (received_at, status);
