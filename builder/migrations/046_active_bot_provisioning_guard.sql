-- UCHIHA Builder migration 046: allow Telegram connections to become active
-- during the narrow, leased connect_bots/publish_store provisioning window,
-- while still requiring a live subscription. This preserves normal provisioning
-- and closes the race where an external Telegram call returns after expiry.

CREATE OR REPLACE FUNCTION uchiha_require_active_tenant_for_active_bot()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status TEXT;
  provisioning_allowed BOOLEAN := FALSE;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  SELECT status INTO parent_status FROM tenants WHERE id = NEW.tenant_id;
  IF parent_status = 'active' THEN
    RETURN NEW;
  END IF;

  IF parent_status = 'connecting_bots' THEN
    SELECT EXISTS (
      SELECT 1
        FROM subscriptions AS s
       WHERE s.tenant_id = NEW.tenant_id
         AND s.status IN ('trial', 'active')
         AND s.ends_at > NOW()
    ) AND EXISTS (
      SELECT 1
        FROM provisioning_jobs AS j
       WHERE j.tenant_id = NEW.tenant_id
         AND j.store_id = NEW.store_id
         AND j.job_type IN ('connect_bots', 'publish_store')
         AND j.status = 'running'
         AND j.claim_token IS NOT NULL
         AND j.lease_expires_at > NOW()
    ) INTO provisioning_allowed;
  END IF;

  IF NOT provisioning_allowed THEN
    RAISE EXCEPTION 'Active bot connection requires an active tenant or a live leased provisioning job'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
