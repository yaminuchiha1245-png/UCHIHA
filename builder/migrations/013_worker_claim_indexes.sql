CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_claim
  ON provisioning_jobs (status, run_after, lease_expires_at, created_at, id);

CREATE INDEX IF NOT EXISTS idx_provider_orders_claim
  ON provider_orders (status, lease_expires_at, created_at, id);

CREATE INDEX IF NOT EXISTS idx_outbox_events_delivery
  ON outbox_events (status, available_at, created_at, id);
