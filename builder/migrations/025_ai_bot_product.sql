-- UCHIHA Builder migration 025: sellable multi-tenant AI Telegram bot product.
-- The OpenAI credential stays platform-owned and environment-only. Customer Telegram
-- bot tokens are encrypted by the application before they reach these tables.

INSERT INTO service_catalog (
  service_key, name, summary, category, billing_kind, price_minor, currency,
  capabilities, dependencies, requires_manual_review, status, sort_order
) VALUES (
  'ai_chatbot',
  'بوت ذكاء اصطناعي',
  'بوت Telegram جاهز للبيع يعمل عبر ذكاء UCHIHA المركزي مع Free وPRO ولوحة إدارة.',
  'bot',
  'one_time',
  NULL,
  'USD',
  '["telegram","openai","free_model","pro_model","image_generation","admin_panel"]'::jsonb,
  '[]'::jsonb,
  FALSE,
  'active',
  35
)
ON CONFLICT (service_key) DO UPDATE SET
  name=EXCLUDED.name,
  summary=EXCLUDED.summary,
  category=EXCLUDED.category,
  billing_kind=EXCLUDED.billing_kind,
  capabilities=EXCLUDED.capabilities,
  dependencies=EXCLUDED.dependencies,
  requires_manual_review=FALSE,
  updated_at=NOW();

INSERT INTO platform_services (
  id, service_key, slug, icon_key, name_ar, name_en,
  description_ar, description_en, features_ar, features_en,
  starting_price_minor, currency, estimated_duration_ar, estimated_duration_en,
  request_schema, whatsapp_template_ar, whatsapp_template_en,
  status, sort_order, is_catalog_product, catalog_category_slug,
  catalog_subcategory_slug, product_image_url, order_schema
) VALUES (
  '10000000-0000-4000-8000-000000000015',
  'ai-chatbot',
  'ai-chatbot',
  'bot',
  'بوت ذكاء اصطناعي',
  'AI Chatbot',
  'بوت Telegram جاهز يعمل من ذكاء UCHIHA المركزي. يتضمن نموذجًا مجانيًا منخفض القدرات ونموذج PRO متقدمًا مع البرمجة والدراسة وإنشاء الصور.',
  'A ready-to-run Telegram AI bot powered by the central UCHIHA AI service, with Free and PRO models, coding, study, and image generation.',
  '["UCHIHA AI V1 مجاني","UCHIHA AI V2 PRO","برمجة ودراسة وصور","لوحة إدارة للمستخدمين والنماذج"]'::jsonb,
  '["Free UCHIHA AI V1","PRO UCHIHA AI V2","Coding, study and images","Users and models admin panel"]'::jsonb,
  NULL,
  'USD',
  'التفعيل بعد إضافة Telegram Bot Token',
  'Activated after adding a Telegram Bot Token',
  '{}'::jsonb,
  'مرحبًا، أريد تفاصيل بوت الذكاء الاصطناعي الجاهز.',
  'Hello, I would like details about the ready AI chatbot.',
  'active',
  35,
  TRUE,
  'bots',
  'ai',
  '/assets/catalog-assets/ai-chatbot.svg',
  '{"fields":[{"key":"displayName","type":"text","required":true},{"key":"telegramBotToken","type":"secret","required":true}]}'::jsonb
)
ON CONFLICT (service_key) DO UPDATE SET
  slug=EXCLUDED.slug,
  icon_key=EXCLUDED.icon_key,
  name_ar=EXCLUDED.name_ar,
  name_en=EXCLUDED.name_en,
  description_ar=EXCLUDED.description_ar,
  description_en=EXCLUDED.description_en,
  features_ar=EXCLUDED.features_ar,
  features_en=EXCLUDED.features_en,
  estimated_duration_ar=EXCLUDED.estimated_duration_ar,
  estimated_duration_en=EXCLUDED.estimated_duration_en,
  is_catalog_product=TRUE,
  catalog_category_slug=EXCLUDED.catalog_category_slug,
  catalog_subcategory_slug=EXCLUDED.catalog_subcategory_slug,
  product_image_url=EXCLUDED.product_image_url,
  order_schema=EXCLUDED.order_schema,
  updated_at=NOW();

