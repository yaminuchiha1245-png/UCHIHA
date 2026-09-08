-- UCHIHA Builder migration 050: final payment revalidation for subscription sales.
-- A payment method, offer price, or renewal price can change after a customer
-- submits proof but before an administrator approves it. Revalidate at the
-- database boundary when the request becomes completed so every approval path
-- (web admin, bot, or future integration) fails closed on stale payment data.

CREATE OR REPLACE FUNCTION uchiha_revalidate_subscription_request_on_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  request_type TEXT;
  payment_method_id UUID;
  request_amount BIGINT;
  request_currency TEXT;
  request_offer_id UUID;
  request_subscription_id UUID;
  request_tenant_id UUID;
  payment_currency TEXT;
  payment_status TEXT;
  payment_minimum BIGINT;
  payment_maximum BIGINT;
  payment_account TEXT;
  payment_qr_data TEXT;
  payment_qr_image TEXT;
  expected_amount BIGINT;
  expected_currency TEXT;
  offer_enabled BOOLEAN;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  request_type := COALESCE(NEW.metadata->>'requestType', '');
  IF request_type NOT IN ('subscription_activation', 'subscription_renewal') THEN
    RETURN NEW;
  END IF;

  BEGIN
    payment_method_id := (NEW.metadata->>'paymentMethodId')::UUID;
    request_amount := (NEW.metadata->>'amountMinor')::BIGINT;
    request_currency := UPPER(COALESCE(NEW.metadata->>'currency', ''));
    request_offer_id := (NEW.metadata->>'offerId')::UUID;
    IF request_type = 'subscription_renewal' THEN
      request_subscription_id := (NEW.metadata->>'subscriptionId')::UUID;
      request_tenant_id := (NEW.metadata->>'tenantId')::UUID;
    END IF;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Subscription approval has invalid payment metadata'
      USING ERRCODE = '23514';
  END;

  SELECT currency, status, minimum_amount_minor, maximum_amount_minor,
         account_identifier, qr_data, qr_image_url
    INTO payment_currency, payment_status, payment_minimum, payment_maximum,
         payment_account, payment_qr_data, payment_qr_image
    FROM platform_payment_methods
   WHERE id = payment_method_id
     AND tenant_id IS NULL
     AND store_id IS NULL;

  IF NOT FOUND
     OR request_amount <= 0
     OR payment_status <> 'active'
     OR (payment_account IS NULL AND payment_qr_data IS NULL AND payment_qr_image IS NULL)
     OR UPPER(COALESCE(payment_currency, '')) <> request_currency
     OR (payment_minimum IS NOT NULL AND request_amount < payment_minimum)
     OR (payment_maximum IS NOT NULL AND request_amount > payment_maximum) THEN
    RAISE EXCEPTION 'Subscription approval payment method is stale, mismatched, or outside amount limits'
      USING ERRCODE = '23514';
  END IF;

  IF request_type = 'subscription_activation' THEN
    SELECT price_minor, currency, sale_enabled
      INTO expected_amount, expected_currency, offer_enabled
      FROM subscription_offers
     WHERE id = request_offer_id;
  ELSE
    SELECT o.renewal_price_minor, o.currency, o.renewal_enabled
      INTO expected_amount, expected_currency, offer_enabled
      FROM subscriptions s
      JOIN subscription_offers o ON o.id = s.offer_id
     WHERE s.id = request_subscription_id
       AND s.tenant_id = request_tenant_id
       AND s.user_id = NEW.user_id
       AND s.offer_id = request_offer_id;
  END IF;

  IF NOT FOUND
     OR offer_enabled IS DISTINCT FROM TRUE
     OR expected_amount IS NULL
     OR expected_amount <= 0
     OR request_amount <> expected_amount
     OR request_currency <> UPPER(COALESCE(expected_currency, '')) THEN
    RAISE EXCEPTION 'Subscription approval offer or price changed after payment proof submission'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uchiha_revalidate_subscription_request_completion ON service_requests;

CREATE TRIGGER trg_uchiha_revalidate_subscription_request_completion
BEFORE UPDATE OF status ON service_requests
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION uchiha_revalidate_subscription_request_on_completion();
