(function () {
  "use strict";

  var API_ROOT = "/api/storefront/demo";
  var state = {
    route: "home",
    catalog: null,
    selectedProduct: null,
    cart: [],
    openPanel: null,
    searchTimer: null,
    toastTimer: null,
    orderFilter: "all",
    balanceHidden: false
  };

  var elements = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function safeText(value, fallback) {
    var text = value === null || value === undefined ? "" : String(value).trim();
    return text || fallback || "";
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showToast(message) {
    if (!elements.toast) return;
    window.clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    state.toastTimer = window.setTimeout(function () {
      elements.toast.hidden = true;
    }, 3000);
  }

  function panelElement(name) {
    if (name === "menu") return elements.menuPanel;
    if (name === "cart") return elements.cartPanel;
    if (name === "product") return elements.productPanel;
    return null;
  }

  function closePanel() {
    var panel = panelElement(state.openPanel);
    if (panel) panel.hidden = true;
    state.openPanel = null;
    if (elements.backdrop) elements.backdrop.hidden = true;
    document.body.classList.remove("panel-open");
  }

  function openPanel(name) {
    closePanel();
    var panel = panelElement(name);
    if (!panel) return;
    panel.hidden = false;
    if (elements.backdrop) elements.backdrop.hidden = false;
    document.body.classList.add("panel-open");
    state.openPanel = name;
    var closeButton = panel.querySelector("[data-close]");
    if (closeButton) closeButton.focus();
  }

  function setRoute(route, options) {
    options = options || {};
    if (["home", "wallet", "orders", "order-details"].indexOf(route) === -1) {
      showToast("هذه الصفحة ستُضاف في الدفعة القادمة.");
      return;
    }
    closePanel();
    var views = document.querySelectorAll("[data-view]");
    Array.prototype.forEach.call(views, function (view) {
      var active = view.getAttribute("data-view") === route;
      view.hidden = !active;
      view.classList.toggle("is-active", active);
    });
    var navButtons = document.querySelectorAll(".bottom-nav [data-route]");
    Array.prototype.forEach.call(navButtons, function (button) {
      var navRoute = button.getAttribute("data-route");
      button.classList.toggle("is-active", navRoute === route || (route === "order-details" && navRoute === "orders"));
    });
    state.route = route;
    if (options.history !== false && window.history && window.history.pushState) {
      window.history.pushState({ route: route }, "", "#" + route);
    }
    window.scrollTo({ top: 0, behavior: options.instant ? "auto" : "smooth" });
  }

  function requestJson(url) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = window.setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error("timeout"));
      }, 10000);
      fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" }
      })
        .then(function (response) {
          if (!response.ok) throw new Error("request_failed");
          return response.json();
        })
        .then(function (data) {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(data);
        })
        .catch(function (error) {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          reject(error);
        });
    });
  }

  function categoryIcon(category) {
    var value = (safeText(category.slug) + " " + safeText(category.name)).toLowerCase();
    if (/game|gaming|ألعاب|العاب/.test(value)) return "/assets/catalog-assets/game-topup.svg";
    if (/subscription|watch|stream|اشتراك|مشاهد/.test(value)) return "/assets/catalog-assets/subscription.svg";
    if (/mobile|credit|رصيد|اتصال/.test(value)) return "/assets/catalog-assets/mobile-credit.svg";
    if (/software|program|برامج/.test(value)) return "/assets/catalog-assets/software.svg";
    if (/social|تواصل|رشق/.test(value)) return "/assets/catalog-assets/social-service.svg";
    return "/assets/catalog-assets/digital-card.svg";
  }

  function categoryDescription(category) {
    var name = safeText(category.name);
    if (/ألعاب|العاب|game/i.test(name)) return "شحن الألعاب والخدمات";
    if (/اشتراك|مشاهد|subscription/i.test(name)) return "أفضل المنصات والأسعار";
    if (/اتصال|رصيد|mobile/i.test(name)) return "شحن وباقات اتصال";
    if (/برمج|program/i.test(name)) return "مواقع، تطبيقات وبوتات";
    return "منتجات وخدمات رقمية";
  }

  function renderCategories(categories) {
    if (!elements.categoryGrid || !Array.isArray(categories) || !categories.length) return;
    var roots = categories.filter(function (category) { return !category.parentId; });
    var list = (roots.length ? roots : categories).slice(0, 12);
    elements.categoryGrid.innerHTML = list.map(function (category) {
      var image = safeText(category.imageUrl, categoryIcon(category));
      return '<button class="category-card" type="button" data-category-id="' + escapeHtml(category.id) + '" data-category-name="' + escapeHtml(category.name) + '">' +
        '<span class="category-visual"><img src="' + escapeHtml(image) + '" alt="" loading="lazy"></span>' +
        '<b>' + escapeHtml(category.name) + '</b><small>' + escapeHtml(categoryDescription(category)) + '</small></button>';
    }).join("");
  }

  function formatMoney(minor, currency) {
    var amount = Number(minor || 0) / 100;
    var code = safeText(currency, "USD").toUpperCase();
    try {
      return new Intl.NumberFormat("ar", { style: "currency", currency: code, maximumFractionDigits: 2 }).format(amount);
    } catch (_error) {
      return amount.toFixed(2) + " " + code;
    }
  }

  function fallbackProducts(heading) {
    return [
      { id: "preview-1", name: safeText(heading, "منتج رقمي") + " — باقة أساسية", description: "منتج تجريبي لعرض شكل بطاقة المنتج قبل ربط الكتالوج الكامل.", imageUrl: "/assets/catalog-assets/digital-card.svg", priceMinor: 500, currency: "USD" },
      { id: "preview-2", name: "اشتراك رقمي تجريبي", description: "سيتم استبدال هذه البطاقة بمنتجات المتجر الحقيقية.", imageUrl: "/assets/catalog-assets/subscription.svg", priceMinor: 1000, currency: "USD" },
      { id: "preview-3", name: "خدمة رقمية مميزة", description: "بطاقة معاينة لتجربة التفاصيل والسلة والتنقل.", imageUrl: "/assets/catalog-assets/software.svg", priceMinor: 1500, currency: "USD" }
    ];
  }

  function renderProducts(products, heading) {
    if (!elements.productGrid || !elements.productsSection) return;
    var list = Array.isArray(products) && products.length ? products : fallbackProducts(heading);
    elements.productsTrail.textContent = safeText(heading, "داخل القسم");
    elements.productsTitle.textContent = safeText(heading, "المنتجات");
    elements.productGrid.innerHTML = list.map(function (product) {
      var image = safeText(product.imageUrl, "/assets/catalog-assets/digital-card.svg");
      return '<article class="product-card"><div class="product-image"><img src="' + escapeHtml(image) + '" alt="" loading="lazy"></div>' +
        '<div class="product-body"><h3>' + escapeHtml(product.name) + '</h3><p>' + escapeHtml(safeText(product.description, "منتج رقمي جاهز للطلب.")) + '</p>' +
        '<div class="product-footer"><strong>' + escapeHtml(formatMoney(product.priceMinor, product.currency)) + '</strong><button type="button" data-product-id="' + escapeHtml(product.id) + '">التفاصيل</button></div></div></article>';
    }).join("");
    elements.productGrid._products = list;
    elements.productsSection.hidden = false;
    elements.productsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function loadCatalog() {
    return requestJson(API_ROOT + "?catalogOnly=1&limit=1&offset=0")
      .then(function (data) {
        state.catalog = data;
        if (data.store && elements.storeDescription) {
          elements.storeDescription.textContent = safeText(data.store.description, elements.storeDescription.textContent);
          document.title = safeText(data.store.name, "UCHIHA STORE") + " — متجر تجريبي";
        }
        renderCategories(data.categories || []);
      })
      .catch(function () {
        showToast("تم تشغيل بيانات المعاينة المحلية لأن الكتالوج لم يرد.");
      });
  }

  function loadProducts(options) {
    options = options || {};
    var query = ["limit=36", "offset=0"];
    if (options.categoryId) query.push("categoryId=" + encodeURIComponent(options.categoryId));
    if (options.search) query.push("query=" + encodeURIComponent(options.search));
    return requestJson(API_ROOT + "?" + query.join("&"))
      .then(function (data) {
        renderProducts(data.products || [], options.heading || "المنتجات");
      })
      .catch(function () {
        renderProducts([], options.heading || "المنتجات الرقمية");
      });
  }

  function productById(id) {
    var products = elements.productGrid && elements.productGrid._products ? elements.productGrid._products : [];
    for (var index = 0; index < products.length; index += 1) {
      if (String(products[index].id) === String(id)) return products[index];
    }
    return null;
  }

  function openProduct(product) {
    if (!product) return;
    state.selectedProduct = product;
    elements.modalProductName.textContent = safeText(product.name, "المنتج");
    elements.modalProductDescription.textContent = safeText(product.description, "منتج رقمي جاهز للطلب.");
    elements.modalProductImage.src = safeText(product.imageUrl, "/assets/catalog-assets/digital-card.svg");
    elements.modalProductPrice.textContent = formatMoney(product.priceMinor, product.currency);
    openPanel("product");
  }

  function renderCart() {
    var count = state.cart.length;
    if (elements.cartBadge) elements.cartBadge.textContent = String(count || 2);
    if (elements.heroCartBadge) elements.heroCartBadge.textContent = String(count || 2);
    if (elements.cartEmpty) elements.cartEmpty.hidden = count > 0;
    if (elements.cartItems) {
      elements.cartItems.innerHTML = state.cart.map(function (item, index) {
        return '<article class="cart-item"><img src="' + escapeHtml(safeText(item.imageUrl, "/assets/catalog-assets/digital-card.svg")) + '" alt=""><div><b>' + escapeHtml(item.name) + '</b><small>' + escapeHtml(formatMoney(item.priceMinor, item.currency)) + '</small></div><button type="button" data-remove-cart="' + index + '">حذف</button></article>';
      }).join("");
    }
    var total = state.cart.reduce(function (sum, item) { return sum + Number(item.priceMinor || 0); }, 0);
    if (elements.cartTotal) elements.cartTotal.textContent = formatMoney(total, state.cart.length ? state.cart[0].currency : "USD");
  }

  function addSelectedToCart() {
    var product = state.selectedProduct;
    if (!product) return;
    var exists = state.cart.some(function (item) { return String(item.id) === String(product.id); });
    if (!exists) state.cart.push(product);
    renderCart();
    closePanel();
    showToast(exists ? "المنتج موجود في السلة مسبقًا." : "تمت إضافة المنتج إلى السلة.");
  }

  function filterOrders() {
    var query = safeText(elements.orderSearch ? elements.orderSearch.value : "").toLowerCase();
    var visible = 0;
    var cards = document.querySelectorAll(".order-card");
    Array.prototype.forEach.call(cards, function (card) {
      var statusMatches = state.orderFilter === "all" || card.getAttribute("data-status") === state.orderFilter;
      var searchMatches = !query || safeText(card.getAttribute("data-search")).toLowerCase().indexOf(query) !== -1;
      var show = statusMatches && searchMatches;
      card.hidden = !show;
      if (show) visible += 1;
    });
    if (elements.ordersEmpty) elements.ordersEmpty.hidden = visible > 0;
  }

  function action(name) {
    var messages = {
      notifications: "لا توجد إشعارات جديدة في نسخة المعاينة.",
      account: "صفحة الحساب ستُنفّذ ضمن الدفعة التالية بنفس التصميم المعتمد.",
      support: "سيتم ربط هذا الزر بمركز الدعم الخاص بصاحب المتجر.",
      currency: "اختيار العملة سيصبح ديناميكيًا بعد ربط إعدادات المتجر.",
      favorites: "المفضلة قيد التجهيز.",
      logout: "تسجيل الخروج معطّل في نسخة المعاينة.",
      "add-balance": "صفحة إضافة الرصيد قيد التنفيذ.",
      withdraw: "السحب سيُفعّل حسب إعدادات صاحب المتجر.",
      transfer: "التحويل الداخلي قيد التجهيز.",
      payments: "صفحة الدفعات ستكون ضمن الدفعة القادمة.",
      "all-transactions": "سيتم فتح سجل العمليات الكامل لاحقًا.",
      "order-filters": "خيارات التاريخ وطريقة الدفع ستُضاف في المرحلة القادمة.",
      telegram: "ربط تيليجرام ضمن المرحلة التالية.",
      security: "صفحة الحماية والمصادقة الثنائية ضمن المرحلة التالية.",
      identity: "توثيق الهوية ضمن المرحلة التالية.",
      api: "واجهة المطور ضمن المرحلة التالية.",
      about: "صفحة من نحن قيد التجهيز.",
      checkout: "الدفع الحقيقي معطّل في المتجر التجريبي."
    };

    if (name === "menu") return openPanel("menu");
    if (name === "cart") { renderCart(); return openPanel("cart"); }
    if (name === "categories" || name === "all-categories") {
      closePanel();
      var categories = byId("categories");
      if (categories) categories.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (name === "back-categories") {
      if (elements.productsSection) elements.productsSection.hidden = true;
      var section = byId("categories");
      if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (name === "add-cart") return addSelectedToCart();
    if (name === "buy-demo") {
      addSelectedToCart();
      window.setTimeout(function () { openPanel("cart"); }, 150);
      return;
    }
    if (name === "toggle-balance") {
      state.balanceHidden = !state.balanceHidden;
      var value = document.querySelector(".wallet-balance-copy strong");
      if (value) value.textContent = state.balanceHidden ? "••••••" : "$ 20.793";
      return;
    }
    showToast(messages[name] || "هذه الميزة قيد التطوير.");
  }

  function bindEvents() {
    document.addEventListener("click", function (event) {
      var closeButton = event.target.closest("[data-close]");
      if (closeButton) {
        closePanel();
        return;
      }

      var routeButton = event.target.closest("[data-route]");
      if (routeButton) {
        event.preventDefault();
        var route = routeButton.getAttribute("data-route");
        if (route === "account") action("account");
        else setRoute(route);
        return;
      }

      var actionButton = event.target.closest("[data-action]");
      if (actionButton) {
        event.preventDefault();
        action(actionButton.getAttribute("data-action"));
        return;
      }

      var category = event.target.closest("[data-category-id]");
      if (category) {
        loadProducts({ categoryId: category.getAttribute("data-category-id"), heading: category.getAttribute("data-category-name") });
        return;
      }

      var fallbackCategory = event.target.closest("[data-fallback-category]");
      if (fallbackCategory) {
        var heading = safeText(fallbackCategory.querySelector("b") && fallbackCategory.querySelector("b").textContent, "المنتجات الرقمية");
        loadProducts({ heading: heading });
        return;
      }

      var productButton = event.target.closest("[data-product-id]");
      if (productButton) {
        openProduct(productById(productButton.getAttribute("data-product-id")));
        return;
      }

      var removeButton = event.target.closest("[data-remove-cart]");
      if (removeButton) {
        state.cart.splice(Number(removeButton.getAttribute("data-remove-cart")), 1);
        renderCart();
        return;
      }

      var filterButton = event.target.closest("[data-order-filter]");
      if (filterButton) {
        state.orderFilter = filterButton.getAttribute("data-order-filter");
        var filters = document.querySelectorAll("[data-order-filter]");
        Array.prototype.forEach.call(filters, function (button) { button.classList.toggle("is-active", button === filterButton); });
        filterOrders();
        return;
      }

      var orderCard = event.target.closest("[data-order-id]");
      if (orderCard) {
        var detailNumber = document.querySelector("#viewOrderDetails .page-heading h1");
        var detailOrder = document.querySelector("#viewOrderDetails .detail-status-row b");
        if (detailNumber) detailNumber.textContent = "#" + orderCard.getAttribute("data-order-id");
        if (detailOrder) detailOrder.textContent = "#" + orderCard.getAttribute("data-order-id");
        setRoute("order-details");
      }
    });

    if (elements.backdrop) elements.backdrop.addEventListener("click", closePanel);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closePanel();
    });

    if (elements.searchInput) {
      elements.searchInput.addEventListener("input", function () {
        var query = elements.searchInput.value.trim();
        elements.clearSearch.hidden = !query;
        window.clearTimeout(state.searchTimer);
        if (!query) return;
        state.searchTimer = window.setTimeout(function () {
          loadProducts({ search: query, heading: "نتائج البحث عن: " + query });
        }, 400);
      });
    }

    if (elements.clearSearch) {
      elements.clearSearch.addEventListener("click", function () {
        elements.searchInput.value = "";
        elements.clearSearch.hidden = true;
        if (elements.productsSection) elements.productsSection.hidden = true;
        elements.searchInput.focus();
      });
    }

    if (elements.orderSearch) elements.orderSearch.addEventListener("input", filterOrders);

    window.addEventListener("popstate", function (event) {
      setRoute(event.state && event.state.route ? event.state.route : "home", { history: false, instant: true });
    });
  }

  function collectElements() {
    elements.storeDescription = byId("storeDescription");
    elements.searchInput = byId("searchInput");
    elements.clearSearch = byId("clearSearch");
    elements.categoryGrid = byId("categoryGrid");
    elements.productsSection = byId("productsSection");
    elements.productsTrail = byId("productsTrail");
    elements.productsTitle = byId("productsTitle");
    elements.productGrid = byId("productGrid");
    elements.backdrop = byId("backdrop");
    elements.menuPanel = byId("menuPanel");
    elements.cartPanel = byId("cartPanel");
    elements.productPanel = byId("productPanel");
    elements.modalProductName = byId("modalProductName");
    elements.modalProductDescription = byId("modalProductDescription");
    elements.modalProductImage = byId("modalProductImage");
    elements.modalProductPrice = byId("modalProductPrice");
    elements.cartItems = byId("cartItems");
    elements.cartEmpty = byId("cartEmpty");
    elements.cartTotal = byId("cartTotal");
    elements.cartBadge = byId("cartBadge");
    elements.heroCartBadge = byId("heroCartBadge");
    elements.orderSearch = byId("orderSearch");
    elements.ordersEmpty = byId("ordersEmpty");
    elements.toast = byId("toast");
  }

  function initialRoute() {
    var hash = safeText(window.location.hash).replace(/^#/, "");
    return ["home", "wallet", "orders", "order-details"].indexOf(hash) !== -1 ? hash : "home";
  }

  function init() {
    collectElements();
    bindEvents();
    renderCart();
    loadCatalog();
    setRoute(initialRoute(), { history: false, instant: true });
    document.documentElement.setAttribute("data-demo-ready", "true");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
