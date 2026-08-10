(() => {
  "use strict";

  const pathMatch = /^\/admin\/([^/]+)\/?$/.exec(location.pathname);
  if (!pathMatch) return;
  const storeId = decodeURIComponent(pathMatch[1]);
  let csrfToken = sessionStorage.getItem("uchihaBuilderCsrf") || "";

  async function request(path, options = {}) {
    const method = options.method || "GET";
    const headers = { accept: "application/json", ...(options.headers || {}) };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) {
      headers["x-csrf-token"] = csrfToken;
    }
    const response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const data = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (data?.csrfToken) {
      csrfToken = data.csrfToken;
      sessionStorage.setItem("uchihaBuilderCsrf", csrfToken);
    }
    if (!response.ok) {
      const error = new Error(data?.message || "تعذر إكمال العملية");
      error.status = response.status;
      error.code = data?.error || data?.code;
      throw error;
    }
    return data;
  }

  function el(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = options.text;
    if (options.type) node.type = options.type;
    if (options.name) node.name = options.name;
    if (options.value !== undefined) node.value = options.value;
    if (options.placeholder) node.placeholder = options.placeholder;
    if (options.autocomplete) node.autocomplete = options.autocomplete;
    if (options.inputmode) node.inputMode = options.inputmode;
    if (options.required) node.required = true;
    for (const child of children) node.append(child);
    return node;
  }

  function setState(container, message, type = "") {
    container.textContent = message;
    container.className = `admin-bot-standalone-status ${type}`.trim();
    container.hidden = false;
  }

  function renderBotStatus(container, bot) {
    container.replaceChildren();
    container.hidden = false;
    if (!bot?.connected) {
      const status = el("div", { className: "admin-bot-status-row" }, [
        el("div", {}, [
          el("strong", { text: "بوت الإدارة غير مربوط بعد" }),
          el("small", { text: "أدخل التوكن ومعرف تيليجرام الخاص بك ثم اضغط ربط وتشغيل." })
        ]),
        el("span", { className: "status-badge", text: "غير مربوط" })
      ]);
      container.append(status);
      return;
    }

    const badgeClass = bot.status === "active" ? "status-badge active" : "status-badge";
    container.append(
      el("div", { className: "admin-bot-status-row" }, [
        el("div", {}, [
          el("strong", { text: `@${bot.username || "admin_bot"}` }),
          el("small", {
            text: bot.status === "active"
              ? "متصل بالمنصة ويستقبل أوامر الإدارة من المالك فقط."
              : "تم حفظ البوت ويحتاج إعادة محاولة تشغيل Webhook."
          })
        ]),
        el("span", { className: badgeClass, text: bot.status === "active" ? "نشط" : "بانتظار التشغيل" })
      ])
    );
  }

  async function bootstrap() {
    // app.js is loaded before this file. Moving to the next task ensures its old
    // two-bot submit listener is attached to the original form before we replace it.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const oldForm = document.querySelector("#botsForm");
    if (!oldForm) return;

    const panel = oldForm.closest('[data-panel-view="bots"]');
    const heading = panel?.querySelector(".panel-heading");
    const eyebrow = heading?.querySelector(".eyebrow");
    const title = heading?.querySelector("h2");
    if (eyebrow) eyebrow.textContent = "إدارة مباشرة من تيليجرام";
    if (title) title.textContent = "ربط بوت الإدارة";

    const guide = panel?.querySelector(".botfather-guide");
    if (guide) {
      const guideTitle = guide.querySelector("h3");
      if (guideTitle) guideTitle.textContent = "أنت أنشأت البوت — بقي ربطه بالمنصة";
      const list = guide.querySelector("ol");
      if (list) {
        list.replaceChildren(
          el("li", { text: "احتفظ بالتوكن الذي أعطاك إياه BotFather ولا ترسله لأي شخص." }),
          el("li", { text: "ضع التوكن في خانة بوت الإدارة هنا." }),
          el("li", { text: "أدخل Telegram ID الرقمي لحسابك حتى لا يستطيع غيرك استخدام الإدارة." }),
          el("li", { text: "اضغط ربط وتشغيل. المنصة تفحص التوكن وتضبط Webhook تلقائيًا." }),
          el("li", { text: "بعد نجاح الربط افتح البوت وأرسل /admin لإظهار لوحة الإدارة." })
        );
      }
    }

    const tokenInput = el("input", {
      type: "password",
      name: "adminToken",
      autocomplete: "off",
      placeholder: "123456789:AA...",
      required: true
    });
    const ownerInput = el("input", {
      type: "text",
      name: "ownerTelegramId",
      inputmode: "numeric",
      autocomplete: "off",
      placeholder: "مثال: 123456789",
      required: true
    });
    const submit = el("button", {
      type: "submit",
      className: "button field-wide",
      text: "اختبار وربط بوت الإدارة"
    });
    const statusBox = el("div", { className: "admin-bot-standalone-status", text: "جاري قراءة حالة البوت..." });

    const form = el("form", { className: `${oldForm.className} admin-bot-single-form` }, [
      el("label", { className: "field field-wide" }, [
        el("span", { text: "توكن بوت الإدارة" }),
        tokenInput,
        el("small", { text: "يُشفّر داخل المنصة ولا يظهر كاملًا بعد الحفظ." })
      ]),
      el("label", { className: "field field-wide" }, [
        el("span", { text: "Telegram ID للمالك" }),
        ownerInput,
        el("small", { text: "الحساب صاحب هذا الرقم فقط يستطيع فتح أوامر الإدارة." })
      ]),
      el("p", {
        className: "field-wide field-help",
        text: "لا تحتاج إلى إنشاء بوت المتجر الآن. بوت الإدارة يعمل بشكل مستقل، ويمكن إضافة بوت المتجر لاحقًا."
      }),
      statusBox,
      submit
    ]);
    form.id = "adminBotStandaloneForm";
    oldForm.replaceWith(form);

    const legacyConnections = document.querySelector("#botConnections");
    if (legacyConnections) legacyConnections.hidden = true;

    try {
      await request("/api/me");
      const current = await request(`/api/stores/${encodeURIComponent(storeId)}/admin-bot`);
      if (current?.bot?.ownerTelegramId) ownerInput.value = current.bot.ownerTelegramId;
      renderBotStatus(statusBox, current?.bot);
    } catch (error) {
      setState(statusBox, error.message, "error");
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      submit.textContent = "جاري فحص البوت وتشغيله...";
      setState(statusBox, "جاري التحقق من التوكن وربط Webhook...", "pending");
      try {
        if (!csrfToken) await request("/api/me");
        const data = await request(`/api/stores/${encodeURIComponent(storeId)}/admin-bot`, {
          method: "POST",
          body: {
            adminToken: tokenInput.value.trim(),
            ownerTelegramId: ownerInput.value.trim()
          }
        });
        tokenInput.value = "";
        renderBotStatus(statusBox, data.bot);
        const globalNotice = document.querySelector("#adminNotice");
        if (globalNotice) {
          globalNotice.textContent = `تم ربط @${data.bot.username} بنجاح. افتح البوت في تيليجرام وأرسل /admin.`;
          globalNotice.className = "notice success";
          globalNotice.hidden = false;
        }
      } catch (error) {
        setState(statusBox, error.message, "error");
      } finally {
        submit.disabled = false;
        submit.textContent = "اختبار وربط بوت الإدارة";
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
