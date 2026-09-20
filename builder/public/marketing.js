(() => {
  "use strict";

  const LANGUAGE_KEY = "uchiha-ui-language";
  const WHATSAPP_FALLBACK = "+963942586044";
  const page = document.body.dataset.page || "home";
  const state = {
    locale: readLocale(),
    portal: null,
    user: null,
    sliderIndex: 0,
    sliderTimer: null,
    search: "",
    requestKey: null
  };

  const copy = {
    ar: {
      "common.skip": "تجاوز إلى المحتوى",
      "common.close": "إغلاق",
      "common.copy": "نسخ",
      "common.copied": "تم النسخ",
      "common.open": "فتح",
      "common.details": "التفاصيل",
      "common.notAvailable": "غير متاح",
      "common.notConfigured": "غير مفعّل",
      "common.guest": "غير مسجل",
      "common.none": "—",
      "common.menu": "فتح قائمة التنقل",
      "common.language": "Switch to English",
      "common.light": "استخدام الوضع الفاتح",
      "common.dark": "استخدام الوضع الداكن",
      "common.loadingError": "تعذر تحميل البيانات الآن",
      "common.retry": "إعادة المحاولة",
      "nav.home": "الرئيسية",
      "nav.services": "الخدمات",
      "nav.showcase": "نماذج الأعمال",
      "nav.payments": "طرق الدفع",
      "nav.api": "UCHIHA API",
      "nav.contact": "تواصل معنا",
      "nav.login": "تسجيل الدخول",
      "nav.admin": "إدارة المنصة",
      "actions.createStore": "إنشاء متجر",
      "actions.exploreServices": "استعراض الخدمات",
      "actions.allServices": "جميع الخدمات",
      "actions.openShowcase": "فتح النماذج",
      "actions.paymentCenter": "مركز طرق الدفع",
      "actions.apiDetails": "تفاصيل البنية",
      "actions.contactCenter": "مركز التواصل",
      "actions.requestService": "طلب خدمة",
      "actions.sendRequest": "إرسال الطلب",
      "actions.whatsapp": "تواصل عبر واتساب",
      "actions.openWhatsapp": "تواصل عبر واتساب",
      "actions.openChannel": "فتح القناة",
      "actions.viewDemo": "فتح النموذج",
      "actions.viewDetails": "عرض التفاصيل",
      "actions.showQr": "عرض QR",
      "actions.copyAddress": "نسخ العنوان",
      "hero.kicker": "حلول رقمية مترابطة",
      "hero.title": "أنشئ <em>متجرك وموقعك</em> وبوتاتك من منصة واحدة",
      "hero.description": "نحوّل فكرتك إلى منتج رقمي واضح وآمن وقابل للتوسع، مع إدارة موحدة للموقع والبوتات والتطبيقات والطلبات.",
      "hero.proofLabel": "مزايا المنصة",
      "hero.proof1": "بنية موحدة",
      "hero.proof2": "تصميم Mobile First",
      "hero.proof3": "دعم عربي وإنجليزي",
      "slider.label": "العروض والخدمات",
      "slider.previous": "الصورة السابقة",
      "slider.next": "الصورة التالية",
      "slider.dots": "اختيار الصورة",
      "confidence.label": "مزايا التنفيذ",
      "confidence.securityTitle": "أمان وحماية",
      "confidence.securityText": "عزل وصلاحيات وسجلات",
      "confidence.pricingTitle": "تسعير واضح",
      "confidence.pricingText": "عرض بعد مراجعة المتطلبات",
      "confidence.supportTitle": "دعم فعلي",
      "confidence.supportText": "قنوات تواصل ظاهرة",
      "confidence.performanceTitle": "أداء سريع",
      "confidence.performanceText": "تجربة مناسبة للهاتف",
      "services.kicker": "خدماتنا",
      "services.title": "كل ما يحتاجه مشروعك الرقمي",
      "services.description": "خدمات مدارة من قاعدة البيانات ويمكن إظهارها وترتيبها وتحديثها من لوحة المنصة.",
      "services.pageTitle": "خدمات رقمية مبنية حول هدف واضح",
      "services.pageDescription": "اختر الخدمة المناسبة، ثم أرسل التفاصيل للحصول على نطاق ومدة وخطوات تنفيذ واضحة.",
      "services.search": "ابحث عن خدمة...",
      "services.count": "{count} خدمة",
      "services.price": "السعر الابتدائي",
      "services.quote": "حسب المتطلبات",
      "services.duration": "مدة التنفيذ",
      "services.comingSoon": "متاحة قريبًا",
      "how.kicker": "طريقة العمل",
      "how.title": "من الفكرة إلى مشروع يعمل",
      "how.step1Title": "اختر خدمتك",
      "how.step1Text": "ابدأ بالخدمة الأقرب لهدفك.",
      "how.step2Title": "أرسل التفاصيل",
      "how.step2Text": "نراجع المتطلبات ونوضح النطاق.",
      "how.step3Title": "نقوم بالتنفيذ",
      "how.step3Text": "تنفيذ واختبار ومتابعة واضحة.",
      "how.step4Title": "تستلم المشروع",
      "how.step4Text": "تسليم منظم مع تعليمات التشغيل.",
      "showcase.kicker": "نماذج الأعمال",
      "showcase.title": "نماذج يمكن فتحها وتجربتها",
      "showcase.description": "نعرض النماذج الحقيقية أو التجريبية بوضوح دون الادعاء بأنها مشاريع عملاء.",
      "showcase.pageTitle": "واجهات عملية، لا صور وهمية",
      "showcase.pageDescription": "كل بطاقة توضّح إن كانت معاينة تجريبية أو مشروعًا منشورًا، ويمكن فتحها مباشرة.",
      "showcase.demo": "نموذج تجريبي",
      "showcase.live": "مشروع منشور",
      "payments.kicker": "طرق الدفع",
      "payments.title": "طرق واضحة، وتفاصيل لا تظهر قبل تفعيلها",
      "payments.description": "هذه الصفحة للتعريف بطرق الدفع فقط، ولا تطلب رفع إثبات تحويل.",
      "payments.pageTitle": "طرق الدفع وحالتها الحالية",
      "payments.pageDescription": "صفحة معلومات فقط. لا ترفع إثبات تحويل هنا، ولا تحوّل قبل ظهور بيانات مستفيد مفعلة.",
      "payments.networkWarning": "تحقق من العملة والشبكة والعنوان قبل التحويل. لا تعتمد على بيانات من رسالة غير رسمية.",
      "payments.currency": "العملة",
      "payments.network": "الشبكة",
      "payments.minimum": "الحد الأدنى",
      "payments.beneficiary": "اسم المستفيد",
      "payments.account": "رقم الحساب أو العنوان",
      "payments.instructions": "تعليمات التحويل",
      "payments.noProof": "لا نطلب رفع إثبات دفع من هذه الصفحة.",
      "payments.active": "متاحة",
      "payments.comingSoon": "قريبًا",
      "payments.disabled": "متوقفة",
      "payments.hidden": "مخفية",
      "payments.unconfigured": "تُعرض البيانات بعد تفعيل الطريقة من الإدارة.",
      "api.kicker": "UCHIHA API",
      "api.title": "بنية مزودين قابلة للتوسع دون كشف المصدر الحقيقي",
      "api.description": "Adapters موحدة للمزامنة والرصيد والطلبات والحالات، مع Idempotency وRetry وWebhooks وسجلات أخطاء آمنة.",
      "api.point1": "UCHIHA API 1 و2 و3 كأسماء عامة",
      "api.point2": "بيانات الاعتماد مشفرة ومنفصلة",
      "api.point3": "تجهيز مستقبل لشراء الاستضافة والدومينات عبر API",
      "api.pageTitle": "طبقة تكامل قوية للمزودين والخدمات المستقبلية",
      "api.pageDescription": "واجهة عامة بأسماء داخلية محايدة، وطبقة Adapter تمنع ربط المنصة بمزود واحد أو كشفه للعميل.",
      "api.cardAdapterTitle": "Adapter Interface",
      "api.cardAdapterText": "عقد موحد للاتصال والرصيد والأقسام والمنتجات والطلب والمتابعة والإلغاء المدعوم.",
      "api.cardQueueTitle": "طلبات موثوقة",
      "api.cardQueueText": "Idempotency وRetry مع Backoff وحالات كاملة ومحاولات قابلة للتتبع.",
      "api.cardSecurityTitle": "اعتمادات آمنة",
      "api.cardSecurityText": "الأسرار مشفرة ومنفصلة ولا تظهر في الواجهة العامة أو السجلات.",
      "api.cardTenantTitle": "عزل المتاجر",
      "api.cardTenantText": "tenant_id وstore_id وسياسات وصول تمنع انتقال البيانات بين المتاجر.",
      "api.futureKicker": "جاهزية مستقبلية",
      "api.futureTitle": "شراء الاستضافة والدومينات عبر API",
      "api.futureText": "تم تجهيز نقاط التكامل دون ادعاء وجود مزود فعلي قبل إضافة بياناته وعقده الرسمي.",
      "api.hostingTitle": "UCHIHA Hosting 1",
      "api.domainsTitle": "UCHIHA Domains 1",
      "api.notConfigured": "غير مهيأ — جاهز لربط مزود لاحقًا",
      "api.statusTitle": "حالات الطلب المدعومة",
      "contact.kicker": "تواصل معنا",
      "contact.title": "وسائل التواصل ظاهرة وسهلة الوصول",
      "contact.description": "لا نطلب كلمات مرور أو Tokens أو وثائق دفع داخل الرسائل العامة.",
      "contact.pageTitle": "اختر وسيلة التواصل الأنسب",
      "contact.pageDescription": "تعرض هذه الصفحة القنوات المفعلة وساعات العمل المحددة من الإدارة فقط.",
      "contact.securityNote": "لن نطلب منك مشاركة كلمة مرور أو Token أو مفتاح API عبر قنوات التواصل العامة.",
      "contact.hours": "ساعات التواصل",
      "cta.kicker": "جاهز للبدء؟",
      "cta.title": "حوّل فكرتك إلى مشروع احترافي قابل للنمو",
      "states.noServices": "لا توجد خدمات ظاهرة حاليًا",
      "states.noServicesHint": "يمكن لمدير المنصة إضافة الخدمات أو تفعيلها.",
      "states.noSearchResults": "جرّب عبارة بحث مختلفة.",
      "states.noPortfolio": "لا توجد نماذج منشورة حاليًا",
      "states.noPayments": "لم تُنشر طرق دفع بعد",
      "states.noContacts": "لم تُفعّل وسائل التواصل بعد",
      "request.kicker": "طلب خدمة",
      "request.description": "أرسل التفاصيل الأساسية وسنتواصل معك لتحديد النطاق والخطوات.",
      "request.name": "الاسم",
      "request.email": "البريد الإلكتروني",
      "request.phone": "رقم الهاتف",
      "request.details": "تفاصيل المشروع",
      "request.contactHint": "أدخل البريد أو الهاتف على الأقل. لا ترسل كلمات مرور أو مفاتيح API.",
      "request.success": "تم استلام الطلب بنجاح. رقم الطلب: {id}",
      "request.failure": "تعذر إرسال الطلب. راجع الحقول وحاول مجددًا.",
      "request.contactRequired": "أدخل البريد الإلكتروني أو رقم الهاتف.",
      "whatsapp.default": "مرحبًا، أريد معرفة المزيد عن خدمات UCHIHA Builder.\nالصفحة: {page_url}",
      "whatsapp.service": "مرحبًا، أريد تفاصيل خدمة {service_name}.\nاسم العميل: {customer_name}\nالمعرف الداخلي: {customer_id}\nرابط الصفحة: {page_url}\nيرجى إرسال المتطلبات والمدة وخطوات عرض السعر.",
      "footer.about": "منصة موحدة لإنشاء وإدارة المتاجر والمواقع والبوتات والتطبيقات والتكاملات الرقمية.",
      "footer.platform": "المنصة",
      "footer.services": "الخدمات",
      "footer.support": "الدعم والمساعدة",
      "footer.legal": "قانوني",
      "footer.terms": "الشروط",
      "footer.privacy": "الخصوصية",
      "footer.rights": "جميع الحقوق محفوظة.",
      "footer.security": "الأمان والصيانة"
      ,"legal.termsKicker": "الشروط"
      ,"legal.termsTitle": "شروط استخدام المنصة"
      ,"legal.termsIntro": "استخدم المنصة والخدمات بصورة قانونية، وقدّم معلومات صحيحة، ولا تشارك بيانات دخول أو مفاتيح سرية ضمن الطلبات العامة."
      ,"legal.scopeTitle": "نطاق الخدمة"
      ,"legal.scopeText": "يتم تحديد النطاق والسعر والمدة النهائية بعد مراجعة المتطلبات، ولا تُعد الأسعار الابتدائية عرضًا نهائيًا."
      ,"legal.paymentsTitle": "المدفوعات"
      ,"legal.paymentsText": "لا تُرسل أي دفعة إلا عبر طريقة نشطة تعرض بيانات المستفيد داخل صفحة الدفع الرسمية."
      ,"legal.privacyKicker": "الخصوصية"
      ,"legal.privacyTitle": "كيف نتعامل مع بياناتك"
      ,"legal.privacyIntro": "نجمع الحد الأدنى اللازم لتشغيل الحسابات والمتاجر والطلبات والدعم، مع عزل بيانات كل متجر وصلاحيات وصول محددة."
      ,"legal.securityTitle": "الأمان والاحتفاظ"
      ,"legal.securityText": "تُحمى الأسرار بالتشفير أو التجزئة المناسبة، ولا تظهر بيانات اعتماد المزودين في الواجهات العامة أو سجلات التشغيل."
      ,"legal.contactTitle": "طلبات الخصوصية"
      ,"legal.contactText": "يمكنك استخدام مركز التواصل لطلب تصحيح بياناتك أو الاستفسار عن استخدامها."
    },
    en: {
      "common.skip": "Skip to content",
      "common.close": "Close",
      "common.copy": "Copy",
      "common.copied": "Copied",
      "common.open": "Open",
      "common.details": "Details",
      "common.notAvailable": "Not available",
      "common.notConfigured": "Not configured",
      "common.guest": "Guest",
      "common.none": "—",
      "common.menu": "Open navigation menu",
      "common.language": "التبديل إلى العربية",
      "common.light": "Use light mode",
      "common.dark": "Use dark mode",
      "common.loadingError": "The data could not be loaded right now",
      "common.retry": "Try again",
      "nav.home": "Home",
      "nav.services": "Services",
      "nav.showcase": "Work & Stores",
      "nav.payments": "Payment Methods",
      "nav.api": "UCHIHA API",
      "nav.contact": "Contact",
      "nav.login": "Sign in",
      "nav.admin": "Platform Admin",
      "actions.createStore": "Create a Store",
      "actions.exploreServices": "Explore Services",
      "actions.allServices": "All Services",
      "actions.openShowcase": "View Work",
      "actions.paymentCenter": "Payment Center",
      "actions.apiDetails": "Architecture Details",
      "actions.contactCenter": "Contact Center",
      "actions.requestService": "Request Service",
      "actions.sendRequest": "Send Request",
      "actions.whatsapp": "Contact via WhatsApp",
      "actions.openWhatsapp": "Contact via WhatsApp",
      "actions.openChannel": "Open Channel",
      "actions.viewDemo": "Open Demo",
      "actions.viewDetails": "View Details",
      "actions.showQr": "Show QR",
      "actions.copyAddress": "Copy Address",
      "hero.kicker": "Connected digital services",
      "hero.title": "Build your <em>store and website</em>, apps, and bots on one platform",
      "hero.description": "We turn your idea into a clear, secure, scalable digital product with unified management for websites, bots, applications, and orders.",
      "hero.proofLabel": "Platform advantages",
      "hero.proof1": "Unified architecture",
      "hero.proof2": "Mobile-first design",
      "hero.proof3": "Arabic and English",
      "slider.label": "Offers and services",
      "slider.previous": "Previous slide",
      "slider.next": "Next slide",
      "slider.dots": "Choose a slide",
      "confidence.label": "Delivery advantages",
      "confidence.securityTitle": "Secure by design",
      "confidence.securityText": "Isolation, roles, and audit logs",
      "confidence.pricingTitle": "Clear pricing",
      "confidence.pricingText": "Quote after scope review",
      "confidence.supportTitle": "Visible support",
      "confidence.supportText": "Contact channels in plain sight",
      "confidence.performanceTitle": "Fast experience",
      "confidence.performanceText": "Designed for mobile devices",
      "services.kicker": "Our services",
      "services.title": "Everything your digital project needs",
      "services.description": "Database-backed services that platform administrators can publish, reorder, and update.",
      "services.pageTitle": "Digital services built around a clear goal",
      "services.pageDescription": "Choose a service and share your requirements to receive a clear scope, timeline, and delivery process.",
      "services.search": "Search services...",
      "services.count": "{count} services",
      "services.price": "Starting price",
      "services.quote": "Based on requirements",
      "services.duration": "Estimated timeline",
      "services.comingSoon": "Available soon",
      "how.kicker": "How it works",
      "how.title": "From idea to working product",
      "how.step1Title": "Choose a service",
      "how.step1Text": "Start with the service closest to your goal.",
      "how.step2Title": "Share the details",
      "how.step2Text": "We review requirements and clarify the scope.",
      "how.step3Title": "We build it",
      "how.step3Text": "Implementation, testing, and clear progress updates.",
      "how.step4Title": "Receive your project",
      "how.step4Text": "Organized handover with operating guidance.",
      "showcase.kicker": "Selected work",
      "showcase.title": "Working examples you can open",
      "showcase.description": "Real and demo work is labeled honestly, without presenting mock content as client projects.",
      "showcase.pageTitle": "Working interfaces, not fictional claims",
      "showcase.pageDescription": "Every card identifies whether it is a demo or a live project and opens directly.",
      "showcase.demo": "Demo",
      "showcase.live": "Published project",
      "payments.kicker": "Payment methods",
      "payments.title": "Clear methods with details shown only after activation",
      "payments.description": "This page lists payment methods only. It never asks you to upload transfer proof.",
      "payments.pageTitle": "Payment methods and live status",
      "payments.pageDescription": "Information only. Do not upload payment proof here or transfer before verified beneficiary details are shown.",
      "payments.networkWarning": "Verify the currency, network, and destination before transferring. Never rely on details from an unofficial message.",
      "payments.currency": "Currency",
      "payments.network": "Network",
      "payments.minimum": "Minimum",
      "payments.beneficiary": "Beneficiary",
      "payments.account": "Account or address",
      "payments.instructions": "Transfer instructions",
      "payments.noProof": "Payment proof is never requested on this page.",
      "payments.active": "Available",
      "payments.comingSoon": "Coming soon",
      "payments.disabled": "Unavailable",
      "payments.hidden": "Hidden",
      "payments.unconfigured": "Details appear after an administrator activates the method.",
      "api.kicker": "UCHIHA API",
      "api.title": "An extensible provider layer that keeps the upstream source private",
      "api.description": "Unified adapters for sync, balances, orders, and statuses with idempotency, retries, webhooks, and safe error logs.",
      "api.point1": "UCHIHA API 1, 2, and 3 as public aliases",
      "api.point2": "Encrypted, isolated credentials",
      "api.point3": "Future API purchasing for hosting and domains",
      "api.pageTitle": "A strong integration layer for providers and future services",
      "api.pageDescription": "Neutral public aliases and an Adapter layer prevent provider lock-in and keep upstream identities private.",
      "api.cardAdapterTitle": "Adapter Interface",
      "api.cardAdapterText": "One contract for connectivity, balance, categories, products, orders, status tracking, and supported cancellation.",
      "api.cardQueueTitle": "Reliable orders",
      "api.cardQueueText": "Idempotency, retry with backoff, complete statuses, and traceable attempts.",
      "api.cardSecurityTitle": "Protected credentials",
      "api.cardSecurityText": "Secrets are encrypted and isolated, and never appear in public views or logs.",
      "api.cardTenantTitle": "Store isolation",
      "api.cardTenantText": "tenant_id, store_id, and access policies prevent data from crossing stores.",
      "api.futureKicker": "Future readiness",
      "api.futureTitle": "Purchase hosting and domains through APIs",
      "api.futureText": "Integration slots are ready without pretending a live provider exists before official credentials and contracts are supplied.",
      "api.hostingTitle": "UCHIHA Hosting 1",
      "api.domainsTitle": "UCHIHA Domains 1",
      "api.notConfigured": "Not configured — ready for a future provider",
      "api.statusTitle": "Supported order statuses",
      "contact.kicker": "Contact us",
      "contact.title": "Support channels that are visible and easy to reach",
      "contact.description": "We never request passwords, tokens, API keys, or payment documents in public messages.",
      "contact.pageTitle": "Choose the right contact channel",
      "contact.pageDescription": "Only active channels and administrator-configured working hours appear here.",
      "contact.securityNote": "We will never ask you to share a password, token, or API key through a public contact channel.",
      "contact.hours": "Contact hours",
      "cta.kicker": "Ready to begin?",
      "cta.title": "Turn your idea into a professional product built to grow",
      "states.noServices": "No services are currently published",
      "states.noServicesHint": "A platform administrator can publish or activate services.",
      "states.noSearchResults": "Try a different search phrase.",
      "states.noPortfolio": "No work samples are currently published",
      "states.noPayments": "No payment methods have been published",
      "states.noContacts": "No contact channels have been activated",
      "request.kicker": "Service request",
      "request.description": "Share the essentials and we will contact you to confirm scope and next steps.",
      "request.name": "Name",
      "request.email": "Email",
      "request.phone": "Phone",
      "request.details": "Project details",
      "request.contactHint": "Enter an email or phone number. Never include passwords or API keys.",
      "request.success": "Your request was received. Reference: {id}",
      "request.failure": "The request could not be sent. Review the fields and try again.",
      "request.contactRequired": "Enter an email address or phone number.",
      "whatsapp.default": "Hello, I would like to learn more about UCHIHA Builder services.\nPage: {page_url}",
      "whatsapp.service": "Hello, I would like details about {service_name}.\nCustomer: {customer_name}\nInternal ID: {customer_id}\nPage: {page_url}\nPlease send the requirements, timeline, and quotation steps.",
      "footer.about": "A unified platform for building and managing stores, websites, bots, apps, and digital integrations.",
      "footer.platform": "Platform",
      "footer.services": "Services",
      "footer.support": "Support",
      "footer.legal": "Legal",
      "footer.terms": "Terms",
      "footer.privacy": "Privacy",
      "footer.rights": "All rights reserved.",
      "footer.security": "Security & Maintenance"
      ,"legal.termsKicker": "Terms"
      ,"legal.termsTitle": "Platform Terms of Use"
      ,"legal.termsIntro": "Use the platform and services lawfully, provide accurate information, and never include credentials or secret keys in public requests."
      ,"legal.scopeTitle": "Service scope"
      ,"legal.scopeText": "Final scope, price, and timeline are confirmed after requirements review. Starting prices are not a final quotation."
      ,"legal.paymentsTitle": "Payments"
      ,"legal.paymentsText": "Send funds only through an active method that shows verified beneficiary details on the official payment page."
      ,"legal.privacyKicker": "Privacy"
      ,"legal.privacyTitle": "How we handle your data"
      ,"legal.privacyIntro": "We collect the minimum information needed for accounts, stores, orders, and support, with store isolation and explicit access controls."
      ,"legal.securityTitle": "Security and retention"
      ,"legal.securityText": "Secrets use appropriate encryption or hashing, and provider credentials never appear in public interfaces or operational logs."
      ,"legal.contactTitle": "Privacy requests"
      ,"legal.contactText": "Use the Contact Center to request a correction or ask how your information is used."
    }
  };

  const iconPaths = {
    sun: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"></path>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"></path>',
    close: '<path d="m6 6 12 12M18 6 6 18"></path>',
    store: '<path d="M4 10v10h16V10M3 10l2-6h14l2 6"></path><path d="M3 10c0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0"></path>',
    browser: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 9h18M7 6.5h.01M10 6.5h.01"></path>',
    telegram: '<path d="m21 3-8.2 18-3.9-7.4L3 10.8 21 3Z"></path><path d="m8.9 13.6 7.4-6.2"></path>',
    shield: '<path d="M12 3 20 6v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-3Z"></path><path d="m9 12 2 2 4-4"></path>',
    android: '<path d="m7 7-2-3M17 7l2-3M6 9h12v9H6zM8 18v3M16 18v3M3 10v6M21 10v6"></path><path d="M6 9a6 5 0 0 1 12 0"></path>',
    apple: '<path d="M16.5 13.5c0-2 1.7-3 2-3.2-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.9-3.5.9-.7 0-1.8-.9-3-.9-1.5 0-3 .9-3.8 2.3-1.7 2.9-.4 7.2 1.2 9.6.8 1.1 1.7 2.4 3 2.3 1.2 0 1.7-.7 3.2-.7 1.5 0 2 .7 3.2.7 1.3 0 2.2-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7-.1 0-3.1-1.2-3.1-4.2Z"></path><path d="M14.2 7c.6-.8 1.1-1.9 1-3-1 .1-2.2.7-2.9 1.5-.6.7-1.1 1.8-1 2.9 1.1.1 2.2-.5 2.9-1.4Z"></path>',
    code: '<path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"></path>',
    api: '<circle cx="12" cy="12" r="3"></circle><path d="M19 12h3M2 12h3M12 2v3M12 19v3M17 7l2-2M5 19l2-2M17 17l2 2M5 5l2 2"></path>',
    server: '<rect x="3" y="4" width="18" height="6" rx="2"></rect><rect x="3" y="14" width="18" height="6" rx="2"></rect><path d="M7 7h.01M7 17h.01M11 7h7M11 17h7"></path>',
    globe: '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"></path>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"></path>',
    layout: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M9 4v16M9 10h12"></path>',
    workflow: '<circle cx="5" cy="6" r="2"></circle><circle cx="19" cy="6" r="2"></circle><circle cx="12" cy="18" r="2"></circle><path d="M7 6h10M6 8l5 8M18 8l-5 8"></path>',
    consulting: '<path d="M4 20v-2a5 5 0 0 1 5-5h3"></path><circle cx="9" cy="7" r="4"></circle><path d="m15 17 2 2 4-5"></path>',
    whatsapp: '<path d="M20.5 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.2-4.7A8.5 8.5 0 1 1 20.5 11.5Z"></path><path d="M8.2 7.5c.2-.5.4-.5.8-.5h.4c.2 0 .4.1.5.4l.8 1.8c.1.3 0 .5-.2.7l-.6.7c-.2.2-.1.4 0 .6.7 1.2 1.7 2.1 3 2.7.2.1.4.1.6-.1l.8-.9c.2-.2.4-.3.7-.2l1.8.8c.3.1.4.3.4.6 0 .8-.4 1.6-1.1 2-1 .6-2.3.4-3.3 0-2.4-.9-4.5-2.8-5.6-5-.5-.9-.8-2.1-.3-3.1.2-.2.4-.4.5-.5Z"></path>',
    phone: '<path d="M6.6 3h3l1.5 4-2 1.7a16 16 0 0 0 6.2 6.2l1.7-2 4 1.5v3c0 2-1.6 3.6-3.6 3.6A14.4 14.4 0 0 1 3 6.6C3 4.6 4.6 3 6.6 3Z"></path>',
    email: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 7 8 6 8-6"></path>',
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m16 16 5 5"></path>',
    warning: '<path d="M12 3 2.7 20h18.6L12 3Z"></path><path d="M12 9v5M12 17h.01"></path>',
    price: '<path d="M20 12 12 20l-8-8V4h8l8 8Z"></path><circle cx="8" cy="8" r="1"></circle>',
    support: '<path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H6a2 2 0 0 1-2-2v-4ZM20 14h-3v6h1a2 2 0 0 0 2-2v-4ZM17 20c-1 1-2.5 1.5-5 1.5"></path>',
    speed: '<path d="M5 19a9 9 0 1 1 14 0M12 13l4-4"></path><circle cx="12" cy="13" r="1"></circle>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"></rect><circle cx="12" cy="12" r="4"></circle><circle cx="17.5" cy="6.5" r=".5"></circle>',
    facebook: '<path d="M14 21v-8h3l.5-3H14V8.5c0-1 .3-1.5 1.7-1.5H18V4.2c-.6-.1-1.5-.2-2.5-.2C13 4 11 5.5 11 8.4V10H8v3h3v8h3Z"></path>',
    discord: '<path d="M7 7c3-2 7-2 10 0 1.5 2.4 2.5 5.2 2.7 8-1.8 1.4-3.5 2-5.2 2.4l-1.1-1.5M17 7l-1.5 1M7 7 5.5 8C4 10.4 3.5 12.6 3.3 15c1.8 1.4 3.5 2 5.2 2.4l1.1-1.5"></path><circle cx="8.5" cy="13" r="1"></circle><circle cx="15.5" cy="13" r="1"></circle>',
    copy: '<rect x="8" y="8" width="11" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"></path>'
  };

  function readLocale() {
    try {
      const saved = localStorage.getItem(LANGUAGE_KEY);
      if (saved === "ar" || saved === "en") return saved;
    } catch {
      // Language remains usable without persistent storage.
    }
    return document.documentElement.lang === "en" ? "en" : "ar";
  }

  function t(key, replacements = {}) {
    let value = copy[state.locale]?.[key] ?? copy.ar[key] ?? key;
    for (const [name, replacement] of Object.entries(replacements)) {
      value = value.replaceAll(`{${name}}`, String(replacement ?? ""));
    }
    return value;
  }

  function localized(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    return value[state.locale] || value.ar || value.en || "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function icon(name, label = "") {
    const path = iconPaths[name] || iconPaths.code;
    return `<svg viewBox="0 0 24 24" ${label ? `role="img" aria-label="${escapeHtml(label)}"` : 'aria-hidden="true"'}>${path}</svg>`;
  }

  function applyIcons(root = document) {
    root.querySelectorAll("[data-icon]").forEach((node) => {
      node.innerHTML = icon(node.dataset.icon);
    });
  }

  function translateDocument(root = document) {
    document.documentElement.lang = state.locale;
    document.documentElement.dir = state.locale === "ar" ? "rtl" : "ltr";
    root.querySelectorAll("[data-i18n]").forEach((node) => {
      node.textContent = t(node.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-html]").forEach((node) => {
      node.innerHTML = t(node.dataset.i18nHtml);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
      node.placeholder = t(node.dataset.i18nPlaceholder);
    });
    root.querySelectorAll("[data-i18n-aria]").forEach((node) => {
      node.setAttribute("aria-label", t(node.dataset.i18nAria));
    });
    root.querySelectorAll("[data-language-toggle]").forEach((button) => {
      button.textContent = state.locale === "ar" ? "EN" : "عربي";
      button.setAttribute("aria-label", t("common.language"));
      button.setAttribute("title", t("common.language"));
    });
    syncThemeLabels();
  }

  function syncThemeLabels() {
    const dark = document.documentElement.dataset.theme === "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const label = dark ? t("common.light") : t("common.dark");
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
    });
  }

  function setLocale(locale) {
    if (locale !== "ar" && locale !== "en") return;
    state.locale = locale;
    try {
      localStorage.setItem(LANGUAGE_KEY, locale);
    } catch {
      // The selected locale still applies for this page.
    }
    document.querySelector('#serviceRequestDialog[data-dynamic-dialog="true"]')?.remove();
    translateDocument();
    renderAll();
    window.dispatchEvent(new CustomEvent("uchiha:language-change", { detail: { locale } }));
  }

  function navigation() {
    return [
      ["home", "/", "nav.home"],
      ["services", "/services", "nav.services"],
      ["showcase", "/showcase", "nav.showcase"],
      ["payments", "/payment-methods", "nav.payments"],
      ["api", "/uchiha-api", "nav.api"],
      ["contact", "/contact", "nav.contact"]
    ];
  }

  function renderShell() {
    const header = document.getElementById("siteHeader");
    if (header) {
      const links = navigation().map(([key, href, label]) =>
        `<a href="${href}"${page === key ? ' aria-current="page"' : ""} data-i18n="${label}">${t(label)}</a>`
      ).join("");
      header.innerHTML = `
        <header class="site-header">
          <div class="marketing-container site-header-inner">
            <a class="platform-brand" href="/" aria-label="UCHIHA Builder">
              <img src="/assets/brand/platform-mark.svg" alt="" width="38" height="38">
              <span><b>UCHIHA</b><small>BUILDER</small></span>
            </a>
            <nav class="desktop-nav" aria-label="${escapeHtml(t("common.menu"))}">${links}</nav>
            <div class="header-actions">
              <button class="language-toggle" type="button" data-language-toggle>${state.locale === "ar" ? "EN" : "عربي"}</button>
              <button class="header-icon-button" type="button" data-theme-toggle>${icon("sun")}</button>
              <a class="header-login" href="/login" data-i18n="nav.login">${t("nav.login")}</a>
              <a class="header-create" href="/create-store" data-i18n="actions.createStore">${t("actions.createStore")}</a>
              <button class="mobile-menu-toggle" type="button" data-mobile-menu aria-expanded="false">${icon("menu")}</button>
            </div>
          </div>
        </header>
        <div class="mobile-drawer" data-mobile-drawer hidden>
          <div class="mobile-drawer-inner">
            <nav>${links}</nav>
            <div class="mobile-drawer-actions">
              <a class="secondary-button" href="/login">${t("nav.login")}</a>
              <a class="primary-button" href="/create-store">${t("actions.createStore")}</a>
            </div>
          </div>
        </div>`;
    }

    const footer = document.getElementById("siteFooter");
    if (footer) {
      footer.innerHTML = `
        <footer class="site-footer">
          <div class="marketing-container footer-main">
            <div class="footer-about">
              <a class="platform-brand" href="/"><img src="/assets/brand/platform-mark.svg" alt="" width="38" height="38"><span><b>UCHIHA</b><small>BUILDER</small></span></a>
              <p>${t("footer.about")}</p>
              <a class="footer-whatsapp" data-footer-whatsapp href="#" target="_blank" rel="noopener">${icon("whatsapp")}<span dir="ltr">+963 942 586 044</span></a>
            </div>
            <nav class="footer-column"><b>${t("footer.platform")}</b><a href="/">${t("nav.home")}</a><a href="/showcase">${t("nav.showcase")}</a><a href="/uchiha-api">${t("nav.api")}</a><a href="/create-store">${t("actions.createStore")}</a></nav>
            <nav class="footer-column"><b>${t("footer.services")}</b><a href="/services">${t("nav.services")}</a><a href="/payment-methods">${t("nav.payments")}</a><a href="/services#security-maintenance">${t("footer.security")}</a><a href="/contact">${t("nav.contact")}</a></nav>
            <nav class="footer-column"><b>${t("footer.support")}</b><a href="/support">${t("footer.support")}</a><a href="/contact">${t("actions.contactCenter")}</a><a href="/terms">${t("footer.terms")}</a><a href="/privacy">${t("footer.privacy")}</a></nav>
          </div>
          <div class="marketing-container footer-bottom"><span>© ${new Date().getFullYear()} UCHIHA Builder — ${t("footer.rights")}</span><nav><a href="/terms">${t("footer.terms")}</a><a href="/privacy">${t("footer.privacy")}</a></nav></div>
        </footer>`;
    }

    translateDocument();
    bindShellEvents();
  }

  function bindShellEvents() {
    document.querySelectorAll("[data-language-toggle]").forEach((button) => {
      button.addEventListener("click", () => setLocale(state.locale === "ar" ? "en" : "ar"));
    });
    const menu = document.querySelector("[data-mobile-menu]");
    const drawer = document.querySelector("[data-mobile-drawer]");
    menu?.addEventListener("click", () => {
      const opening = drawer.hidden;
      drawer.hidden = !opening;
      menu.setAttribute("aria-expanded", String(opening));
      menu.innerHTML = icon(opening ? "close" : "menu");
    });
    drawer?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
      drawer.hidden = true;
      menu?.setAttribute("aria-expanded", "false");
      if (menu) menu.innerHTML = icon("menu");
    }));
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || payload.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload.code;
      throw error;
    }
    return payload;
  }

  async function loadPortal() {
    try {
      const [portal, me] = await Promise.all([
        requestJson("/api/public/portal"),
        requestJson("/api/me").catch((error) => error.status === 401 ? null : Promise.reject(error))
      ]);
      state.portal = portal;
      state.user = me?.user || null;
      document.querySelectorAll(".skeleton-grid, .skeleton-panel").forEach((node) => node.classList.remove("skeleton-grid", "skeleton-panel"));
      renderAll();
    } catch (error) {
      console.error("Portal load failed", error);
      showLoadError();
    }
  }

  function showLoadError() {
    for (const id of ["servicesGrid", "portfolioGrid", "paymentsGrid", "contactsGrid", "portalSlider"]) {
      const node = document.getElementById(id);
      if (!node) continue;
      node.classList.remove("skeleton-grid", "skeleton-panel");
      node.innerHTML = `<div class="content-state"><b>${t("common.loadingError")}</b><button class="outline-button" type="button" data-retry-portal>${t("common.retry")}</button></div>`;
    }
    document.querySelectorAll("[data-retry-portal]").forEach((button) => button.addEventListener("click", loadPortal));
  }

  function renderAll() {
    applyIcons();
    if (!state.portal) return;
    renderSlider();
    renderServices();
    renderPortfolio();
    renderPayments();
    renderContacts();
    configureWhatsapp();
  }

  function renderSlider() {
    const slider = document.getElementById("portalSlider");
    if (!slider) return;
    const banners = state.portal.banners || [];
    const stage = slider.querySelector(".slider-stage");
    const dots = slider.querySelector(".slider-dots");
    if (!banners.length) {
      slider.hidden = true;
      stopSlider();
      return;
    }
    slider.hidden = false;
    state.sliderIndex = Math.min(state.sliderIndex, banners.length - 1);
    stage.innerHTML = banners.map((banner, index) => `
      <article class="slider-slide${index === state.sliderIndex ? " active" : ""}" aria-hidden="${index === state.sliderIndex ? "false" : "true"}">
        <img src="${escapeHtml(banner.imageUrl)}" alt="" width="720" height="480">
        <div class="slider-caption"><h2>${escapeHtml(localized(banner.title))}</h2><p>${escapeHtml(localized(banner.subtitle))}</p><a href="${escapeHtml(banner.linkUrl || "/services")}">${escapeHtml(localized(banner.actionLabel) || t("common.open"))}</a></div>
      </article>`).join("");
    dots.innerHTML = banners.map((banner, index) => `<button class="slider-dot" type="button" role="tab" aria-selected="${index === state.sliderIndex}" aria-label="${index + 1}: ${escapeHtml(localized(banner.title))}" data-slide-index="${index}"></button>`).join("");
    dots.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => showSlide(Number(button.dataset.slideIndex), true)));
    const previous = slider.querySelector(".slider-previous");
    const next = slider.querySelector(".slider-next");
    if (previous) previous.onclick = () => showSlide(state.sliderIndex - 1, true);
    if (next) next.onclick = () => showSlide(state.sliderIndex + 1, true);
    slider.onmouseenter = stopSlider;
    slider.onmouseleave = startSlider;
    slider.onfocusin = stopSlider;
    slider.onfocusout = startSlider;
    startSlider();
  }

  function showSlide(index, restart = false) {
    const banners = state.portal?.banners || [];
    if (!banners.length) return;
    state.sliderIndex = (index + banners.length) % banners.length;
    const slider = document.getElementById("portalSlider");
    slider?.querySelectorAll(".slider-slide").forEach((slide, itemIndex) => {
      const active = itemIndex === state.sliderIndex;
      slide.classList.toggle("active", active);
      slide.setAttribute("aria-hidden", String(!active));
    });
    slider?.querySelectorAll("[data-slide-index]").forEach((dot, itemIndex) => dot.setAttribute("aria-selected", String(itemIndex === state.sliderIndex)));
    if (restart) startSlider();
  }

  function stopSlider() {
    clearInterval(state.sliderTimer);
    state.sliderTimer = null;
  }

  function startSlider() {
    stopSlider();
    const banners = state.portal?.banners || [];
    if (banners.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden) return;
    const configured = Number(state.portal.settings?.["portal.presentation"]?.sliderAutoplayMs);
    const delay = Number.isFinite(configured) ? Math.max(4000, Math.min(configured, 15000)) : 6500;
    state.sliderTimer = setInterval(() => showSlide(state.sliderIndex + 1), delay);
  }

  function formatMoney(minor, currency) {
    if (minor === null || minor === undefined) return t("services.quote");
    try {
      return new Intl.NumberFormat(state.locale === "ar" ? "ar-SY" : "en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(Number(minor) / 100);
    } catch {
      return `${(Number(minor) / 100).toFixed(2)} ${currency || "USD"}`;
    }
  }

  function renderServices() {
    const grid = document.getElementById("servicesGrid");
    if (!grid) return;
    const query = state.search.trim().toLocaleLowerCase(state.locale);
    let services = (state.portal.services || []).filter((service) => ["active", "coming_soon"].includes(service.status));
    if (query) services = services.filter((service) => [localized(service.name), localized(service.description), ...(service.features?.[state.locale] || [])].join(" ").toLocaleLowerCase(state.locale).includes(query));
    const limit = Number(grid.dataset.limit || 0);
    const visible = limit > 0 ? services.slice(0, limit) : services;
    grid.innerHTML = visible.map((service) => {
      const features = service.features?.[state.locale] || service.features?.ar || [];
      const requestAction = service.status === "active"
        ? `<button class="primary-button" type="button" data-request-service="${service.id}">${t("actions.requestService")}</button>`
        : `<button class="primary-button" type="button" disabled>${t("services.comingSoon")}</button>`;
      return `<article class="service-card" id="${escapeHtml(service.slug)}">
        <span class="service-icon">${icon(service.iconKey)}</span>
        <h3>${escapeHtml(localized(service.name))}</h3>
        <p>${escapeHtml(localized(service.description))}</p>
        <ul class="service-features">${features.slice(0, 4).map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}</ul>
        <div class="service-meta"><span><small>${t("services.price")}</small><b>${escapeHtml(formatMoney(service.startingPriceMinor, service.currency))}</b></span><span><small>${t("services.duration")}</small><b>${escapeHtml(localized(service.estimatedDuration) || t("common.notAvailable"))}</b></span></div>
        <div class="service-actions">${requestAction}<a class="whatsapp-button" href="${escapeHtml(whatsappUrl(service))}" target="_blank" rel="noopener">${icon("whatsapp")}${t("actions.whatsapp")}</a></div>
      </article>`;
    }).join("");
    const empty = document.getElementById("servicesEmpty");
    if (empty) empty.hidden = visible.length > 0;
    const count = document.getElementById("serviceCount");
    if (count) count.textContent = t("services.count", { count: services.length });
    grid.querySelectorAll("[data-request-service]").forEach((button) => button.addEventListener("click", () => openServiceDialog(button.dataset.requestService)));
  }

  function renderPortfolio() {
    const grid = document.getElementById("portfolioGrid");
    if (!grid) return;
    const items = state.portal.portfolio || [];
    grid.innerHTML = items.map((item) => `<article class="portfolio-card"><div class="portfolio-media"><img src="${escapeHtml(item.imageUrl)}" alt="" width="960" height="540" loading="lazy"><span class="portfolio-badge">${item.type === "demo" ? t("showcase.demo") : t("showcase.live")}</span></div><div class="portfolio-copy"><h3>${escapeHtml(localized(item.title))}</h3><p>${escapeHtml(localized(item.description))}</p><a href="${escapeHtml(item.targetUrl)}">${t("actions.viewDemo")} ←</a></div></article>`).join("");
    const empty = document.getElementById("portfolioEmpty");
    if (empty) empty.hidden = items.length > 0;
  }

  function paymentStatus(method) {
    const keys = { active: "payments.active", coming_soon: "payments.comingSoon", disabled: "payments.disabled", hidden: "payments.hidden" };
    return t(keys[method.status] || "payments.disabled");
  }

  function renderPayments() {
    const grid = document.getElementById("paymentsGrid");
    if (!grid) return;
    let methods = state.portal.paymentMethods || [];
    const limit = Number(grid.dataset.limit || 0);
    if (limit > 0) methods = methods.slice(0, limit);
    const compact = grid.classList.contains("payment-mini-grid");
    grid.innerHTML = methods.map((method) => {
      if (compact) return `<article class="payment-mini-card"><img class="payment-logo" src="${escapeHtml(method.logoUrl || "/assets/payment-assets/manual-payment.svg")}" alt="" width="42" height="42"><b>${escapeHtml(localized(method.name))}</b><small>${escapeHtml([method.currency, method.network].filter(Boolean).join(" · "))}</small><span class="method-status${method.status === "active" ? " active" : ""}">${paymentStatus(method)}</span></article>`;
      const usable = method.status === "active" && method.configured;
      return `<article class="payment-card">
        <div class="payment-card-head"><div class="payment-card-identity"><img class="payment-logo" src="${escapeHtml(method.logoUrl || "/assets/payment-assets/manual-payment.svg")}" alt="" width="48" height="48"><div><h2>${escapeHtml(localized(method.name))}</h2><small>${escapeHtml(method.type || "")}</small></div></div><span class="method-status${method.status === "active" ? " active" : ""}">${paymentStatus(method)}</span></div>
        <div class="payment-facts"><div><span>${t("payments.currency")}</span><b>${escapeHtml(method.currency || t("common.none"))}</b></div><div><span>${t("payments.network")}</span><b>${escapeHtml(method.network || t("common.notAvailable"))}</b></div><div><span>${t("payments.minimum")}</span><b>${method.minimumAmountMinor === null ? t("common.notAvailable") : escapeHtml(formatMoney(method.minimumAmountMinor, method.currency))}</b></div></div>
        <p>${usable ? t("payments.noProof") : t("payments.unconfigured")}</p>
        <div class="payment-card-actions"><button class="outline-button" type="button" data-payment-details="${method.id}" ${usable ? "" : "disabled"}>${t("actions.viewDetails")}</button><button class="primary-button" type="button" data-payment-qr="${method.id}" ${usable && (method.qrUrl || method.qrImageUrl) ? "" : "disabled"}>${t("actions.showQr")}</button></div>
      </article>`;
    }).join("");
    const empty = document.getElementById("paymentsEmpty");
    if (empty) empty.hidden = methods.length > 0;
    grid.querySelectorAll("[data-payment-details]").forEach((button) => button.addEventListener("click", () => openPaymentDialog(button.dataset.paymentDetails, false)));
    grid.querySelectorAll("[data-payment-qr]").forEach((button) => button.addEventListener("click", () => openPaymentDialog(button.dataset.paymentQr, true)));
  }

  function contactHref(contact) {
    const target = String(contact.target || "").trim();
    const username = target.replace(/^@/, "");
    if (contact.type === "whatsapp") return whatsappUrl(null, localized(contact.messageTemplate));
    if (contact.type === "phone") return `tel:${target.replace(/[^+\d]/g, "")}`;
    if (contact.type === "email") return `mailto:${target}`;
    if (target.startsWith("https://")) return target;
    const social = { telegram: "https://t.me/", instagram: "https://instagram.com/", tiktok: "https://tiktok.com/@", facebook: "https://facebook.com/", discord: "https://discord.com/users/" };
    return social[contact.type] ? `${social[contact.type]}${encodeURIComponent(username)}` : "#";
  }

  function renderContacts() {
    const grid = document.getElementById("contactsGrid");
    if (!grid) return;
    const contacts = state.portal.contacts || [];
    grid.innerHTML = contacts.map((contact) => `<article class="contact-card" data-contact-type="${escapeHtml(contact.type)}"><span class="contact-icon">${icon(contact.iconKey || contact.type)}</span><h3>${escapeHtml(localized(contact.name))}</h3><p>${escapeHtml(localized(contact.description))}</p><small><b>${t("contact.hours")}:</b> ${escapeHtml(localized(contact.workingHours) || t("common.notAvailable"))}</small><a class="${contact.type === "whatsapp" ? "whatsapp-button" : "outline-button"}" href="${escapeHtml(contactHref(contact))}" target="${["phone", "email"].includes(contact.type) ? "_self" : "_blank"}" rel="noopener">${contact.type === "whatsapp" ? t("actions.openWhatsapp") : t("actions.openChannel")}</a></article>`).join("");
    const empty = document.getElementById("contactsEmpty");
    if (empty) empty.hidden = contacts.length > 0;
  }

  function whatsappNumber() {
    const configured = state.portal?.whatsappNumber || state.portal?.settings?.["portal.presentation"]?.whatsappNumber || WHATSAPP_FALLBACK;
    return String(configured).replace(/\D/g, "") || WHATSAPP_FALLBACK.replace(/\D/g, "");
  }

  function whatsappUrl(service = null, customTemplate = "") {
    const name = service ? localized(service.name) : "UCHIHA Builder";
    let template = customTemplate || (service ? localized(service.whatsappTemplate) : t("whatsapp.default")) || (service ? t("whatsapp.service") : t("whatsapp.default"));
    const replacements = {
      service_name: name,
      customer_name: state.user?.displayName || t("common.guest"),
      customer_id: state.user?.id || t("common.notAvailable"),
      page_url: window.location.href
    };
    for (const [key, value] of Object.entries(replacements)) template = template.replaceAll(`{${key}}`, value);
    return `https://wa.me/${whatsappNumber()}?text=${encodeURIComponent(template)}`;
  }

  function configureWhatsapp() {
    const href = whatsappUrl();
    const floating = document.getElementById("floatingWhatsapp");
    if (floating) href && (floating.href = href);
    document.querySelectorAll("[data-footer-whatsapp]").forEach((link) => link.href = href);
  }

  function ensureServiceDialog() {
    let dialog = document.getElementById("serviceRequestDialog");
    if (dialog) return dialog;
    document.body.insertAdjacentHTML("beforeend", `<dialog id="serviceRequestDialog" class="portal-dialog" data-dynamic-dialog="true"><form id="serviceRequestForm"><button class="dialog-close" type="button" data-dialog-close aria-label="${t("common.close")}">×</button><span class="section-kicker">${t("request.kicker")}</span><h2 id="requestServiceName"></h2><p>${t("request.description")}</p><input name="serviceId" type="hidden"><label><span>${t("request.name")}</span><input name="customerName" required maxlength="160" autocomplete="name"></label><div class="dialog-fields"><label><span>${t("request.email")}</span><input name="customerEmail" type="email" maxlength="240" autocomplete="email"></label><label><span>${t("request.phone")}</span><input name="customerPhone" type="tel" maxlength="40" autocomplete="tel"></label></div><label><span>${t("request.details")}</span><textarea name="details" rows="5" required maxlength="6000"></textarea></label><small>${t("request.contactHint")}</small><div id="serviceRequestNotice" class="form-notice" role="status" hidden></div><button class="primary-button" type="submit">${t("actions.sendRequest")}</button></form></dialog>`);
    dialog = document.getElementById("serviceRequestDialog");
    bindServiceForm(dialog);
    return dialog;
  }

  function bindServiceForm(dialog = document.getElementById("serviceRequestDialog")) {
    if (!dialog || dialog.dataset.bound === "true") return;
    dialog.dataset.bound = "true";
    dialog.querySelector("[data-dialog-close]")?.addEventListener("click", () => closeDialog(dialog));
    dialog.addEventListener("click", (event) => { if (event.target === dialog) closeDialog(dialog); });
    dialog.querySelector("form")?.addEventListener("submit", submitServiceRequest);
  }

  function openServiceDialog(serviceId) {
    const service = state.portal?.services?.find((item) => item.id === serviceId);
    if (!service) return;
    const dialog = ensureServiceDialog();
    const form = dialog.querySelector("form");
    form.reset();
    form.elements.serviceId.value = service.id;
    if (state.user?.displayName) form.elements.customerName.value = state.user.displayName;
    if (state.user?.email) form.elements.customerEmail.value = state.user.email;
    dialog.querySelector("#requestServiceName").textContent = localized(service.name);
    const notice = dialog.querySelector("#serviceRequestNotice");
    notice.hidden = true;
    notice.classList.remove("success");
    state.requestKey = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    openDialog(dialog);
    setTimeout(() => form.elements.customerName.focus(), 50);
  }

  async function submitServiceRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const notice = form.querySelector("#serviceRequestNotice");
    const button = form.querySelector('[type="submit"]');
    if (!form.elements.customerEmail.value.trim() && !form.elements.customerPhone.value.trim()) {
      notice.textContent = t("request.contactRequired");
      notice.hidden = false;
      return;
    }
    button.disabled = true;
    notice.hidden = true;
    try {
      const result = await requestJson("/api/public/service-requests", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": state.requestKey },
        body: JSON.stringify({
          serviceId: form.elements.serviceId.value,
          customerName: form.elements.customerName.value,
          customerEmail: form.elements.customerEmail.value,
          customerPhone: form.elements.customerPhone.value,
          details: form.elements.details.value,
          locale: state.locale,
          sourcePage: `${window.location.pathname}${window.location.search}`
        })
      });
      notice.textContent = t("request.success", { id: result.request.id });
      notice.classList.add("success");
      notice.hidden = false;
      form.querySelectorAll("input:not([type=hidden]), textarea").forEach((field) => field.disabled = true);
    } catch (error) {
      console.error("Service request failed", error);
      notice.textContent = error.code === "contact_required" ? t("request.contactRequired") : t("request.failure");
      notice.classList.remove("success");
      notice.hidden = false;
      button.disabled = false;
    }
  }

  function openPaymentDialog(methodId, focusQr) {
    const method = state.portal?.paymentMethods?.find((item) => item.id === methodId);
    if (!method || method.status !== "active" || !method.configured) return;
    document.getElementById("paymentDetailsDialog")?.remove();
    const qr = method.qrUrl || method.qrImageUrl;
    const instructions = (method.instructions || []).filter((item) => item.locale === state.locale);
    const body = instructions.length ? instructions.map((item) => `<section><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.body)}</p>${item.warning ? `<div class="security-note warning-note"><span class="line-icon">${icon("warning")}</span><p>${escapeHtml(item.warning)}</p></div>` : ""}</section>`).join("") : `<p>${t("payments.noProof")}</p>`;
    document.body.insertAdjacentHTML("beforeend", `<dialog id="paymentDetailsDialog" class="portal-dialog"><div class="portal-dialog-panel"><button class="dialog-close" type="button" data-dialog-close aria-label="${t("common.close")}">×</button><span class="section-kicker">${t("payments.kicker")}</span><h2>${escapeHtml(localized(method.name))}</h2><div class="payment-dialog-layout">${qr ? `<div class="payment-qr-shell"><img src="${escapeHtml(qr)}" alt="QR — ${escapeHtml(localized(method.name))}" width="360" height="360"></div>` : ""}<div><div class="payment-detail-list"><div><span>${t("payments.beneficiary")}</span><b>${escapeHtml(method.beneficiaryName || t("common.notAvailable"))}</b></div><div><span>${t("payments.currency")}</span><b>${escapeHtml(method.currency || t("common.none"))}</b></div><div><span>${t("payments.network")}</span><b>${escapeHtml(method.network || t("common.notAvailable"))}</b></div><div><span>${t("payments.account")}</span><code dir="ltr">${escapeHtml(method.accountIdentifier || t("common.notAvailable"))}</code></div></div><div class="copy-row"><button class="outline-button" type="button" data-copy-value="${escapeHtml(method.accountIdentifier || "")}">${icon("copy")}${t("actions.copyAddress")}</button></div>${body}</div></div></div></dialog>`);
    const dialog = document.getElementById("paymentDetailsDialog");
    dialog.querySelector("[data-dialog-close]").addEventListener("click", () => closeDialog(dialog));
    dialog.addEventListener("click", (event) => { if (event.target === dialog) closeDialog(dialog); });
    dialog.querySelector("[data-copy-value]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      try {
        await navigator.clipboard.writeText(button.dataset.copyValue);
        button.textContent = t("common.copied");
      } catch {
        button.textContent = t("common.notAvailable");
      }
    });
    openDialog(dialog);
    if (focusQr) dialog.querySelector(".payment-qr-shell")?.scrollIntoView({ block: "center" });
  }

  function openDialog(dialog) {
    document.body.classList.add("dialog-open");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeDialog(dialog) {
    document.body.classList.remove("dialog-open");
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function initialize() {
    renderShell();
    bindServiceForm();
    const search = document.getElementById("serviceSearch");
    search?.addEventListener("input", () => {
      state.search = search.value;
      renderServices();
    });
    document.addEventListener("visibilitychange", () => document.hidden ? stopSlider() : startSlider());
    window.addEventListener("uchiha:theme-change", syncThemeLabels);
    loadPortal();
  }

  initialize();
})();
