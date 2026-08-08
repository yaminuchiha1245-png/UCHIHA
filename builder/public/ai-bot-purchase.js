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

  function renderTokenSetup(instanceId, title = "تشغيل البوت", ownerTelegramId = "") {
    const section = $("#handoffSection");
    const card = $("#handoffCard");
    section.hidden = false;
    card.innerHTML = `<div class="purchase-handoff">
      <strong>${escapeHtml(title)}</strong>
      <p>انسخ Telegram Bot Token من BotFather والصقه هنا. معرف Telegram الرقمي هو الحساب الذي سيملك صلاحية <b>/admin</b>.</p>
      <form data-token-setup="${escapeHtml(instanceId)}" class="purchase-token-form">
        <label>Telegram Bot Token
          <input name="telegramBotToken" type="password" autocomplete="off" required maxlength="300" placeholder="123456789:AA...">
        </label>
        <label>Telegram ID للمالك
          <input name="ownerTelegramId" type="text" inputmode="numeric" pattern="[0-9]{5,20}" required maxlength="20" value="${escapeHtml(ownerTelegramId)}" placeholder="مثال: 123456789">
        </label>
        <small>يتم التحقق من التوكن مع Telegram ثم تشفيره على السيرفر. يمكنك استخدام هذه الصفحة لاحقًا لتغيير التوكن إذا استبدلته من BotFather.</small>
        <button type="submit">تحقق وشغّل البوت</button>
      </form>
    </div>`;

    card.querySelector("[data-token-setup]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const values = Object.fromEntries(new FormData(form).entries());
      button.disabled = true;
      try {
        const result = await api(`/api/platform/ai-bots/${encodeURIComponent(instanceId)}/token`, {
          method: "POST",
          body: {
            telegramBotToken: values.telegramBotToken,
            ownerTelegramId: values.ownerTelegramId
          }
        });
        const instance = result.instance || {};
        form.reset();
        toast("تم التحقق من التوكن وتشغيل البوت بنجاح");
        const mine = await api("/api/platform/ai-bots");
        state.wallet = mine.wallet;
        state.instances = mine.instances || [];
        renderProduct();
        renderInstances();
        card.innerHTML = `<div class="purchase-handoff">
          <strong>✅ البوت جاهز</strong>
          <p>${instance.telegramUsername ? `تم تشغيل @${escapeHtml(instance.telegramUsername)}.` : "تم تشغيل البوت."} افتحه الآن واكتب <b>/admin</b> لربط OpenAI وإدارة النماذج وPRO والمستخدمين وكل الإعدادات.</p>
          ${instance.telegramUrl ? `<div class="purchase-actions"><a href="${escapeHtml(instance.telegramUrl)}" target="_blank" rel="noopener">فتح البوت</a></div>` : ""}
        </div>`;
      } catch (error) {
        toast(error.message, true);
      } finally {
        button.disabled = false;
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
          <span class="purchase-status ${active ? "active" : "pending"}">${active ? "تم التشغيل" : "بانتظار Bot Token"}</span>
          ${instance.telegramUsername ? `<small>@${escapeHtml(instance.telegramUsername)}</small>` : ""}
          ${instance.tokenMasked ? `<small>Token: ${escapeHtml(instance.tokenMasked)}</small>` : ""}
        </div>
        <div class="purchase-actions">
          ${active ? `<a href="${escapeHtml(instance.telegramUrl)}" target="_blank" rel="noopener">فتح البوت</a>` : ""}
          <button type="button" data-token-instance="${escapeHtml(instance.id)}" data-owner-id="${escapeHtml(instance.ownerTelegramId || "")}">${active ? "تغيير Bot Token" : "إضافة Bot Token"}</button>
        </div>
      </article>`;
    }).join("");

    list.querySelectorAll("[data-token-instance]").forEach((button) => {
      button.addEventListener("click", () => {
        renderTokenSetup(
          button.dataset.tokenInstance,
          button.textContent.includes("تغيير") ? "تغيير Telegram Bot Token" : "إضافة Telegram Bot Token",
          button.dataset.ownerId || ""
        );
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

      const requested = new URLSearchParams(location.search).get("instance");
      if (requested) {
        const instance = state.instances.find((item) => item.id === requested);
        if (instance) {
          renderTokenSetup(
            instance.id,
            instance.status === "active" ? "تغيير Telegram Bot Token" : "إضافة Telegram Bot Token",
            instance.ownerTelegramId || ""
          );
        }
      }
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
      toast("تم شراء البوت. أضف Telegram Bot Token لتشغيله.");
      const mine = await api("/api/platform/ai-bots");
      state.wallet = mine.wallet;
      state.instances = mine.instances || [];
      renderProduct();
      renderInstances();
      renderTokenSetup(result.instanceId, "تم الشراء — أكمل تشغيل البوت");
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  load();
})();