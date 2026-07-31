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

  function currencyFractionDigits(currency) {
    try {
      return new Intl.NumberFormat("en", {
        style: "currency",
        currency: currency || "USD"
      }).resolvedOptions().maximumFractionDigits;
    } catch {
      return 2;
    }
  }

  function currencyMinorFactor(currency) {
    return 10 ** currencyFractionDigits(currency);
  }

  function formatCurrencyMajor(amount, currency) {
    return new Intl.NumberFormat("ar", {
      style: "currency",
      currency: currency || "USD"
    }).format(Number(amount || 0));
  }

  function money(minor, currency) {
    return formatCurrencyMajor(
      Number(minor || 0) / currencyMinorFactor(currency),
      currency
    );
  }

  function accessibleTextColor(background) {
    const match = /^#([0-9a-f]{6})$/i.exec(String(background || ""));
    if (!match) return "#ffffff";
    const channels = match[1].match(/.{2}/g).map((part) => Number.parseInt(part, 16) / 255);
    const luminance = channels
      .map((channel) =>
        channel <= 0.03928
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4
      )
      .reduce(
        (total, channel, index) =>
          total + channel * [0.2126, 0.7152, 0.0722][index],
        0
      );
    const whiteContrast = 1.05 / (luminance + 0.05);
    const darkContrast = (luminance + 0.05) / 0.0528;
    return whiteContrast >= darkContrast ? "#ffffff" : "#0b0c12";
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
    let publicConfig = { currencies: ["USD"] };
    let currentStore = null;
    const draftKey = "uchiha:store-wizard:v1";
    const builderDesignPresets = {
      "professional-dark": { primaryColor: "#6654d9", secondaryColor: "#141620", backgroundColor: "#0c0e14", surfaceColor: "#151822", textColor: "#f7f6fb", mutedTextColor: "#a7a8b4" },
      "modern-light": { primaryColor: "#5b52c9", secondaryColor: "#1c1a23", backgroundColor: "#f8f7fb", surfaceColor: "#ffffff", textColor: "#1b1821", mutedTextColor: "#706c79" },
      "gaming-digital": { primaryColor: "#d74768", secondaryColor: "#171020", backgroundColor: "#0b0a10", surfaceColor: "#17131d", textColor: "#fbf7fa", mutedTextColor: "#b9aab6" }
    };

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
      publicConfig = configData;
      offer = offerData.offer;
      if (offer) {
        document.querySelector("#offerName").textContent = offer.name;
        document.querySelector("#offerPrice").textContent = money(offer.priceMinor, offer.currency);
      }
      document.querySelector("#activateDemoButton").hidden = !configData.demoMode;
      const currencySelect = document.querySelector("#storeCurrency");
      const displayNames = typeof Intl.DisplayNames === "function"
        ? new Intl.DisplayNames(["ar"], { type: "currency" })
        : null;
      currencySelect.replaceChildren();
      for (const code of configData.currencies || ["USD"]) {
        let label = code;
        try {
          label = displayNames?.of(code) || code;
        } catch {
          label = code;
        }
        currencySelect.append(
          element("option", {
            text: `${code} — ${label}`,
            attributes: { value: code }
          })
        );
      }
      currencySelect.value = "USD";
    } catch (error) {
      showNotice(notice, error.message, "error");
    }

    document.querySelectorAll("[data-auth-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
          tab.classList.remove("active");
          tab.setAttribute("aria-selected", "false");
        });
        button.classList.add("active");
        button.setAttribute("aria-selected", "true");
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
    const wizardPages = [...document.querySelectorAll("[data-wizard-step]")];
    const wizardTitle = document.querySelector("#wizardTitle");
    const wizardCounter = document.querySelector("#wizardCounter");
    const wizardBack = document.querySelector("#wizardBack");
    const wizardNext = document.querySelector("#wizardNext");
    const wizardSubmit = document.querySelector("#wizardSubmit");
    let wizardStep = 1;
    let slugTimer;

    function selectedComponents() {
      return [
        "store_website",
        "web_admin",
        ...[...storeForm.querySelectorAll('input[name="components"]:checked:not(:disabled)')].map(
          (input) => input.value
        )
      ];
    }

    function draftValues() {
      return { ...formData(storeForm), components: selectedComponents() };
    }

    function saveDraft() {
      try {
        localStorage.setItem(draftKey, JSON.stringify(draftValues()));
      } catch {
        // The wizard remains fully usable when browser storage is unavailable.
      }
    }

    function restoreDraft() {
      let draft;
      try {
        draft = JSON.parse(localStorage.getItem(draftKey) || "null");
      } catch {
        draft = null;
      }
      if (!draft || typeof draft !== "object") return;
      for (const [key, value] of Object.entries(draft)) {
        if (key === "components") continue;
        const control = storeForm.elements[key];
        if (control && typeof value === "string") control.value = value;
      }
      if (Array.isArray(draft.components)) {
        storeForm.querySelectorAll('input[name="components"]').forEach((input) => {
          if (!input.disabled) input.checked = draft.components.includes(input.value);
        });
      }
    }

    function renderWizardReview() {
      const values = draftValues();
      const componentLabels = {
        store_website: "موقع المتجر",
        web_admin: "لوحة الإدارة",
        storefront_bot: "بوت المتجر",
        admin_bot: "بوت الإدارة",
        android_app: "تطبيق Android",
        ios_app: "تطبيق iOS"
      };
      const rows = [
        ["المتجر", values.name || "—"],
        ["الرابط", `${values.slug || "—"}.uchiha.store`],
        ["العملة", values.currency || "USD"],
        ["القالب", storeForm.elements.templateKey.selectedOptions[0]?.textContent || values.templateKey],
        ["المكوّنات", values.components.map((key) => componentLabels[key] || key).join("، ")]
      ];
      const container = document.querySelector("#wizardReview");
      container.replaceChildren(
        ...rows.map(([label, value]) =>
          element("div", {}, [element("span", { text: label }), element("strong", { text: value })])
        )
      );
    }

    function renderWizard() {
      for (const page of wizardPages) {
        const active = Number(page.dataset.wizardStep) === wizardStep;
        page.hidden = !active;
        page.classList.toggle("active", active);
      }
      document.querySelectorAll("[data-wizard-progress]").forEach((item) => {
        const index = Number(item.dataset.wizardProgress);
        item.classList.toggle("active", index === wizardStep);
        item.classList.toggle("done", index < wizardStep);
      });
      const currentPage = wizardPages.find((page) => Number(page.dataset.wizardStep) === wizardStep);
      wizardTitle.textContent = currentPage?.dataset.title || "إعداد المشروع";
      wizardCounter.textContent = `الخطوة ${wizardStep} من ${wizardPages.length}`;
      wizardBack.hidden = wizardStep === 1;
      wizardNext.hidden = wizardStep === wizardPages.length;
      wizardSubmit.hidden = wizardStep !== wizardPages.length;
      if (wizardStep === wizardPages.length) renderWizardReview();
    }

    function validateWizardPage() {
      const currentPage = wizardPages.find((page) => Number(page.dataset.wizardStep) === wizardStep);
      const controls = [...currentPage.querySelectorAll("input, select, textarea")].filter(
        (control) => !control.disabled
      );
      for (const control of controls) {
        if (!control.checkValidity()) {
          control.reportValidity();
          return false;
        }
      }
      return true;
    }

    wizardNext.addEventListener("click", () => {
      if (!validateWizardPage()) return;
      wizardStep = Math.min(wizardPages.length, wizardStep + 1);
      saveDraft();
      renderWizard();
      document.querySelector("#storeStep").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    wizardBack.addEventListener("click", () => {
      wizardStep = Math.max(1, wizardStep - 1);
      renderWizard();
      document.querySelector("#storeStep").scrollIntoView({ behavior: "smooth", block: "start" });
    });

    function updatePreview() {
      const values = formData(storeForm);
      const name = values.name || "متجرك";
      previewName.textContent = name;
      previewLogo.textContent = name.trim().slice(0, 1) || "م";
      previewDescription.textContent = values.description || "وصف متجرك يظهر هنا";
      preview.dataset.template = values.templateKey || "modern-light";
      preview.style.setProperty("--preview-primary", values.primaryColor || "#6d28d9");
      preview.style.setProperty("--preview-secondary", values.secondaryColor || "#111827");
      preview.style.setProperty("--preview-background", values.backgroundColor || "#f8fafc");
      preview.style.setProperty("--preview-surface", values.surfaceColor || "#ffffff");
      preview.style.setProperty("--preview-text", values.textColor || "#111827");
      preview.style.setProperty("--preview-muted", values.mutedTextColor || "#64748b");
    }
    storeForm.addEventListener("input", (event) => {
      if (event.target.name === "templateKey") {
        const preset = builderDesignPresets[event.target.value];
        for (const [key, value] of Object.entries(preset || {})) {
          if (storeForm.elements[key]) storeForm.elements[key].value = value;
        }
      }
      if (event.target.name === "components") {
        event.target.closest("label")?.classList.toggle("selected", event.target.checked);
      }
      updatePreview();
      saveDraft();
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
    restoreDraft();
    storeForm.querySelectorAll('input[name="components"]').forEach((input) => {
      input.closest("label")?.classList.toggle("selected", input.checked);
    });
    const wizardBannerUrl = document.querySelector("#wizardBannerUrl");
    const updateWizardBannerRequirement = () => {
      const needsMedia = storeForm.elements.bannerMediaType.value !== "abstract";
      wizardBannerUrl.required = needsMedia;
    };
    storeForm.elements.bannerMediaType.addEventListener("change", updateWizardBannerRequirement);
    updateWizardBannerRequirement();
    updatePreview();
    renderWizard();

    storeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      hideNotice(notice);
      if (!validateWizardPage()) return;
      const body = { ...formData(event.currentTarget), components: selectedComponents() };
      try {
        const result = await api("/api/stores", {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body
        });
        localStorage.removeItem(draftKey);
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
    let productPagination = { limit: 50, offset: 0, total: 0 };
    let adminProductQuery = "";
    let supportedCurrencies = ["USD"];
    let currencySettings = [];
    const mediaOptions = [
      ["digital-card", "بطاقات رقمية"],
      ["game-topup", "ألعاب وشحن"],
      ["mobile-credit", "رصيد واتصالات"],
      ["subscription", "اشتراكات"],
      ["software", "برامج وأدوات"],
      ["social-service", "خدمات اجتماعية"],
      ["programming", "خدمات برمجة"]
    ];

    const designPresets = {
      "professional-dark": { primaryColor: "#6654d9", secondaryColor: "#141620", backgroundColor: "#0c0e14", surfaceColor: "#151822", textColor: "#f7f6fb", mutedTextColor: "#a7a8b4", borderColor: "#2b2e3a" },
      "modern-light": { primaryColor: "#5b52c9", secondaryColor: "#1c1a23", backgroundColor: "#f8f7fb", surfaceColor: "#ffffff", textColor: "#1b1821", mutedTextColor: "#706c79", borderColor: "#e4e1e8" },
      "gaming-digital": { primaryColor: "#d74768", secondaryColor: "#171020", backgroundColor: "#0b0a10", surfaceColor: "#17131d", textColor: "#fbf7fa", mutedTextColor: "#b9aab6", borderColor: "#392634" }
    };
    const templateAliases = { digital: "gaming-digital", gaming: "gaming-digital", "modern-dark": "professional-dark", "tech-services": "professional-dark", "commerce-light": "modern-light", luxury: "professional-dark", general: "modern-light" };
    const designForm = document.querySelector("#designForm");
    const designPreview = document.querySelector("#designPreview");
    const bannerForm = document.querySelector("#bannerForm");
    const currencyForm = document.querySelector("#currencyForm");

    function canonicalTemplateKey(key) {
      return templateAliases[key] || key || "modern-light";
    }

    function designValues() {
      return formData(designForm);
    }

    function renderDesignPreview() {
      const values = designValues();
      designPreview.dataset.template = canonicalTemplateKey(values.templateKey);
      designPreview.style.setProperty("--preview-primary", values.primaryColor);
      designPreview.style.setProperty("--preview-secondary", values.secondaryColor);
      designPreview.style.setProperty("--preview-background", values.backgroundColor);
      designPreview.style.setProperty("--preview-surface", values.surfaceColor);
      designPreview.style.setProperty("--preview-text", values.textColor);
      designPreview.style.setProperty("--preview-muted", values.mutedTextColor);
      designPreview.style.setProperty("--preview-border", values.borderColor);
      designPreview.style.setProperty("--preview-radius", values.borderRadius);
      document.querySelector("#designPreviewName").textContent = storeData?.name || "المتجر";
      document.querySelector("#designPreviewLogo").textContent = (storeData?.name || "U").trim().slice(0, 1);
    }

    function fillDesignForm(store) {
      const design = store.design;
      const templateKey = canonicalTemplateKey(store.templateKey);
      const values = { templateKey, ...design };
      for (const [key, value] of Object.entries(values)) {
        if (designForm.elements[key] && value !== null && value !== undefined) designForm.elements[key].value = value;
      }
      renderDesignPreview();
    }

    designForm.addEventListener("input", (event) => {
      if (event.target.name === "templateKey") {
        const preset = designPresets[canonicalTemplateKey(event.target.value)];
        for (const [key, value] of Object.entries(preset || {})) designForm.elements[key].value = value;
      }
      renderDesignPreview();
    });

    designForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      hideNotice(notice);
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const body = designValues();
        body.logoUrl = body.logoUrl.trim() || null;
        body.coverUrl = body.coverUrl.trim() || null;
        const result = await api(`/api/stores/${storeId}/design`, { method: "PUT", body });
        storeData = result.store;
        fillDesignForm(result.store);
        await loadStore();
        showNotice(notice, "تم حفظ القالب والتصميم", "success");
      } catch (error) {
        showNotice(notice, error.message, "error");
      } finally {
        button.disabled = false;
      }
    });

    function fillBannerForm(banner) {
      if (!bannerForm || !banner) return;
      for (const [key, value] of Object.entries(banner)) {
        if (bannerForm.elements[key] && value !== null && value !== undefined) {
          bannerForm.elements[key].value = value;
        }
      }
    }

    bannerForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      hideNotice(notice);
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const body = formData(event.currentTarget);
        body.mediaUrl = body.mediaUrl.trim() || null;
        body.linkUrl = body.linkUrl.trim() || null;
        const result = await api(`/api/stores/${storeId}/banner`, { method: "PUT", body });
        fillBannerForm(result.banner);
        showNotice(notice, "تم حفظ بانر الواجهة", "success");
      } catch (error) {
        showNotice(notice, error.message, "error");
      } finally {
        button.disabled = false;
      }
    });

    function populateCurrencyOptions() {
      const select = document.querySelector("#currencyCode");
      if (!select) return;
      const selected = select.value;
      const displayNames = typeof Intl.DisplayNames === "function"
        ? new Intl.DisplayNames(["ar"], { type: "currency" })
        : null;
      select.replaceChildren();
      for (const code of supportedCurrencies) {
        let name = code;
        try {
          name = displayNames?.of(code) || code;
        } catch {
          name = code;
        }
        select.append(
          element("option", {
            text: `${code} — ${name}`,
            attributes: { value: code }
          })
        );
      }
      select.value = supportedCurrencies.includes(selected)
        ? selected
        : (supportedCurrencies.find((code) => code !== storeData?.currency) || storeData?.currency || "USD");
    }

    function renderCurrencySettings(settings = []) {
      currencySettings = settings;
      const list = document.querySelector("#currencySettingsList");
      const hint = document.querySelector("#currencyRateHint");
      if (!list) return;
      if (hint && storeData) {
        hint.textContent = `أدخل قيمة وحدة واحدة من العملة المختارة بعملة المتجر الأساسية ${storeData.currency}.`;
      }
      list.replaceChildren();
      for (const setting of settings) {
        const toggle = setting.isBase
          ? element("span", { className: "status-badge active", text: "العملة الأساسية" })
          : element("button", {
              className: "button button-secondary button-compact",
              type: "button",
              text: setting.isEnabled ? "تعطيل" : "إعادة التفعيل"
            });
        if (!setting.isBase) {
          toggle.addEventListener("click", async () => {
            toggle.disabled = true;
            try {
              const result = await api(
                `/api/stores/${storeId}/currencies/${encodeURIComponent(setting.currency)}`,
                {
                  method: "PUT",
                  body: {
                    rateToBase: setting.rateToBase,
                    isEnabled: !setting.isEnabled
                  }
                }
              );
              renderCurrencySettings(result.currencies);
              showNotice(
                notice,
                setting.isEnabled
                  ? `تم إخفاء ${setting.currency} من واجهة المتجر`
                  : `تم تفعيل ${setting.currency}`,
                "success"
              );
            } catch (error) {
              showNotice(notice, error.message, "error");
              toggle.disabled = false;
            }
          });
        }
        const updated = setting.rateUpdatedAt
          ? new Date(setting.rateUpdatedAt).toLocaleString("ar")
          : "غير متاح";
        list.append(
          element("article", { className: setting.isEnabled ? "active" : "disabled" }, [
            element("div", {}, [
              element("strong", { text: setting.currency }),
              element("small", {
                text: setting.isBase
                  ? "السعر 1 — أساس الحساب"
                  : `1 ${setting.currency} = ${setting.rateToBase} ${storeData?.currency || ""}`
              }),
              element("time", { text: `آخر تحديث: ${updated}` })
            ]),
            toggle
          ])
        );
      }
    }

    currencyForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      hideNotice(notice);
      const values = formData(event.currentTarget);
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const result = await api(
          `/api/stores/${storeId}/currencies/${encodeURIComponent(values.currency)}`,
          {
            method: "PUT",
            body: {
              rateToBase: Number(values.rateToBase),
              isEnabled: true
            }
          }
        );
        renderCurrencySettings(result.currencies);
        event.currentTarget.elements.rateToBase.value = "";
        showNotice(notice, `تم تحديث سعر ${values.currency} وتفعيله`, "success");
      } catch (error) {
        showNotice(notice, error.message, "error");
      } finally {
        button.disabled = false;
      }
    });

    document.querySelector("#adminProductsMore").addEventListener("click", () => loadCatalog(false));
    let adminSearchTimer;
    document.querySelector("#adminProductSearch").addEventListener("input", (event) => {
      adminProductQuery = event.target.value.trim();
      clearTimeout(adminSearchTimer);
      adminSearchTimer = setTimeout(() => loadCatalog(true), 300);
    });

    function openAdminPanel(panelKey) {
      const parentPanel = ["design", "library", "programming", "bots"].includes(panelKey)
        ? "settings"
        : panelKey;
      document.querySelectorAll(".nav-item[data-panel]").forEach((item) => {
        item.classList.toggle("active", item.dataset.panel === parentPanel);
      });
      document.querySelectorAll("[data-panel-view]").forEach((panel) => {
        panel.classList.toggle("active", panel.dataset.panelView === panelKey);
      });
      document.querySelector(`[data-panel-view="${panelKey}"]`)?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }

    document.querySelectorAll(".nav-item[data-panel]").forEach((button) => {
      button.addEventListener("click", () => {
        openAdminPanel(button.dataset.panel);
      });
    });
    document.querySelectorAll("[data-open-panel]").forEach((button) => {
      button.addEventListener("click", () => openAdminPanel(button.dataset.openPanel));
    });

    function renderProducts() {
      const list = document.querySelector("#productsList");
      const summary = document.querySelector("#adminProductsSummary");
      const moreButton = document.querySelector("#adminProductsMore");
      list.replaceChildren();
      list.classList.toggle("empty-state", products.length === 0);
      summary.textContent = `عرض ${products.length} من ${productPagination.total} منتج`;
      moreButton.hidden = products.length >= productPagination.total;
      if (!products.length) {
        list.textContent = "لا توجد منتجات بعد.";
        return;
      }
      for (const product of products) {
        const mediaSelect = element("select", { attributes: { "aria-label": `صورة ${product.name}` } });
        for (const [value, label] of mediaOptions) {
          mediaSelect.append(element("option", { text: label, attributes: { value } }));
        }
        mediaSelect.value = product.media?.key || "digital-card";
        const customImage = element("input", {
          type: "url",
          attributes: {
            placeholder: "رابط صورة خاصة",
            "aria-label": `رابط صورة ${product.name}`
          }
        });
        if (product.media?.source === "merchant") customImage.value = product.imageUrl || "";
        const saveMedia = element("button", {
          className: "button button-compact",
          type: "button",
          text: "حفظ الصورة"
        });
        saveMedia.addEventListener("click", async () => {
          saveMedia.disabled = true;
          hideNotice(notice);
          try {
            await api(`/api/stores/${storeId}/products/${product.id}/media`, {
              method: "PATCH",
              body: customImage.value.trim()
                ? { imageUrl: customImage.value.trim() }
                : { mediaKey: mediaSelect.value }
            });
            await loadCatalog();
            showNotice(notice, `تم تحديث صورة ${product.name}`, "success");
          } catch (error) {
            showNotice(notice, error.message, "error");
            saveMedia.disabled = false;
          }
        });
        list.append(
          element("article", { className: "catalog-product-row" }, [
            element("img", {
              attributes: {
                src: product.imageUrl || "/assets/catalog-assets/digital-card.svg",
                alt: ""
              }
            }),
            element("div", { className: "catalog-product-copy" }, [
              element("strong", { text: product.name }),
              element("small", {
                text: product.media?.locked ? "صورة خاصة محمية من المزامنة" : "صورة من مكتبة UCHIHA"
              })
            ]),
            element("span", { text: money(product.priceMinor, product.currency) }),
            element("div", { className: "catalog-media-controls" }, [mediaSelect, customImage, saveMedia])
          ])
        );
      }
    }

    function renderCategories() {
      const productSelect = document.querySelector("#productCategory");
      const parentSelect = document.querySelector("#categoryParent");
      const selectedProduct = productSelect.value;
      const selectedParent = parentSelect.value;
      productSelect.replaceChildren(
        element("option", {
          text: "اختر قسم المنتج",
          attributes: { value: "", disabled: "" }
        })
      );
      parentSelect.replaceChildren(element("option", { text: "قسم رئيسي", attributes: { value: "" } }));
      const roots = categories.filter((category) => !category.parentId);
      for (const root of roots) {
        productSelect.append(element("option", { text: root.name, attributes: { value: root.id } }));
        parentSelect.append(element("option", { text: root.name, attributes: { value: root.id } }));
        for (const child of categories.filter((category) => category.parentId === root.id)) {
          productSelect.append(
            element("option", {
              text: `${root.name} / ${child.name}`,
              attributes: { value: child.id }
            })
          );
        }
      }
      productSelect.value = selectedProduct;
      parentSelect.value = selectedParent;
    }

    const mediaLibrary = document.querySelector("#productMediaLibrary");
    const mediaKeyInput = document.querySelector("#productMediaKey");
    mediaLibrary.querySelectorAll("[data-media-key]").forEach((button) => {
      button.addEventListener("click", () => {
        mediaLibrary.querySelectorAll("[data-media-key]").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        mediaKeyInput.value = button.dataset.mediaKey;
        document.querySelector("#productImageUrl").value = "";
      });
    });

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
      if (document.querySelector("#statBots")) {
        document.querySelector("#statBots").textContent = `${bots.length}/2`;
      }
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
      document.querySelector("#statCustomers").textContent = data.counts.customers || 0;
      document.querySelector("#statSupport").textContent = data.counts.support || 0;
      const productPrice = document.querySelector("#productPrice");
      if (productPrice) {
        const digits = currencyFractionDigits(data.store.currency);
        productPrice.step = digits ? String(1 / (10 ** digits)) : "1";
      }
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
      fillDesignForm(data.store);
      fillBannerForm(data.banners?.[0]);
      populateCurrencyOptions();
      renderCurrencySettings(data.currencies || []);
      const componentContainer = document.querySelector("#projectComponents");
      if (componentContainer) {
        componentContainer.replaceChildren();
        const componentStatus = {
          active: "نشط",
          provisioning: "قيد التجهيز",
          pending_configuration: "بانتظار الإعداد",
          review_required: "يحتاج مراجعة",
          failed: "تعذر التجهيز"
        };
        if (!data.project?.components?.length) {
          componentContainer.append(
            element("p", {
              className: "empty-state",
              text: "هذا متجر سابق وسيظهر كمشروع موحّد بعد أول تحديث."
            })
          );
        } else {
          for (const component of data.project.components) {
            componentContainer.append(
              element("article", {}, [
                element("div", {}, [
                  element("strong", { text: component.name }),
                  element("small", { text: component.summary })
                ]),
                element("span", {
                  className: `status-badge ${component.status === "active" ? "active" : ""}`,
                  text: componentStatus[component.status] || component.status
                })
              ])
            );
          }
        }
      }
    }

    async function loadStore() {
      const data = await api(`/api/stores/${storeId}`);
      applyStoreHeader(data);
      return data;
    }

    async function loadCatalog(reset = true) {
      const nextOffset = reset ? 0 : products.length;
      const parameters = new URLSearchParams({ limit: "50", offset: String(nextOffset) });
      if (adminProductQuery) parameters.set("query", adminProductQuery);
      const [categoryData, productData] = await Promise.all([
        api(`/api/stores/${storeId}/categories`),
        api(`/api/stores/${storeId}/products?${parameters}`)
      ]);
      categories = categoryData.categories;
      products = reset ? productData.products : [...products, ...productData.products];
      productPagination = productData.pagination || { limit: 50, offset: 0, total: products.length };
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
      return element("article", {
        className: "service-card",
        dataset: {
          search: `${service.name || ""} ${service.description || ""} ${service.source || ""}`.toLocaleLowerCase("ar")
        }
      }, [
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

    function bindServiceSearch(inputSelector, gridSelector) {
      const input = document.querySelector(inputSelector);
      const grid = document.querySelector(gridSelector);
      input?.addEventListener("input", () => {
        const query = input.value.trim().toLocaleLowerCase("ar");
        let visible = 0;
        grid.querySelectorAll(".service-card").forEach((card) => {
          card.hidden = Boolean(query) && !card.dataset.search.includes(query);
          if (!card.hidden) visible += 1;
        });
        grid.classList.toggle("filter-empty", visible === 0);
      });
    }

    bindServiceSearch("#librarySearch", "#libraryServices");
    bindServiceSearch("#programmingSearch", "#programmingServices");

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
      body.priceMinor = Math.round(
        Number(body.price || 0) * currencyMinorFactor(storeData?.currency || "USD")
      );
      delete body.price;
      try {
        await api(`/api/stores/${storeId}/products`, { method: "POST", body });
        event.currentTarget.reset();
        mediaLibrary.querySelectorAll("[data-media-key]").forEach((item) => {
          item.classList.toggle("active", item.dataset.mediaKey === "digital-card");
        });
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
      const configPromise = api("/api/public/config").then((config) => {
        supportedCurrencies = config.currencies || ["USD"];
        populateCurrencyOptions();
      });
      await Promise.all([configPromise, loadStore(), loadCatalog(), loadLibraries(), loadOrders()]);
    } catch (error) {
      const heading = document.querySelector("#adminStoreName");
      const status = document.querySelector("#storeStatus");
      const needsLogin = error.status === 401;
      heading.textContent = needsLogin ? "سجّل الدخول لإدارة متجرك" : "تعذّر تحميل المتجر";
      status.textContent = needsLogin ? "دخول مطلوب" : "تعذّر الاتصال";
      status.classList.remove("active");
      status.classList.add("error");
      showNotice(notice, error.message, "error");
    }
  }

  async function initStore() {
    const slug = decodeURIComponent(location.pathname.split("/").filter(Boolean).at(-1));
    const loading = document.querySelector("#storeLoading");
    const app = document.querySelector("#storeApp");
    let catalog = { store: null, categories: [], products: [], pagination: { limit: 36, offset: 0, total: 0, hasMore: false } };
    let currentCategory = "";
    let currentRoot = "";
    let searchTerm = "";
    let previewMode = false;
    let selectedProduct = null;
    let selectedCurrency = null;
    const orderDialog = document.querySelector("#orderDialog");
    const orderForm = document.querySelector("#orderForm");
    const orderNotice = document.querySelector("#orderNotice");
    const productsSection = document.querySelector("#products");
    const moreDialog = document.querySelector("#storeMoreDialog");
    const homeIntro = document.querySelector(".store-home-intro");
    const categorySection = document.querySelector("#categories");
    const categoryContainer = document.querySelector("#storeCategories");
    const subcategoryPanel = document.querySelector("#storeSubcategoryPanel");
    const browseBack = document.querySelector("#storeBrowseBack");
    const cartDialog = document.querySelector("#storeCartDialog");
    const cartNotice = document.querySelector("#storeCartNotice");
    const cartStorageKey = `uchiha:cart:${slug}`;
    let browseMode = "home";
    let accountShell = null;
    let cart = [];
    try {
      const storedCart = JSON.parse(sessionStorage.getItem(cartStorageKey) || "[]");
      cart = Array.isArray(storedCart) ? storedCart.filter((item) => item && item.productId) : [];
    } catch {
      cart = [];
    }

    function displayMoney(minor, currency) {
      const target = selectedCurrency;
      if (
        target &&
        catalog.store &&
        currency === catalog.store.currency &&
        target.currency !== currency &&
        Number(target.rateToBase) > 0
      ) {
        const sourceMajor =
          Number(minor || 0) / currencyMinorFactor(currency);
        return formatCurrencyMajor(
          sourceMajor / Number(target.rateToBase),
          target.currency
        );
      }
      return money(minor, currency);
    }

    function accountRoute(route) {
      const mapping = {
        account: "account",
        wallet: "wallet",
        payments: "payments",
        orders: "orders",
        support: "support",
        telegram: "telegram",
        security: "security",
        identity: "identity",
        developer: "developer",
        about: "about"
      };
      return `/store/${encodeURIComponent(slug)}/${mapping[route] || "account"}`;
    }

    function persistCart() {
      sessionStorage.setItem(cartStorageKey, JSON.stringify(cart));
      renderCart();
    }

    function cartTotalMinor() {
      return cart.reduce((total, item) => total + Number(item.priceMinor || 0) * Number(item.quantity || 1), 0);
    }

    function renderCart() {
      const container = document.querySelector("#storeCartItems");
      const empty = document.querySelector("#storeCartEmpty");
      const badge = document.querySelector("#storeCartBadge");
      const total = document.querySelector("#storeCartTotal");
      const checkout = document.querySelector("#checkoutStoreCart");
      const count = cart.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
      badge.hidden = count < 1;
      badge.textContent = String(Math.min(count, 99));
      container.replaceChildren();
      empty.hidden = cart.length > 0;
      checkout.disabled = cart.length < 1;
      const currency = cart[0]?.currency || catalog.store?.currency || "USD";
      total.textContent = cart.length ? displayMoney(cartTotalMinor(), currency) : "—";
      for (const item of cart) {
        const remove = element("button", { type: "button", text: "حذف", className: "store-cart-remove" });
        remove.addEventListener("click", () => {
          cart = cart.filter((entry) => entry.productId !== item.productId);
          persistCart();
        });
        container.append(element("article", { className: "store-cart-item" }, [
          element("img", { attributes: { src: item.imageUrl || "/assets/catalog-assets/digital-card.svg", alt: "" } }),
          element("div", {}, [
            element("strong", { text: item.name }),
            element("small", { text: `الكمية: ${item.quantity}` }),
            element("b", { text: displayMoney(Number(item.priceMinor) * Number(item.quantity), item.currency) })
          ]),
          remove
        ]));
      }
    }

    function addSelectedProductToCart(values, inputData) {
      if (!selectedProduct) return;
      const item = {
        productId: selectedProduct.id,
        name: selectedProduct.name,
        imageUrl: selectedProduct.imageUrl || null,
        priceMinor: Number(selectedProduct.priceMinor),
        currency: selectedProduct.currency,
        quantity: Number(values.quantity || 1),
        inputData
      };
      const existingIndex = cart.findIndex((entry) => entry.productId === item.productId);
      if (existingIndex >= 0) cart.splice(existingIndex, 1, item);
      else cart.push(item);
      persistCart();
    }

    function openCart() {
      hideNotice(cartNotice);
      renderCart();
      if (typeof cartDialog.showModal === "function") cartDialog.showModal();
      else cartDialog.setAttribute("open", "");
    }

    async function hydrateAccountChrome() {
      try {
        accountShell = await api(`/api/public/stores/${encodeURIComponent(slug)}/account-shell`);
        const customer = accountShell.customer;
        const avatar = document.querySelector("#storeProfileAvatar");
        const balanceValue = document.querySelector("#storeBalanceValue");
        const balanceCurrency = document.querySelector("#storeBalanceCurrency");
        const drawerName = document.querySelector("#drawerCustomerName");
        const drawerId = document.querySelector("#drawerCustomerId");
        const drawerBalance = document.querySelector("#drawerBalance");
        const logout = document.querySelector("#drawerLogout");
        document.querySelector("#storeFloatingSupport").hidden = !accountShell.experience.floatingSupportEnabled;
        document.querySelector("#drawerIdentityLink").hidden = !accountShell.experience.identityVerificationEnabled;
        document.querySelector("#drawerDeveloperLink").hidden = !accountShell.experience.storefrontApiEnabled;
        document.querySelector("#drawerThemeToggle").hidden = !accountShell.experience.lightModeEnabled;
        const promo = document.querySelector("#drawerBuilderPromo");
        if (accountShell.experience.builderPromoUrl) {
          promo.href = accountShell.experience.builderPromoUrl;
          promo.hidden = false;
          if (accountShell.experience.builderPromoImageUrl) {
            promo.style.backgroundImage = `linear-gradient(rgba(0,0,0,.58),rgba(0,0,0,.76)),url(${JSON.stringify(accountShell.experience.builderPromoImageUrl).slice(1,-1)})`;
          }
        } else {
          promo.hidden = true;
        }
        if (!customer) {
          avatar.textContent = "؟";
          drawerName.textContent = "زائر";
          drawerId.textContent = "سجّل الدخول لمزامنة الرصيد والطلبات";
          balanceValue.textContent = "—";
          balanceCurrency.textContent = "";
          drawerBalance.textContent = "—";
          logout.hidden = true;
          return;
        }
        avatar.replaceChildren();
        if (customer.avatarUrl) {
          avatar.append(element("img", { attributes: { src: customer.avatarUrl, alt: `صورة ${customer.displayName}` } }));
        } else {
          avatar.textContent = customer.displayName?.trim().slice(0, 1) || "ح";
        }
        drawerName.textContent = customer.displayName || "حسابي";
        drawerId.textContent = `المعرف: ${customer.id}`;
        const hiddenBalance = customer.balanceHidden;
        const formattedBalance = hiddenBalance ? "••••" : money(customer.balanceMinor, customer.currency);
        balanceValue.textContent = hiddenBalance ? "••••" : (new Intl.NumberFormat("ar", { maximumFractionDigits: 2 }).format(Number(customer.balanceMinor || 0) / currencyMinorFactor(customer.currency)));
        balanceCurrency.textContent = customer.currency || "";
        drawerBalance.textContent = formattedBalance;
        logout.hidden = false;
        try {
          const wallet = await api(`/api/public/stores/${encodeURIComponent(slug)}/wallet`);
          const unread = wallet.notifications.filter((item) => !item.readAt).length;
          const badge = document.querySelector("#storeUnreadBadge");
          badge.hidden = unread < 1;
          badge.textContent = unread > 99 ? "99+" : String(unread);
        } catch {
          // Account shell remains usable when the optional wallet summary fails.
        }
      } catch {
        document.querySelector("#storeBalanceValue").textContent = "—";
      }
    }

    function renderCurrencySelector() {
      const selector = document.querySelector("#storeCurrencySelector");
      if (!selector || !catalog.store) return;
      const currencies = catalog.currencies?.length
        ? catalog.currencies
        : [{ currency: catalog.store.currency, isBase: true, rateToBase: 1, rateSource: "base" }];
      const saved = localStorage.getItem(`uchiha:currency:${slug}`);
      selectedCurrency =
        currencies.find((item) => item.currency === saved) ||
        currencies.find((item) => item.isBase) ||
        currencies[0];
      selector.replaceChildren();
      for (const setting of currencies) {
        const suffix = setting.isBase ? "الأساسية" : `محدثة ${new Date(setting.rateUpdatedAt).toLocaleDateString("ar")}`;
        selector.append(
          element("option", {
            text: `${setting.currency} — ${suffix}`,
            attributes: { value: setting.currency }
          })
        );
      }
      selector.value = selectedCurrency.currency;
    }

    function applyBanner(store) {
      const banner = catalog.banners?.[0] || {
        title: store.welcomeMessage || `مرحبًا بك في ${store.name}`,
        subtitle: store.description,
        mediaType: store.design.coverUrl ? "image" : "abstract",
        mediaUrl: store.design.coverUrl,
        linkUrl: "#categories",
        actionLabel: "استكشف الأقسام"
      };
      const link = document.querySelector("#storeMediaLink");
      const image = document.querySelector("#storeBannerImage");
      const video = document.querySelector("#storeBannerVideo");
      link.dataset.mediaType = banner.mediaType || "abstract";
      link.href = banner.linkUrl || "#categories";
      if (/^https:\/\//.test(link.href) && new URL(link.href).origin !== location.origin) {
        link.target = "_blank";
        link.rel = "noopener";
      } else {
        link.removeAttribute("target");
        link.removeAttribute("rel");
      }
      image.hidden = true;
      video.hidden = true;
      video.pause();
      video.removeAttribute("src");
      if (["image", "gif"].includes(banner.mediaType) && banner.mediaUrl) {
        image.src = banner.mediaUrl;
        image.alt = banner.title || `بانر ${store.name}`;
        image.hidden = false;
      } else if (banner.mediaType === "video" && banner.mediaUrl) {
        video.src = banner.mediaUrl;
        video.hidden = false;
        video.load();
        video.play().catch(() => undefined);
      }
      document.querySelector("#storeHeroTitle").textContent =
        banner.title || store.welcomeMessage || `مرحبًا بك في ${store.name}`;
      document.querySelector("#storeDescription").textContent = banner.subtitle || store.description || "";
      document.querySelector("#storeBannerAction").textContent =
        banner.actionLabel || (banner.linkUrl ? "فتح الرابط" : "استكشف الأقسام");
    }

    function applyDesign(store) {
      const design = store.design;
      const templateAliases = { digital: "gaming-digital", gaming: "gaming-digital", "modern-dark": "professional-dark", "tech-services": "professional-dark", "commerce-light": "modern-light", luxury: "professional-dark", general: "modern-light" };
      const templateKey = templateAliases[store.templateKey] || store.templateKey || "modern-light";
      const theme = document.documentElement.dataset.theme || "light";
      const templateIsDark = templateKey === "professional-dark" || templateKey === "gaming-digital";
      const useSavedPalette = (theme === "dark") === templateIsDark;
      const alternatePalette = theme === "dark"
        ? { backgroundColor: "#0b0c12", surfaceColor: "#15151d", textColor: "#f5f3f8", mutedTextColor: "#a8a4b2", borderColor: "#2b2a34" }
        : { backgroundColor: "#f8f7fb", surfaceColor: "#ffffff", textColor: "#1b1821", mutedTextColor: "#706c79", borderColor: "#e4e1e8" };
      const palette = useSavedPalette ? design : { ...design, ...alternatePalette };
      app.dataset.template = templateKey;
      app.dataset.buttonStyle = design.buttonStyle || "solid";
      app.dataset.cardStyle = design.cardStyle || "bordered";
      const variables = {
        "--store-primary": design.primaryColor,
        "--store-on-primary": accessibleTextColor(design.primaryColor),
        "--store-secondary": design.secondaryColor,
        "--store-background": palette.backgroundColor,
        "--store-surface": palette.surfaceColor,
        "--store-text": palette.textColor,
        "--store-muted": palette.mutedTextColor,
        "--store-border": palette.borderColor,
        "--store-success": design.successColor || "#16a34a",
        "--store-warning": design.warningColor || "#d97706",
        "--store-danger": design.dangerColor || "#dc2638",
        "--store-radius": design.borderRadius,
        "--store-font": design.fontFamily
      };
      for (const [name, value] of Object.entries(variables)) app.style.setProperty(name, value);
      document.title = store.name;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", design.primaryColor || "#11121a");
      if (design.faviconUrl) document.querySelector('link[rel="icon"]')?.setAttribute("href", design.faviconUrl);
      document.querySelector("#storeName").textContent = store.name;
      document.querySelector("#storeTagline").textContent = store.activityType;
      document.querySelector("#storeTextLogo").textContent = store.name.trim().slice(0, 1);
      document.querySelector("#footerStoreName").textContent = store.name;
      document.querySelector("#drawerStoreName").textContent = store.name;
      document.querySelector("#drawerLogo").textContent = store.name.trim().slice(0, 1);
      const logo = document.querySelector("#storeLogoImage");
      const textLogo = document.querySelector("#storeTextLogo");
      if (design.logoUrl) {
        logo.src = design.logoUrl;
        logo.alt = `شعار ${store.name}`;
        logo.hidden = false;
        textLogo.hidden = true;
      } else {
        logo.hidden = true;
        textLogo.hidden = false;
      }
      applyBanner(store);
    }

    window.addEventListener("uchiha:theme-change", () => {
      if (catalog.store) applyDesign(catalog.store);
    });

    function categoryName(categoryId) {
      return catalog.categories.find((category) => category.id === categoryId)?.name || "";
    }

    function resetLoadedProducts() {
      catalog.products = [];
      catalog.pagination = { limit: 36, offset: 0, total: 0, hasMore: false };
    }

    function setBrowseMode(mode, { scroll = false, focus = false } = {}) {
      browseMode = mode;
      app.dataset.browseMode = mode;
      const isHome = mode === "home";
      const isCategory = mode === "category";
      const isProducts = mode === "products" || mode === "search";
      const categoryTitle = document.querySelector("#categorySectionTitle");
      const categoryEyebrow = document.querySelector("#categorySectionEyebrow");
      const categoryDescription = document.querySelector("#categorySectionDescription");
      const selectedRootName = categoryName(currentRoot);

      homeIntro.hidden = !isHome;
      categorySection.hidden = isProducts;
      categoryContainer.hidden = !isHome;
      productsSection.hidden = !isProducts;
      browseBack.hidden = isHome;
      const selectedChildren = currentRoot
        ? catalog.categories.filter((category) => category.parentId === currentRoot)
        : [];
      subcategoryPanel.hidden = !isCategory || !selectedChildren.length;

      if (isCategory) {
        categoryEyebrow.textContent = "الأقسام";
        categoryTitle.textContent = selectedRootName || "اختر القسم الفرعي";
        categoryDescription.textContent = "اختر الخدمة التي تريدها للانتقال إلى المنتجات.";
        browseBack.setAttribute("aria-label", "العودة إلى كل الأقسام");
      } else {
        categoryEyebrow.textContent = "تسوّق بسهولة";
        categoryTitle.textContent = "اختر قسمك";
        categoryDescription.textContent = "ابدأ بالقسم المناسب، وبعدها اختر الخدمة التي تحتاجها.";
        browseBack.setAttribute(
          "aria-label",
          mode === "search"
            ? "العودة إلى الصفحة الرئيسية"
            : currentRoot && currentCategory && currentRoot !== currentCategory
              ? `العودة إلى ${selectedRootName}`
              : "العودة إلى كل الأقسام"
        );
      }

      const productsBack = document.querySelector("#backToCategories");
      if (productsBack) {
        productsBack.textContent =
          currentRoot && currentCategory && currentRoot !== currentCategory
            ? `العودة إلى ${selectedRootName}`
            : "العودة للأقسام";
      }

      if (!scroll && !focus) return;
      const target = isHome ? categorySection : isCategory ? categorySection : productsSection;
      window.requestAnimationFrame(() => {
        if (scroll) target.scrollIntoView({ behavior: "smooth", block: "start" });
        if (focus) {
          const heading = isProducts
            ? document.querySelector("#productsHeading")
            : document.querySelector("#categorySectionTitle");
          window.setTimeout(() => heading?.focus({ preventScroll: true }), scroll ? 350 : 0);
        }
      });
    }

    function clearCategorySelection({ scroll = false, clearSearch = true } = {}) {
      currentRoot = "";
      currentCategory = "";
      resetLoadedProducts();
      if (clearSearch) {
        searchTerm = "";
        document.querySelector("#storeSearch").value = "";
      }
      renderCategories();
      setBrowseMode("home", { scroll, focus: scroll });
    }

    function navigateBack() {
      const isNestedCategory =
        browseMode === "products" &&
        currentRoot &&
        currentCategory &&
        currentRoot !== currentCategory;
      if (isNestedCategory) {
        currentCategory = "";
        resetLoadedProducts();
        renderCategories();
        setBrowseMode("category", { scroll: true, focus: true });
        return;
      }
      clearCategorySelection({ scroll: true });
    }

    function renderCategories() {
      const subcategoryList = document.querySelector("#storeSubcategories");
      const roots = catalog.categories.filter((category) => !category.parentId);
      categoryContainer.replaceChildren();
      for (const category of roots) {
        const image = category.imageUrl
          ? element("img", { attributes: { src: category.imageUrl, alt: "" } })
          : element("span", { className: "category-monogram", text: category.name.trim().slice(0, 1) });
        const childrenCount = catalog.categories.filter((item) => item.parentId === category.id).length;
        const button = element("button", {
          type: "button",
          className: "store-category-card",
          dataset: { category: category.id },
          attributes: {
            "aria-pressed": String(currentRoot === category.id),
            "aria-label": childrenCount
              ? `فتح قسم ${category.name}، يتضمن ${childrenCount} أقسام فرعية`
              : `فتح منتجات ${category.name}`
          }
        }, [
          element("span", { className: "category-card-visual" }, [image]),
          element("span", { className: "category-card-copy" }, [
            element("strong", { text: category.name }),
            element("small", {
              text: childrenCount ? `${childrenCount} أقسام` : "تصفّح القسم"
            })
          ])
        ]);
        button.classList.toggle("active", currentRoot === category.id);
        button.addEventListener("click", () => {
          currentRoot = category.id;
          searchTerm = "";
          document.querySelector("#storeSearch").value = "";
          if (childrenCount) {
            currentCategory = "";
            resetLoadedProducts();
            renderCategories();
            setBrowseMode("category", { scroll: true, focus: true });
          } else {
            currentCategory = category.id;
            renderCategories();
            setBrowseMode("products", { scroll: true });
            loadStoreProducts(true)
              .then(() => document.querySelector("#productsHeading")?.focus({ preventScroll: true }))
              .catch((error) => showNotice(orderNotice, error.message, "error"));
          }
        });
        categoryContainer.append(button);
      }

      if (!roots.length) {
        categoryContainer.append(element("p", { className: "empty-state", text: "ستظهر الأقسام هنا بعد إضافتها." }));
      }

      const selectedRoot = roots.find((category) => category.id === currentRoot);
      const selectedChildren = selectedRoot
        ? catalog.categories.filter((category) => category.parentId === selectedRoot.id)
        : [];
      subcategoryPanel.hidden = browseMode !== "category" || !selectedRoot || !selectedChildren.length;
      subcategoryList.replaceChildren();
      if (!selectedRoot || !selectedChildren.length) return;
      for (const category of selectedChildren) {
        const image = category.imageUrl
          ? element("img", { attributes: { src: category.imageUrl, alt: "", loading: "lazy" } })
          : element("span", { className: "category-monogram", text: category.name.trim().slice(0, 1) });
        const button = element("button", {
          type: "button",
          attributes: { "aria-label": `فتح منتجات ${category.name}` }
        }, [
          element("span", { className: "subcategory-visual" }, [image]),
          element("strong", { text: category.name })
        ]);
        button.classList.toggle("active", currentCategory === category.id);
        button.addEventListener("click", () => {
          currentCategory = category.id;
          renderCategories();
          setBrowseMode("products", { scroll: true });
          loadStoreProducts(true)
            .then(() => document.querySelector("#productsHeading")?.focus({ preventScroll: true }))
            .catch((error) => showNotice(orderNotice, error.message, "error"));
        });
        subcategoryList.append(button);
      }
    }

    function openOrder(product, mode = "purchase") {
      selectedProduct = product;
      orderForm.reset();
      orderForm.dataset.mode = mode;
      const customerNameLabel = orderForm.elements.customerName.closest("label");
      const customerEmailLabel = orderForm.elements.customerEmail.closest("label");
      customerNameLabel.hidden = mode === "cart";
      customerEmailLabel.hidden = mode === "cart";
      orderForm.elements.customerName.required = mode !== "cart";
      if (accountShell?.customer) {
        orderForm.elements.customerName.value = accountShell.customer.displayName || "";
        orderForm.elements.customerEmail.value = accountShell.customer.email || "";
      }
      orderForm.elements.productId.value = product.id;
      orderForm.elements.quantity.min = product.minimumQuantity;
      orderForm.elements.quantity.max = product.maximumQuantity || "";
      orderForm.elements.quantity.value = product.minimumQuantity;
      document.querySelector("#orderProductName").textContent = product.name;
      document.querySelector("#orderProductDescription").textContent = product.description;
      document.querySelector("#orderProductImage").src =
        product.imageUrl || "/assets/catalog-assets/digital-card.svg";
      document.querySelector("#orderProductImage").alt = product.name;
      document.querySelector("#orderTotal").textContent = displayMoney(
        product.priceMinor * product.minimumQuantity,
        product.currency
      );
      const fields = document.querySelector("#orderDynamicFields");
      fields.replaceChildren();
      for (const field of product.fields || []) {
        const key = String(field.key || field.name || "").trim();
        if (!key) continue;
        const choices = Array.isArray(field.options) ? field.options : Array.isArray(field.choices) ? field.choices : [];
        let input;
        if (choices.length) {
          input = element("select", {
            attributes: { name: `input_${key}`, required: field.required ? "" : null }
          });
          input.append(element("option", { text: "اختر" , attributes: { value: "" } }));
          for (const choice of choices) {
            const value = typeof choice === "object" ? choice.value ?? choice.id ?? choice.label : choice;
            const label = typeof choice === "object" ? choice.label ?? choice.name ?? value : choice;
            input.append(element("option", { text: String(label), attributes: { value: String(value) } }));
          }
        } else if (field.type === "textarea") {
          input = element("textarea", {
            attributes: {
              name: `input_${key}`,
              required: field.required ? "" : null,
              maxlength: String(field.maxLength || 2000),
              rows: "4"
            }
          });
        } else {
          const supportedType = ["number", "email", "url", "tel"].includes(field.type) ? field.type : "text";
          input = element("input", {
            type: supportedType,
            attributes: {
              name: `input_${key}`,
              required: field.required ? "" : null,
              maxlength: supportedType === "number" ? null : String(field.maxLength || 500),
              min: field.minimum ?? null,
              max: field.maximum ?? null,
              inputmode: field.inputMode || null
            }
          });
        }
        fields.append(element("label", { text: field.label || key }, [input]));
      }
      const submitButton = orderForm.querySelector('button[value="submit"]');
      submitButton.disabled = false;
      submitButton.textContent = mode === "cart" ? "إضافة إلى السلة" : "إنشاء الطلب";
      document.querySelector("#testPaymentField").hidden = mode === "cart" || document.querySelector("#testPaymentField").dataset.demoMode !== "true";
      orderForm.dispatchEvent(new CustomEvent("uchiha:order-opened"));
      hideNotice(orderNotice);
      orderDialog.showModal();
    }

    function renderProducts() {
      const container = document.querySelector("#storeProducts");
      const trail = document.querySelector("#storeCategoryTrail");
      const heading = document.querySelector("#productsHeading");
      const summary = document.querySelector("#productsSummary");
      if (searchTerm) {
        trail.textContent = "نتائج البحث";
        heading.textContent = `نتائج: ${searchTerm}`;
      } else if (currentCategory && currentRoot !== currentCategory) {
        trail.textContent = `${categoryName(currentRoot)} / ${categoryName(currentCategory)}`;
        heading.textContent = categoryName(currentCategory);
      } else if (currentRoot) {
        trail.textContent = "القسم الرئيسي";
        heading.textContent = categoryName(currentRoot);
      } else {
        trail.textContent = "داخل الأقسام";
        heading.textContent = "المنتجات والخدمات";
      }
      const total = Number(catalog.pagination?.total || 0);
      summary.textContent = `عرض ${catalog.products.length} من ${total} عنصر متاح`;
      document.querySelector("#storeProductsMore").hidden = !catalog.pagination?.hasMore;
      container.replaceChildren();
      if (!catalog.products.length) {
        container.append(
          element("div", { className: "empty-state store-empty-state" }, [
            element("span", { text: "◇" }),
            element("strong", { text: "لا توجد نتائج هنا بعد" }),
            element("p", {
              text: searchTerm
                ? "جرّب كلمة أقصر أو ارجع إلى الأقسام."
                : "سيضيف المتجر منتجات هذا القسم قريبًا."
            })
          ])
        );
        return;
      }
      const typeLabels = { digital: "منتج رقمي", physical: "منتج مادي", service: "خدمة", subscription: "اشتراك", code: "كود", account: "حساب", game_topup: "شحن لعبة", api_service: "خدمة رقمية", programming_service: "خدمة برمجة" };
      for (const product of catalog.products) {
        const visual = element("div", { className: "product-visual" }, [
          element("img", { attributes: { src: product.imageUrl || "/assets/catalog-assets/digital-card.svg", alt: product.name, loading: "lazy" } })
        ]);
        const buyButton = element("button", {
          type: "button",
          text: "شراء الآن",
          attributes: { "aria-label": `شراء ${product.name}` }
        });
        const cartButton = element("button", {
          type: "button",
          className: "store-add-cart",
          text: "أضف للسلة",
          attributes: { "aria-label": `إضافة ${product.name} إلى السلة` }
        });
        buyButton.addEventListener("click", () => openOrder(product, "purchase"));
        cartButton.addEventListener("click", () => openOrder(product, "cart"));
        const category = categoryName(product.categoryId);
        container.append(element("article", { className: "store-product-card" }, [
          visual,
          element("div", { className: "product-body" }, [
            element("div", { className: "product-meta-line" }, [
              element("span", { className: "product-kind", text: typeLabels[product.type] || "منتج" }),
              category ? element("small", { text: category }) : null
            ].filter(Boolean)),
            element("h3", { text: product.name }),
            element("p", { text: product.description }),
            element("div", { className: "product-footer" }, [
              element("strong", { text: displayMoney(product.priceMinor, product.currency) }),
              element("span", { className: "product-actions" }, [cartButton, buyButton])
            ])
          ])
        ]));
      }
    }

    async function loadStoreProducts(reset = true) {
      const offset = reset ? 0 : catalog.products.length;
      const parameters = new URLSearchParams({ limit: "36", offset: String(offset) });
      if (previewMode) parameters.set("preview", "1");
      if (searchTerm) parameters.set("query", searchTerm);
      if (currentCategory || currentRoot) parameters.set("categoryId", currentCategory || currentRoot);
      setBrowseMode(searchTerm ? "search" : "products");
      if (reset) {
        document.querySelector("#storeProducts").replaceChildren(
          ...Array.from({ length: 6 }, () =>
            element("article", { className: "store-product-skeleton" })
          )
        );
      }
      const data = await api(`/api/storefront/${encodeURIComponent(slug)}?${parameters}`);
      catalog = {
        ...data,
        products: reset ? data.products : [...catalog.products, ...data.products]
      };
      applyDesign(catalog.store);
      renderCategories();
      renderProducts();
      setBrowseMode(searchTerm ? "search" : "products");
    }

    async function loadStoreShell() {
      const parameters = new URLSearchParams({ catalogOnly: "1", limit: "1", offset: "0" });
      if (previewMode) parameters.set("preview", "1");
      const data = await api(`/api/storefront/${encodeURIComponent(slug)}?${parameters}`);
      catalog = {
        ...data,
        products: [],
        pagination: { limit: 36, offset: 0, total: 0, hasMore: false }
      };
      applyDesign(catalog.store);
      renderCurrencySelector();
      renderCategories();
      setBrowseMode("home");
    }

    let storeSearchTimer;
    document.querySelector("#storeSearch").addEventListener("input", (event) => {
      searchTerm = event.target.value.trim().toLocaleLowerCase("ar");
      clearTimeout(storeSearchTimer);
      storeSearchTimer = setTimeout(() => {
        if (!searchTerm) {
          clearCategorySelection({ clearSearch: false });
          return;
        }
        currentRoot = "";
        currentCategory = "";
        renderCategories();
        setBrowseMode("search");
        loadStoreProducts(true).catch((error) => showNotice(orderNotice, error.message, "error"));
      }, 300);
    });
    document.querySelector("#storeProductsMore").addEventListener("click", () => {
      loadStoreProducts(false).catch((error) => showNotice(orderNotice, error.message, "error"));
    });

    browseBack.addEventListener("click", navigateBack);
    document.querySelector("#backToCategories").addEventListener("click", navigateBack);
    for (const link of document.querySelectorAll("[data-store-home]")) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        clearCategorySelection();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }
    for (const link of document.querySelectorAll("[data-store-categories]")) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        clearCategorySelection({ scroll: true });
      });
    }
    function focusStoreSearch() {
      const input = document.querySelector("#storeSearch");
      input.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => input.focus(), 350);
    }
    document.querySelector("#storeSearchTrigger")?.addEventListener("click", focusStoreSearch);
    document.querySelector("#mobileSearch")?.addEventListener("click", focusStoreSearch);

    document.querySelector("#storeCurrencySelector")?.addEventListener("change", (event) => {
      selectedCurrency =
        catalog.currencies?.find((item) => item.currency === event.target.value) || selectedCurrency;
      if (selectedCurrency) {
        localStorage.setItem(`uchiha:currency:${slug}`, selectedCurrency.currency);
      }
      if (!productsSection.hidden) renderProducts();
      if (selectedProduct) {
        const quantity = Number(orderForm.elements.quantity.value || 1);
        document.querySelector("#orderTotal").textContent = displayMoney(
          selectedProduct.priceMinor * quantity,
          selectedProduct.currency
        );
      }
    });

    function openMoreDialog() {
      if (typeof moreDialog.showModal === "function") moreDialog.showModal();
      else moreDialog.setAttribute("open", "");
    }
    document.querySelector("#storeMoreTrigger")?.addEventListener("click", openMoreDialog);
    document.querySelector("#mobileMore")?.addEventListener("click", openMoreDialog);
    document.querySelector("#closeStoreMore")?.addEventListener("click", () => moreDialog.close());
    moreDialog?.addEventListener("click", (event) => {
      if (event.target === moreDialog) moreDialog.close();
    });

    document.querySelector("#storeCartTrigger")?.addEventListener("click", openCart);
    document.querySelector("#closeStoreCart")?.addEventListener("click", () => cartDialog.close());
    cartDialog?.addEventListener("click", (event) => {
      if (event.target === cartDialog) cartDialog.close();
    });
    document.querySelector("#clearStoreCart")?.addEventListener("click", () => {
      if (!cart.length || window.confirm("هل تريد تفريغ السلة؟")) {
        cart = [];
        persistCart();
        hideNotice(cartNotice);
      }
    });
    document.querySelector("#checkoutStoreCart")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (!cart.length) return;
      button.disabled = true;
      const original = button.textContent;
      button.textContent = "جارٍ التحقق من الرصيد...";
      hideNotice(cartNotice);
      try {
        const session = await api(`/api/public/stores/${encodeURIComponent(slug)}/customer/me`);
        const result = await api(`/api/public/stores/${encodeURIComponent(slug)}/orders/wallet`, {
          method: "POST",
          headers: {
            "x-customer-csrf-token": session.csrfToken,
            "idempotency-key": crypto.randomUUID()
          },
          body: {
            items: cart.map((item) => ({
              productId: item.productId,
              quantity: Number(item.quantity),
              inputData: item.inputData || {}
            }))
          }
        });
        cart = [];
        persistCart();
        showNotice(cartNotice, `تم الدفع من المحفظة وإنشاء الطلب ${result.order.orderNumber}.`, "success");
        button.textContent = "تم إنشاء الطلب";
        await hydrateAccountChrome();
      } catch (error) {
        if (error.status === 401) {
          const next = `${location.pathname}${location.search}#cart`;
          location.href = `${accountRoute("account")}?next=${encodeURIComponent(next)}`;
          return;
        }
        showNotice(cartNotice, error.message, "error");
        button.disabled = false;
        button.textContent = original;
      }
    });
    document.querySelector("#drawerLogout")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (!window.confirm("هل تريد تسجيل الخروج من هذا الجهاز؟")) return;
      button.disabled = true;
      try {
        const session = await api(`/api/public/stores/${encodeURIComponent(slug)}/customer/me`);
        await api(`/api/public/stores/${encodeURIComponent(slug)}/customers/logout`, {
          method: "POST",
          headers: { "x-customer-csrf-token": session.csrfToken }
        });
        accountShell = null;
        location.reload();
      } catch (error) {
        button.disabled = false;
        window.alert(error.message);
      }
    });
    if (location.hash === "#cart") window.setTimeout(openCart, 0);

    orderForm.elements.quantity.addEventListener("input", () => {
      if (!selectedProduct) return;
      const quantity = Number(orderForm.elements.quantity.value || 1);
      document.querySelector("#orderTotal").textContent = displayMoney(
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
      if (orderForm.dataset.mode === "cart") {
        if (!orderForm.reportValidity()) return;
        addSelectedProductToCart(values, inputs);
        showNotice(orderNotice, "تمت إضافة المنتج إلى السلة. يمكنك متابعة التسوق أو فتح السلة.", "success");
        window.setTimeout(() => orderDialog.close(), 500);
        return;
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
      const testPaymentField = document.querySelector("#testPaymentField");
      testPaymentField.dataset.demoMode = String(Boolean(config.demoMode));
      testPaymentField.hidden = !config.demoMode;
      try {
        await loadStoreShell();
      } catch (error) {
        if (error.status !== 404) throw error;
        previewMode = true;
        await loadStoreShell();
      }
      renderCart();
      hydrateAccountChrome();
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
