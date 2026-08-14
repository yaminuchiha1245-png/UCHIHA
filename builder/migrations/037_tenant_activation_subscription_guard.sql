-- UCHIHA Builder migration 037: an active tenant must always have a live subscription.
-- This is a database-level invariant so provisioning workers, admin routes, or
-- future code cannot accidentally reactivate an expired/unpaid tenant.

CREATE OR REPLACE FUNCTION uchiha_require_live_subscription_for_tenant_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM subscriptions AS s
       WHERE s.tenant_id = NEW.id
         AND s.status IN ('trial', 'active')
         AND s.ends_at > NOW()
    ) THEN
      RAISE EXCEPTION 'Tenant cannot become active without a live subscription'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uchiha_require_live_subscription_for_tenant_activation ON tenants;

CREATE TRIGGER trg_uchiha_require_live_subscription_for_tenant_activation
BEFORE UPDATE OF status ON tenants
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION uchiha_require_live_subscription_for_tenant_activation();
