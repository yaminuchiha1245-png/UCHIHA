-- UCHIHA Builder migration 038: a pending renewal request may only extend a
-- subscription while its captured amount/currency still match the current offer.
-- This closes the race where an administrator changes the renewal price after a
-- customer submitted proof but before the proof is approved.

CREATE OR REPLACE FUNCTION uchiha_guard_subscription_renewal_price()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  renewal_request JSONB;
  current_price BIGINT;
  current_currency TEXT;
BEGIN
  IF NEW.ends_at > OLD.ends_at THEN
    SELECT sr.metadata
      INTO renewal_request
      FROM service_requests AS sr
     WHERE sr.metadata->>'requestType' = 'subscription_renewal'
       AND sr.metadata->>'subscriptionId' = NEW.id::TEXT
       AND sr.status NOT IN ('completed', 'cancelled', 'rejected')
     ORDER BY sr.created_at DESC
     LIMIT 1;

    IF renewal_request IS NOT NULL THEN
      SELECT o.renewal_price_minor, o.currency
        INTO current_price, current_currency
        FROM subscription_offers AS o
       WHERE o.id = NEW.offer_id;

      IF current_price IS NULL
         OR current_price <= 0
         OR COALESCE((renewal_request->>'amountMinor')::BIGINT, -1) <> current_price
         OR UPPER(COALESCE(renewal_request->>'currency', '')) <> UPPER(COALESCE(current_currency, '')) THEN
        RAISE EXCEPTION 'Renewal price or currency changed after request creation'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uchiha_guard_subscription_renewal_price ON subscriptions;

CREATE TRIGGER trg_uchiha_guard_subscription_renewal_price
BEFORE UPDATE OF ends_at ON subscriptions
FOR EACH ROW
WHEN (OLD.ends_at IS DISTINCT FROM NEW.ends_at)
EXECUTE FUNCTION uchiha_guard_subscription_renewal_price();
