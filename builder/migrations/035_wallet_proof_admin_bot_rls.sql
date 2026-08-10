-- UCHIHA Builder migration 035: tenant RLS for proof-first wallet and admin bot state.
ALTER TABLE wallet_topup_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_bot_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY wallet_topup_proofs_tenant_isolation ON wallet_topup_proofs
  USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));

CREATE POLICY admin_bot_sessions_tenant_isolation ON admin_bot_sessions
  USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));
