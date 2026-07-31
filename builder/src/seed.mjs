import { randomUUID } from "node:crypto";
import { encryptSecret, hashPassword, normalizeEmail } from "./security.mjs";
import { syncProvider, UCHIHA_API_1_ALIAS } from "./providers.mjs";

const programmingServiceNames = [
  "إنشاء متجر إلكتروني",
  "إنشاء بوت متجر",
  "إنشاء بوت خدمات",
  "إنشاء بوت مخصص",
  "إنشاء موقع إلكتروني",
  "إنشاء تطبيق Android",
  "إنشاء تطبيق iOS",
  "إنشاء لوحة إدارة",
  "ربط API",
  "تطوير ميزة خاصة",
  "تصميم واجهة",
  "صيانة مشروع",
  "استضافة ونشر",
  "ربط دومين",
  "إعداد متجر موجود",
  "تعديل متجر",
  "استشارة تقنية"
];

const platformServiceCatalog = Object.freeze([
  {
    key: "store_website",
    name: "موقع متجر إلكتروني",
    summary: "واجهة متجر سريعة للأقسام والمنتجات والطلبات والمحفظة.",
    category: "store",
    billingKind: "subscription",
    capabilities: ["catalog", "orders", "wallet", "support", "pwa"],
    dependencies: []
  },
  {
    key: "web_admin",
    name: "لوحة إدارة الويب",
    summary: "إدارة مبسطة للكتالوج والطلبات والعملاء والتصميم.",
    category: "system",
    billingKind: "subscription",
    capabilities: ["dashboard", "catalog", "payments", "analytics"],
    dependencies: ["store_website"]
  },
  {
    key: "storefront_bot",
    name: "بوت المتجر",
    summary: "قناة بيع تيليجرام مرتبطة بنفس المنتجات والطلبات.",
    category: "bot",
    billingKind: "subscription",
    capabilities: ["telegram", "catalog", "orders"],
    dependencies: ["store_website"]
  },
  {
    key: "admin_bot",
    name: "بوت الإدارة",
    summary: "تنبيهات وتحكم سريع للمالك من تيليجرام.",
    category: "bot",
    billingKind: "subscription",
    capabilities: ["telegram", "notifications", "order_actions"],
    dependencies: ["store_website"]
  },
  {
    key: "android_app",
    name: "تطبيق Android",
    summary: "تطبيق إدارة UCHIHA للهاتف يعمل على نفس واجهة الـAPI.",
    category: "app",
    billingKind: "quote",
    capabilities: ["android", "push_notifications", "owner_workspace"],
    dependencies: ["web_admin"]
  },
  {
    key: "ios_app",
    name: "تطبيق iPhone وiPad",
    summary: "تطبيق iOS أصلي الغلاف ومتصّل بنفس الحساب والمشاريع.",
    category: "app",
    billingKind: "quote",
    capabilities: ["ios", "push_notifications", "owner_workspace"],
    dependencies: ["web_admin"],
    requiresManualReview: true
  },
  {
    key: "custom_system",
    name: "نظام مخصص",
    summary: "نظام أعمال يُحلّل ويُسعّر بحسب المتطلبات.",
    category: "system",
    billingKind: "quote",
    capabilities: ["custom_workflow", "roles", "integrations"],
    dependencies: [],
    requiresManualReview: true,
    status: "coming_soon"
  },
  {
    key: "custom_service",
    name: "خدمة برمجية مخصصة",
    summary: "تنفيذ ميزة أو تكامل خاص تحت إدارة مشروع UCHIHA.",
    category: "service",
    billingKind: "quote",
    capabilities: ["custom_delivery"],
    dependencies: [],
    requiresManualReview: true,
    status: "coming_soon"
  }
]);

