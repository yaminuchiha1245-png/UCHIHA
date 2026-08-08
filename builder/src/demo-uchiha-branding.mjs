export const UCHIHA_DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000101";
export const UCHIHA_DEMO_STORE_ID = "00000000-0000-4000-8000-000000000102";
export const UCHIHA_DEMO_SERVICES_CATEGORY_ID = "00000000-0000-4000-8000-000000000204";
export const UCHIHA_DEMO_SERVICE_PRODUCT_ID = "00000000-0000-4000-8000-000000000304";

const BANNERS = Object.freeze([
  {
    id: "00000000-0000-4000-8000-000000000401",
    title: "كل خدماتك الرقمية في مكان واحد",
    subtitle: "تصفح الأقسام واختر المنتج أو الخدمة التي تناسبك بخطوات واضحة وسريعة.",
    mediaUrl: "/assets/demo-assets/uchiha-banner-madara.webp",
    linkUrl: "https://wa.me/963942586044",
    actionLabel: "استكشف الأقسام",
    sortOrder: 10
  },
  {
    id: "00000000-0000-4000-8000-000000000403",
    title: "حساب ومحفظة وطلبات منظمة",
    subtitle: "تابع رصيدك ودفعاتك وحالة كل طلب من واجهة واحدة متناسقة.",
    mediaUrl: "/assets/demo-assets/uchiha-banner-obito.webp",
    linkUrl: "https://wa.me/963942586044",
    actionLabel: "افتح حسابك",
    sortOrder: 20
  },
  {
    id: "00000000-0000-4000-8000-000000000404",
    title: "دعم واضح عندما تحتاجه",
    subtitle: "تواصل مع فريق المتجر عبر الوسائل المعتمدة دون البحث بين صفحات متفرقة.",
    mediaUrl: "/assets/demo-assets/uchiha-banner-itachi.webp",
    linkUrl: "https://wa.me/963942586044",
    actionLabel: "مركز الدعم",
    sortOrder: 30
  }
]);

const CATEGORY_MEDIA = Object.freeze([
  ["00000000-0000-4000-8000-000000000201", "الألعاب والشحن", "/assets/demo-assets/uchiha-category-games-v2.svg"],
  ["00000000-0000-4000-8000-000000000202", "الاشتراكات والمشاهدة", "/assets/demo-assets/uchiha-category-subscriptions-v2.svg"],
  ["00000000-0000-4000-8000-000000000203", "الخدمات الرقمية", "/assets/demo-assets/uchiha-category-digital-v2.svg"],
  [UCHIHA_DEMO_SERVICES_CATEGORY_ID, "البرمجة والتصميم", "/assets/demo-assets/uchiha-category-services-v2.svg"],
  ["00000000-0000-4000-8000-000000000211", "شحن مباشر", "/assets/demo-assets/uchiha-category-games-v2.svg"],
  ["00000000-0000-4000-8000-000000000212", "عضويات شهرية", "/assets/demo-assets/uchiha-category-subscriptions-v2.svg"],
  ["00000000-0000-4000-8000-000000000213", "بطاقات وأكواد", "/assets/demo-assets/uchiha-category-digital-v2.svg"],
  ["00000000-0000-4000-8000-000000000214", "أدوات العمل", "/assets/demo-assets/uchiha-category-digital-v2.svg"]
]);

const DEMO_CURRENCIES = Object.freeze([
  ["00000000-0000-4000-8000-000000000501", "USD", true, 1],
  ["00000000-0000-4000-8000-000000000502", "TRY", false, 0.02127660],
  ["00000000-0000-4000-8000-000000000503", "SAR", false, 0.26666667],
  ["00000000-0000-4000-8000-000000000504", "AED", false, 0.27229408],
  ["00000000-0000-4000-8000-000000000505", "JOD", false, 1.41043724],
  ["00000000-0000-4000-8000-000000000506", "IQD", false, 0.00076336],
  ["00000000-0000-4000-8000-000000000507", "EGP", false, 0.02040816]
]);

