-- UCHIHA Builder migration 022: make the permanent demo storefront financially read-only.
-- This migration is additive and idempotent. It never deletes production data.
CREATE OR REPLACE FUNCTION uchiha_block_demo_financial_writes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected_store UUID;
  affected_id UUID;
  allowed_preview_row BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    affected_store := OLD.store_id;
    affected_id := OLD.id;
  ELSE
    affected_store := NEW.store_id;
    affected_id := NEW.id;
  END IF;

  IF affected_store = '00000000-0000-4000-8000-000000000102'::UUID THEN
    allowed_preview_row :=
      (TG_TABLE_NAME = 'orders' AND affected_id IN (
        '00000000-0000-4000-8000-000000000531'::UUID,
        '00000000-0000-4000-8000-000000000532'::UUID
      )) OR
      (TG_TABLE_NAME = 'deposit_requests' AND affected_id IN (
        '00000000-0000-4000-8000-000000000511'::UUID,
        '00000000-0000-4000-8000-000000000512'::UUID,
        '00000000-0000-4000-8000-000000000513'::UUID
      )) OR
      (TG_TABLE_NAME = 'wallet_ledger' AND affected_id IN (
        '00000000-0000-4000-8000-000000000521'::UUID,
        '00000000-0000-4000-8000-000000000522'::UUID,
        '00000000-0000-4000-8000-000000000523'::UUID
      ));

    IF NOT allowed_preview_row THEN
      RAISE EXCEPTION 'demo_store_read_only'
        USING ERRCODE = 'P0001',
              DETAIL = 'The permanent demo store cannot create real orders, deposits, ledger entries, or provider orders.',
              HINT = 'Use a non-demo tenant for financial operations.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_demo_orders_read_only ON orders;
CREATE TRIGGER trg_demo_orders_read_only
BEFORE INSERT OR UPDATE OR DELETE ON orders
FOR EACH ROW EXECUTE FUNCTION uchiha_block_demo_financial_writes();

DROP TRIGGER IF EXISTS trg_demo_deposits_read_only ON deposit_requests;
CREATE TRIGGER trg_demo_deposits_read_only
BEFORE INSERT OR UPDATE OR DELETE ON deposit_requests
FOR EACH ROW EXECUTE FUNCTION uchiha_block_demo_financial_writes();

DROP TRIGGER IF EXISTS trg_demo_ledger_read_only ON wallet_ledger;
CREATE TRIGGER trg_demo_ledger_read_only
BEFORE INSERT OR UPDATE OR DELETE ON wallet_ledger
FOR EACH ROW EXECUTE FUNCTION uchiha_block_demo_financial_writes();

DROP TRIGGER IF EXISTS trg_demo_provider_orders_read_only ON provider_orders;
CREATE TRIGGER trg_demo_provider_orders_read_only
BEFORE INSERT OR UPDATE OR DELETE ON provider_orders
FOR EACH ROW EXECUTE FUNCTION uchiha_block_demo_financial_writes();
