import { randomUUID } from "node:crypto";

export const PLATFORM_SERVICE_SEED = Object.freeze([
  {
    id: "10000000-0000-4000-8000-000000000001",
    key: "ecommerce-store",
    slug: "ecommerce-store",
    icon: "store",
    ar: "إنشاء متجر إلكتروني",
    en: "E-commerce Store",
    descriptionAr: "متجر سريع ومتجاوب لإدارة الأقسام والمنتجات والطلبات والعملاء من مكان واحد.",
    descriptionEn: "A fast, responsive storefront for products, orders, customers, and daily operations.",
    featuresAr: ["تصميم Mobile First", "لوحة إدارة واضحة", "محفظة وطلبات ومدفوعات"],
    featuresEn: ["Mobile-first design", "Clear admin workspace", "Wallet, orders, and payments"],
    durationAr: "يحدد بعد مراجعة المتطلبات",
    durationEn: "Confirmed after requirements review"
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    key: "web-development",
    slug: "web-development",
    icon: "browser",
    ar: "تطوير مواقع الويب",
    en: "Web Development",
    descriptionAr: "مواقع تعريفية وتجارية ولوحات أعمال مبنية حول هدف واضح وأداء فعلي.",
    descriptionEn: "Business websites, portals, and dashboards designed around measurable goals.",
    featuresAr: ["واجهة متجاوبة", "أداء وتهيئة بحث", "ربط قواعد البيانات"],
    featuresEn: ["Responsive interface", "Performance and SEO", "Database integration"],
    durationAr: "حسب نطاق المشروع",
    durationEn: "Based on project scope"
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    key: "telegram-bots",
    slug: "telegram-bots",
    icon: "bot",
    ar: "بوتات تلغرام",
    en: "Telegram Bots",
    descriptionAr: "بوتات متجر وخدمات وإدارة وأتمتة متصلة بلوحة تحكم وواجهات API عند الحاجة.",
    descriptionEn: "Store, service, admin, and automation bots connected to dashboards and APIs when needed.",
    featuresAr: ["Store Bot", "Admin Bot", "Webhook آمن"],
    featuresEn: ["Store Bot", "Admin Bot", "Secure webhooks"],
    durationAr: "حسب الوظائف والتكاملات",
    durationEn: "Based on features and integrations"
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    key: "mobile-apps",
    slug: "mobile-apps",
    icon: "phone",
    ar: "تطبيقات الجوال",
    en: "Mobile Applications",
    descriptionAr: "تطبيقات Android وiOS مرتبطة بخدمات الويب وقاعدة البيانات وإشعارات المشروع.",
    descriptionEn: "Android and iOS apps connected to web services, databases, and project notifications.",
    featuresAr: ["Android", "iOS", "تكامل API"],
    featuresEn: ["Android", "iOS", "API integration"],
    durationAr: "حسب حجم التطبيق",
    durationEn: "Based on app scope"
  },
  {
    id: "10000000-0000-4000-8000-000000000005",
    key: "hosting-domains",
    slug: "hosting-domains",
    icon: "server",
    ar: "الاستضافة والدومينات",
    en: "Hosting & Domains",
    descriptionAr: "تجهيز استضافة ودومين وSSL ونشر المشروع مع إعدادات تشغيل واضحة وقابلة للإدارة.",
    descriptionEn: "Hosting, domain, SSL, and deployment setup with manageable production configuration.",
    featuresAr: ["SSL", "DNS", "نشر المشروع"],
    featuresEn: ["SSL", "DNS", "Deployment"],
    durationAr: "عادة خلال يوم عمل",
    durationEn: "Usually within one business day"
  },
  {
    id: "10000000-0000-4000-8000-000000000006",
    key: "ai-solutions",
    slug: "ai-solutions",
    icon: "spark",
    ar: "حلول الذكاء الاصطناعي",
    en: "AI Solutions",
    descriptionAr: "دمج نماذج الذكاء الاصطناعي داخل المواقع والبوتات والتطبيقات مع ضوابط استخدام واضحة.",
    descriptionEn: "AI model integrations for websites, bots, and apps with clear usage controls.",
    featuresAr: ["مساعدات ذكية", "ربط OpenAI", "سجلات واستهلاك"],
    featuresEn: ["AI assistants", "OpenAI integration", "Usage logs"],
    durationAr: "حسب النموذج والتكامل",
    durationEn: "Based on model and integration"
  }
]);

const PROGRAMMING_PRODUCT_SEED = Object.freeze([
  ["ecommerce-store", "p-ecommerce", "إنشاء متجر إلكتروني", "E-commerce Store", 29900, "store"],
  ["web-development", "p-web", "تطوير موقع ويب", "Web Development", 24900, "browser"],
  ["telegram-bots", "p-bot", "بوت تلغرام احترافي", "Telegram Bot", 19900, "bot"],
  ["mobile-apps", "p-mobile", "تطبيق جوال", "Mobile Application", 39900, "phone"],
  ["hosting-domains", "p-hosting", "استضافة ودومين", "Hosting & Domain", 4900, "server"],
  ["ai-solutions", "p-ai", "حل ذكاء اصطناعي", "AI Solution", 29900, "spark"]
]);

