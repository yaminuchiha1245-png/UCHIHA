-- Preserve the provider selected during an authenticated, single-use Telegram link.
-- Existing owner-paired accounts retain NULL and continue using their previous
-- primary membership until they deliberately relink to a specific provider.
ALTER TABLE telegram_accounts
  ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_accounts_tenant ON telegram_accounts(tenant_id);
