(function () {
  "use strict";

  var API_ROOT = "/api/storefront/demo";
  var state = {
    catalog: null,
    selectedProduct: null,
    cart: [],
    openPanel: null,
    toastTimer: null,
    searchTimer: null
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
    window.clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    state.toastTimer = window.setTimeout(function () {
      elements.toast.hidden = true;
    }, 3200);
  }

  function panelElement(name) {
    if (name === "menu") return elements.menuPanel;
    if (name === "cart") return elements.cartPanel;
    if (name === "stages") return elements.stagesPanel;
    if (name === "product") return elements.productPanel;
    return null;
  }

  function closePanel() {
    if (state.openPanel) {
      var active = panelElement(state.openPanel);
      if (active) active.hidden = true;
    }
    state.openPanel = null;
    elements.backdrop.hidden = true;
    document.body.classList.remove("panel-open");
  }

  function openPanel(name) {
    closePanel();
    var panel = panelElement(name);
    if (!panel) return;
    panel.hidden = false;
    elements.backdrop.hidden = false;
    document.body.classList.add("panel-open");
    state.openPanel = name;
    var closeButton = panel.querySelector("[data-close]");
    if (closeButton) closeButton.focus();
  }

  function scrollToSection(id) {
    closePanel();
    var target = byId(id);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function iconForCategory(category) {
    var value = (safeText(category.slug) + " " + safeText(category.name)).toLowerCase();
    if (/game|gaming|ألعاب|العاب|شحن/.test(value)) return "🎮";
    if (/card|بطاق/.test(value)) return "💳";
    if (/subscription|watch|stream|مشاهد|اشتراك/.test(value)) return "▶";
    if (/mobile|credit|اتصال|رصيد/.test(value)) return "📱";
    if (/ai|ذكاء/.test(value)) return "✦";
    if (/software|program|برامج/.test(value)) return "⌘";
    if (/account|حساب/.test(value)) return "♙";
    if (/crypto|عملة|عملات/.test(value)) return "◈";
    if (/design|تصميم/.test(value)) return "✎";
    return "◇";
  }

  function categoryDescription(category) {
    var name = safeText(category.name);
    if (/ألعاب|العاب|game/i.test(name)) return "شحن وبطاقات وأكواد";
    if (/بطاق|card/i.test(name)) return "بطاقات عالمية ومتنوعة";
    if (/اشتراك|مشاهد|subscription/i.test(name)) return "منصات وخدمات رقمية";
    if (/اتصال|رصيد|mobile/i.test(name)) return "شحن وباقات اتصال";
    if (/ذكاء|\bai\b/i.test(name)) return "أدوات وخطط احترافية";
    return "منتجات وخدمات رقمية";
  }

  function renderCategories(categories) {
    if (!Array.isArray(categories) || !categories.length) return;
    var roots = categories.filter(function (category) { return !category.parentId; });
    var list = roots.length ? roots : categories;
    elements.categoryGrid.innerHTML = list.map(function (category) {
      var image = category.imageUrl
        ? '<img src="' + escapeHtml(category.imageUrl) + '" alt="" loading="lazy">'
        : '<span class="category-icon">' + iconForCategory(category) + "</span>";
      return '<button class="category-card" type="button" data-category-id="' + escapeHtml(category.id) + '" data-category-name="' + escapeHtml(category.name) + '">' +
        image + "<b>" + escapeHtml(category.name) + "</b><small>" + escapeHtml(categoryDescription(category)) + "</small></button>";
    }).join("");
  }

  function formatMoney(minor, currency) {
    var code = safeText(currency, "USD").toUpperCase();
    var amount = Number(minor || 0) / 100;
    try {
      return new Intl.NumberFormat("ar", { style: "currency", currency: code, maximumFractionDigits: 2 }).format(amount);
    } catch (_error) {
      return amount.toFixed(2) + " " + code;
    }
  }

  function fallbackProducts(categoryName) {
    var title = safeText(categoryName, "المنتجات الرقمية");
    return [
      {
        id: "preview-1",
        name: "منتج تجريبي — " + title,
        description: "بطاقة عرض لتجربة شكل المنتج وخطوات إضافته إلى السلة.",
        imageUrl: "/assets/catalog-assets/digital-card.svg",
        priceMinor: 500,
        currency: "USD"
      },
      {
        id: "preview-2",
        name: "خدمة رقمية تجريبية",
        description: "سيتم استبدال هذه البطاقة بمنتجات حقيقية في مرحلة تجهيز الكتالوج.",
        imageUrl: "/assets/catalog-assets/subscription.svg",
        priceMinor: 1000,
        currency: "USD"
      }
    ];
  }

  function renderProducts(products, heading) {
    var list = Array.isArray(products) && products.length ? products : fallbackProducts(heading);
    elements.productsTrail.textContent = safeText(heading, "المنتجات الرقمية");
    elements.productsTitle.textContent = safeText(heading, "المنتجات والخدمات");
    elements.productsEmpty.hidden = list.length > 0;
    elements.productGrid.innerHTML = list.map(function (product) {
      var image = safeText(product.imageUrl, "/assets/catalog-assets/digital-card.svg");
      return '<article class="product-card"><div class="product-image"><img src="' + escapeHtml(image) + '" alt="" loading="lazy"></div>' +
        '<div class="product-body"><h3>' + escapeHtml(product.name) + '</h3><p>' + escapeHtml(safeText(product.description, "منتج رقمي جاهز للطلب.")) + '</p>' +
        '<div class="product-footer"><strong>' + escapeHtml(formatMoney(product.priceMinor, product.currency)) + '</strong>' +
        '<button type="button" data-product-id="' + escapeHtml(product.id) + '">التفاصيل</button></div></div></article>';
    }).join("");
    elements.productGrid._products = list;
    elements.productsSection.hidden = false;
    elements.productsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function requestJson(url) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = window.setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error("انتهت مهلة الاتصال"));
      }, 12000);
      fetch(url, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } })
        .then(function (response) {
          if (!response.ok) throw new Error("تعذر تحميل البيانات");
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

  function loadCatalog() {
    return requestJson(API_ROOT + "?catalogOnly=1&limit=1&offset=0")
      .then(function (data) {
        state.catalog = data;
        if (data.store) {
          elements.storeName.textContent = safeText(data.store.name, "Nova Digital");
          elements.storeDescription.textContent = safeText(data.store.description, elements.storeDescription.textContent);
          document.title = safeText(data.store.name, "Nova Digital") + " — متجر تجريبي";
        }
        renderCategories(data.categories || []);
      })
      .catch(function () {
        showToast("تعذر تحديث بيانات المتجر، تم تشغيل نسخة المعاينة المحلية.");
      });
  }

  function loadProducts(options) {
    options = options || {};
    var query = ["limit=36", "offset=0"];
    if (options.categoryId) query.push("categoryId=" + encodeURIComponent(options.categoryId));
    if (options.search) query.push("query=" + encodeURIComponent(options.search));
    elements.productGrid.innerHTML = '<div class="empty-state"><span>◌</span><b>جارٍ تحميل المنتجات...</b></div>';
    elements.productsSection.hidden = false;
    return requestJson(API_ROOT + "?" + query.join("&"))
      .then(function (data) {
        renderProducts(data.products || [], options.heading || (options.search ? "نتائج البحث" : "المنتجات"));
      })
      .catch(function () {
        renderProducts([], options.heading || "المنتجات الرقمية");
        showToast("تم عرض منتجات تجريبية لأن الكتالوج لم يكتمل بعد.");
      });
  }

  function productById(id) {
    var products = elements.productGrid._products || [];
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
    elements.cartBadge.hidden = count < 1;
    elements.cartBadge.textContent = String(count);
    elements.cartEmpty.hidden = count > 0;
    elements.cartItems.innerHTML = state.cart.map(function (item, index) {
      return '<article class="cart-item"><img src="' + escapeHtml(safeText(item.imageUrl, "/assets/catalog-assets/digital-card.svg")) + '" alt=""><div><b>' + escapeHtml(item.name) + '</b><small>' + escapeHtml(formatMoney(item.priceMinor, item.currency)) + '</small></div><button type="button" data-remove-cart="' + index + '">حذف</button></article>';
    }).join("");
    var total = state.cart.reduce(function (sum, item) { return sum + Number(item.priceMinor || 0); }, 0);
    var currency = state.cart.length ? state.cart[0].currency : "USD";
    elements.cartTotal.textContent = formatMoney(total, currency);
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

  function action(name) {
    if (name === "menu") return openPanel("menu");
    if (name === "stages") return openPanel("stages");
    if (name === "cart") { renderCart(); return openPanel("cart"); }
    if (name === "home") { closePanel(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (name === "categories" || name === "all-categories") return scrollToSection("categories");
    if (name === "back-categories") { elements.productsSection.hidden = true; return scrollToSection("categories"); }
    if (name === "add-cart") return addSelectedToCart();
    if (name === "buy-demo") { addSelectedToCart(); return window.setTimeout(function () { action("cart"); }, 180); }
    if (name === "checkout") return showToast("الدفع معطّل في نسخة المعاينة لحماية الزوار.");
    if (name === "support") return showToast("مركز الدعم سيُربط بوسائل صاحب المتجر في المرحلة القادمة.");
    if (name === "wallet") return showToast("المحفظة والحركات المالية قيد التجهيز.");
    if (name === "orders") return showToast("صفحة متابعة الطلبات قيد التجهيز.");
    if (name === "account") return showToast("تسجيل الدخول وربط الحساب قيد التجهيز.");
    if (name === "notifications") return showToast("لا توجد إشعارات في نسخة المعاينة.");
  }

  function bindEvents() {
    document.addEventListener("click", function (event) {
      var close = event.target.closest("[data-close]");
      if (close) { closePanel(); return; }

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

      var fallback = event.target.closest("[data-fallback-category]");
      if (fallback) {
        loadProducts({ heading: fallback.querySelector("b").textContent });
        return;
      }

      var productButton = event.target.closest("[data-product-id]");
      if (productButton) {
        openProduct(productById(productButton.getAttribute("data-product-id")));
        return;
      }

      var remove = event.target.closest("[data-remove-cart]");
      if (remove) {
        state.cart.splice(Number(remove.getAttribute("data-remove-cart")), 1);
        renderCart();
      }
    });

    elements.backdrop.addEventListener("click", closePanel);
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") closePanel(); });

    elements.searchInput.addEventListener("input", function () {
      var query = elements.searchInput.value.trim();
      elements.clearSearch.hidden = !query;
      window.clearTimeout(state.searchTimer);
      if (!query) return;
      state.searchTimer = window.setTimeout(function () {
        loadProducts({ search: query, heading: "نتائج البحث عن: " + query });
      }, 450);
    });

    elements.clearSearch.addEventListener("click", function () {
      elements.searchInput.value = "";
      elements.clearSearch.hidden = true;
      elements.productsSection.hidden = true;
      elements.searchInput.focus();
    });
  }

  function collectElements() {
    elements.storeName = byId("storeName");
    elements.storeDescription = byId("storeDescription");
    elements.searchInput = byId("searchInput");
    elements.clearSearch = byId("clearSearch");
    elements.categoryGrid = byId("categoryGrid");
    elements.productsSection = byId("products");
    elements.productsTrail = byId("productsTrail");
    elements.productsTitle = byId("productsTitle");
    elements.productGrid = byId("productGrid");
    elements.productsEmpty = byId("productsEmpty");
    elements.backdrop = byId("backdrop");
    elements.menuPanel = byId("menuPanel");
    elements.cartPanel = byId("cartPanel");
    elements.stagesPanel = byId("stagesPanel");
    elements.productPanel = byId("productPanel");
    elements.modalProductName = byId("modalProductName");
    elements.modalProductDescription = byId("modalProductDescription");
    elements.modalProductImage = byId("modalProductImage");
    elements.modalProductPrice = byId("modalProductPrice");
    elements.cartItems = byId("cartItems");
    elements.cartEmpty = byId("cartEmpty");
    elements.cartTotal = byId("cartTotal");
    elements.cartBadge = byId("cartBadge");
    elements.toast = byId("toast");
  }

  function init() {
    collectElements();
    bindEvents();
    renderCart();
    loadCatalog();
    document.documentElement.setAttribute("data-demo-ready", "true");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
