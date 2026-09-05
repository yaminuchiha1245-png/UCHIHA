-- UCHIHA Builder migration 030: an owner may intentionally reuse the same
-- OpenAI API key across multiple purchased bots. Keep the fingerprint indexed
-- for diagnostics without enforcing cross-bot uniqueness.

DROP INDEX IF EXISTS idx_ai_bot_instances_openai_key_fingerprint;

CREATE INDEX IF NOT EXISTS idx_ai_bot_instances_openai_key_fingerprint
  ON ai_bot_instances (openai_key_fingerprint)
  WHERE openai_key_fingerprint IS NOT NULL;