CREATE TABLE IF NOT EXISTS platform_catalog_orders (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES platform_services(id) ON DELETE RESTRICT,
  project_id UUID REFERENCES platform_projects(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending_configuration' CHECK (
    status IN (
      'pending_configuration','provisioning','active','failed','suspended',
      'cancelled','refunded'
    )
  ),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  configuration JSONB NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_platform_catalog_orders_user_created
  ON platform_catalog_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_catalog_orders_status
  ON platform_catalog_orders (status, created_at);

CREATE TABLE IF NOT EXISTS ai_bot_instances (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL UNIQUE REFERENCES platform_catalog_orders(id) ON DELETE CASCADE,
  project_id UUID REFERENCES platform_projects(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES platform_services(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL DEFAULT 'UCHIHA AI',
  telegram_bot_id TEXT UNIQUE,
  telegram_username TEXT,
  token_ciphertext TEXT,
  token_fingerprint TEXT UNIQUE,
  token_masked TEXT,
  webhook_secret_ciphertext TEXT,
  webhook_secret_hash TEXT,
  owner_telegram_id TEXT,
  pro_subscribe_url TEXT,
  welcome_text TEXT NOT NULL DEFAULT 'اختر نموذج الذكاء الاصطناعي الذي تريد استخدامه.',
  status TEXT NOT NULL DEFAULT 'awaiting_token' CHECK (
    status IN ('awaiting_token','validated','provisioning','active','paused','failed','revoked')
  ),
  settings JSONB NOT NULL DEFAULT '{}',
  last_error TEXT,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_bot_instances_user_created
  ON ai_bot_instances (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_bot_instances_status
  ON ai_bot_instances (status, updated_at);

CREATE TABLE IF NOT EXISTS ai_bot_model_profiles (
  id UUID PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES ai_bot_instances(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  display_name TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  access_level TEXT NOT NULL CHECK (access_level IN ('free','pro')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  intelligence_label TEXT NOT NULL DEFAULT '',
  analysis_label TEXT NOT NULL DEFAULT '',
  image_quality_label TEXT NOT NULL DEFAULT '',
  coding_label TEXT NOT NULL DEFAULT '',
  education_label TEXT NOT NULL DEFAULT '',
  max_output_tokens INTEGER NOT NULL DEFAULT 1200 CHECK (max_output_tokens BETWEEN 128 AND 32768),
  reasoning_effort TEXT NOT NULL DEFAULT 'low',
  image_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  image_model TEXT NOT NULL DEFAULT 'gpt-image-2',
  image_quality TEXT NOT NULL DEFAULT 'low',
  system_prompt TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (instance_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_ai_bot_model_profiles_instance
  ON ai_bot_model_profiles (instance_id, enabled, sort_order);

CREATE TABLE IF NOT EXISTS ai_bot_end_users (
  instance_id UUID NOT NULL REFERENCES ai_bot_instances(id) ON DELETE CASCADE,
  telegram_user_id TEXT NOT NULL,
  username TEXT,
  full_name TEXT NOT NULL DEFAULT '',
  pro_until TIMESTAMPTZ,
  active_model_slug TEXT NOT NULL DEFAULT 'uchiha-v1',
  active_mode TEXT NOT NULL DEFAULT 'general' CHECK (active_mode IN ('general','coding','study','image')),
  previous_response_id TEXT,
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (instance_id, telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_bot_end_users_recent
  ON ai_bot_end_users (instance_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_bot_end_users_pro
  ON ai_bot_end_users (instance_id, pro_until DESC);

CREATE TABLE IF NOT EXISTS ai_bot_usage (
  id UUID PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES ai_bot_instances(id) ON DELETE CASCADE,
  telegram_user_id TEXT NOT NULL,
  model_profile_id UUID REFERENCES ai_bot_model_profiles(id) ON DELETE SET NULL,
  provider_model TEXT NOT NULL,
  request_kind TEXT NOT NULL CHECK (request_kind IN ('chat','image')),
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens BIGINT NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  provider_response_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','failed')),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_bot_usage_instance_created
  ON ai_bot_usage (instance_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_bot_usage_user_created
  ON ai_bot_usage (instance_id, telegram_user_id, created_at DESC);