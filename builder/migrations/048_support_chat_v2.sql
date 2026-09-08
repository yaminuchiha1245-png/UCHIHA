-- UCHIHA Builder migration 048: production support chat read state and encrypted attachments.
-- Extends the existing tenant-scoped support_threads/support_messages tables from migration 015.

ALTER TABLE support_threads
  ADD COLUMN IF NOT EXISTS customer_last_read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS staff_last_read_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS support_attachments (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES support_messages(id) ON DELETE CASCADE,
  uploader_type TEXT NOT NULL CHECK (uploader_type IN ('customer', 'staff', 'system')),
  uploader_customer_id UUID REFERENCES store_customers(id) ON DELETE SET NULL,
  uploader_user_id UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (
    mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain')
  ),
  content_ciphertext TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 4000000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (uploader_type = 'customer' AND uploader_customer_id IS NOT NULL AND uploader_user_id IS NULL) OR
    (uploader_type = 'staff' AND uploader_customer_id IS NULL AND uploader_user_id IS NOT NULL) OR
    (uploader_type = 'system' AND uploader_customer_id IS NULL AND uploader_user_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_support_attachments_thread
  ON support_attachments(tenant_id, store_id, thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_support_attachments_message
  ON support_attachments(message_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_support_attachment_hash_per_message
  ON support_attachments(message_id, content_hash);

ALTER TABLE support_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_attachments_tenant_isolation ON support_attachments;
CREATE POLICY support_attachments_tenant_isolation ON support_attachments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID);

-- Existing messages predate read receipts. Treat the current history as read so
-- launch does not manufacture unread badges for old conversations.
UPDATE support_threads st
SET customer_last_read_at = COALESCE(
      customer_last_read_at,
      (SELECT MAX(sm.created_at) FROM support_messages sm WHERE sm.thread_id = st.id AND sm.author_type = 'staff'),
      st.created_at
    ),
    staff_last_read_at = COALESCE(
      staff_last_read_at,
      (SELECT MAX(sm.created_at) FROM support_messages sm WHERE sm.thread_id = st.id AND sm.author_type = 'customer'),
      st.created_at
    )
WHERE customer_last_read_at IS NULL OR staff_last_read_at IS NULL;