export async function applyUchihaShowcaseBranding(db, showcase) {
  if (!showcase?.storeId || showcase.storeId !== UCHIHA_DEMO_STORE_ID) return showcase;

  await db.query(
    `UPDATE tenants
     SET name='UCHIHA Demo Store', updated_at=NOW()
     WHERE id=$1`,
    [UCHIHA_DEMO_TENANT_ID]
  );

  await db.query(
    `UPDATE stores
     SET name='UCHIHA STORE',
         activity_type='digital-products',
         description='متجر رقمي تجريبي متكامل يعرض الأقسام والمنتجات والحساب والمحفظة والطلبات بتجربة واضحة واحترافية.',
         language='ar', currency='USD', template_key='professional-dark',
         welcome_message='مرحبًا بك في UCHIHA STORE — اختر القسم المناسب وابدأ طلبك بخطوات قصيرة.',
         updated_at=NOW()
     WHERE id=$1 AND tenant_id=$2`,
    [UCHIHA_DEMO_STORE_ID, UCHIHA_DEMO_TENANT_ID]
  );

  await db.query(
    `UPDATE store_design_tokens
     SET primary_color='#ffffff',
         secondary_color='#bdbdbd',
         background_color='#080808',
         surface_color='#111111',
         text_color='#f5f5f5',
         muted_text_color='#9b9b9b',
         border_color='#292929',
         success_color='#2fad68',
         warning_color='#d8942f',
         danger_color='#d9414d',
         font_family='Tajawal',
         border_radius='12px',
         button_style='solid',
         card_style='bordered',
         logo_url='/assets/demo-assets/uchiha-transparent-mark.svg',
         favicon_url='/assets/brand/favicon.svg',
         cover_url='/assets/demo-assets/uchiha-banner-madara.webp',
         updated_at=NOW()
     WHERE store_id=$1 AND tenant_id=$2`,
    [UCHIHA_DEMO_STORE_ID, UCHIHA_DEMO_TENANT_ID]
  );

  for (const banner of BANNERS) {
    await db.query(
      `UPDATE store_banners
       SET title=$2, subtitle=$3, media_type='image', media_url=$4,
           link_url=$5, action_label=$6, status='active', sort_order=$7,
           updated_at=NOW()
       WHERE id=$1 AND store_id=$8 AND tenant_id=$9`,
      [
        banner.id,
        banner.title,
        banner.subtitle,
        banner.mediaUrl,
        banner.linkUrl,
        banner.actionLabel,
        banner.sortOrder,
        UCHIHA_DEMO_STORE_ID,
        UCHIHA_DEMO_TENANT_ID
      ]
    );
  }

  await db.query(
    `INSERT INTO categories (
       id, tenant_id, store_id, parent_id, name, slug, image_url, sort_order, status
     ) VALUES ($1,$2,$3,NULL,'البرمجة والتصميم','services-programming',$4,40,'active')
     ON CONFLICT (id) DO UPDATE SET
       parent_id=NULL, name=EXCLUDED.name, slug=EXCLUDED.slug,
       image_url=EXCLUDED.image_url, sort_order=40, status='active', updated_at=NOW()`,
    [
      UCHIHA_DEMO_SERVICES_CATEGORY_ID,
      UCHIHA_DEMO_TENANT_ID,
      UCHIHA_DEMO_STORE_ID,
      "/assets/demo-assets/uchiha-category-services-v2.svg"
    ]
  );

  for (const [categoryId, name, imageUrl] of CATEGORY_MEDIA) {
    await db.query(
      `UPDATE categories
       SET name=$2, image_url=$3, status='active', updated_at=NOW()
       WHERE id=$1 AND store_id=$4 AND tenant_id=$5`,
      [categoryId, name, imageUrl, UCHIHA_DEMO_STORE_ID, UCHIHA_DEMO_TENANT_ID]
    );
  }

  await db.query(
    `INSERT INTO products (
       id, tenant_id, store_id, category_id, product_type, name, slug, description,
       image_url, price_minor, currency, stock_quantity, min_quantity, max_quantity,
       delivery_mode, source_kind, fields, options, metadata, sort_order, status
     ) VALUES (
       $1,$2,$3,$4,'programming_service','تصميم متجر رقمي مخصص','custom-digital-store',
       'خدمة تجريبية توضح طريقة عرض خدمات البرمجة وطلب التفاصيل من داخل المتجر.',
       $5,2500,'USD',NULL,1,1,'manual','local',$6,'[]',$7,40,'active'
     )
     ON CONFLICT (id) DO UPDATE SET
       category_id=EXCLUDED.category_id, product_type=EXCLUDED.product_type,
       name=EXCLUDED.name, slug=EXCLUDED.slug, description=EXCLUDED.description,
       image_url=EXCLUDED.image_url, price_minor=EXCLUDED.price_minor,
       fields=EXCLUDED.fields, metadata=EXCLUDED.metadata,
       sort_order=40, status='active', updated_at=NOW()`,
    [
      UCHIHA_DEMO_SERVICE_PRODUCT_ID,
      UCHIHA_DEMO_TENANT_ID,
      UCHIHA_DEMO_STORE_ID,
      UCHIHA_DEMO_SERVICES_CATEGORY_ID,
      "/assets/demo-assets/uchiha-category-services-v2.svg",
      JSON.stringify([
        { key: "project_type", label: "نوع المشروع", type: "select", required: true, options: ["متجر", "موقع", "بوت", "تطبيق"] },
        { key: "details", label: "تفاصيل الطلب", type: "textarea", required: true }
      ]),
      JSON.stringify({ demo: true, readOnly: true, deliveryLabel: "طلب عرض سعر" })
    ]
  );

  for (const [id, currency, isBase, rateToBase] of DEMO_CURRENCIES) {
    await db.query(
      `INSERT INTO store_currency_settings (
         id, tenant_id, store_id, currency, is_base, is_enabled,
         rate_to_base, rate_source, rate_updated_at
       ) VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7,NOW())
       ON CONFLICT (store_id, currency) DO UPDATE SET
         is_base=EXCLUDED.is_base,
         is_enabled=TRUE,
         rate_to_base=EXCLUDED.rate_to_base,
         rate_source=EXCLUDED.rate_source,
         rate_updated_at=NOW(),
         updated_at=NOW()`,
      [
        id,
        UCHIHA_DEMO_TENANT_ID,
        UCHIHA_DEMO_STORE_ID,
        currency,
        isBase,
        rateToBase,
        isBase ? "base" : "demo-manual"
      ]
    );
  }

  await db.query(
    `UPDATE payment_methods
     SET instructions='طريقة تجريبية للعرض فقط — لا ترسل أي أموال أو إثباتات.',
         updated_at=NOW()
     WHERE store_id=$1 AND tenant_id=$2`,
    [UCHIHA_DEMO_STORE_ID, UCHIHA_DEMO_TENANT_ID]
  );

  return { ...showcase, name: "UCHIHA STORE", branded: true };
}
