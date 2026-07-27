(() => {
  "use strict";

  const page = document.body.dataset.page;
  let csrfToken = sessionStorage.getItem("uchihaBuilderCsrf") || "";

  function element(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = options.text;
    if (options.type) node.type = options.type;
    if (options.href) node.href = options.href;
    if (options.dataset) Object.assign(node.dataset, options.dataset);
    if (options.attributes) {
      for (const [name, value] of Object.entries(options.attributes)) {
        if (value !== null && value !== undefined) node.setAttribute(name, String(value));
      }
    }
    for (const child of children) {
      if (child) node.append(child);
    }
    return node;
  }

  async function api(path, options = {}) {
    const method = options.method || "GET";
    const headers = { accept: "application/json", ...(options.headers || {}) };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) {
      headers["x-csrf-token"] = csrfToken;
    }
    const response = await fetch(path, {
      ...options,
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin"
    });
    const data = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.message || "تعذر إكمال العملية");
      error.status = response.status;
      error.code = data?.error;
      throw error;
    }
    if (data?.csrfToken) {
      csrfToken = data.csrfToken;
      sessionStorage.setItem("uchihaBuilderCsrf", csrfToken);
    }
    return data;
  }

  function showNotice(target, message, type = "") {
    if (!target) return;
    target.textContent = message;
    target.className = `notice ${type}`.trim();
    target.hidden = false;
  }

  function hideNotice(target) {
    if (target) target.hidden = true;
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function money(minor, currency) {
    return new Intl.NumberFormat("ar", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2
    }).format(Number(minor || 0) / 100);
  }

  function statusLabel(status) {
    const labels = {
      draft: "مسودة",
      payment_pending: "بانتظار الدفع",
      provisioning_store: "قيد إنشاء المتجر",
      provisioning_branding: "قيد تجهيز الهوية",
      connecting_bots: "قيد ربط البوتات",
      ready_to_publish: "جاهز للنشر",
      active: "نشط",
      review_required: "يحتاج مراجعة",
      suspended: "موقوف",
      subscription_expired: "منتهي الاشتراك"
    };
    return labels[status] || status;
  }

  async function currentUser() {
    return api("/api/me");
  }

  function activateProgress(key) {
    const order = ["account", "subscription", "identity", "publish"];
    const current = order.indexOf(key);
    document.querySelectorAll("[data-progress]").forEach((item) => {
      const index = order.indexOf(item.dataset.progress);
      item.classList.toggle("active", index === current);
      item.classList.toggle("done", index < current);
    });
  }

  async function initBuilder() {
    const notice = document.querySelector("#notice");
    const authStep = document.querySelector("#authStep");
    const subscriptionStep = document.querySelector("#subscriptionStep");
    const storeStep = document.querySelector("#storeStep");
    const resultStep = document.querySelector("#resultStep");
    let offer = null;
    let currentStore = null;

    function showStep(target, progress) {
      [authStep, subscriptionStep, storeStep, resultStep].forEach((section) => {
        section.hidden = section !== target;
      });
      activateProgress(progress);
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function showResult(store) {
      currentStore = store;
      showStep(resultStep, "publish");
      document.querySelector("#dashboardLink").href = store.links.dashboard;
      document.querySelector("#storefrontLink").href =
        store.status === "active" ? store.links.storefront : `${store.links.storefront}?preview=1`;
      document.querySelector("#subdomainLink").textContent = store.links.subdomain;
      document.querySelector("#provisioningStatus").textContent =
        store.status === "active"
          ? "متجرك نشط وجاهز للبيع من الموقع والبوتين."
          : `الحالة الحالية: ${statusLabel(store.status)}. يمكنك متابعة الربط من لوحة الإدارة.`;
    }

    async function refreshStoreUntilReady(storeId, attempts = 30) {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const data = await api(`/api/stores/${storeId}`);
        showResult(data.store);
        if (["ready_to_publish", "active", "review_required"].includes(data.store.status)) return;
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }

    try {
      const [configData, offerData] = await Promise.all([
        api("/api/public/config"),
        api("/api/subscription-offer")
      ]);
      offer = offerData.offer;
      if (offer) {
        document.querySelector("#offerName").textContent = offer.name;
        document.querySelector("#offerPrice").textContent = money(offer.priceMinor, offer.currency);
      }
      document.querySelector("#activateDemoButton").hidden = !configData.demoMode;
    } catch (error) {
      showNotice(notice, error.message, "error");
    }

    document.querySelectorAll("[data-auth-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-auth-tab]").forEach((tab) => tab.classList.remove("active"));
        button.classList.add("active");
        document.querySelector("#registerForm").hidden = button.dataset.authTab !== "register";
        document.querySelector("#loginForm").hidden = button.dataset.authTab !== "login";
      });
    });

    async function afterAuthentication() {
      const me = await currentUser();
      if (me.stores.length) {
        showResult(me.stores[0]);
        return;
      }
      showStep(subscriptionStep, "subscription");
    }

    document.querySelector("#registerForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      hideNotice(notice);
      const body = formData(event.currentTarget);
      try {
        const result = await api("/api/auth/register", { method: "POST", body });
        csrfToken = result.csrfToken;
        sessionStorage.setItem("uchihaBuilderCsrf", csrfToken);
        await afterAuthentication();
      } catch (error) {
        showNotice(notice, error.message, "error");
      }
    });

    document.querySelector("#loginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      hideNotice(notice);
      try {
        const result = await api("/api/auth/login", {
          method: "POST",
          body: formData(event.currentTarget)
        });
        csrfToken = result.csrfToken;
        sessionStorage.setItem("uchihaBuilderCsrf", csrfToken);
        await afterAuthentication();
      } catch (error) {
        showNotice(notice, error.message, "error");
      }
    });

    document.querySelector("#activateDemoButton").addEventListener("click", async () => {
      hideNotice(notice);
      try {
        if (!offer) throw new Error("لم يتم إعداد الاشتراك بعد");
        await api("/api/subscriptions/demo-activate", {
          method: "POST",
          body: { offerId: offer.id }
        });
        showStep(storeStep, "identity");
      } catch (error) {
        showNotice(notice, error.message, "error");
      }
    });

    const storeForm = document.querySelector("#storeForm");
    const preview = document.querySelector("#livePreview");
    const previewName = document.querySelector("#previewName");
    const previewLogo = document.querySelector("#previewLogo");
    const previewDescription = document.querySelector("#previewDescription");
    const slugStatus = document.querySelector("#slugStatus");
    let slugTimer;

    function updatePreview() {
      const values = formData(storeForm);
      const name = values.name || "متجرك";
      previewName.textContent = name;
      previewLogo.textContent = name.trim().slice(0, 1) || "م";
      previewDescription.textContent = values.description || "وصف متجرك يظهر هنا";
      preview.style.setProperty("--preview-primary", values.primaryColor || "#6d28d9");
      preview.style.setProperty("--preview-secondary", values.secondaryColor || "#111827");
    }
    storeForm.addEventListener("input", (event) => {
      updatePreview();
      if (event.target.name === "slug") {
        clearTimeout(slugTimer);
        slugTimer = setTimeout(async () => {
          const slug = event.target.value.trim().toLowerCase();
          if (slug.length < 3) {
            slugStatus.textContent = "ثلاثة أحرف على الأقل";
            return;
          }
          try {
            const result = await api(`/api/stores/slug/${encodeURIComponent(slug)}/availability`);
            slugStatus.textContent = result.available ? "الرابط متاح" : "الرابط غير متاح";
            slugStatus.style.color = result.available ? "#15803d" : "#b91c1c";
          } catch (error) {
            slugStatus.textContent = error.message;
          }
        }, 350);
      }
    });
    updatePreview();

    storeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      hideNotice(notice);
      const body = formData(event.currentTarget);
      try {
        const result = await api("/api/stores", {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body
        });
        showResult(result.store);
        await refreshStoreUntilReady(result.store.id);
      } catch (error) {
        showNotice(notice, error.message, "error");
      }
    });

    try {
      const me = await currentUser();
      if (me.stores.length) {
        showResult(me.stores[0]);
      } else {
        showStep(subscriptionStep, "subscription");
      }
    } catch {
      showStep(authStep, "account");
    }
  }

  async function initAdmin() {
    const storeId = location.pathname.split("/").filter(Boolean).at(-1);
    const notice = document.querySelector("#adminNotice");
    let storeData;
    let categories = [];
    let products = [];

    document.querySelectorAll(".nav-item").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
        document.querySelectorAll("[data-panel-view]").forEach((panel) => panel.classList.remove("active"));
        button.classList.add("active");
        document.querySelector(`[data-panel-view="${button.dataset.panel}"]`)?.classList.add("active");
      });
    });

    function renderProducts() {
      const list = document.querySelector("#productsList");
      list.replaceChildren();
      list.classList.toggle("empty-state", products.length === 0);
      if (!products.length) {
        list.textContent = "لا توجد منتجات بعد.";
        return;
      }
      for (const product of products) {
        list.append(
          element("div", { className: "data-row" }, [
            element("strong", { text: product.name }),
            element("span", { text: product.type }),
            element("span", { text: money(product.priceMinor, product.currency) }),
            element("small", { text: product.status })
          ])
        );
      }
    }

    function renderCategories() {
      const select = document.querySelector("#productCategory");
      const selected = select.value;
      select.replaceChildren(element("option", { text: "بدون قسم", attributes: { value: "" } }));
      for (const category of categories) {
        select.append(element("option", { text: category.name, attributes: { value: category.id } }));
      }
      select.value = selected;
    }

    function renderBots(bots) {
      const container = document.querySelector("#botConnections");
      container.replaceChildren();
      for (const bot of bots) {
        container.append(
          element("article", { className: "connection-card" }, [
            element("div", {}, [
              element("strong", { text: bot.purpose === "admin" ? "بوت الإدارة" : "بوت المتجر" }),
              element("small", { text: `@${bot.username}` })
            ]),
            element("span", { className: "status-badge active", text: bot.status })
          ])
        );
      }
      document.querySelector("#statBots").textContent = `${bots.length}/2`;
      document.querySelector("#timelineBots").classList.toggle("done", bots.length === 2);
    }

    function applyStoreHeader(data) {
      storeData = data.store;
      document.querySelector("#adminStoreName").textContent = data.store.name;
      const status = document.querySelector("#storeStatus");
      status.textContent = statusLabel(data.store.status);
      status.classList.toggle("active", data.store.status === "active");
      document.querySelector("#adminPreviewLink").href =
        data.store.status === "active" ? data.store.links.storefront : `${data.store.links.storefront}?preview=1`;
      document.querySelector("#statProducts").textContent = data.counts.products;
      document.querySelector("#statCategories").textContent = data.counts.categories;
      document.querySelector("#statOrders").textContent = data.counts.orders;
      document.querySelector("#timelineActive").classList.toggle("done", data.store.status === "active");
      renderBots(data.bots);
      const design = data.store.design;
      const identity = element("div", { className: "identity-card" }, [
        element("strong", { text: `${data.store.name} — ${data.store.templateKey}` }),
        element("p", { text: data.store.description || "لا يوجد وصف بعد." }),
        element("div", { className: "identity-colors" }, [
          element("i", { attributes: { style: `background:${design.primaryColor}` } }),
          element("i", { attributes: { style: `background:${design.secondaryColor}` } }),
          element("i", { attributes: { style: `background:${design.backgroundColor}` } }),
          element("i", { attributes: { style: `background:${design.surfaceColor}` } })
        ])
      ]);
      identity.style.setProperty("--identity-background", design.backgroundColor);
      identity.style.setProperty("--identity-text", design.textColor);
      document.querySelector("#identitySummary").replaceChildren(identity);
    }

    async function loadStore() {
      const data = await api(`/api/stores/${storeId}`);
      applyStoreHeader(data);
      return data;
    }

    async function loadCatalog() {
      const [categoryData, productData] = await Promise.all([
        api(`/api/stores/${storeId}/categories`),
        api(`/api/stores/${storeId}/products`)
      ]);
      categories = categoryData.categories;
      products = productData.products;
      renderCategories();
      renderProducts();
    }

    async function loadOrders() {
      const data = await api(`/api/stores/${storeId}/orders`);
      const list = document.querySelector("#ordersList");
      list.replaceChildren();
      list.classList.toggle("empty-state", data.orders.length === 0);
      if (!data.orders.length) {
        list.textContent = "لا توجد طلبات بعد.";
        return;
      }
      for (const order of data.orders) {
        list.append(
          element("div", { className: "data-row" }, [
            element("strong", { text: order.orderNumber }),
            element("span", { text: order.customerName }),
            element("span", { text: money(order.totalMinor, order.currency) }),
            element("small", { text: statusLabel(order.status) })
          ])
        );
      }
    }

    function serviceCard(service, type) {
      const marginLabel = type === "api" ? "نسبة ربح المتجر" : "هامش ربح المتجر";
      const margin = element("input", {
        type: "number",
        attributes: {
          min: "0",
          value: "0",
          "aria-label": marginLabel
        }
      });
      const button = element("button", {
        className: "button button-compact",
        type: "button",
        text: "إضافة للمتجر"
      });
      button.addEventListener("click", async () => {
        hideNotice(notice);
        button.disabled = true;
        try {
          if (type === "api") {
            await api(`/api/stores/${storeId}/library/import`, {
              method: "POST",
              body: {
                serviceId: service.id,
                newCategoryName: "خدمات UCHIHA",
                profitMode: "percent",
                profitValue: Number(margin.value || 0),
                syncEnabled: true
              }
            });
          } else {
            await api(`/api/stores/${storeId}/programming-services/import`, {
              method: "POST",
              body: {
                serviceId: service.id,
                merchantMarginMinor: Number(margin.value || 0)
              }
            });
          }
          showNotice(notice, `تمت إضافة ${service.name} إلى المتجر`, "success");
          await Promise.all([loadCatalog(), loadStore()]);
        } catch (error) {
          showNotice(notice, error.message, "error");
        } finally {
          button.disabled = false;
        }
      });
      const basePrice =
        type === "api"
          ? money(service.wholesalePriceMinor, service.currency)
          : money(service.startingPriceMinor, service.currency);
      return element("article", { className: "service-card" }, [
        element("span", { className: "service-source", text: type === "api" ? service.source : "خدمات البرمجة" }),
        element("h3", { text: service.name }),
        element("p", { text: service.description || "خدمة جاهزة للإضافة والتخصيص." }),
        element("label", { className: "field", text: marginLabel }, [margin]),
        element("div", { className: "service-meta" }, [
          element("strong", { text: basePrice }),
          button
        ])
      ]);
    }

    async function loadLibraries() {
      const [apiData, programmingData] = await Promise.all([
        api("/api/library/services"),
        api("/api/library/programming-services")
      ]);
      const library = document.querySelector("#libraryServices");
      library.classList.remove("skeleton-grid");
      library.replaceChildren(...apiData.services.map((service) => serviceCard(service, "api")));
      const programming = document.querySelector("#programmingServices");
      programming.classList.remove("skeleton-grid");
      programming.replaceChildren(
        ...programmingData.services.map((service) => serviceCard(service, "programming"))
      );
    }

    document.querySelector("#categoryForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      hideNotice(notice);
      try {
        await api(`/api/stores/${storeId}/categories`, {
          method: "POST",
          body: formData(event.currentTarget)
        });
        event.currentTarget.reset();
        await Promise.all([loadCatalog(), loadStore()]);
        showNotice(notice, "تمت إضافة القسم", "success");
      } catch (error) {
        showNotice(notice, error.message, "error");
      }
    });

    document.querySelector("#productForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      hideNotice(notice);
      const body = formData(event.currentTarget);
      body.categoryId ||= null;
      body.deliveryMode = "manual";
      try {
        await api(`/api/stores/${storeId}/products`, { method: "POST", body });
        event.currentTarget.reset();
        await Promise.all([loadCatalog(), loadStore()]);
        showNotice(notice, "تم حفظ المنتج وظهر في مصدر بيانات المتجر", "success");
      } catch (error) {
        showNotice(notice, error.message, "error");
      }
    });

    document.querySelector("#botsForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      hideNotice(notice);
      try {
        const data = await api(`/api/stores/${storeId}/bots`, {
          method: "POST",
          body: formData(event.currentTarget)
        });
        renderBots(data.bots);
        event.currentTarget.reset();
        showNotice(notice, "نجح فحص البوتين وبدأ إعداد Webhooks", "success");
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const refreshed = await loadStore();
          if (["active", "review_required"].includes(refreshed.store.status)) break;
          await new Promise((resolve) => setTimeout(resolve, 650));
        }
      } catch (error) {
        showNotice(notice, error.message, "error");
      }
    });

    try {
      await currentUser();
      await Promise.all([loadStore(), loadCatalog(), loadLibraries(), loadOrders()]);
    } catch (error) {
      showNotice(notice, error.message, "error");
    }
  }

  async function initStore() {
    const slug = decodeURIComponent(location.pathname.split("/").filter(Boolean).at(-1));
    const loading = document.querySelector("#storeLoading");
    const app = document.querySelector("#storeApp");
    let catalog;
    let currentCategory = "";
    let searchTerm = "";
    let selectedProduct = null;
    const orderDialog = document.querySelector("#orderDialog");
    const orderForm = document.querySelector("#orderForm");
    const orderNotice = document.querySelector("#orderNotice");

    function applyDesign(store) {
      const design = store.design;
      const variables = {
        "--store-primary": design.primaryColor,
        "--store-secondary": design.secondaryColor,
        "--store-background": design.backgroundColor,
        "--store-surface": design.surfaceColor,
        "--store-text": design.textColor,
        "--store-muted": design.mutedTextColor,
        "--store-border": design.borderColor,
        "--store-radius": design.borderRadius,
        "--store-font": design.fontFamily
      };
      for (const [name, value] of Object.entries(variables)) app.style.setProperty(name, value);
      document.title = store.name;
      document.querySelector("#storeName").textContent = store.name;
      document.querySelector("#storeTagline").textContent = store.activityType;
      document.querySelector("#storeTextLogo").textContent = store.name.trim().slice(0, 1);
      document.querySelector("#storeHeroTitle").textContent = store.welcomeMessage || `مرحبًا بك في ${store.name}`;
      document.querySelector("#storeDescription").textContent = store.description;
      document.querySelector("#footerStoreName").textContent = store.name;
      const logo = document.querySelector("#storeLogoImage");
      const textLogo = document.querySelector("#storeTextLogo");
      if (design.logoUrl) {
        logo.src = design.logoUrl;
        logo.alt = `شعار ${store.name}`;
        logo.hidden = false;
        textLogo.hidden = true;
      }
      if (design.coverUrl) {
        document.querySelector("#storeCover").style.backgroundImage =
          `linear-gradient(135deg, color-mix(in srgb, ${design.primaryColor} 72%, transparent), color-mix(in srgb, ${design.secondaryColor} 80%, transparent)), url("${design.coverUrl.replace(/["\\]/g, "")}")`;
      }
      const contacts = store.contacts || {};
      const contact = document.querySelector("#storeContactLink");
      if (contacts.whatsapp) contact.href = `https://wa.me/${String(contacts.whatsapp).replace(/\D/g, "")}`;
      else if (contacts.email) contact.href = `mailto:${contacts.email}`;
      else contact.href = "#";
    }

    function renderCategories() {
      const container = document.querySelector("#storeCategories");
      container.replaceChildren();
      for (const category of catalog.categories) {
        const button = element("button", {
          type: "button",
          text: category.name,
          dataset: { category: category.id }
        });
        button.classList.toggle("active", currentCategory === category.id);
        button.addEventListener("click", () => {
          currentCategory = category.id;
          document.querySelectorAll(".store-categories button").forEach((item) => item.classList.remove("active"));
          button.classList.add("active");
          renderProducts();
        });
        container.append(button);
      }
      document.querySelector('.store-categories button[data-category=""]').addEventListener("click", (event) => {
        currentCategory = "";
        document.querySelectorAll(".store-categories button").forEach((item) => item.classList.remove("active"));
        event.currentTarget.classList.add("active");
        renderProducts();
      });
    }

    function openOrder(product) {
      selectedProduct = product;
      orderForm.reset();
      orderForm.elements.productId.value = product.id;
      orderForm.elements.quantity.min = product.minimumQuantity;
      orderForm.elements.quantity.max = product.maximumQuantity || "";
      orderForm.elements.quantity.value = product.minimumQuantity;
      document.querySelector("#orderProductName").textContent = product.name;
      document.querySelector("#orderProductDescription").textContent = product.description;
      document.querySelector("#orderTotal").textContent = money(
        product.priceMinor * product.minimumQuantity,
        product.currency
      );
      const fields = document.querySelector("#orderDynamicFields");
      fields.replaceChildren();
      for (const field of product.fields || []) {
        const input = element("input", {
          type: field.type === "number" ? "number" : "text",
          attributes: {
            name: `input_${field.key}`,
            required: field.required ? "" : null,
            maxlength: "500"
          }
        });
        fields.append(element("label", { text: field.label || field.key }, [input]));
      }
      hideNotice(orderNotice);
      orderDialog.showModal();
    }

    function renderProducts() {
      const container = document.querySelector("#storeProducts");
      const filtered = catalog.products.filter((product) => {
        const categoryMatch = !currentCategory || product.categoryId === currentCategory;
        const searchMatch =
          !searchTerm ||
          product.name.toLowerCase().includes(searchTerm) ||
          product.description.toLowerCase().includes(searchTerm);
        return categoryMatch && searchMatch;
      });
      container.replaceChildren();
      if (!filtered.length) {
        container.append(element("p", { className: "empty-state", text: "لا توجد منتجات مطابقة." }));
        return;
      }
      const typeLabels = {
        digital: "منتج رقمي",
        physical: "منتج مادي",
        service: "خدمة",
        subscription: "اشتراك",
        code: "كود",
        account: "حساب",
        game_topup: "شحن لعبة",
        api_service: "خدمة رقمية",
        programming_service: "خدمة برمجة"
      };
      for (const product of filtered) {
        const visual = element("div", { className: "product-visual" }, [
          element("span", { text: product.name.trim().slice(0, 1) })
        ]);
        if (product.imageUrl) {
          visual.style.backgroundImage = `url("${product.imageUrl.replace(/["\\]/g, "")}")`;
        }
        const buyButton = element("button", { type: "button", text: "اطلب الآن" });
        buyButton.addEventListener("click", () => openOrder(product));
        container.append(
          element("article", { className: "store-product-card" }, [
            visual,
            element("div", { className: "product-body" }, [
              element("span", { className: "product-kind", text: typeLabels[product.type] || "منتج" }),
              element("h3", { text: product.name }),
              element("p", { text: product.description }),
              element("div", { className: "product-footer" }, [
                element("strong", { text: money(product.priceMinor, product.currency) }),
                buyButton
              ])
            ])
          ])
        );
      }
    }

    document.querySelector("#storeSearch").addEventListener("input", (event) => {
      searchTerm = event.target.value.trim().toLowerCase();
      renderProducts();
    });

    orderForm.elements.quantity.addEventListener("input", () => {
      if (!selectedProduct) return;
      const quantity = Number(orderForm.elements.quantity.value || 1);
      document.querySelector("#orderTotal").textContent = money(
        selectedProduct.priceMinor * quantity,
        selectedProduct.currency
      );
    });

    orderForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (event.submitter?.value === "cancel") {
        orderDialog.close();
        return;
      }
      hideNotice(orderNotice);
      const values = formData(orderForm);
      const inputs = {};
      for (const [key, value] of Object.entries(values)) {
        if (key.startsWith("input_")) inputs[key.slice(6)] = value;
      }
      try {
        const result = await api(`/api/storefront/${encodeURIComponent(slug)}/orders`, {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: {
            productId: values.productId,
            customerName: values.customerName,
            customerEmail: values.customerEmail,
            quantity: Number(values.quantity),
            testPayment: values.testPayment === "on",
            inputs
          }
        });
        showNotice(
          orderNotice,
          `تم إنشاء الطلب ${result.order.orderNumber}. الحالة: ${statusLabel(result.order.status)}`,
          "success"
        );
        orderForm.querySelector('button[value="submit"]').disabled = true;
      } catch (error) {
        showNotice(orderNotice, error.message, "error");
      }
    });

    try {
      const config = await api("/api/public/config");
      document.querySelector("#testPaymentField").hidden = !config.demoMode;
      try {
        catalog = await api(`/api/storefront/${encodeURIComponent(slug)}`);
      } catch (error) {
        if (error.status !== 404) throw error;
        catalog = await api(`/api/storefront/${encodeURIComponent(slug)}?preview=1`);
      }
      applyDesign(catalog.store);
      renderCategories();
      renderProducts();
      loading.hidden = true;
      app.hidden = false;
    } catch (error) {
      loading.querySelector("span").hidden = true;
      loading.querySelector("p").textContent = error.message;
    }
  }

  if (page === "builder") initBuilder();
  if (page === "admin") initAdmin();
  if (page === "store") initStore();
})();

