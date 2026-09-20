CREATE INDEX IF NOT EXISTS idx_products_tenant_store_status_sort
  ON products (tenant_id, store_id, status, sort_order, created_at, id);

CREATE INDEX IF NOT EXISTS idx_products_tenant_store_category_status
  ON products (tenant_id, store_id, category_id, status, sort_order, created_at, id);

CREATE INDEX IF NOT EXISTS idx_products_tenant_store_name
  ON products (tenant_id, store_id, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_categories_tenant_store_parent_sort
  ON categories (tenant_id, store_id, parent_id, status, sort_order, created_at, id);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_store_created
  ON orders (tenant_id, store_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_product_analyses_review_queue
  ON product_input_analyses (tenant_id, store_id, status, confidence, analyzed_at DESC, id);
