-- UCHIHA Builder migration 047: a live subscription payment reference may be
-- used only once per platform payment method across activation and renewal.
-- PostgreSQL owns the invariant so concurrent requests cannot race the
-- application-level duplicate check.

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_requests_subscription_payment_reference
ON service_requests (
  (metadata->>'paymentMethodId'),
  (LOWER(BTRIM(metadata->>'paymentReference')))
)
WHERE metadata->>'requestType' IN ('subscription_activation', 'subscription_renewal')
  AND COALESCE(metadata->>'paymentMethodId', '') <> ''
  AND COALESCE(BTRIM(metadata->>'paymentReference'), '') <> ''
  AND status NOT IN ('cancelled', 'rejected');
