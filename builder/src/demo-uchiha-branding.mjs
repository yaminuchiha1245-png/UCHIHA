export const UCHIHA_DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000101";
export const UCHIHA_DEMO_STORE_ID = "00000000-0000-4000-8000-000000000102";

const BANNERS = Object.freeze([
  {
    id: "00000000-0000-4000-8000-000000000401",
    title: "كل خدماتك الرقمية في مكان واحد",
    subtitle: "تصفح الأقسام واختر المنتج أو الخدمة التي تناسبك بخطوات واضحة وسريعة.",
    mediaUrl: "/assets/demo-assets/uchiha-slide-main.svg",
    linkUrl: "#categories",
    actionLabel: "استكشف الأقسام",
    sortOrder: 10
  },
  {
    id: "00000000-0000-4000-8000-000000000403",
    title: "حساب ومحفظة وطلبات منظمة",
    subtitle: "تابع رصيدك ودفعاتك وحالة كل طلب من واجهة واحدة متناسقة.",
    mediaUrl: "/assets/demo-assets/uchiha-slide-account.svg",
    linkUrl: "/store/demo/account",
    actionLabel: "افتح حسابك",
    sortOrder: 20
  },
  {
    id: "00000000-0000-4000-8000-000000000404",
    title: "دعم واضح عندما تحتاجه",
    subtitle: "تواصل مع فريق المتجر عبر الوسائل المعتمدة دون البحث بين صفحات متفرقة.",
    mediaUrl: "/assets/demo-assets/uchiha-slide-support.svg",
    linkUrl: "/store/demo/support",
    actionLabel: "مركز الدعم",
    sortOrder: 30
  }
]);

const CATEGORY_MEDIA = Object.freeze([
  ["00000000-0000-4000-8000-000000000201", "الألعاب والشحن", "/assets/demo-assets/uchiha-category-games.svg"],
  ["00000000-0000-4000-8000-000000000202", "الاشتراكات", "/assets/demo-assets/uchiha-category-subscriptions.svg"],
  ["00000000-0000-4000-8000-000000000203", "الخدمات الرقمية", "/assets/demo-assets/uchiha-category-digital.svg"],
  ["00000000-0000-4000-8000-000000000211", "شحن مباشر", "/assets/demo-assets/uchiha-category-games.svg"],
  ["00000000-0000-4000-8000-000000000212", "عضويات شهرية", "/assets/demo-assets/uchiha-category-subscriptions.svg"],
  ["00000000-0000-4000-8000-000000000213", "بطاقات وأكواد", "/assets/demo-assets/uchiha-category-digital.svg"],
  ["00000000-0000-4000-8000-000000000214", "أدوات العمل", "/assets/demo-assets/uchiha-category-digital.svg"]
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
     SET primary_color='#8f3044',
         secondary_color='#4f1825',
         background_color='#0f1115',
         surface_color='#181c22',
         text_color='#f5f7fa',
         muted_text_color='#a4acb8',
         border_color='#303642',
         success_color='#2fad68',
         warning_color='#d8942f',
         danger_color='#d9414d',
         font_family='Tajawal',
         border_radius='12px',
         button_style='solid',
         card_style='bordered',
         logo_url='/assets/brand/storefront-mark.svg',
         favicon_url='/assets/brand/favicon.svg',
         cover_url='/assets/demo-assets/uchiha-slide-main.svg',
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

  for (const [categoryId, name, imageUrl] of CATEGORY_MEDIA) {
    await db.query(
      `UPDATE categories
       SET name=$2, image_url=$3, status='active', updated_at=NOW()
       WHERE id=$1 AND store_id=$4 AND tenant_id=$5`,
      [categoryId, name, imageUrl, UCHIHA_DEMO_STORE_ID, UCHIHA_DEMO_TENANT_ID]
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
