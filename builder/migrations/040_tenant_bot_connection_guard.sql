-- UCHIHA Builder migration 040: Telegram webhooks must stop when a tenant is
-- not active, without destroying validated credentials needed for renewal.

CREATE OR REPLACE FUNCTION uchiha_sync_bot_connections_with_tenant_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status <> 'active' THEN
    UPDATE bot_connections
       SET status='validated', updated_at=NOW()
     WHERE tenant_id=NEW.id AND status='active';
  ELSIF OLD.status <> 'active' AND NEW.status = 'active' THEN
    UPDATE bot_connections
       SET status='active', updated_at=NOW()
     WHERE tenant_id=NEW.id AND status='validated';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uchiha_sync_bot_connections_with_tenant_status ON tenants;

CREATE TRIGGER trg_uchiha_sync_bot_connections_with_tenant_status
AFTER UPDATE OF status ON tenants
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION uchiha_sync_bot_connections_with_tenant_status();

-- Repair legacy webhook state so inactive tenants cannot keep receiving bot traffic.
UPDATE bot_connections AS bc
   SET status='validated', updated_at=NOW()
  FROM tenants AS t
 WHERE bc.tenant_id=t.id
   AND bc.status='active'
   AND t.status <> 'active';
