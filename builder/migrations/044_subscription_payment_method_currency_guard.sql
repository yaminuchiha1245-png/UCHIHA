-- UCHIHA Builder migration 044: subscription activation and renewal requests
-- must use a configured, active, platform-level payment method in the exact
-- same currency as the captured offer/renewal amount.

CREATE OR REPLACE FUNCTION uchiha_validate_subscription_payment_method()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  request_type TEXT;
  payment_method_id UUID;
  payment_currency TEXT;
  payment_status TEXT;
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
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Subscription request has an invalid payment method identifier'
      USING ERRCODE = '23514';
  END;

  SELECT currency, status, account_identifier, qr_data, qr_image_url
    INTO payment_currency, payment_status, payment_account, payment_qr_data, payment_qr_image
    FROM platform_payment_methods
   WHERE id = payment_method_id
     AND tenant_id IS NULL
     AND store_id IS NULL;

  IF NOT FOUND
     OR payment_status <> 'active'
     OR (payment_account IS NULL AND payment_qr_data IS NULL AND payment_qr_image IS NULL)
     OR UPPER(COALESCE(payment_currency, '')) <> UPPER(COALESCE(NEW.metadata->>'currency', '')) THEN
    RAISE EXCEPTION 'Subscription payment method is unavailable or uses a different currency'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uchiha_validate_subscription_payment_method ON service_requests;

CREATE TRIGGER trg_uchiha_validate_subscription_payment_method
BEFORE INSERT OR UPDATE OF metadata ON service_requests
FOR EACH ROW
EXECUTE FUNCTION uchiha_validate_subscription_payment_method();
