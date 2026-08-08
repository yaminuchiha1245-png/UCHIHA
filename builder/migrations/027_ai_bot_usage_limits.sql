-- UCHIHA Builder migration 027: merchant-visible Free/PRO usage limits.
-- Platform-wide emergency protection remains server-side in AI_PLATFORM_DAILY_REQUEST_LIMIT.

ALTER TABLE ai_bot_instances
  ADD COLUMN IF NOT EXISTS free_daily_request_limit INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS pro_daily_request_limit INTEGER NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS free_daily_image_limit INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS pro_daily_image_limit INTEGER NOT NULL DEFAULT 30;

ALTER TABLE ai_bot_instances
  DROP CONSTRAINT IF EXISTS ai_bot_instances_free_daily_request_limit_check,
  ADD CONSTRAINT ai_bot_instances_free_daily_request_limit_check
    CHECK (free_daily_request_limit BETWEEN 1 AND 200),
  DROP CONSTRAINT IF EXISTS ai_bot_instances_pro_daily_request_limit_check,
  ADD CONSTRAINT ai_bot_instances_pro_daily_request_limit_check
    CHECK (pro_daily_request_limit BETWEEN 1 AND 2000),
  DROP CONSTRAINT IF EXISTS ai_bot_instances_free_daily_image_limit_check,
  ADD CONSTRAINT ai_bot_instances_free_daily_image_limit_check
    CHECK (free_daily_image_limit BETWEEN 0 AND 20),
  DROP CONSTRAINT IF EXISTS ai_bot_instances_pro_daily_image_limit_check,
  ADD CONSTRAINT ai_bot_instances_pro_daily_image_limit_check
    CHECK (pro_daily_image_limit BETWEEN 0 AND 200);

CREATE INDEX IF NOT EXISTS idx_ai_bot_usage_daily_limits
  ON ai_bot_usage (instance_id, telegram_user_id, request_kind, created_at DESC)
  WHERE status='completed';

CREATE INDEX IF NOT EXISTS idx_ai_bot_usage_global_daily_guard
  ON ai_bot_usage (created_at DESC)
  WHERE status='completed';