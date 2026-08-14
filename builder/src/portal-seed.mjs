import { randomUUID } from "node:crypto";

const PLATFORM_SERVICE_SEED = Object.freeze([
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
    key: "telegram-store-bot",
    slug: "telegram-store-bot",
    icon: "telegram",
    ar: "إنشاء بوتات تلغرام",
    en: "Telegram Bots",
    descriptionAr: "بوتات بيع وخدمات مرتبطة بنفس المنتجات والطلبات الموجودة في المنصة.",
    descriptionEn: "Commerce and service bots connected to the same catalog, customers, and orders.",
    featuresAr: ["قوائم وحقول مرنة", "تنبيهات فورية", "Webhook مركزي"],
    featuresEn: ["Flexible menus and fields", "Instant notifications", "Central webhooks"],
    durationAr: "يحدد بعد تحليل التدفق",
    durationEn: "Confirmed after flow analysis"
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    key: "telegram-admin-bot",
    slug: "telegram-admin-bot",
    icon: "shield",
    ar: "إنشاء بوت إدارة",
    en: "Admin Bot",
    descriptionAr: "إدارة الطلبات والتنبيهات والإجراءات السريعة بصلاحيات موثقة.",
    descriptionEn: "Secure order alerts and operational actions with explicit permissions.",
    featuresAr: ["صلاحيات متعددة", "تنبيهات الطلبات", "سجل إجراءات"],
    featuresEn: ["Role-based access", "Order alerts", "Action audit trail"],
    durationAr: "حسب الصلاحيات المطلوبة",
    durationEn: "Based on required permissions"
  },
  {
    id: "10000000-0000-4000-8000-000000000005",
    key: "android-app",
    slug: "android-app",
    icon: "android",
    ar: "إنشاء تطبيق Android",
    en: "Android Application",
    descriptionAr: "تطبيق Android متصل بالـAPI والحسابات والبيانات نفسها دون قاعدة منفصلة.",
    descriptionEn: "An Android app connected to the same API, users, and central data.",
    featuresAr: ["واجهة هاتف أصلية", "إشعارات وتسجيل آمن", "جاهزية للنشر"],
    featuresEn: ["Native mobile shell", "Secure sign-in and notifications", "Release readiness"],
    durationAr: "حسب خصائص التطبيق",
    durationEn: "Based on app capabilities"
  },
  {
    id: "10000000-0000-4000-8000-000000000006",
    key: "ios-app",
    slug: "ios-app",
    icon: "apple",
    ar: "إنشاء تطبيق iPhone",
    en: "iPhone Application",
    descriptionAr: "تطبيق iPhone مرتبط بالبنية نفسها مع تجهيزات التوقيع ومتطلبات App Store.",
    descriptionEn: "An iPhone app on the same backend, prepared for signing and App Store requirements.",
    featuresAr: ["دعم iPhone وiPad", "تجهيز التوقيع", "بيانات موحدة"],
    featuresEn: ["iPhone and iPad", "Signing preparation", "Unified data"],
    durationAr: "بعد مراجعة متطلبات Apple",
    durationEn: "After Apple requirements review"
  },
  {
    id: "10000000-0000-4000-8000-000000000007",
    key: "custom-software",
    slug: "custom-software",
    icon: "code",
    ar: "خدمات البرمجة الخاصة",
    en: "Custom Software",
    descriptionAr: "تطوير أنظمة وميزات خاصة عندما لا تناسبك الحلول الجاهزة.",
    descriptionEn: "Purpose-built systems and features when off-the-shelf tools do not fit.",
    featuresAr: ["تحليل المتطلبات", "تنفيذ قابل للتوسع", "تسليم موثق"],
    featuresEn: ["Requirements analysis", "Scalable implementation", "Documented delivery"],
    durationAr: "يحدد بعد التحليل",
    durationEn: "Confirmed after analysis"
  },
  {
    id: "10000000-0000-4000-8000-000000000008",
    key: "api-integration",
    slug: "api-integration",
    icon: "api",
    ar: "تكامل API",
    en: "API Integration",
    descriptionAr: "ربط الأنظمة والمزودين والدفع عبر واجهات آمنة وسجلات قابلة للتتبع.",
    descriptionEn: "Connect providers, payments, and systems through secure, traceable APIs.",
    featuresAr: ["Idempotency", "Retry وBackoff", "Webhooks وسجلات"],
    featuresEn: ["Idempotency", "Retry and backoff", "Webhooks and logs"],
    durationAr: "حسب وثائق المزود",
    durationEn: "Based on provider documentation"
  },
  {
    id: "10000000-0000-4000-8000-000000000009",
    key: "hosting-deployment",
    slug: "hosting-deployment",
    icon: "server",
    ar: "الاستضافة والنشر",
    en: "Hosting & Deployment",
    descriptionAr: "اختيار بيئة مناسبة، إعداد النشر، المراقبة والنسخ الاحتياطي.",
    descriptionEn: "Hosting selection, deployment setup, monitoring, and backup planning.",
    featuresAr: ["بيئة مناسبة للحمل", "متغيرات ENV", "فحص الجاهزية"],
    featuresEn: ["Right-sized environment", "ENV configuration", "Readiness checks"],
    durationAr: "حسب البنية الحالية",
    durationEn: "Based on current architecture"
  },
  {
    id: "10000000-0000-4000-8000-000000000010",
    key: "domains",
    slug: "domains",
    icon: "globe",
    ar: "حجز وربط الدومينات",
    en: "Domains",
    descriptionAr: "حجز أو ربط الدومين وضبط DNS وSSL وربطه بالمتجر أو التطبيق.",
    descriptionEn: "Register or connect domains, configure DNS and SSL, and attach them to your project.",
    featuresAr: ["DNS وSSL", "ربط النطاق الفرعي", "تجهيز API للشراء مستقبلًا"],
    featuresEn: ["DNS and SSL", "Subdomain mapping", "Future purchase API readiness"],
    durationAr: "يتبع وقت انتشار DNS",
    durationEn: "Subject to DNS propagation"
  },
  {
    id: "10000000-0000-4000-8000-000000000011",
    key: "security-maintenance",
    slug: "security-maintenance",
    icon: "lock",
    ar: "الأمن والصيانة",
    en: "Security & Maintenance",
    descriptionAr: "مراجعة الثغرات والتحديثات والسجلات والاستجابة للأعطال.",
    descriptionEn: "Security review, updates, logging, and production incident response.",
    featuresAr: ["مراجعة أمان", "تحديثات دورية", "مراقبة الأخطاء"],
    featuresEn: ["Security review", "Scheduled updates", "Error monitoring"],
    durationAr: "خطة دورية أو طلب منفرد",
    durationEn: "Retainer or one-off engagement"
  },
  {
    id: "10000000-0000-4000-8000-000000000012",
    key: "ui-ux-design",
    slug: "ui-ux-design",
    icon: "layout",
    ar: "تصميم واجهات المستخدم",
    en: "UI/UX Design",
    descriptionAr: "واجهات واضحة ومريحة تخدم أهداف المستخدم والعمل بدل الزخرفة الزائدة.",
    descriptionEn: "Clear product interfaces designed around user tasks and business outcomes.",
    featuresAr: ["Mobile First", "حالات كاملة", "نظام تصميم"],
    featuresEn: ["Mobile first", "Complete UI states", "Design system"],
    durationAr: "حسب عدد الشاشات",
    durationEn: "Based on screen count"
  },
  {
    id: "10000000-0000-4000-8000-000000000013",
    key: "automation",
    slug: "automation",
    icon: "workflow",
    ar: "الأتمتة وربط الأنظمة",
    en: "Automation",
    descriptionAr: "تقليل العمل اليدوي بربط الأحداث والمهام والإشعارات بين الأنظمة.",
    descriptionEn: "Reduce manual operations by connecting events, tasks, and notifications.",
    featuresAr: ["تدفقات موثوقة", "Queue وOutbox", "تقارير تنفيذ"],
    featuresEn: ["Reliable workflows", "Queue and outbox", "Execution reports"],
    durationAr: "حسب عدد التدفقات",
    durationEn: "Based on workflow count"
  },
  {
    id: "10000000-0000-4000-8000-000000000014",
    key: "technical-consulting",
    slug: "technical-consulting",
    icon: "consulting",
    ar: "استشارة تقنية",
    en: "Technical Consulting",
    descriptionAr: "مراجعة الفكرة أو المشروع واختيار البنية والخطوات الواقعية قبل التنفيذ.",
    descriptionEn: "Review an idea or existing product and choose a practical technical direction.",
    featuresAr: ["مراجعة مستقلة", "أولويات واضحة", "توصيات قابلة للتنفيذ"],
    featuresEn: ["Independent review", "Clear priorities", "Actionable recommendations"],
    durationAr: "جلسة أو تقرير",
    durationEn: "Session or written report"
  }
]);

