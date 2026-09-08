-- UCHIHA Builder migration 042: close the INSERT path as well as UPDATE.
-- A tenant may never enter the database already active without a live bound
-- subscription. Normal provisioning inserts non-active tenants and activates
-- them only after the subscription row exists.

CREATE OR REPLACE FUNCTION uchiha_require_live_subscription_for_tenant_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
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
BEFORE INSERT OR UPDATE OF status ON tenants
FOR EACH ROW
EXECUTE FUNCTION uchiha_require_live_subscription_for_tenant_activation();