export async function seedPlatformServiceCatalog(db, currency = "USD") {
  for (const [sortOrder, service] of platformServiceCatalog.entries()) {
    await db.query(
      `INSERT INTO service_catalog (
         service_key, name, summary, category, billing_kind, price_minor,
         currency, capabilities, dependencies, requires_manual_review, status, sort_order
       ) VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (service_key) DO UPDATE SET
         name=EXCLUDED.name, summary=EXCLUDED.summary, category=EXCLUDED.category,
         billing_kind=EXCLUDED.billing_kind, currency=EXCLUDED.currency,
         capabilities=EXCLUDED.capabilities, dependencies=EXCLUDED.dependencies,
         requires_manual_review=EXCLUDED.requires_manual_review,
         status=EXCLUDED.status, sort_order=EXCLUDED.sort_order, updated_at=NOW()`,
      [
        service.key,
        service.name,
        service.summary,
        service.category,
        service.billingKind,
        currency,
        JSON.stringify(service.capabilities),
        JSON.stringify(service.dependencies),
        Boolean(service.requiresManualReview),
        service.status || "active",
        (sortOrder + 1) * 10
      ]
    );
  }
}

export async function ensureSubscriptionOffer(db, offer) {
  const existing = await db.query("SELECT * FROM subscription_offers ORDER BY created_at LIMIT 1");
  if (existing.rows[0]) return existing.rows[0];
  const required = [
    offer?.priceMinor,
    offer?.renewalPriceMinor,
    offer?.durationCount,
    offer?.durationUnit
  ];
  if (required.some((value) => value === null || value === undefined || value === "")) {
    throw new Error("Subscription seed requires configurable price, renewal price, duration unit and duration count");
  }
  const id = randomUUID();
  await db.query(
    `INSERT INTO subscription_offers (
       id, name, price_minor, renewal_price_minor, currency, duration_unit,
       duration_count, trial_days, discount_percent, sale_enabled, renewal_enabled
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, TRUE, TRUE)`,
    [
      id,
      offer.name || "UCHIHA Full",
      offer.priceMinor,
      offer.renewalPriceMinor,
      offer.currency,
      offer.durationUnit,
      offer.durationCount,
      offer.trialDays || 0
    ]
  );
  return (await db.query("SELECT * FROM subscription_offers WHERE id = $1", [id])).rows[0];
}

export async function ensurePlatformAdmin(db, email, password) {
  if (!email || !password) return null;
  const normalized = normalizeEmail(email);
  const existing = await db.query("SELECT * FROM platform_users WHERE email = $1", [normalized]);
  if (existing.rows[0]) {
    if (!existing.rows[0].is_platform_admin) {
      await db.query("UPDATE platform_users SET is_platform_admin = TRUE, updated_at = NOW() WHERE id = $1", [
        existing.rows[0].id
      ]);
    }
    return existing.rows[0];
  }
  const id = randomUUID();
  await db.query(
    `INSERT INTO platform_users (
       id, email, display_name, password_hash, is_platform_admin
     ) VALUES ($1, $2, 'UCHIHA Platform Admin', $3, TRUE)`,
    [id, normalized, await hashPassword(password)]
  );
  return (await db.query("SELECT * FROM platform_users WHERE id = $1", [id])).rows[0];
}

export async function ensureUchihaApi1(db, config) {
  const existing = await db.query("SELECT * FROM api_providers WHERE public_alias = $1", [UCHIHA_API_1_ALIAS]);
  if (existing.rows[0]) return existing.rows[0];
  const id = randomUUID();
  const testMode = config.providerMode !== "live";
  const credential = config.providerToken || (testMode ? "test-mode-no-external-request" : "");
  if (!credential) throw new Error("UCHIHA API 1 live mode requires a provider token");
  await db.query(
    `INSERT INTO api_providers (
       id, internal_name, public_alias, adapter_key, base_url, currency,
       test_mode, connection_status, credentials_ciphertext, sync_settings, retry_settings
     ) VALUES (
       $1, 'JAS4CARD', $2, 'jas4card', 'https://api.js4card.com/client/api',
       'USD', $3, 'unknown', $4, $5, $6
     )`,
    [
      id,
      UCHIHA_API_1_ALIAS,
      testMode,
      encryptSecret(credential, config.encryptionKey),
      { intervalMinutes: 60, syncPrices: true, syncAvailability: true },
      { maxAttempts: 5, baseDelaySeconds: 10 }
    ]
  );
  return (await db.query("SELECT * FROM api_providers WHERE id = $1", [id])).rows[0];
}

