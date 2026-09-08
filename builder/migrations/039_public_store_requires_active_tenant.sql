-- UCHIHA Builder migration 039: a publicly usable store must belong to an
-- active tenant. Provisioning and private-preview states remain allowed.

CREATE OR REPLACE FUNCTION uchiha_require_active_tenant_for_public_store()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status TEXT;
BEGIN
  IF NEW.status IN ('active', 'ready') THEN
    SELECT status INTO parent_status FROM tenants WHERE id = NEW.tenant_id;
    IF parent_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Public store requires an active tenant'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uchiha_require_active_tenant_for_public_store ON stores;

CREATE TRIGGER trg_uchiha_require_active_tenant_for_public_store
BEFORE INSERT OR UPDATE OF status, tenant_id ON stores
FOR EACH ROW
EXECUTE FUNCTION uchiha_require_active_tenant_for_public_store();

-- Repair legacy rows that could otherwise remain reachable through public APIs.
UPDATE stores AS s
   SET status='suspended', updated_at=NOW()
  FROM tenants AS t
 WHERE s.tenant_id=t.id
   AND s.status IN ('active', 'ready')
   AND t.status <> 'active';
