-- UCHIHA Builder migration 041: an active Telegram connection must always
-- belong to an active tenant. This closes the race where an in-flight webhook
-- configuration finishes after the tenant was suspended/expired.

CREATE OR REPLACE FUNCTION uchiha_require_active_tenant_for_active_bot()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status TEXT;
BEGIN
  IF NEW.status = 'active' THEN
    SELECT status INTO parent_status FROM tenants WHERE id = NEW.tenant_id;
    IF parent_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Active bot connection requires an active tenant'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uchiha_require_active_tenant_for_active_bot ON bot_connections;

CREATE TRIGGER trg_uchiha_require_active_tenant_for_active_bot
BEFORE INSERT OR UPDATE OF status, tenant_id ON bot_connections
FOR EACH ROW
EXECUTE FUNCTION uchiha_require_active_tenant_for_active_bot();

UPDATE bot_connections AS bc
   SET status='validated', updated_at=NOW()
  FROM tenants AS t
 WHERE bc.tenant_id=t.id
   AND bc.status='active'
   AND t.status <> 'active';
