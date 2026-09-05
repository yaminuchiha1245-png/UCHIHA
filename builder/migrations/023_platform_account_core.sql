-- UCHIHA Builder migration 023: platform account foundation.
-- This is the central customer account layer for UCHIHA services. It is separate
-- from individual storefront customer wallets and remains tied to platform_users.

CREATE TABLE IF NOT EXISTS platform_account_wallets (
  user_id UUID PRIMARY KEY REFERENCES platform_users(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  balance_minor BIGINT NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  held_minor BIGINT NOT NULL DEFAULT 0 CHECK (held_minor >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_account_ledger (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (
    entry_type IN (
      'deposit', 'purchase', 'refund', 'admin_adjustment',
      'internal_transfer', 'hold', 'release'
    )
  ),
  amount_minor BIGINT NOT NULL CHECK (amount_minor <> 0),
  balance_after_minor BIGINT NOT NULL CHECK (balance_after_minor >= 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reference_type TEXT,
  reference_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS platform_account_ledger_user_created_idx
  ON platform_account_ledger (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_account_preferences (
  user_id UUID PRIMARY KEY REFERENCES platform_users(id) ON DELETE CASCADE,
  locale TEXT NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar', 'en')),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  phone TEXT,
  telegram_user_id TEXT,
  telegram_username TEXT,
  notification_preferences JSONB NOT NULL DEFAULT '{"orders":true,"wallet":true,"security":true,"marketing":false}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_account_notifications (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  action_url TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS platform_account_notifications_user_created_idx
  ON platform_account_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS platform_account_notifications_unread_idx
  ON platform_account_notifications (user_id, read_at, created_at DESC);

INSERT INTO platform_account_wallets (user_id)
SELECT id FROM platform_users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO platform_account_preferences (user_id)
SELECT id FROM platform_users
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION initialize_platform_account_core()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO platform_account_wallets (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO platform_account_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS platform_users_account_core_trigger ON platform_users;
CREATE TRIGGER platform_users_account_core_trigger
AFTER INSERT ON platform_users
FOR EACH ROW
EXECUTE FUNCTION initialize_platform_account_core();