export async function seedProgrammingServices(db, currency = "USD") {
  for (const name of programmingServiceNames) {
    await db.query(
      `INSERT INTO programming_services (
         id, name, description, starting_price_minor, currency,
         estimated_duration, fields, options, resale_enabled, status
       ) VALUES ($1, $2, $3, 0, $4, NULL, $5, '[]', TRUE, 'active')
       ON CONFLICT (name) DO NOTHING`,
      [
        randomUUID(),
        name,
        `خدمة ${name} تُدار من منصة UCHIHA ويمكن تعديل وصفها وسعرها وحقولها من لوحة مدير المنصة.`,
        currency,
        JSON.stringify([
          { key: "requirements", label: "تفاصيل الطلب", type: "textarea", required: true },
          { key: "attachments", label: "مرفقات", type: "file", required: false }
        ])
      ]
    );
  }
}

const SHOWCASE = Object.freeze({
  tenantId: "00000000-0000-4000-8000-000000000101",
  storeId: "00000000-0000-4000-8000-000000000102",
  categories: {
    games: "00000000-0000-4000-8000-000000000201",
    subscriptions: "00000000-0000-4000-8000-000000000202",
    digital: "00000000-0000-4000-8000-000000000203",
    topup: "00000000-0000-4000-8000-000000000211",
    memberships: "00000000-0000-4000-8000-000000000212",
    gameCards: "00000000-0000-4000-8000-000000000213",
    workSubscriptions: "00000000-0000-4000-8000-000000000214"
  }
});

