-- UCHIHA Builder migration 043: keep the production showcase tenant usable
-- without weakening subscription enforcement for real customer tenants.
-- The exception is pinned to both the immutable showcase UUID and slug.

CREATE OR REPLACE FUNCTION uchiha_require_live_subscription_for_tenant_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active')
     AND NOT (
       NEW.id = '00000000-0000-4000-8000-000000000101'::UUID
       AND NEW.slug = 'showcase-demo'
     ) THEN
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
