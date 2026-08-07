(() => {
  "use strict";

  const boot = window.__uchihaStoreBoot || (window.__uchihaStoreBoot = { release: "unknown", phase: "boot-guard", errors: [] });
  const record = (kind, value) => {
    const message = value instanceof Error ? value.message : String(value || kind);
    boot.errors = Array.isArray(boot.errors) ? boot.errors : [];
    boot.errors.push({ kind, message, at: Date.now() });
    if (boot.errors.length > 12) boot.errors.shift();
  };

  window.addEventListener("error", (event) => record("error", event.error || event.message));
  window.addEventListener("unhandledrejection", (event) => record("unhandledrejection", event.reason));

  function slugFromLocation() {
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts[0] === "store" && parts[1]) return decodeURIComponent(parts[1]);
    if (location.hostname.toLowerCase().startsWith("demo.")) return "demo";
    return "";
  }

  function money(minor, currency) {
    const amount = Number(minor || 0) / 100;
    try {
      return new Intl.NumberFormat("ar", { style: "currency", currency: currency || "USD" }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${currency || "USD"}`;
    }
  }

  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showFatal(message) {
    const loading = document.querySelector("#storeLoading");
    if (!loading) return;
    const orbit = loading.querySelector(".store-loader-orbit");
    const target = loading.querySelector("#storeLoadingError");
    if (orbit) orbit.hidden = true;
    if (target) {
      target.textContent = message || "تعذر تشغيل واجهة المتجر. حاول إعادة تحميل الصفحة.";
      target.hidden = false;
    }
  }

  function renderProducts(data, categoryName) {
    const section = document.querySelector("#products");
    const homeIntro = document.querySelector(".store-home-intro");
    const categories = document.querySelector("#categories");
    const container = document.querySelector("#storeProducts");
    const heading = document.querySelector("#productsHeading");
    const summary = document.querySelector("#productsSummary");
    if (!section || !container) return;
    if (homeIntro) homeIntro.hidden = true;
    if (categories) categories.hidden = true;
    section.hidden = false;
    if (heading) heading.textContent = categoryName || "المنتجات والخدمات";
    if (summary) summary.textContent = `عرض ${data.products?.length || 0} منتج`;
    container.replaceChildren();
    for (const product of data.products || []) {
      const card = create("article", "store-product-card");
      const visual = create("div", "product-visual");
      const image = document.createElement("img");
      image.src = product.imageUrl || "/assets/catalog-assets/digital-card.svg";
      image.alt = product.name || "";
      visual.append(image);
      const body = create("div", "product-body");
      body.append(create("h3", "", product.name || "منتج"));
      body.append(create("p", "", product.description || ""));
      const footer = create("div", "product-footer");
      footer.append(create("strong", "", money(product.priceMinor, product.currency)));
      body.append(footer);
      card.append(visual, body);
      container.append(card);
    }
    if (!container.children.length) container.append(create("p", "empty-state", "لا توجد منتجات في هذا القسم حالياً."));
  }

  async function recover() {
    const loading = document.querySelector("#storeLoading");
    const app = document.querySelector("#storeApp");
    if (!loading || !app || loading.hidden || !app.hidden) return;
    const slug = slugFromLocation();
    if (!slug) return;
    boot.phase = "recovery";
    try {
      const response = await fetch(`/api/storefront/${encodeURIComponent(slug)}?catalogOnly=1&limit=1&offset=0`, {
        credentials: "same-origin",
        headers: { accept: "application/json" }
      });
      if (!response.ok) throw new Error(`Storefront API ${response.status}`);
      const data = await response.json();
      if (!data?.store) throw new Error("Storefront payload is incomplete");

      const store = data.store;
      const setText = (selector, value) => {
        const node = document.querySelector(selector);
        if (node) node.textContent = value || "";
      };
      setText("#storeName", store.name);
      setText("#drawerStoreName", store.name);
      setText("#footerStoreName", store.name);
      setText("#storeTagline", store.activityType || "متجر رقمي");
      setText("#storeHeroTitle", store.welcomeMessage || `مرحباً بك في ${store.name}`);
      setText("#storeDescription", store.description || "");

      const logo = document.querySelector("#storeLogoImage");
      const textLogo = document.querySelector("#storeTextLogo");
      if (logo && store.design?.logoUrl) {
        logo.src = store.design.logoUrl;
        logo.alt = `شعار ${store.name}`;
        logo.hidden = false;
        if (textLogo) textLogo.hidden = true;
      } else if (textLogo) {
        textLogo.textContent = store.name.trim().slice(0, 1) || "U";
        textLogo.hidden = false;
      }

      const categoryContainer = document.querySelector("#storeCategories");
      if (categoryContainer) {
        const roots = (data.categories || []).filter((category) => !category.parentId);
        categoryContainer.replaceChildren();
        for (const category of roots) {
          const button = create("button", "store-category-card");
          button.type = "button";
          const visual = create("span", "category-card-visual");
          if (category.imageUrl) {
            const image = document.createElement("img");
            image.src = category.imageUrl;
            image.alt = "";
            visual.append(image);
          }
          const copy = create("span", "category-card-copy");
          copy.append(create("strong", "", category.name));
          copy.append(create("small", "", "تصفح القسم"));
          button.append(visual, copy);
          button.addEventListener("click", async () => {
            try {
              const productsResponse = await fetch(`/api/storefront/${encodeURIComponent(slug)}?limit=36&offset=0&categoryId=${encodeURIComponent(category.id)}`, {
                credentials: "same-origin",
                headers: { accept: "application/json" }
              });
              if (!productsResponse.ok) throw new Error(`Products API ${productsResponse.status}`);
              renderProducts(await productsResponse.json(), category.name);
            } catch (error) {
              record("recovery-products", error);
              showFatal("تعذر تحميل منتجات القسم. أعد المحاولة بعد لحظات.");
            }
          });
          categoryContainer.append(button);
        }
      }

      loading.hidden = true;
      app.hidden = false;
      document.body.dataset.storeBootRecovered = "true";
      boot.phase = "recovered";
    } catch (error) {
      record("recovery", error);
      boot.phase = "failed";
      showFatal("تعذر تشغيل المتجر حالياً. تم تسجيل الخطأ تلقائياً للمراجعة.");
    }
  }

  function arm() {
    window.setTimeout(() => {
      const loading = document.querySelector("#storeLoading");
      const app = document.querySelector("#storeApp");
      if (loading && app && !loading.hidden && app.hidden) recover();
    }, 4500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arm, { once: true });
  else arm();
})();