export async function ensureShowcaseStore(db) {
  await db.query(
    `INSERT INTO tenants (id, slug, name, status)
     VALUES ($1, 'showcase-demo', 'UCHIHA Store Demo', 'active')
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, status='active', updated_at=NOW()`,
    [SHOWCASE.tenantId]
  );
  await db.query(
    `INSERT INTO stores (
       id, tenant_id, name, slug, activity_type, description, country, language,
       currency, template_key, status, contact_data, welcome_message
     ) VALUES (
       $1,$2,'UCHIHA Store','demo','digital-products',
       'متجر UCHIHA التجريبي يعرض تجربة شراء رقمية واضحة وآمنة من منصة UCHIHA Builder.',
       'TR','ar','USD','professional-dark','active',$3,
       'أهلًا بك في عالم UCHIHA للخدمات والمنتجات الرقمية.'
     )
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name, description=EXCLUDED.description, template_key=EXCLUDED.template_key,
       status='active', contact_data=EXCLUDED.contact_data,
       welcome_message=EXCLUDED.welcome_message, updated_at=NOW()`,
    [
      SHOWCASE.storeId,
      SHOWCASE.tenantId,
      JSON.stringify({})
    ]
  );
  await db.query(
    `INSERT INTO store_design_tokens (
       tenant_id, store_id, primary_color, secondary_color, background_color,
       surface_color, text_color, muted_text_color, border_color, success_color,
       warning_color, danger_color, font_family, border_radius, button_style,
       card_style, logo_url, favicon_url, cover_url
     ) VALUES (
       $1,$2,'#e21d35','#5f0b17','#060709','#111216','#f8f8fa','#a2a4ad',
       '#282a31','#35c96f','#f0aa35','#ed334d','Tajawal','16px','solid',
       'bordered','/assets/brand/uchiha-mark.svg','/assets/brand/favicon.svg',NULL
     )
     ON CONFLICT (store_id) DO UPDATE SET
       primary_color=EXCLUDED.primary_color, secondary_color=EXCLUDED.secondary_color,
       background_color=EXCLUDED.background_color, surface_color=EXCLUDED.surface_color,
       text_color=EXCLUDED.text_color, muted_text_color=EXCLUDED.muted_text_color,
       border_color=EXCLUDED.border_color, success_color=EXCLUDED.success_color,
       warning_color=EXCLUDED.warning_color, danger_color=EXCLUDED.danger_color,
       font_family=EXCLUDED.font_family, border_radius=EXCLUDED.border_radius,
       button_style=EXCLUDED.button_style, card_style=EXCLUDED.card_style,
       logo_url=EXCLUDED.logo_url, favicon_url=EXCLUDED.favicon_url,
       cover_url=EXCLUDED.cover_url, updated_at=NOW()`,
    [SHOWCASE.tenantId, SHOWCASE.storeId]
  );
  await db.query(
    `INSERT INTO store_experience_settings (
       store_id, tenant_id, identity_verification_enabled,
       floating_support_enabled, light_mode_enabled, storefront_api_enabled,
       builder_promo_url
     ) VALUES ($1,$2,TRUE,TRUE,TRUE,TRUE,'/')
     ON CONFLICT (store_id) DO UPDATE SET
       identity_verification_enabled=TRUE,
       floating_support_enabled=TRUE,
       light_mode_enabled=TRUE,
       storefront_api_enabled=TRUE,
       builder_promo_url='/', updated_at=NOW()`,
    [SHOWCASE.storeId, SHOWCASE.tenantId]
  );
  await db.query(
    `INSERT INTO store_banners (
       id, tenant_id, store_id, title, subtitle, media_type, media_url,
       link_url, action_label, status, sort_order
     ) VALUES (
       '00000000-0000-4000-8000-000000000401',$1,$2,
       'أهلًا بك في عالم UCHIHA',
       'اختر قسمك ووصل إلى المنتج أو الخدمة التي تحتاجها بخطوات سريعة وواضحة.',
       'abstract',NULL,'#categories','تسوّق الآن','active',0
     )
     ON CONFLICT (id) DO UPDATE SET
       title=EXCLUDED.title, subtitle=EXCLUDED.subtitle,
       media_type=EXCLUDED.media_type, media_url=EXCLUDED.media_url,
       link_url=EXCLUDED.link_url, action_label=EXCLUDED.action_label,
       status='active', updated_at=NOW()`,
    [SHOWCASE.tenantId, SHOWCASE.storeId]
  );
  await db.query(
    `INSERT INTO store_currency_settings (
       id, tenant_id, store_id, currency, is_base, is_enabled,
       rate_to_base, rate_source
     ) VALUES (
       '00000000-0000-4000-8000-000000000402',$1,$2,'USD',TRUE,TRUE,1,'base'
     )
     ON CONFLICT (store_id, currency) DO UPDATE SET
       is_base=TRUE, is_enabled=TRUE, rate_to_base=1,
       rate_source='base', rate_updated_at=NOW(), updated_at=NOW()`,
    [SHOWCASE.tenantId, SHOWCASE.storeId]
  );
  const demoPaymentMethods = [
    ["00000000-0000-4000-8000-000000000411", "تحويل بنكي", "bank_transfer", "حوّل إلى الحساب الموضح ثم ارفع إثبات التحويل.", { accountName: "UCHIHA Store — Demo", iban: "DEMO-NOT-FOR-PAYMENT" }, 10],
    ["00000000-0000-4000-8000-000000000412", "USDT — TRC20", "usdt_trc20", "أرسل المبلغ عبر شبكة TRC20 فقط.", { network: "TRC20", address: "DEMO-WALLET" }, 20],
    ["00000000-0000-4000-8000-000000000413", "Binance Pay", "binance_pay", "استخدم معرّف Binance Pay ثم أرفق لقطة التحويل.", { payId: "DEMO-PAY-ID" }, 30]
  ];
  for (const [id, name, type, instructions, destination, sortOrder] of demoPaymentMethods) {
    await db.query(
      `INSERT INTO payment_methods (
         id, tenant_id, store_id, name, method_type, instructions,
         destination_data, commission_bps, fixed_fee_minor,
         minimum_amount_minor, maximum_amount_minor, sort_order, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,100,NULL,$8,'active')
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, instructions=EXCLUDED.instructions,
         destination_data=EXCLUDED.destination_data,
         sort_order=EXCLUDED.sort_order, status='active', updated_at=NOW()`,
      [id, SHOWCASE.tenantId, SHOWCASE.storeId, name, type, instructions, JSON.stringify(destination), sortOrder]
    );
  }

  const categories = [
    [SHOWCASE.categories.games, null, "الألعاب والشحن", "games-topup", "/assets/catalog-assets/game-topup.svg", 10],
    [SHOWCASE.categories.subscriptions, null, "الاشتراكات", "subscriptions", "/assets/catalog-assets/subscription.svg", 20],
    [SHOWCASE.categories.digital, null, "الخدمات الرقمية", "digital-services", "/assets/catalog-assets/digital-card.svg", 30],
    [SHOWCASE.categories.topup, SHOWCASE.categories.games, "شحن مباشر", "instant-topup", "/assets/catalog-assets/mobile-credit.svg", 11],
    [SHOWCASE.categories.gameCards, SHOWCASE.categories.games, "بطاقات وأكواد", "game-cards", "/assets/catalog-assets/digital-card.svg", 12],
    [SHOWCASE.categories.memberships, SHOWCASE.categories.subscriptions, "عضويات شهرية", "monthly-memberships", "/assets/catalog-assets/subscription.svg", 21],
    [SHOWCASE.categories.workSubscriptions, SHOWCASE.categories.subscriptions, "أدوات العمل", "work-subscriptions", "/assets/catalog-assets/software.svg", 22]
  ];
  for (const [id, parentId, name, slug, imageUrl, sortOrder] of categories) {
    await db.query(
      `INSERT INTO categories (
         id, tenant_id, store_id, parent_id, name, slug, image_url, sort_order, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')
       ON CONFLICT (id) DO UPDATE SET
         parent_id=EXCLUDED.parent_id, name=EXCLUDED.name, image_url=EXCLUDED.image_url,
         sort_order=EXCLUDED.sort_order, status='active', updated_at=NOW()`,
      [id, SHOWCASE.tenantId, SHOWCASE.storeId, parentId, name, slug, imageUrl, sortOrder]
    );
  }

  const products = [
    {
      id: "00000000-0000-4000-8000-000000000301",
      categoryId: SHOWCASE.categories.topup,
      type: "game_topup",
      name: "شحن 1,000 نقطة",
      slug: "game-1000-points",
      description: "شحن تجريبي سريع لحساب اللاعب مع اختيار المنطقة.",
      imageUrl: "/assets/catalog-assets/game-topup.svg",
      priceMinor: 899,
      fields: [
        { key: "player_id", label: "معرّف اللاعب", type: "text", required: true },
        { key: "region", label: "المنطقة", type: "select", required: true, options: ["Europe", "MENA", "Asia"] }
      ]
    },
    {
      id: "00000000-0000-4000-8000-000000000302",
      categoryId: SHOWCASE.categories.topup,
      type: "game_topup",
      name: "باقة الموسم",
      slug: "season-pass",
      description: "باقة موسم رقمية تُضاف إلى الحساب بعد التحقق من البيانات.",
      imageUrl: "/assets/catalog-assets/game-topup.svg",
      priceMinor: 1299,
      fields: [{ key: "player_id", label: "معرّف اللاعب", type: "text", required: true }]
    },
    {
      id: "00000000-0000-4000-8000-000000000303",
      categoryId: SHOWCASE.categories.memberships,
      type: "subscription",
      name: "Stream Plus — شهر",
      slug: "stream-plus-month",
      description: "اشتراك ترفيهي لمدة شهر مع تسليم بيانات التفعيل داخل الطلب.",
      imageUrl: "/assets/catalog-assets/subscription.svg",
      priceMinor: 1099,
      fields: [{ key: "email", label: "البريد المرتبط بالحساب", type: "email", required: true }]
    },
    {
      id: "00000000-0000-4000-8000-000000000304",
      categoryId: SHOWCASE.categories.workSubscriptions,
      type: "subscription",
      name: "Cloud Workspace",
      slug: "cloud-workspace",
      description: "عضوية أدوات عمل سحابية لفريق صغير لمدة شهر.",
      imageUrl: "/assets/catalog-assets/software.svg",
      priceMinor: 1599,
      fields: [{ key: "team_name", label: "اسم مساحة العمل", type: "text", required: true }]
    },
    {
      id: "00000000-0000-4000-8000-000000000305",
      categoryId: SHOWCASE.categories.digital,
      type: "digital",
      name: "بطاقة رقمية بقيمة 25$",
      slug: "digital-card-25",
      description: "كود رقمي تجريبي بتسليم منظم داخل صفحة الطلب.",
      imageUrl: "/assets/catalog-assets/digital-card.svg",
      priceMinor: 2650,
      fields: [{ key: "delivery_email", label: "بريد التسليم", type: "email", required: true }]
    },
    {
      id: "00000000-0000-4000-8000-000000000306",
      categoryId: SHOWCASE.categories.digital,
      type: "service",
      name: "إعداد متجر رقمي",
      slug: "digital-store-setup",
      description: "جلسة إعداد أولية لهوية المتجر وتنظيم الأقسام والمنتجات.",
      imageUrl: "/assets/catalog-assets/programming.svg",
      priceMinor: 4900,
      fields: [{ key: "requirements", label: "وصف النشاط والمتطلبات", type: "textarea", required: true }]
    },
    {
      id: "00000000-0000-4000-8000-000000000307",
      categoryId: SHOWCASE.categories.digital,
      type: "digital",
      name: "حزمة أدوات إنتاجية",
      slug: "productivity-toolkit",
      description: "حزمة ملفات وأدوات رقمية منظمة للعمل اليومي.",
      imageUrl: "/assets/catalog-assets/software.svg",
      priceMinor: 1850,
      fields: [{ key: "delivery_email", label: "بريد التسليم", type: "email", required: true }]
    },
    {
      id: "00000000-0000-4000-8000-000000000308",
      categoryId: SHOWCASE.categories.gameCards,
      type: "code",
      name: "بطاقة رصيد ألعاب 10$",
      slug: "gaming-credit-10",
      description: "رمز رقمي تجريبي مناسب لمعاينة مسار شراء الأكواد.",
      imageUrl: "/assets/catalog-assets/digital-card.svg",
      priceMinor: 1090,
      fields: [{ key: "platform", label: "المنصة", type: "select", required: true, options: ["PC", "Console", "Mobile"] }]
    }
  ];
  for (const [index, product] of products.entries()) {
    await db.query(
      `INSERT INTO products (
         id, tenant_id, store_id, category_id, product_type, name, slug, description,
         image_url, price_minor, currency, stock_quantity, min_quantity, max_quantity,
         delivery_mode, source_kind, fields, options, metadata, sort_order, status
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'USD',NULL,1,10,'manual','local',$11,'[]','{}',$12,'active'
       )
       ON CONFLICT (id) DO UPDATE SET
         category_id=EXCLUDED.category_id, product_type=EXCLUDED.product_type,
         name=EXCLUDED.name, description=EXCLUDED.description, image_url=EXCLUDED.image_url,
         price_minor=EXCLUDED.price_minor, fields=EXCLUDED.fields,
         sort_order=EXCLUDED.sort_order, status='active', updated_at=NOW()`,
      [
        product.id,
        SHOWCASE.tenantId,
        SHOWCASE.storeId,
        product.categoryId,
        product.type,
        product.name,
        product.slug,
        product.description,
        product.imageUrl,
        product.priceMinor,
        JSON.stringify(product.fields),
        (index + 1) * 10
      ]
    );
  }
  return { tenantId: SHOWCASE.tenantId, storeId: SHOWCASE.storeId, slug: "demo" };
}

export async function seedEnvironment(db, config) {
  const offer = await ensureSubscriptionOffer(db, config.offerSeed);
  const admin = await ensurePlatformAdmin(db, config.platformAdminEmail, config.platformAdminPassword);
  const provider = await ensureUchihaApi1(db, config);
  await seedProgrammingServices(db, offer.currency);
  await seedPlatformServiceCatalog(db, offer.currency);
  const sync = await syncProvider(db, provider.id, config);
  const showcase = config.demoSeed ? await ensureShowcaseStore(db) : null;
  return { offer, admin, provider, sync, showcase };
}

export { platformServiceCatalog, programmingServiceNames };
