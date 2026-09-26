-- Per-subscriber speed, daily quota and independent prices; no FX conversion.
ALTER TABLE subscribers ADD CONSTRAINT subscribers_tenant_id_id_unique UNIQUE (tenant_id,id);

CREATE TABLE subscriber_access_profiles (
  tenant_id TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  speed_down_mbps INTEGER NOT NULL CHECK (speed_down_mbps BETWEEN 1 AND 100000),
  speed_up_mbps INTEGER NOT NULL CHECK (speed_up_mbps BETWEEN 1 AND 100000),
  daily_quota_bytes BIGINT CHECK (daily_quota_bytes IS NULL OR daily_quota_bytes > 0),
  daily_quota_unit TEXT CHECK (daily_quota_unit IN ('MB','GB')),
  price_currency TEXT NOT NULL CHECK (price_currency IN ('USD','SYP','TRY')),
  prices_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id,subscriber_id),
  FOREIGN KEY (tenant_id,subscriber_id) REFERENCES subscribers(tenant_id,id) ON DELETE CASCADE,
  CHECK ((daily_quota_bytes IS NULL) = (daily_quota_unit IS NULL))
);

ALTER TABLE subscriber_access_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriber_access_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY subscriber_access_profiles_tenant_policy ON subscriber_access_profiles
  USING (app.has_tenant_access(tenant_id)) WITH CHECK (app.has_tenant_access(tenant_id));
