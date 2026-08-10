-- UCHIHA Builder migration 035: tenant RLS for proof-first wallet and admin bot state.
-- Policy creation is guarded because a short-lived 034 runtime migration may already
-- have installed these policies on a deployment before 034/035 were split cleanly.
ALTER TABLE wallet_topup_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_bot_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'wallet_topup_proofs'
      AND policyname = 'wallet_topup_proofs_tenant_isolation'
  ) THEN
    CREATE POLICY wallet_topup_proofs_tenant_isolation ON wallet_topup_proofs
      USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'admin_bot_sessions'
      AND policyname = 'admin_bot_sessions_tenant_isolation'
  ) THEN
    CREATE POLICY admin_bot_sessions_tenant_isolation ON admin_bot_sessions
      USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));
  END IF;
END
$$;
