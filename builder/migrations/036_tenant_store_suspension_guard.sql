-- UCHIHA Builder migration 036: fail closed when an active tenant leaves service.
--
-- Public storefront/payment routes may only remain live while their tenant is active.
-- We deliberately do not auto-reactivate stores when a tenant becomes active again;
-- reactivation must remain an explicit business/admin action so a store that was
-- intentionally suspended for another reason is never reopened by accident.

CREATE OR REPLACE FUNCTION uchiha_suspend_stores_when_tenant_deactivates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status <> 'active' THEN
    UPDATE stores
       SET status = 'suspended',
           updated_at = NOW()
     WHERE tenant_id = NEW.id
       AND status IN ('active', 'ready');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uchiha_suspend_stores_when_tenant_deactivates ON tenants;

CREATE TRIGGER trg_uchiha_suspend_stores_when_tenant_deactivates
AFTER UPDATE OF status ON tenants
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION uchiha_suspend_stores_when_tenant_deactivates();

-- Repair legacy inconsistent rows only for states that are unambiguously not
-- allowed to transact publicly. Provisioning/ready-to-publish tenants are left
-- untouched so private preview flows are not disrupted.
UPDATE stores AS s
   SET status = 'suspended',
       updated_at = NOW()
  FROM tenants AS t
 WHERE s.tenant_id = t.id
   AND t.status IN ('suspended', 'subscription_expired', 'review_required')
   AND s.status IN ('active', 'ready');
