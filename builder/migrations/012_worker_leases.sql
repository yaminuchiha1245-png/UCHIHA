ALTER TABLE provisioning_jobs ADD COLUMN claim_token TEXT;
ALTER TABLE provisioning_jobs ADD COLUMN lease_expires_at TIMESTAMPTZ;

ALTER TABLE provider_orders ADD COLUMN claim_token TEXT;
ALTER TABLE provider_orders ADD COLUMN lease_expires_at TIMESTAMPTZ;
