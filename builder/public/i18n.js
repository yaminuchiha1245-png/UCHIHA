(() => {
  "use strict";

  const STORAGE_KEY = "uchiha-ui-language";
  const textState = new WeakMap();
  const attributeState = new WeakMap();
  let applying = false;

  const keys = {
    ar: {
      "store.loading": "تحميل المتجر",
      "language.switch": "Switch to English"
    },
    en: {
      "store.loading": "Loading store",
      "language.switch": "التبديل إلى العربية"
    }
  };

  const phrases = new Map(Object.entries({
    "تجاوز إلى محتوى المتجر": "Skip to store content",
    "تجاوز إلى المحتوى": "Skip to content",
    "الرئيسية": "Home",
    "الخدمات": "Services",
    "الطلبات": "Orders",
    "طلباتي": "My Orders",
    "المنتجات": "Products",
    "المنتجات والخدمات": "Products & Services",
    "الأقسام": "Categories",
    "العملاء": "Customers",
    "المستخدمون": "Users",
    "المتاجر": "Stores",
    "الاشتراكات": "Subscriptions",
    "الموظفون والصلاحيات": "Staff & Permissions",
    "الصلاحيات": "Permissions",
    "طرق الدفع": "Payment Methods",
    "دفعاتي": "My Payments",
    "إضافة رصيد": "Add Funds",
    "محفظتي": "My Wallet",
    "المحفظة": "Wallet",
    "الرصيد": "Balance",
    "العملة": "Currency",
    "عملة العرض": "Display currency",
    "الإشعارات": "Notifications",
    "حساب المتجر": "Store account",
    "فتح الحساب": "Open account",
    "فتح المحفظة": "Open wallet",
    "فتح القائمة": "Open menu",
    "القائمة": "Menu",
    "إغلاق": "Close",
    "العودة": "Back",
    "العودة للأقسام": "Back to categories",
    "العودة إلى كل الأقسام": "Back to all categories",
    "العودة إلى الصفحة الرئيسية": "Back to home",
    "العودة إلى واجهة المتجر": "Return to the storefront",
    "العودة إلى الصفحة الرئيسية للمتجر": "Return to store home",
    "البحث في المتجر": "Search the store",
    "ابحث في المتجر": "Search the store",
    "ابحث عن لعبة أو اشتراك أو خدمة...": "Search for a product, subscription, or service...",
    "بحث": "Search",
    "مرحبًا بك": "Welcome",
    "استكشف الأقسام": "Explore categories",
    "فتح الرابط": "Open link",
    "مزايا المتجر": "Store advantages",
    "اختر القسم ووصل للخدمة بسرعة": "Choose a category and reach the service quickly",
    "تابع طلبك من حسابك": "Track orders from your account",
    "الدعم معك داخل المتجر": "Support is available inside the store",
    "تسوّق بسهولة": "Shop with ease",
    "اختر قسمك": "Choose a category",
    "ابدأ بالقسم المناسب، وبعدها اختر الخدمة التي تحتاجها.": "Start with the right category, then choose the service you need.",
    "داخل القسم": "Inside category",
    "تحميل المزيد": "Load more",
    "تحتاج مساعدة؟": "Need help?",
    "تحدث مع فريق المتجر من هنا": "Talk to the store team here",
    "اختر واتساب أو تيليجرام أو وسيلة التواصل التي فعّلها المتجر.": "Choose WhatsApp, Telegram, or another channel enabled by the store.",
    "فتح مركز الدعم": "Open Support Center",
    "الدعم المباشر": "Direct support",
    "تواصل عبر واتساب": "Contact via WhatsApp",
    "التنقل السريع": "Quick navigation",
    "السلة": "Cart",
    "الحماية": "Security",
    "سجّل الدخول لمزامنة الرصيد والطلبات": "Sign in to sync balance and orders",
    "زائر": "Guest",
    "مدعوم بواسطة UCHIHA": "Powered by UCHIHA",
    "قائمة المتجر": "Store menu",
    "طلبات إضافة الرصيد فقط": "Balance top-up requests only",
    "الرصيد وسجل العمليات": "Balance and transaction history",
    "حالة الشراء والتنفيذ": "Purchase and fulfillment status",
    "الدعم الفني": "Technical Support",
    "وسائل التواصل الخارجية المعتمدة": "Approved external contact channels",
    "ربط Telegram": "Connect Telegram",
    "نفس الحساب والرصيد والطلبات": "The same account, balance, and orders",
    "حماية الحساب": "Account Security",
    "التحقق بخطوتين والجلسات": "Two-step verification and sessions",
    "توثيق الهوية": "Identity Verification",
    "إرسال ومتابعة طلب التوثيق": "Submit and track a verification request",
    "واجهة المطور API": "Developer API",
    "المنتجات والأقسام فقط": "Products and categories only",
    "من نحن": "About Us",
    "تعرف على المتجر وخدماته": "Learn about the store and its services",
    "اللغة": "Language",
    "المظهر": "Theme",
    "داكن": "Dark",
    "فاتح": "Light",
    "أنشئ متجرك مع UCHIHA Builder": "Build your store with UCHIHA Builder",
    "موقع وبوت متجر ولوحة إدارة من مكان واحد": "Website, store bot, and admin workspace in one place",
    "تسجيل الخروج": "Sign out",
    "سلة المشتريات": "Shopping Cart",
    "راجع طلباتك قبل الدفع": "Review your items before payment",
    "السلة فارغة حاليًا.": "Your cart is currently empty.",
    "الإجمالي التقريبي": "Estimated total",
    "الدفع من المحفظة": "Pay from Wallet",
    "تفريغ السلة": "Clear Cart",
    "إتمام الطلب": "Complete Order",
    "الاسم الكامل": "Full Name",
    "البريد الإلكتروني": "Email",
    "الكمية": "Quantity",
    "تنفيذ طلب تجريبي آمن من دون إرسال خارجي": "Run a safe demo order without external submission",
    "الإجمالي": "Total",
    "إنشاء الطلب": "Create Order",
    "شراء الآن": "Buy Now",
    "إضافة للسلة": "Add to Cart",
    "حذف": "Remove",
    "هل تريد تفريغ السلة؟": "Clear all items from the cart?",
    "جارٍ التحقق من الرصيد...": "Checking wallet balance...",
    "تم إنشاء الطلب": "Order created",
    "هل تريد تسجيل الخروج من هذا الجهاز؟": "Sign out from this device?",
    "ستظهر الأقسام هنا بعد إضافتها.": "Categories will appear here after they are added.",
    "اختر القسم الفرعي": "Choose a subcategory",
    "اختر الخدمة التي تريدها للانتقال إلى المنتجات.": "Choose a service to view its products.",
    "تصفّح القسم": "Browse category",
    "لا توجد منتجات مطابقة.": "No matching products.",
    "لوحة المعلومات": "Dashboard",
    "لوحة الإدارة": "Admin Dashboard",
    "إدارة المتجر": "Store Management",
    "إعدادات المتجر": "Store Settings",
    "التصميم والهوية": "Design & Identity",
    "الهوية والتصميم": "Identity & Design",
    "الدومين": "Domain",
    "البوتات": "Bots",
    "السجلات": "Logs",
    "النسخ الاحتياطي": "Backups",
    "حالة النظام": "System Status",
    "الإعدادات": "Settings",
    "القوالب": "Templates",
    "مزودو API": "API Providers",
    "المزودون": "Providers",
    "الأرصدة": "Balances",
    "المزامنة": "Synchronization",
    "الأخطاء": "Errors",
    "المحاولات": "Attempts",
    "التواصل والدعم": "Contact & Support",
    "التواصل": "Contact",
    "مركز التواصل": "Contact Center",
    "طلبات الخدمات البرمجية": "Software Service Requests",
    "الخدمات المستوردة": "Imported Services",
    "الأسعار والأرباح": "Pricing & Profit",
    "حفظ": "Save",
    "حفظ التغييرات": "Save Changes",
    "إلغاء": "Cancel",
    "تعديل": "Edit",
    "إضافة": "Add",
    "إضافة جديد": "Add New",
    "تحديث": "Update",
    "نسخ": "Copy",
    "تم النسخ": "Copied",
    "عرض": "View",
    "التفاصيل": "Details",
    "الحالة": "Status",
    "نشط": "Active",
    "مفعّل": "Enabled",
    "غير مفعّل": "Disabled",
    "مخفي": "Hidden",
    "قريبًا": "Coming Soon",
    "قيد الانتظار": "Pending",
    "قيد المعالجة": "Processing",
    "مكتمل": "Completed",
    "فشل": "Failed",
    "ملغي": "Cancelled",
    "يحتاج مراجعة": "Requires Review",
    "نجاح": "Success",
    "تحذير": "Warning",
    "خطأ": "Error",
    "لا توجد بيانات": "No data",
    "لا توجد نتائج": "No results",
    "لا توجد طلبات": "No orders",
    "إعادة المحاولة": "Retry",
    "تسجيل الدخول": "Sign In",
    "إنشاء حساب": "Create Account",
    "كلمة المرور": "Password",
    "تأكيد كلمة المرور": "Confirm Password",
    "الاسم": "Name",
    "رقم الهاتف": "Phone Number",
    "التالي": "Next",
    "السابق": "Previous",
    "ابدأ الآن": "Start Now",
    "إنشاء متجر": "Create a Store",
    "متجر إلكتروني": "E-commerce Store",
    "موقع ويب": "Website",
    "بوت متجر": "Store Bot",
    "بوت إدارة": "Admin Bot",
    "تطبيق Android": "Android App",
    "تطبيق iPhone": "iPhone App",
    "خدمات برمجية": "Software Services",
    "تكامل API": "API Integration",
    "الاستضافة": "Hosting",
    "الدومينات": "Domains",
    "الأمن والصيانة": "Security & Maintenance",
    "إنشاء مشروعك": "Create Your Project",
    "اختر الخدمات التي تحتاجها": "Choose the services you need",
    "بيانات المشروع": "Project Details",
    "اسم المشروع": "Project Name",
    "نوع المشروع": "Project Type",
    "وصف المشروع": "Project Description",
    "الدولة": "Country",
    "العربية": "Arabic",
    "الإنجليزية": "English",
    "العربية (RTL)": "Arabic (RTL)",
    "الإنجليزية (LTR)": "English (LTR)",
    "تجربة مجانية": "Free Trial",
    "بدء التجربة": "Start Trial",
    "المعلومات الأساسية": "Basic Information",
    "معلومات الاتصال": "Contact Information",
    "إعدادات عامة": "General Settings",
    "شعار المتجر": "Store Logo",
    "لون أساسي": "Primary Color",
    "لون ثانوي": "Secondary Color",
    "الوضع الفاتح": "Light Mode",
    "الوضع الداكن": "Dark Mode",
    "معاينة": "Preview",
    "نشر": "Publish",
    "إخفاء": "Hide",
    "ترتيب": "Order",
    "السعر": "Price",
    "المدة": "Timeline",
    "الوصف": "Description",
    "العنوان": "Title",
    "الشبكة": "Network",
    "العملة والشبكة": "Currency and Network",
    "الحد الأدنى": "Minimum",
    "اسم المستفيد": "Beneficiary Name",
    "رقم الحساب أو عنوان المحفظة": "Account or Wallet Address",
    "تعليمات التحويل": "Transfer Instructions",
    "عرض QR": "Show QR",
    "رفع شعار": "Upload Logo",
    "رسالة افتراضية": "Default Message",
    "ساعات العمل": "Working Hours",
    "واتساب": "WhatsApp",
    "تيليجرام": "Telegram",
    "البريد الإلكتروني": "Email",
    "الهاتف": "Phone",
    "الخصوصية": "Privacy",
    "الشروط": "Terms",
    "الدعم والمساعدة": "Support & Help",
    "حسابي": "My Account",
    "إدارة": "Manage",
    "المتجر غير موجود": "Store not found",
    "المتجر غير متاح حاليًا": "The store is currently unavailable",
    "تعذّر تحميل المتجر": "The store could not be loaded",
    "تعذّر الاتصال": "Connection failed",
    "دخول مطلوب": "Sign-in required",
    "سجّل الدخول لإدارة متجرك": "Sign in to manage your store"
  }));

  const phrasePatterns = [
    [/^مرحبًا بك في (.+)$/u, "Welcome to $1"],
    [/^شعار (.+)$/u, "$1 logo"],
    [/^بانر (.+)$/u, "$1 banner"],
    [/^الكمية:\s*(.+)$/u, "Quantity: $1"],
    [/^(\d+) أقسام$/u, "$1 categories"],
    [/^فتح قسم (.+)، يتضمن (\d+) أقسام فرعية$/u, "Open $1, containing $2 subcategories"],
    [/^فتح منتجات (.+)$/u, "Open $1 products"],
    [/^العودة إلى (.+)$/u, "Back to $1"],
    [/^المعرف:\s*(.+)$/u, "ID: $1"],
    [/^محدثة (.+)$/u, "Updated $1"],
    [/^تم إنشاء الطلب (.+)$/u, "Order $1 was created"],
    [/^الحالة:\s*(.+)$/u, "Status: $1"]
  ];

  function readLocale() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "ar" || saved === "en") return saved;
    } catch {
      // Persistence is optional.
    }
    return document.documentElement.lang === "en" ? "en" : "ar";
  }

  let locale = readLocale();

  function t(key) {
    return keys[locale]?.[key] || keys.ar[key] || key;
  }

  function translatedPhrase(source) {
    const trimmed = source.trim();
    if (!trimmed) return source;
    let translated = phrases.get(trimmed);
    if (!translated) {
      for (const [pattern, replacement] of phrasePatterns) {
        if (pattern.test(trimmed)) {
          translated = trimmed.replace(pattern, replacement);
          break;
        }
      }
    }
    if (!translated) return source;
    const leading = source.match(/^\s*/u)?.[0] || "";
    const trailing = source.match(/\s*$/u)?.[0] || "";
    return `${leading}${translated}${trailing}`;
  }

  function eligibleTextNode(node) {
    const parent = node.parentElement;
    if (!parent) return false;
    if (["SCRIPT", "STYLE", "CODE", "PRE"].includes(parent.tagName)) return false;
    return !parent.closest("[data-no-auto-translate]");
  }

  function translateTextNode(node, forceSource = false) {
    if (!eligibleTextNode(node)) return;
    const current = node.nodeValue || "";
    let record = textState.get(node);
    if (!record || forceSource || (locale === "en" && current !== record.translated && current !== record.source)) {
      record = { source: current, translated: translatedPhrase(current) };
      textState.set(node, record);
    }
    const next = locale === "en" ? record.translated : record.source;
    if (current !== next) node.nodeValue = next;
  }

  function translateAttribute(element, attribute, forceSource = false) {
    if (!element.hasAttribute(attribute)) return;
    const current = element.getAttribute(attribute) || "";
    let records = attributeState.get(element);
    if (!records) {
      records = new Map();
      attributeState.set(element, records);
    }
    let record = records.get(attribute);
    if (!record || forceSource || (locale === "en" && current !== record.translated && current !== record.source)) {
      record = { source: current, translated: translatedPhrase(current) };
      records.set(attribute, record);
    }
    const next = locale === "en" ? record.translated : record.source;
    if (current !== next) element.setAttribute(attribute, next);
  }

  function translateElement(element, forceSource = false) {
    if (!(element instanceof Element)) return;
    if (element.dataset.i18n) element.textContent = t(element.dataset.i18n);
    if (element.dataset.i18nAria) element.setAttribute("aria-label", t(element.dataset.i18nAria));
    for (const attribute of ["placeholder", "aria-label", "title", "alt"]) {
      translateAttribute(element, attribute, forceSource);
    }
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) translateTextNode(child, forceSource);
      else if (child.nodeType === Node.ELEMENT_NODE) translateElement(child, forceSource);
    }
  }

  function syncControls() {
    document.querySelectorAll("[data-language-toggle]").forEach((button) => {
      const label = locale === "ar" ? "EN" : "عربي";
      const valueNode = button.querySelector("b");
      if (valueNode) valueNode.textContent = label;
      else button.textContent = label;
      button.setAttribute("aria-label", t("language.switch"));
      button.setAttribute("title", t("language.switch"));
    });
  }

  function ensureControl() {
    if (document.querySelector("[data-language-toggle]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "global-language-toggle";
    button.dataset.languageToggle = "true";
    document.body.append(button);
  }

  function applyLocale({ forceSource = false } = {}) {
    applying = true;
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    translateElement(document.body, forceSource);
    if (document.title) {
      const translatedTitle = translatedPhrase(document.title);
      if (!document.documentElement.dataset.originalTitle) document.documentElement.dataset.originalTitle = document.title;
      document.title = locale === "en" ? translatedTitle : document.documentElement.dataset.originalTitle;
    }
    ensureControl();
    syncControls();
    applying = false;
  }

  function setLocale(next) {
    if (next !== "ar" && next !== "en") return;
    locale = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The page still updates without local storage.
    }
    applyLocale();
    window.dispatchEvent(new CustomEvent("uchiha:language-change", { detail: { locale } }));
  }

  document.addEventListener("click", (event) => {
    const toggle = event.target.closest?.("[data-language-toggle]");
    if (toggle) setLocale(locale === "ar" ? "en" : "ar");
  });

  const observer = new MutationObserver((mutations) => {
    if (applying) return;
    applying = true;
    for (const mutation of mutations) {
      if (mutation.type === "characterData") translateTextNode(mutation.target);
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
        else if (node.nodeType === Node.ELEMENT_NODE) translateElement(node);
      }
    }
    syncControls();
    applying = false;
  });

  function initialize() {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/assets/i18n.css?v=20260801";
    document.head.append(stylesheet);
    applyLocale({ forceSource: true });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  }

  window.UchihaI18n = {
    get locale() { return locale; },
    t,
    setLocale
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
