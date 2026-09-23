-- Telegram Mini App accounts are linked only through trusted administration,
-- never created automatically by an unauthenticated request.
CREATE TABLE telegram_accounts (
    telegram_user_id TEXT PRIMARY KEY CHECK (telegram_user_id ~ '^[1-9][0-9]{3,16}$'),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_telegram_accounts_user ON telegram_accounts(user_id);
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS telegram_user_id TEXT;
GRANT SELECT ON telegram_accounts TO uchiha_runtime, uchiha_platform, uchiha_backup;
GRANT INSERT, UPDATE, DELETE ON telegram_accounts TO uchiha_platform;
