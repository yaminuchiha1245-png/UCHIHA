-- Real platform catalog publishing and account-level balance deposit requests.
-- Existing seeded services remain hidden from the sale catalog until an administrator
-- explicitly marks a finished product as ready for sale.

ALTER TABLE platform_services
  ADD COLUMN IF NOT EXISTS is_catalog_product BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE platform_services
  ADD COLUMN IF NOT EXISTS catalog_category_slug TEXT;

ALTER TABLE platform_services
  ADD COLUMN IF NOT EXISTS catalog_subcategory_slug TEXT;

ALTER TABLE platform_services
  ADD COLUMN IF NOT EXISTS product_image_url TEXT;

ALTER TABLE platform_services
  ADD COLUMN IF NOT EXISTS order_schema JSONB NOT NULL DEFAULT '{}';

ALTER TABLE platform_services
  DROP CONSTRAINT IF EXISTS platform_services_catalog_location_check;

ALTER TABLE platform_services
  ADD CONSTRAINT platform_services_catalog_location_check CHECK (
    is_catalog_product = FALSE OR (
      catalog_category_slug IS NOT NULL AND length(trim(catalog_category_slug)) > 0 AND
      catalog_subcategory_slug IS NOT NULL AND length(trim(catalog_subcategory_slug)) > 0
    )
  );

CREATE INDEX IF NOT EXISTS idx_platform_services_catalog_listing
  ON platform_services (
    is_catalog_product,
    status,
    catalog_category_slug,
    catalog_subcategory_slug,
    sort_order,
    created_at
  );

CREATE TABLE IF NOT EXISTS platform_deposit_requests (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  payment_method_id UUID NOT NULL REFERENCES platform_payment_methods(id) ON DELETE RESTRICT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  payer_name TEXT,
  provider_reference TEXT,
  proof_mime TEXT NOT NULL CHECK (proof_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  proof_bytes BYTEA NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (
    status IN ('pending_review', 'approved', 'rejected', 'cancelled')
  ),
  admin_note TEXT,
  reviewed_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_platform_deposit_requests_user
  ON platform_deposit_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_deposit_requests_review
  ON platform_deposit_requests (status, created_at);
