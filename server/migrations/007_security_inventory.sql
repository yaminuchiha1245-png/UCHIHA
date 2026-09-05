BEGIN;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS status_path TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_request_per_user
  ON orders(telegram_id, client_request_id)
  WHERE client_request_id IS NOT NULL AND client_request_id <> '';
CREATE TABLE IF NOT EXISTS inventory_codes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  value_enc TEXT,
  encrypted BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'available',
  order_no TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_product_status ON inventory_codes(product_id, status);
CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;
