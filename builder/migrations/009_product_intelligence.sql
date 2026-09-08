-- UCHIHA Builder migration 009: deterministic product input analysis and review queue.
CREATE TABLE IF NOT EXISTS product_input_analyses (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  analyzer_version TEXT NOT NULL,
  detected_kind TEXT NOT NULL,
  confidence NUMERIC(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL CHECK (status IN ('auto_applied', 'review_required', 'approved', 'dismissed')),
  suggested_fields JSONB NOT NULL DEFAULT '[]',
  suggested_options JSONB NOT NULL DEFAULT '[]',
  signals JSONB NOT NULL DEFAULT '[]',
  reviewed_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  review_note TEXT,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, store_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_input_analysis_queue
  ON product_input_analyses(tenant_id, store_id, status, confidence, analyzed_at);
CREATE INDEX IF NOT EXISTS idx_products_store_catalog_search
  ON products(tenant_id, store_id, status, sort_order, created_at);