const PAYMENT_METHOD_SEED = Object.freeze([
  ["20000000-0000-4000-8000-000000000001", "usdt-trc20", "usdt_trc20", "USDT TRC20", "USDT TRC20", "USDT", "TRC20", "/assets/payment-assets/usdt.svg", 10],
  ["20000000-0000-4000-8000-000000000002", "usdt-bep20", "usdt_bep20", "USDT BEP20", "USDT BEP20", "USDT", "BEP20", "/assets/payment-assets/usdt.svg", 20],
  ["20000000-0000-4000-8000-000000000003", "binance-pay", "binance_pay", "Binance Pay", "Binance Pay", "USDT", null, "/assets/payment-assets/binance-pay.svg", 30],
  ["20000000-0000-4000-8000-000000000004", "bank-transfer", "bank_transfer", "تحويل بنكي", "Bank Transfer", "USD", null, "/assets/payment-assets/bank.svg", 40],
  ["20000000-0000-4000-8000-000000000005", "sham-cash", "sham_cash", "شام كاش", "Sham Cash", "SYP", null, "/assets/payment-assets/sham-cash.svg", 50],
  ["20000000-0000-4000-8000-000000000006", "payeer", "payeer", "Payeer", "Payeer", "USD", null, "/assets/payment-assets/payeer.svg", 60]
]);

