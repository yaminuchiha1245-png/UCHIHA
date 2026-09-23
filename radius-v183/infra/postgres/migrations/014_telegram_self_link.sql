-- Secure per-provider Telegram pairing after authenticating an existing member.
-- The full one-time code never persists; only its SHA256 domain-separated digest.
CREATE TABLE telegram_link_challenges (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX telegram_link_challenges_user_idx
  ON telegram_link_challenges(user_id, tenant_id, expires_at);
ALTER TABLE telegram_link_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_link_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY telegram_link_runtime ON telegram_link_challenges TO uchiha_runtime
  USING (app.has_tenant_access(tenant_id))
  WITH CHECK (app.has_tenant_access(tenant_id));
CREATE POLICY telegram_link_platform ON telegram_link_challenges TO uchiha_platform
  USING (TRUE) WITH CHECK (TRUE);
GRANT SELECT, INSERT, DELETE ON telegram_link_challenges TO uchiha_runtime;
GRANT SELECT, UPDATE ON telegram_link_challenges TO uchiha_platform;