const PAYMENT_METHOD_SEED = Object.freeze([
  {
    id: "20000000-0000-4000-8000-000000000001",
    key: "binance-pay",
    ar: "Binance Pay",
    en: "Binance Pay",
    type: "binance_pay",
    currency: "USDT",
    network: "Binance Pay",
    icon: "binance",
    min: 500,
    max: 5000000,
    status: "coming_soon"
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    key: "usdt-trc20",
    ar: "USDT TRC20",
    en: "USDT TRC20",
    type: "usdt_trc20",
    currency: "USDT",
    network: "TRC20",
    icon: "usdt",
    min: 500,
    max: 5000000,
    status: "coming_soon"
  },
  {
    id: "20000000-0000-4000-8000-000000000003",
    key: "sham-cash",
    ar: "ShamCash",
    en: "ShamCash",
    type: "sham_cash",
    currency: "SYP",
    network: "ShamCash",
    icon: "wallet",
    min: 1000,
    max: null,
    status: "coming_soon"
  }
]);

export async function seedPortalContent(db, config) {
  for (const service of PLATFORM_SERVICE_SEED) {
    await db.query(
      `INSERT INTO platform_services (
         id, service_key, slug, icon_key, name_ar, name_en,
         description_ar, description_en, features_ar, features_en,
         estimated_duration_ar, estimated_duration_en, status, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',$13)
       ON CONFLICT (service_key) DO NOTHING`,
      [
        service.id,
        service.key,
        service.slug,
        service.icon,
        service.ar,
        service.en,
        service.descriptionAr,
        service.descriptionEn,
        JSON.stringify(service.featuresAr),
        JSON.stringify(service.featuresEn),
        service.durationAr,
        service.durationEn,
        PLATFORM_SERVICE_SEED.indexOf(service) * 10
      ]
    );
  }

  for (const [serviceKey, productId, ar, en, price, iconKey] of PROGRAMMING_PRODUCT_SEED) {
    const service = (await db.query("SELECT id FROM platform_services WHERE service_key=$1 LIMIT 1", [serviceKey])).rows[0];
    if (!service) continue;
    await db.query(
      `INSERT INTO platform_products (
         id, service_id, slug, name_ar, name_en, description_ar, description_en,
         icon_key, price_minor, currency, product_type, delivery_mode, fields, options,
         status, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'programming_service','manual','[]','[]','active',$11)
       ON CONFLICT (service_id, slug) DO NOTHING`,
      [
        productId,
        service.id,
        serviceKey,
        ar,
        en,
        `طلب ${ar} مخصص حسب متطلبات المشروع.` ,
        `Custom ${en} request based on the project requirements.`,
        iconKey,
        price,
        config.offerSeed?.currency || "USD",
        PROGRAMMING_PRODUCT_SEED.findIndex((item) => item[0] === serviceKey) * 10
      ]
    );
  }

  for (const method of PAYMENT_METHOD_SEED) {
    await db.query(
      `INSERT INTO platform_payment_methods (
         id, method_key, name_ar, name_en, method_type, icon_key, currency, network,
         commission_bps, fixed_fee_minor, minimum_amount_minor, maximum_amount_minor,
         status, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,$9,$10,$11,$12)
       ON CONFLICT (method_key) DO NOTHING`,
      [
        method.id,
        method.key,
        method.ar,
        method.en,
        method.type,
        method.icon,
        method.currency,
        method.network,
        method.min,
        method.max,
        method.status,
        PAYMENT_METHOD_SEED.indexOf(method) * 10
      ]
    );
  }

  const instructions = [
    [PAYMENT_METHOD_SEED[0].id, 10, "أرسل المبلغ من خلال Binance Pay.", "Send the amount using Binance Pay.", "راجع معرف الاستلام المعروض قبل التحويل.", "Verify the displayed receiving identifier before transfer.", "لا تعتمد أي عنوان من جلسة دفع قديمة.", "Never reuse an address from an old payment session."],
    [PAYMENT_METHOD_SEED[1].id, 10, "اختر شبكة TRC20 حصراً.", "Use TRC20 network only.", "انسخ العنوان كما يظهر بعد تفعيل الطريقة.", "Copy the address exactly after the method is activated.", "أي شبكة مختلفة قد تسبب فقدان الرصيد.", "Using another network may result in loss of funds."],
    [PAYMENT_METHOD_SEED[2].id, 10, "افتح ShamCash وأرسل المبلغ إلى بيانات الاستقبال الظاهرة.", "Open ShamCash and send to the displayed receiving details.", "أرفق رقم العملية بعد التحويل.", "Attach the transaction reference after transfer.", "تظهر بيانات الاستقبال بعد تفعيل الطريقة من إدارة المنصة.", "Receiving details appear after the platform admin activates the method."]
  ];
  for (const row of instructions) {
    await db.query(
      `INSERT INTO payment_method_instructions (
         id, payment_method_id, step_order, title_ar, title_en, body_ar, body_en, warning_ar, warning_en
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (payment_method_id, step_order) DO NOTHING`,
      [randomUUID(), ...row]
    );
  }
}
