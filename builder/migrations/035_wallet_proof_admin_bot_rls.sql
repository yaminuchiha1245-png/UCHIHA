-- UCHIHA Builder migration 035: tenant RLS and replay protection for proof-first wallet/admin bot state.
-- Policy creation is guarded because a short-lived 034 runtime migration may already
-- have installed these policies on a deployment before 034/035 were split cleanly.
ALTER TABLE wallet_topup_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_bot_sessions ENABLE ROW LEVEL SECURITY;

-- A transfer reference or an identical receipt image must never be credited twice,
-- even if the browser generates a fresh idempotency key on a later submission.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_topup_proof_reference
  ON wallet_topup_proofs(customer_id, payment_method_id, reference_text)
  WHERE reference_text IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_topup_proof_image
  ON wallet_topup_proofs(customer_id, payment_method_id, proof_sha256)
  WHERE proof_sha256 IS NOT NULL;

-- The permanent demo must remain financially read-only for this new flow too.
DROP TRIGGER IF EXISTS trg_demo_wallet_topup_proofs_read_only ON wallet_topup_proofs;
CREATE TRIGGER trg_demo_wallet_topup_proofs_read_only
BEFORE INSERT OR UPDATE OR DELETE ON wallet_topup_proofs
FOR EACH ROW EXECUTE FUNCTION uchiha_block_demo_financial_writes();

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
