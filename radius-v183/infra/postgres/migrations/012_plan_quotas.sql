ALTER TABLE plans ADD COLUMN IF NOT EXISTS quota_bytes BIGINT CHECK (quota_bytes IS NULL OR quota_bytes > 0);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS quota_period TEXT NOT NULL DEFAULT 'none' CHECK (quota_period IN ('none', 'daily', 'monthly'));
ALTER TABLE plans ADD COLUMN IF NOT EXISTS quota_action TEXT NOT NULL DEFAULT 'block' CHECK (quota_action IN ('block', 'throttle'));
ALTER TABLE plans ADD COLUMN IF NOT EXISTS throttle_down_mbps INTEGER CHECK (throttle_down_mbps IS NULL OR throttle_down_mbps > 0);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS throttle_up_mbps INTEGER CHECK (throttle_up_mbps IS NULL OR throttle_up_mbps > 0);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS duration_days INTEGER NOT NULL DEFAULT 30 CHECK (duration_days BETWEEN 1 AND 3660);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS simultaneous_use INTEGER NOT NULL DEFAULT 1 CHECK (simultaneous_use BETWEEN 1 AND 100);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'all' CHECK (scope_type IN ('all', 'device', 'site'));
ALTER TABLE plans ADD COLUMN IF NOT EXISTS scope_id TEXT;

CREATE INDEX IF NOT EXISTS radius_accounting_subscriber_time_idx
  ON radius_accounting_events(tenant_id, subscriber_id, occurred_at DESC);
