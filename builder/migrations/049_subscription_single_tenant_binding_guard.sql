-- UCHIHA Builder migration 049: a paid/trial subscription can be bound to one tenant exactly once.
-- The store creation transaction reads an unbound subscription before creating the tenant.
-- Concurrent create requests can therefore race before the later UPDATE obtains its row lock.
-- This database trigger makes the binding immutable so the losing transaction rolls back.

CREATE OR REPLACE FUNCTION uchiha_lock_subscription_tenant_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Subscription tenant binding is immutable once assigned'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.tenant_id IS NULL AND NEW.tenant_id IS NOT NULL THEN
    IF NEW.status NOT IN ('trial', 'active') OR NEW.ends_at <= NOW() THEN
      RAISE EXCEPTION 'Only a live subscription can be bound to a tenant'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uchiha_lock_subscription_tenant_binding ON subscriptions;

CREATE TRIGGER trg_uchiha_lock_subscription_tenant_binding
BEFORE UPDATE OF tenant_id ON subscriptions
FOR EACH ROW
WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id)
EXECUTE FUNCTION uchiha_lock_subscription_tenant_binding();
