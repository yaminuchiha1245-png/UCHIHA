(() => {
  "use strict";

  const state = {
    me: null,
    csrf: "",
    product: null,
    wallet: null,
    instances: [],
    selected: null,
    detail: null,
    platformAdmin: null
  };

  const $ = (selector) => document.querySelector(selector);

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function api(path, { method = "GET", body, headers = {} } = {}) {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || "تعذر إكمال العملية");
      error.status = response.status;
      error.code = payload.error;
      throw error;
    }
    return payload;
  }

  function mutation(path, options = {}) {
    return api(path, {
      ...options,
      headers: { "x-csrf-token": state.csrf, ...(options.headers || {}) }
    });
  }

  function money(minor, currency = "USD") {
    if (minor === null || minor === undefined) return "لم يُحدد بعد";
    let digits = 2;
    try {
      digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
      return new Intl.NumberFormat("ar", { style: "currency", currency }).format(Number(minor) / (10 ** digits));
    } catch {
      return `${(Number(minor) / 100).toFixed(2)} ${currency}`;
    }
  }

  function amountFromMinor(minor, currency = "USD") {
    let digits = 2;
    try {
      digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    } catch {
      digits = 2;
    }
    return Number(minor || 0) / (10 ** digits);
  }

  function minorFromAmount(amount, currency = "USD") {
    let digits = 2;
    try {
      digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    } catch {
      digits = 2;
    }
    return Math.round(Number(amount || 0) * (10 ** digits));
  }

  function toast(message, error = false) {
    const node = $("#toast");
    node.textContent = message;
    node.classList.toggle("error", error);
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.hidden = true; }, 4200);
  }

  function statusLabel(status) {
    const labels = {
      awaiting_token: "بانتظار Telegram Token",
      validated: "تم التحقق",
      provisioning: "قيد التجهيز",
      active: "فعال",
      paused: "متوقف مؤقتًا",
      failed: "تعذر التشغيل",
      revoked: "ملغي"
    };
    return labels[status] || status || "غير معروف";
  }

  function renderProduct() {
    const product = state.product || {};
    $("#productTitle").textContent = product.name || "بوت ذكاء اصطناعي";
    $("#productDescription").textContent = product.description || "بوت Telegram جاهز للبيع يعمل من خدمة UCHIHA AI المركزية.";
    $("#productPrice").textContent = product.priceConfigured ? money(product.priceMinor, product.currency) : "السعر غير محدد";
    const features = Array.isArray(product.features) ? product.features : [];
    $("#productFeatures").innerHTML = features.map((item) => `<li>${escapeHtml(item)}</li>`).join("");

    const provider = $("#providerState");
    provider.textContent = product.providerReady ? "الذكاء المركزي جاهز" : "OpenAI غير مربوط";
    provider.className = `ai-pill ${product.providerReady ? "good" : "bad"}`;
    const productState = $("#productState");
    productState.textContent = product.available ? "المنتج متاح" : "المنتج غير متاح";
    productState.className = `ai-pill ${product.available ? "good" : "warn"}`;

    const loggedIn = Boolean(state.me?.user);
    $("#loginButton").hidden = loggedIn;
    $("#purchaseForm").hidden = !loggedIn;
    const buy = $("#purchaseButton");
    buy.disabled = !product.available || !product.priceConfigured || !product.providerReady;
    if (!loggedIn) {
      $("#walletBalance").textContent = "سجّل الدخول لعرض رصيد UCHIHA.";
    } else {
      $("#walletBalance").textContent = `رصيدك المتاح: ${money(state.wallet?.availableMinor || 0, state.wallet?.currency || product.currency)}`;
    }
  }

  function renderInstances() {
    const section = $("#instancesSection");
    if (!state.me?.user) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    const grid = $("#instancesGrid");
    if (!state.instances.length) {
      grid.innerHTML = '<div class="ai-empty">لم تشترِ أي بوت ذكاء اصطناعي حتى الآن.</div>';
      return;
    }
    grid.innerHTML = state.instances.map((instance) => `
      <button class="ai-instance-card${state.selected === instance.id ? " active" : ""}" type="button" data-instance="${escapeHtml(instance.id)}">
        <span class="ai-status ${escapeHtml(instance.status)}">${escapeHtml(statusLabel(instance.status))}</span>
        <h3>${escapeHtml(instance.displayName)}</h3>
        <p>${instance.telegramUsername ? `@${escapeHtml(instance.telegramUsername)}` : "لم يتم ربط Telegram بعد"}</p>
        <p>${escapeHtml(instance.tokenMasked || "Token غير مضاف")}</p>
      </button>`).join("");
    grid.querySelectorAll("[data-instance]").forEach((button) => {
      button.addEventListener("click", () => selectInstance(button.dataset.instance));
    });
  }

  function statCard(label, value) {
    return `<article class="ai-stat"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></article>`;
  }

  function renderModels(instance) {
    const models = instance.models || [];
    $("#modelsGrid").innerHTML = models.map((model) => `
      <form class="ai-model-card${model.accessLevel === "pro" ? " pro" : ""}" data-model="${escapeHtml(model.slug)}">
        <div class="ai-model-head"><h4>${escapeHtml(model.displayName)}</h4><span class="ai-model-badge">${model.accessLevel === "pro" ? "PRO" : "FREE"}</span></div>
        <div class="ai-model-fields">
          <label>الاسم الظاهر<input name="displayName" maxlength="120" value="${escapeHtml(model.displayName)}"></label>
          <label>الوصول<select name="accessLevel"><option value="free"${model.accessLevel === "free" ? " selected" : ""}>مجاني</option><option value="pro"${model.accessLevel === "pro" ? " selected" : ""}>PRO</option></select></label>
          <label>مستوى الذكاء<input name="intelligenceLabel" maxlength="120" value="${escapeHtml(model.intelligenceLabel)}"></label>
          <label>التحليل<input name="analysisLabel" maxlength="120" value="${escapeHtml(model.analysisLabel)}"></label>
          <label>الصور<input name="imageQualityLabel" maxlength="120" value="${escapeHtml(model.imageQualityLabel)}"></label>
          <label>البرمجة<input name="codingLabel" maxlength="120" value="${escapeHtml(model.codingLabel)}"></label>
          <label>التعليم<input name="educationLabel" maxlength="120" value="${escapeHtml(model.educationLabel)}"></label>
          <label>حد طول الرد<input name="maxOutputTokens" type="number" min="128" max="8192" value="${Number(model.maxOutputTokens || 1200)}"></label>
        </div>
        <label class="ai-check"><input name="enabled" type="checkbox"${model.enabled ? " checked" : ""}> إظهار النموذج</label>
        <label class="ai-check"><input name="imageEnabled" type="checkbox"${model.imageEnabled ? " checked" : ""}> تفعيل إنشاء الصور</label>
        <button class="ai-button ai-primary ai-small" type="submit">حفظ النموذج</button>
      </form>`).join("");

    $("#modelsGrid").querySelectorAll("[data-model]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form).entries());
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
          await mutation(`/api/platform/ai-bots/${state.selected}/models/${encodeURIComponent(form.dataset.model)}`, {
            method: "PATCH",
            body: {
              ...values,
              enabled: form.elements.enabled.checked,
              imageEnabled: form.elements.imageEnabled.checked,
              maxOutputTokens: Number(values.maxOutputTokens)
            }
          });
          toast("تم حفظ إعدادات النموذج");
          await selectInstance(state.selected, { quiet: true });
        } catch (error) {
          toast(error.message, true);
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  function renderUsers(users) {
    const mount = $("#usersList");
    if (!users.length) {
      mount.innerHTML = '<div class="ai-empty">لم يبدأ أي مستخدم البوت بعد.</div>';
      return;
    }
    mount.innerHTML = users.map((user) => `
      <article class="ai-user-row" data-user="${escapeHtml(user.telegramUserId)}">
        <div class="ai-user-main"><b>${escapeHtml(user.fullName || user.username || user.telegramUserId)}</b><small>${user.username ? `@${escapeHtml(user.username)}` : "بدون username"} · ID ${escapeHtml(user.telegramUserId)}</small></div>
        <div class="ai-user-meta">${user.isPro ? `<span class="ai-success">PRO</span>` : "مجاني"}<br>${escapeHtml(user.activeModelSlug || "—")}</div>
        <div class="ai-user-meta">${Number(user.requestCount || 0)} طلب<br>${user.isBanned ? '<span class="ai-danger">محظور</span>' : "فعال"}</div>
        <div class="ai-user-actions">
          <button class="ai-button ai-secondary ai-small" type="button" data-action="pro30">PRO 30 يوم</button>
          <button class="ai-button ai-secondary ai-small" type="button" data-action="pro0">إلغاء PRO</button>
          <button class="ai-button ai-secondary ai-small" type="button" data-action="ban">${user.isBanned ? "فك الحظر" : "حظر"}</button>
        </div>
      </article>`).join("");
    mount.querySelectorAll("[data-user]").forEach((row) => {
      row.querySelectorAll("[data-action]").forEach((button) => {
        button.addEventListener("click", async () => {
          button.disabled = true;
          const telegramId = row.dataset.user;
          try {
            if (button.dataset.action.startsWith("pro")) {
              const days = button.dataset.action === "pro30" ? 30 : 0;
              await mutation(`/api/platform/ai-bots/${state.selected}/users/${telegramId}/pro`, { method: "POST", body: { days } });
              toast(days ? "تم تفعيل PRO لمدة 30 يومًا" : "تم إلغاء PRO");
            } else {
              const current = state.detail.dashboard.users.find((item) => item.telegramUserId === telegramId);
              await mutation(`/api/platform/ai-bots/${state.selected}/users/${telegramId}/ban`, { method: "POST", body: { banned: !current?.isBanned } });
              toast(current?.isBanned ? "تم فك الحظر" : "تم حظر المستخدم");
            }
            await selectInstance(state.selected, { quiet: true });
          } catch (error) {
            toast(error.message, true);
          } finally {
            button.disabled = false;
          }
        });
      });
    });
  }

  function fillForm(form, instance) {
    if (!form) return;
    if (form.elements.displayName) form.elements.displayName.value = instance.displayName || "UCHIHA AI";
    if (form.elements.ownerTelegramId) form.elements.ownerTelegramId.value = instance.ownerTelegramId || "";
    if (form.elements.proSubscribeUrl) form.elements.proSubscribeUrl.value = instance.proSubscribeUrl || "";
    if (form.elements.welcomeText) form.elements.welcomeText.value = instance.welcomeText || "";
    if (form.elements.status) form.elements.status.value = ["active", "paused"].includes(instance.status) ? instance.status : "active";
  }

  function renderManager() {
    const section = $("#managerSection");
    if (!state.detail?.instance) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    const { instance, dashboard, openAi } = state.detail;
    $("#managerTitle").textContent = instance.displayName;
    $("#managerStatus").innerHTML = `الحالة: <b>${escapeHtml(statusLabel(instance.status))}</b>${instance.telegramUsername ? ` · Telegram: <b>@${escapeHtml(instance.telegramUsername)}</b>` : " · أضف Telegram Bot Token لإكمال التشغيل."} · الذكاء المركزي: <b>${openAi?.configured ? "جاهز" : "غير جاهز"}</b>`;
    const openBot = $("#openBotButton");
    openBot.hidden = !instance.telegramUrl;
    if (instance.telegramUrl) openBot.href = instance.telegramUrl;
    const stats = dashboard?.stats || {};
    $("#dashboardGrid").innerHTML = [
      statCard("المستخدمون", String(stats.users || 0)),
      statCard("مشتركو PRO", String(stats.proUsers || 0)),
      statCard("طلبات اليوم", String(stats.requestsToday || 0)),
      statCard("إجمالي الطلبات", String(stats.requests || 0))
    ].join("");

    const hasToken = Boolean(instance.tokenMasked);
    $("#tokenSection").hidden = hasToken;
    $("#settingsSection").hidden = !hasToken;
    $("#modelsSection").hidden = !hasToken;
    $("#usersSection").hidden = !hasToken;
    fillForm($("#tokenForm"), instance);
    fillForm($("#settingsForm"), instance);
    if (hasToken) {
      renderModels(instance);
      renderUsers(dashboard?.users || []);
    }
  }

  async function selectInstance(instanceId, { quiet = false } = {}) {
    state.selected = instanceId;
    renderInstances();
    try {
      state.detail = await api(`/api/platform/ai-bots/${instanceId}`);
      renderManager();
      const url = new URL(location.href);
      url.searchParams.set("instance", instanceId);
      history.replaceState(null, "", url);
      if (!quiet) $("#managerSection").scrollIntoView({ block: "start" });
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function loadPlatformAdmin() {
    if (!state.me?.user?.isPlatformAdmin) {
      $("#platformAdminSection").hidden = true;
      return;
    }
    try {
      state.platformAdmin = await api("/api/platform/admin/ai-product");
      const section = $("#platformAdminSection");
      section.hidden = false;
      const admin = state.platformAdmin;
      const form = $("#productAdminForm");
      form.elements.price.value = amountFromMinor(admin.product.priceMinor || 0, admin.product.currency || "USD");
      form.elements.currency.value = admin.product.currency || "USD";
      form.elements.status.value = admin.product.status || "active";
      $("#platformOpenAiState").innerHTML = `
        <p>الحالة: <b class="${admin.openAi.configured ? "ai-success" : "ai-danger"}">${admin.openAi.configured ? "متصل" : "غير مربوط"}</b></p>
        <p>Free: <b>${escapeHtml(admin.openAi.freeModel || "—")}</b><br>PRO: <b>${escapeHtml(admin.openAi.proModel || "—")}</b><br>Images: <b>${escapeHtml(admin.openAi.imageModel || "—")}</b></p>
        <p>البوتات الفعالة: <b>${Number(admin.instances.active || 0)}</b> / ${Number(admin.instances.total || 0)}<br>إجمالي طلبات AI: <b>${Number(admin.usage.requests || 0)}</b></p>`;
      $("#openAiBillingButton").href = admin.openAi.billingUrl;
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function load() {
    try {
      const publicPayload = await api("/api/public/products/ai-chatbot");
      state.product = publicPayload.product;
      state.me = await api("/api/me").catch((error) => error.status === 401 ? null : Promise.reject(error));
      if (state.me?.csrfToken) {
        state.csrf = state.me.csrfToken;
        sessionStorage.setItem("uchihaBuilderCsrf", state.csrf);
      } else {
        state.csrf = sessionStorage.getItem("uchihaBuilderCsrf") || "";
      }
      if (state.me?.user) {
        const mine = await api("/api/platform/ai-bots");
        state.product = mine.product;
        state.wallet = mine.wallet;
        state.instances = mine.instances || [];
      }
      renderProduct();
      renderInstances();
      const requested = new URLSearchParams(location.search).get("instance");
      const initial = requested && state.instances.some((item) => item.id === requested)
        ? requested
        : state.instances[0]?.id;
      if (initial) await selectInstance(initial, { quiet: true });
      await loadPlatformAdmin();
    } catch (error) {
      toast(error.message, true);
      renderProduct();
    }
  }

  $("#purchaseForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#purchaseButton");
    button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      const result = await mutation("/api/platform/ai-bots/purchase", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: values
      });
      toast("تم شراء البوت. أضف Telegram Bot Token لإكمال التشغيل.");
      const mine = await api("/api/platform/ai-bots");
      state.wallet = mine.wallet;
      state.instances = mine.instances || [];
      renderProduct();
      renderInstances();
      await selectInstance(result.instanceId, { quiet: false });
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $("#tokenForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(event.currentTarget).entries());
      await mutation(`/api/platform/ai-bots/${state.selected}/token`, { method: "POST", body });
      event.currentTarget.elements.telegramBotToken.value = "";
      toast("تم التحقق من Telegram وتشغيل البوت بنجاح");
      const mine = await api("/api/platform/ai-bots");
      state.instances = mine.instances || [];
      renderInstances();
      await selectInstance(state.selected, { quiet: true });
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(event.currentTarget).entries());
      await mutation(`/api/platform/ai-bots/${state.selected}`, { method: "PATCH", body });
      toast("تم حفظ إعدادات البوت");
      const mine = await api("/api/platform/ai-bots");
      state.instances = mine.instances || [];
      renderInstances();
      await selectInstance(state.selected, { quiet: true });
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $("#productAdminForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      const currency = String(values.currency || "USD").toUpperCase();
      await mutation("/api/platform/admin/ai-product", {
        method: "PATCH",
        body: {
          priceMinor: minorFromAmount(values.price, currency),
          currency,
          status: values.status
        }
      });
      toast("تم حفظ سعر وحالة المنتج");
      await load();
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $("#refreshButton").addEventListener("click", () => load());
  load();
})();