function whatsappTemplate(locale) {
  if (locale === "en") {
    return [
      "Hello, I would like details about {service_name}.",
      "Customer: {customer_name}",
      "Internal ID: {customer_id}",
      "Page: {page_url}",
      "Please send the requirements, timeline, and quotation steps."
    ].join("\n");
  }
  return [
    "مرحبًا، أريد تفاصيل خدمة {service_name}.",
    "اسم العميل: {customer_name}",
    "المعرف الداخلي: {customer_id}",
    "رابط الصفحة: {page_url}",
    "يرجى إرسال المتطلبات والمدة وخطوات عرض السعر."
  ].join("\n");
}

export async function seedPortalContent(db, config) {
  for (const [index, service] of PLATFORM_SERVICE_SEED.entries()) {
    await db.query(
      `INSERT INTO platform_services (
         id, service_key, slug, icon_key, name_ar, name_en,
         description_ar, description_en, features_ar, features_en,
         estimated_duration_ar, estimated_duration_en,
         whatsapp_template_ar, whatsapp_template_en, status, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active',$15)
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
        whatsappTemplate("ar"),
        whatsappTemplate("en"),
        (index + 1) * 10
      ]
    );
  }

  const contacts = [
    {
      id: "30000000-0000-4000-8000-000000000001",
      type: "whatsapp",
      icon: "whatsapp",
      nameAr: "واتساب",
      nameEn: "WhatsApp",
      descriptionAr: "تواصل مباشر لطلبات الخدمات والاستفسارات.",
      descriptionEn: "Direct contact for service requests and enquiries.",
      target: config.platformWhatsappNumber,
      hoursAr: "تُعرض ساعات العمل عند تحديدها من الإدارة",
      hoursEn: "Working hours appear when configured by an administrator",
      order: 10
    },
    {
      id: "30000000-0000-4000-8000-000000000002",
      type: "phone",
      icon: "phone",
      nameAr: "الهاتف",
      nameEn: "Phone",
      descriptionAr: "للاتصال المباشر عند الحاجة.",
      descriptionEn: "For direct calls when needed.",
      target: config.platformWhatsappNumber,
      hoursAr: "يرجى البدء برسالة واتساب قبل الاتصال",
      hoursEn: "Please start with a WhatsApp message before calling",
      order: 20
    }
  ];
  for (const contact of contacts) {
    await db.query(
      `INSERT INTO contact_methods (
         id, method_type, icon_key, name_ar, name_en, description_ar,
         description_en, target, message_template_ar, message_template_en,
         working_hours_ar, working_hours_en, status, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',$13)
       ON CONFLICT (id) DO NOTHING`,
      [
        contact.id,
        contact.type,
        contact.icon,
        contact.nameAr,
        contact.nameEn,
        contact.descriptionAr,
        contact.descriptionEn,
        contact.target,
        whatsappTemplate("ar"),
        whatsappTemplate("en"),
        contact.hoursAr,
        contact.hoursEn,
        contact.order
      ]
    );
  }

  for (const [id, key, type, nameAr, nameEn, currency, network, logo, sortOrder] of PAYMENT_METHOD_SEED) {
    await db.query(
      `INSERT INTO platform_payment_methods (
         id, method_key, method_type, logo_url, name_ar, name_en,
         currency, network, qr_mode, status, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'none','coming_soon',$9)
       ON CONFLICT (method_key) DO NOTHING`,
      [id, key, type, logo, nameAr, nameEn, currency, network, sortOrder]
    );
    const instructionIdAr = randomUUID();
    const instructionIdEn = randomUUID();
    await db.query(
      `INSERT INTO payment_method_instructions (
         id, platform_payment_method_id, locale, title, body, warning, sort_order
       ) VALUES ($1,$2,'ar','تعليمات التحويل',
                 'تظهر بيانات المستفيد والعنوان بعد تفعيل الطريقة من لوحة الإدارة.',
                 'تحقق من العملة والشبكة قبل أي تحويل. التحويل عبر شبكة خاطئة قد لا يمكن استرداده.',0)
       ON CONFLICT (platform_payment_method_id, locale, sort_order) DO NOTHING`,
      [instructionIdAr, id]
    );
    await db.query(
      `INSERT INTO payment_method_instructions (
         id, platform_payment_method_id, locale, title, body, warning, sort_order
       ) VALUES ($1,$2,'en','Transfer instructions',
                 'Beneficiary and destination details appear after an administrator activates this method.',
                 'Verify the currency and network before sending. Transfers on the wrong network may be unrecoverable.',0)
       ON CONFLICT (platform_payment_method_id, locale, sort_order) DO NOTHING`,
      [instructionIdEn, id]
    );
  }

  const banners = [
    ["40000000-0000-4000-8000-000000000001", "متجر وموقع وبوتات من نظام واحد", "Store, website, and bots in one system", "بيانات موحدة وتجربة واضحة من أول طلب إلى التسليم.", "Unified data and a clear journey from first request to delivery.", "/assets/marketing-assets/slide-commerce.svg", "/services", "استعرض الخدمات", "Explore services", 10],
    ["40000000-0000-4000-8000-000000000002", "تطبيقات متصلة بنفس الحساب", "Apps connected to one account", "Android وiPhone دون تكرار المنتجات أو الطلبات أو الصلاحيات.", "Android and iPhone without duplicating products, orders, or roles.", "/assets/marketing-assets/slide-apps.svg", "/services", "اطلب تطبيقك", "Request your app", 20],
    ["40000000-0000-4000-8000-000000000003", "استضافة ودومينات جاهزة للربط", "Hosting and domains ready to connect", "بنية تكامل قابلة للتوسع لشراء وربط الخدمات عبر API مستقبلًا.", "An extensible integration layer for future API-based provisioning and purchasing.", "/assets/marketing-assets/slide-infrastructure.svg", "/uchiha-api", "اعرف البنية", "See the architecture", 30]
  ];
  for (const banner of banners) {
    await db.query(
      `INSERT INTO platform_banners (
         id, title_ar, title_en, subtitle_ar, subtitle_en, image_url,
         link_url, action_label_ar, action_label_en, status, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10)
       ON CONFLICT (id) DO NOTHING`,
      banner
    );
  }

  if (config.demoSeed) {
    await db.query(
      `INSERT INTO portfolio_items (
         id, title_ar, title_en, description_ar, description_en,
         image_url, target_url, item_type, status, sort_order
       ) VALUES (
         '50000000-0000-4000-8000-000000000001',
         'متجر رقمي تجريبي محايد',
         'Neutral Digital Store Demo',
         'معاينة حقيقية لواجهة الأقسام والبحث والحساب والمحفظة في الوضعين الفاتح والداكن.',
         'A working demo of categories, search, account, wallet, and both visual themes.',
         '/assets/marketing-assets/showcase-store.svg',
         '/store/demo','demo','active',10
       ) ON CONFLICT (id) DO NOTHING`
    );
  }

  await db.query(
    `INSERT INTO system_settings (
       setting_key, scope, setting_value, is_public
     ) VALUES (
       'portal.presentation','platform',$1,TRUE
     ) ON CONFLICT (setting_key) DO NOTHING`,
    [JSON.stringify({
      whatsappNumber: config.platformWhatsappNumber,
      sliderAutoplayMs: 6500,
      supportedLocales: ["ar", "en"],
      defaultTheme: "system"
    })]
  );

  const integrations = [
    ["60000000-0000-4000-8000-000000000001", "hosting", "UCHIHA Hosting 1", "UNCONFIGURED_HOSTING_PROVIDER", "future-hosting-api", ["plans", "purchase", "renew", "status"]],
    ["60000000-0000-4000-8000-000000000002", "domain", "UCHIHA Domains 1", "UNCONFIGURED_DOMAIN_PROVIDER", "future-domain-api", ["search", "register", "transfer", "renew", "dns"]]
  ];
  for (const [id, kind, alias, internalName, adapterKey, capabilities] of integrations) {
    await db.query(
      `INSERT INTO infrastructure_integrations (
         id, integration_kind, public_alias, internal_name, adapter_key,
         capabilities, mode, connection_status
       ) VALUES ($1,$2,$3,$4,$5,$6,'disabled','not_configured')
       ON CONFLICT (integration_kind, public_alias) DO NOTHING`,
      [id, kind, alias, internalName, adapterKey, JSON.stringify(capabilities)]
    );
  }
}

export { PLATFORM_SERVICE_SEED, PAYMENT_METHOD_SEED };
