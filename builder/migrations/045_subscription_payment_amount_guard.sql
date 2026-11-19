-- UCHIHA Builder migration 045: extend the subscription payment-method guard
-- so the captured activation/renewal amount must also fit the configured
-- minimum and maximum limits for that payment method.

CREATE OR REPLACE FUNCTION uchiha_validate_subscription_payment_method()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  request_type TEXT;
  payment_method_id UUID;
  request_amount BIGINT;
  payment_currency TEXT;
  payment_status TEXT;
  payment_minimum BIGINT;
  payment_maximum BIGINT;
  payment_account TEXT;
  payment_qr_data TEXT;
  payment_qr_image TEXT;
BEGIN
  request_type := COALESCE(NEW.metadata->>'requestType', '');
  IF request_type NOT IN ('subscription_activation', 'subscription_renewal') THEN
    RETURN NEW;
  END IF;

  BEGIN
    payment_method_id := (NEW.metadata->>'paymentMethodId')::UUID;
    request_amount := (NEW.metadata->>'amountMinor')::BIGINT;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Subscription request has invalid payment metadata'
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
     OR UPPER(COALESCE(payment_currency, '')) <> UPPER(COALESCE(NEW.metadata->>'currency', ''))
     OR (payment_minimum IS NOT NULL AND request_amount < payment_minimum)
     OR (payment_maximum IS NOT NULL AND request_amount > payment_maximum) THEN
    RAISE EXCEPTION 'Subscription payment method is unavailable, mismatched, or outside amount limits'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
