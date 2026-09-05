(() => {
  "use strict";

  const dictionary = {
    ar: {
      "hero.badge": "منصة واحدة لمشروع كامل",
      "actions.openDemo": "شاهد المتجر التجريبي",
      "actions.talkToUs": "تحدث معنا",
      "hero.product1": "موقع متجر",
      "hero.product2": "بوت متجر",
      "hero.product3": "بوت إدارة",
      "hero.product4": "تطبيق",
      "preview.label": "معاينة لوحة UCHIHA Builder",
      "preview.online": "النظام يعمل",
      "preview.workspace": "مساحة العمل",
      "preview.title": "مشروعك جاهز للنمو",
      "preview.newProject": "مشروع جديد",
      "preview.metric1": "المتجر",
      "preview.metric2": "البوتات",
      "preview.metric3": "الطلبات",
      "preview.active": "فعّال",
      "preview.synced": "متزامنة",
      "preview.fallbackTitle": "واجهة متجر سريعة وواضحة",
      "preview.fallbackText": "أقسام، منتجات، دفع، طلبات ودعم من قاعدة واحدة.",
      "preview.feed1": "الموقع متصل",
      "preview.feed2": "آخر تحديث نُشر",
      "preview.now": "الآن",
      "confidence.unifiedTitle": "إدارة موحدة",
      "confidence.unifiedText": "كل الخدمات من لوحة واحدة",
      "capability.kicker": "ليس مجرد متجر",
      "capability.title": "مشروع رقمي متكامل ينطلق من حساب واحد",
      "capability.description": "اختر ما تحتاجه الآن، وأضف بقية المكونات عندما يتوسع عملك دون نقل البيانات أو تغيير النظام.",
      "capability.note": "جميع المكونات تعمل على قاعدة بيانات موحدة",
      "capability.webTitle": "موقع متجر احترافي",
      "capability.webText": "واجهة سريعة للهاتف، أقسام ومنتجات وسلة وطلبات ودفع ودعم.",
      "capability.botTitle": "بوت متجر",
      "capability.botText": "بيع واستقبال الطلبات ومتابعتها مباشرة من تيليجرام.",
      "capability.adminTitle": "لوحة وبوت إدارة",
      "capability.adminText": "إدارة المنتجات والطلبات والعملاء والأرصدة من أي مكان.",
      "capability.appTitle": "تطبيق Android",
      "capability.appText": "تجربة تطبيق مرتبطة بنفس الحساب والطلبات والإشعارات.",
      "capability.available": "متاح ضمن المنصة",
      "capability.inProgress": "قيد التطوير",
      "ecosystem.kicker": "منظومة UCHIHA",
      "ecosystem.title": "كل أداة تحتاجها، دون واجهة مزدحمة",
      "ecosystem.description": "نظهر لك الأدوات التي تحتاجها في اللحظة المناسبة، مع مسارات واضحة بدل عشرات الأزرار والصفحات المتكررة.",
      "ecosystem.point1": "حساب واحد لكل خدماتك",
      "ecosystem.point2": "بيانات مشتركة بين الموقع والبوت والتطبيق",
      "ecosystem.point3": "إضافة مكونات جديدة دون إعادة بناء المشروع",
      "ecosystem.mapLabel": "مكونات منظومة UCHIHA",
      "ecosystem.store": "المتجر",
      "ecosystem.bots": "البوتات",
      "ecosystem.app": "التطبيق",
      "ecosystem.api": "التكاملات",
      "ecosystem.data": "البيانات",
      "how.description": "مسار قصير وواضح، دون إعدادات مربكة أو خطوات تقنية منك.",
      "cta.title": "ابنِ أول نسخة من مشروعك اليوم، ووسّعها معنا غدًا",
      "cta.description": "ابدأ بالمتجر، ثم أضف البوتات والتطبيق والتكاملات من نفس المنصة."
    },
    en: {
      "hero.badge": "One platform for a complete project",
      "actions.openDemo": "Open the demo store",
      "actions.talkToUs": "Talk to us",
      "hero.product1": "Store website",
      "hero.product2": "Store bot",
      "hero.product3": "Admin bot",
      "hero.product4": "Mobile app",
      "preview.label": "UCHIHA Builder dashboard preview",
      "preview.online": "System online",
      "preview.workspace": "Workspace",
      "preview.title": "Your project is ready to grow",
      "preview.newProject": "New project",
      "preview.metric1": "Store",
      "preview.metric2": "Bots",
      "preview.metric3": "Orders",
      "preview.active": "Active",
      "preview.synced": "Synced",
      "preview.fallbackTitle": "A fast, clear storefront",
      "preview.fallbackText": "Categories, products, payments, orders, and support from one database.",
      "preview.feed1": "Website connected",
      "preview.feed2": "Latest update deployed",
      "preview.now": "Now",
      "confidence.unifiedTitle": "Unified control",
      "confidence.unifiedText": "All services in one dashboard",
      "capability.kicker": "More than a store",
      "capability.title": "A complete digital project from one account",
      "capability.description": "Start with what you need today, then add components as your business grows without moving data or changing systems.",
      "capability.note": "Every component runs on one shared database",
      "capability.webTitle": "Professional storefront",
      "capability.webText": "A mobile-first experience with categories, products, cart, orders, payments, and support.",
      "capability.botTitle": "Store bot",
      "capability.botText": "Sell, receive orders, and track them directly through Telegram.",
      "capability.adminTitle": "Dashboard and admin bot",
      "capability.adminText": "Manage products, orders, customers, and balances from anywhere.",
      "capability.appTitle": "Android app",
      "capability.appText": "A connected app experience using the same account, orders, and notifications.",
      "capability.available": "Available in the platform",
      "capability.inProgress": "In development",
      "ecosystem.kicker": "UCHIHA Ecosystem",
      "ecosystem.title": "Every tool you need, without a crowded interface",
      "ecosystem.description": "We surface the right tools at the right moment, using clear flows instead of repetitive pages and dozens of buttons.",
      "ecosystem.point1": "One account for all services",
      "ecosystem.point2": "Shared data across web, bots, and mobile",
      "ecosystem.point3": "Add new components without rebuilding",
      "ecosystem.mapLabel": "UCHIHA ecosystem components",
      "ecosystem.store": "Store",
      "ecosystem.bots": "Bots",
      "ecosystem.app": "App",
      "ecosystem.api": "Integrations",
      "ecosystem.data": "Data",
      "how.description": "A short, clear path with no technical setup or confusing configuration required from you.",
      "cta.title": "Build your first version today, then scale it with us tomorrow",
      "cta.description": "Start with the store, then add bots, mobile, and integrations from the same platform."
    }
  };

  function locale() {
    return document.documentElement.lang === "en" ? "en" : "ar";
  }

  function translate() {
    const copy = dictionary[locale()];
    document.querySelectorAll("[data-home-i18n]").forEach((node) => {
      const value = copy[node.dataset.homeI18n];
      if (value) node.textContent = value;
    });
    document.querySelectorAll("[data-home-i18n-aria]").forEach((node) => {
      const value = copy[node.dataset.homeI18nAria];
      if (value) node.setAttribute("aria-label", value);
    });
  }

  translate();
  window.addEventListener("uchiha:language-change", translate);
})();
