-- UCHIHA Builder migration 015: unified projects, platform services and store experience.
-- Every client (web, bots and mobile apps) continues to use the same Backend API and database.

CREATE TABLE IF NOT EXISTS service_catalog (
  service_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('store', 'bot', 'app', 'system', 'service')),
  billing_kind TEXT NOT NULL DEFAULT 'quote'
    CHECK (billing_kind IN ('one_time', 'subscription', 'quote')),
  price_minor BIGINT,
  currency TEXT NOT NULL DEFAULT 'USD',
  capabilities JSONB NOT NULL DEFAULT '[]',
  dependencies JSONB NOT NULL DEFAULT '[]',
  requires_manual_review BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'hidden', 'coming_soon')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_projects (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  project_type TEXT NOT NULL
    CHECK (project_type IN ('store', 'bot', 'app', 'system', 'mixed')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'configuring', 'provisioning', 'active',
      'review_required', 'suspended'
    )),
  source_channel TEXT NOT NULL DEFAULT 'web'
    CHECK (source_channel IN ('web', 'telegram', 'android', 'ios', 'admin')),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_components (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES platform_projects(id) ON DELETE CASCADE,
  service_key TEXT NOT NULL REFERENCES service_catalog(service_key),
  status TEXT NOT NULL DEFAULT 'pending_configuration'
    CHECK (status IN (
      'pending_configuration', 'queued', 'provisioning', 'active',
      'review_required', 'failed', 'suspended'
    )),
  configuration JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, service_key)
);

CREATE TABLE IF NOT EXISTS project_events (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES platform_projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_banners (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'image'
    CHECK (media_type IN ('image', 'gif', 'video', 'abstract')),
  media_url TEXT,
  link_url TEXT,
  action_label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'hidden')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, sort_order)
);

CREATE TABLE IF NOT EXISTS store_currency_settings (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  is_base BOOLEAN NOT NULL DEFAULT FALSE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  rate_to_base NUMERIC(20,8) NOT NULL DEFAULT 1 CHECK (rate_to_base > 0),
  rate_source TEXT NOT NULL DEFAULT 'base',
  rate_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, currency)
);

CREATE TABLE IF NOT EXISTS support_threads (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'waiting_customer', 'resolved', 'closed')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal', 'urgent')),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_messages (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL CHECK (author_type IN ('customer', 'staff', 'system')),
  author_customer_id UUID REFERENCES store_customers(id) ON DELETE SET NULL,
  author_user_id UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_projects_user
  ON platform_projects(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_project_components_project
  ON project_components(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_project_events_project
  ON project_events(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_store_banners_active
  ON store_banners(tenant_id, store_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_store_currency_settings
  ON store_currency_settings(tenant_id, store_id, is_enabled);
CREATE INDEX IF NOT EXISTS idx_support_threads_store
  ON support_threads(tenant_id, store_id, status, last_message_at);
CREATE INDEX IF NOT EXISTS idx_support_threads_customer
  ON support_threads(customer_id, last_message_at);
CREATE INDEX IF NOT EXISTS idx_support_messages_thread
  ON support_messages(thread_id, created_at);
