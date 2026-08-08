(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const state = { product: null, me: null, csrf: "", wallet: null, instances: [] };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toast(message, error = false) {
    const node = $("#toast");
    node.textContent = message;
    node.classList.toggle("error", error);
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.hidden = true; }, 4200);
  }

  function currencyDigits(currency) {
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    } catch {
      return 2;
    }
  }

  function money(minor, currency = "USD") {
    if (minor === null || minor === undefined) return "يحدد لاحقًا";
    const digits = currencyDigits(currency);
    try {
      return new Intl.NumberFormat("ar", { style: "currency", currency }).format(Number(minor) / (10 ** digits));
    } catch {
      return `${Number(minor) / (10 ** digits)} ${currency}`;
    }
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: {
        accept: "application/json",
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.method && options.method !== "GET" && state.csrf ? { "x-csrf-token": state.csrf } : {}),
        ...(options.headers || {})
      },
      body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
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

  function renderProduct() {
    const product = state.product || {};
    $("#productTitle").textContent = product.name || "بوت ذكاء اصطناعي";
    $("#productDescription").textContent = product.description || "بوت ذكاء اصطناعي جاهز يعمل داخل Telegram.";
    $("#productPrice").textContent = money(product.priceMinor, product.currency || "USD");
    $("#productFeatures").innerHTML = (product.features || []).slice(0, 8).map((item) => `<li>${escapeHtml(item)}</li>`).join("");

    const loggedIn = Boolean(state.me?.user);
    $("#loginButton").hidden = loggedIn;
    $("#purchaseForm").hidden = !loggedIn;
    if (loggedIn) {
      $("#walletBalance").textContent = `رصيدك المتاح: ${money(state.wallet?.availableMinor || 0, state.wallet?.currency || product.currency || "USD")}`;
    }
    const button = $("#purchaseButton");
    button.disabled = !product.available || !product.priceConfigured;
    if (!product.priceConfigured) button.textContent = "السعر غير محدد بعد";
    else if (!product.available) button.textContent = "المنتج غير متاح حاليًا";
    else button.textContent = "شراء البوت";
  }

  function renderHandoff(setup, title = "تم شراء البوت") {
    const section = $("#handoffSection");
    const card = $("#handoffCard");
    section.hidden = false;
    card.innerHTML = `<div class="purchase-handoff">
      <strong>${escapeHtml(title)}</strong>
      <p>الإعداد والإدارة ليسا داخل الموقع. انتقل إلى Telegram وأكمل ربط BotFather Token، وبعدها استخدم <b>/admin</b> داخل بوتك.</p>
      ${setup?.telegramUrl ? `<div class="purchase-actions"><a href="${escapeHtml(setup.telegramUrl)}" target="_blank" rel="noopener">فتح إعداد UCHIHA في Telegram</a></div>` : ""}
      ${setup?.code ? `<small>كود التفعيل صالح حتى ${escapeHtml(new Date(setup.expiresAt).toLocaleString("ar"))}</small><code>${escapeHtml(setup.code)}</code><div class="purchase-actions"><button class="secondary" type="button" data-copy-code="${escapeHtml(setup.code)}">نسخ الكود</button></div>` : ""}
      ${!setup?.setupBotConfigured ? `<p><b>تنبيه:</b> بوت إعداد UCHIHA لم يتم ضبطه على السيرفر بعد. احتفظ بالكود إلى أن يتم تفعيل بوت الإعداد.</p>` : ""}
    </div>`;
    card.querySelector("[data-copy-code]")?.addEventListener("click", async (event) => {
      try {
        await navigator.clipboard.writeText(event.currentTarget.dataset.copyCode || "");
        toast("تم نسخ كود التفعيل");
      } catch {
        toast("تعذر النسخ تلقائيًا. انسخ الكود يدويًا.", true);
      }
    });
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderInstances() {
    const section = $("#ordersSection");
    const list = $("#instancesList");
    if (!state.me?.user || !state.instances.length) {
      section.hidden = true;
      list.innerHTML = "";
      return;
    }
    section.hidden = false;
    list.innerHTML = state.instances.map((instance) => {
      const active = instance.status === "active" && instance.telegramUrl;
      return `<article class="purchase-item">
        <div class="purchase-item-copy">
          <strong>${escapeHtml(instance.displayName || "AI Bot")}</strong>
          <span class="purchase-status ${active ? "active" : "pending"}">${active ? "تم التسليم والتفعيل" : "بانتظار إعداد Telegram"}</span>
          ${instance.telegramUsername ? `<small>@${escapeHtml(instance.telegramUsername)}</small>` : ""}
        </div>
        <div class="purchase-actions">
          ${active
            ? `<a href="${escapeHtml(instance.telegramUrl)}" target="_blank" rel="noopener">فتح البوت</a>`
            : `<button type="button" data-setup-instance="${escapeHtml(instance.id)}">إعداد في Telegram</button>`}
        </div>
      </article>`;
    }).join("");
    list.querySelectorAll("[data-setup-instance]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const result = await api(`/api/platform/ai-bots/${encodeURIComponent(button.dataset.setupInstance)}/setup-link`, { method: "POST" });
          renderHandoff(result.setup, "رابط إعداد جديد");
        } catch (error) {
          toast(error.message, true);
        } finally {
          button.disabled = false;
        }
      });
    });
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
        state.product = mine.product || state.product;
        state.wallet = mine.wallet;
        state.instances = mine.instances || [];
      }
      renderProduct();
      renderInstances();
    } catch (error) {
      toast(error.message, true);
      renderProduct();
    }
  }

  $("#purchaseForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#purchaseButton");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    button.disabled = true;
    try {
      const result = await api("/api/platform/ai-bots/purchase", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: { displayName: values.displayName }
      });
      renderHandoff(result.setup, "تم شراء البوت بنجاح");
      toast("تم الشراء. أكمل الإعداد من Telegram.");
      const mine = await api("/api/platform/ai-bots");
      state.wallet = mine.wallet;
      state.instances = mine.instances || [];
      renderProduct();
      renderInstances();
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  load();
})();