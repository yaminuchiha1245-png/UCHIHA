ALTER TABLE tenant_subscriptions
  ADD COLUMN IF NOT EXISTS checkout_url TEXT,
  ADD COLUMN IF NOT EXISTS checkout_expires_at TIMESTAMPTZ;
