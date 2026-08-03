(() => {
  "use strict";

  if (location.pathname !== "/account") return;

  const mount = document.getElementById("accountApp");
  if (!mount) return;

  const state = {
    me: null,
    account: null,
    csrfToken: "",
    activeTab: normalizeTab(location.hash.slice(1)),
    loading: false
  };

  const TAB_KEYS = new Set(["overview", "products", "wallet", "notifications", "settings"]);

  function normalizeTab(value) {
    return TAB_KEYS.has(value) ? value : "overview";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function internalHref(value, fallback = "/") {
    const candidate = String(value || "");
    return candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("..")
      ? candidate
      : fallback;
  }

  function initials(value) {
    const parts = String(value || "U").trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
  }

  function formatMoney(minor, currency = "USD") {
    try {
      return new Intl.NumberFormat(document.documentElement.lang === "en" ? "en-US" : "ar-SY", {
        style: "currency",
        currency,
        maximumFractionDigits: 2
      }).format(Number(minor || 0) / 100);
    } catch {
      return `${(Number(minor || 0) / 100).toFixed(2)} ${currency}`;
    }
  }

  function formatDate(value) {
    if (!value) return "—";
    try {
      return new Intl.DateTimeFormat(document.documentElement.lang === "en" ? "en-US" : "ar-SY", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(value));
    } catch {
      return "—";
    }
  }

  async function requestJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.message || "تعذر إكمال العملية");
        error.status = response.status;
        error.code = payload.error;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error.name === "AbortError") {
        const timeoutError = new Error("استغرق الاتصال وقتًا طويلًا. أعد المحاولة.");
        timeoutError.code = "request_timeout";
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function projectRows() {
    const rows = [];
    for (const store of state.me?.stores || []) {
      rows.push({
        id: store.id,
        title: store.name,
        subtitle: `متجر • ${store.role || "مالك"}`,
        status: store.status || "active",
        href: store.links?.dashboard || `/admin/${store.id}`,
        icon: "م"
      });
    }
    for (const project of state.me?.projects || []) {
      if (rows.some((item) => item.id === project.id || item.title === project.name)) continue;
      rows.push({
        id: project.id,
        title: project.name,
        subtitle: `${project.components?.length || 0} مكوّن • ${project.type || "مشروع"}`,
        status: project.status || "configuring",
        href: "/create-store",
        icon: "U"
      });
    }
    return rows;
  }

  function statusLabel(status) {
    const labels = {
      active: "فعّال",
      ready: "جاهز",
      configuring: "قيد الإعداد",
      provisioning: "قيد التجهيز",
      review_required: "يحتاج مراجعة",
      draft: "مسودة",
      suspended: "موقوف"
    };
    return labels[status] || "قيد الإعداد";
  }

  function projectsHtml(limit = 0) {
    const rows = projectRows();
    const visible = limit > 0 ? rows.slice(0, limit) : rows;
    if (!visible.length) {
      return `<div class="account-unified-empty"><b>لا توجد منتجات أو مشاريع حتى الآن</b><p>ابدأ أول خدمة، وستظهر هنا ضمن حسابك نفسه.</p></div>`;
    }
    return `<div class="account-unified-list">${visible.map((item) => `
      <a class="account-unified-row" href="${escapeHtml(internalHref(item.href, "/create-store"))}">
        <span class="account-unified-row-icon">${escapeHtml(item.icon)}</span>
        <span class="account-unified-row-copy"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.subtitle)}</small></span>
        <span class="account-unified-status">${escapeHtml(statusLabel(item.status))}</span>
      </a>`).join("")}</div>`;
  }

  function ledgerHtml() {
    const items = state.account?.ledger || [];
    if (!items.length) {
      return `<div class="account-unified-empty"><b>لا توجد حركات مالية</b><p>المحفظة جاهزة، وستظهر العمليات بعد أول شحن أو شراء.</p></div>`;
    }
    return `<div class="account-unified-list">${items.map((item) => `
      <article class="account-unified-ledger-entry">
        <div><b>${escapeHtml(item.description || item.type)}</b><small>${escapeHtml(formatDate(item.createdAt))}</small></div>
        <strong class="${item.amountMinor >= 0 ? "positive" : "negative"}">${escapeHtml(formatMoney(item.amountMinor, item.currency))}</strong>
      </article>`).join("")}</div>`;
  }

  function notificationsHtml() {
    const items = state.account?.notifications || [];
    if (!items.length) {
      return `<div class="account-unified-empty"><b>لا توجد إشعارات</b><p>ستظهر هنا تحديثات الطلبات والرصيد والأمان.</p></div>`;
    }
    return `<div class="account-unified-list">${items.map((item) => `
      <article class="account-unified-notification${item.isRead ? "" : " unread"}">
        <div><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.body)}</p><time>${escapeHtml(formatDate(item.createdAt))}</time></div>
        ${item.actionUrl ? `<a class="account-unified-small-button" href="${escapeHtml(internalHref(item.actionUrl))}">فتح</a>` : ""}
      </article>`).join("")}</div>`;
  }

  function settingsHtml() {
    const user = state.account.user;
    const preferences = state.account.preferences;
    const notifications = preferences.notifications || {};
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return `
      <div id="accountNotice" class="account-unified-notice" hidden></div>
      <form id="accountSettingsForm" class="account-unified-form">
        <label class="account-unified-field">الاسم الكامل
          <input name="displayName" required maxlength="120" value="${escapeHtml(user.displayName)}">
        </label>
        <label class="account-unified-field">البريد الإلكتروني
          <input type="email" value="${escapeHtml(user.email)}" readonly>
        </label>
        <label class="account-unified-field">اللغة
          <select name="locale">
            <option value="ar"${preferences.locale === "ar" ? " selected" : ""}>العربية</option>
            <option value="en"${preferences.locale === "en" ? " selected" : ""}>English</option>
          </select>
        </label>
        <label class="account-unified-field">العملة المفضلة
          <select name="currency">
            ${["USD", "EUR", "SAR", "AED", "TRY"].map((code) => `<option value="${code}"${preferences.currency === code ? " selected" : ""}>${code}</option>`).join("")}
          </select>
        </label>
        <label class="account-unified-field">المنطقة الزمنية
          <input name="timezone" maxlength="80" value="${escapeHtml(preferences.timezone || browserTimezone)}">
        </label>
        <label class="account-unified-field">رقم الهاتف
          <input name="phone" type="tel" maxlength="40" placeholder="+963..." value="${escapeHtml(preferences.phone || "")}">
        </label>
        <label class="account-unified-field wide">معرف تيليجرام
          <input name="telegramUsername" maxlength="32" placeholder="username" value="${escapeHtml(preferences.telegramUsername || "")}">
        </label>
        <div class="account-unified-checks">
          <label class="account-unified-check"><input name="notifyOrders" type="checkbox"${notifications.orders !== false ? " checked" : ""}> تحديثات الطلبات</label>
          <label class="account-unified-check"><input name="notifyWallet" type="checkbox"${notifications.wallet !== false ? " checked" : ""}> تحديثات الرصيد</label>
          <label class="account-unified-check"><input name="notifySecurity" type="checkbox"${notifications.security !== false ? " checked" : ""}> تنبيهات الأمان</label>
          <label class="account-unified-check"><input name="notifyMarketing" type="checkbox"${notifications.marketing === true ? " checked" : ""}> العروض والأخبار</label>
        </div>
        <div class="account-unified-form-actions">
          <button class="account-unified-button" type="submit">حفظ الإعدادات</button>
          <button class="account-unified-button-secondary" type="button" data-logout>تسجيل الخروج</button>
        </div>
      </form>`;
  }

  function tabButton(key, label) {
    const selected = state.activeTab === key;
    return `<button class="account-unified-tab" type="button" role="tab" aria-selected="${selected}" data-tab-target="${key}">${label}</button>`;
  }

  function panel(key, content) {
    return `<section class="account-unified-panel" role="tabpanel" data-account-panel="${key}"${state.activeTab === key ? "" : " hidden"}>${content}</section>`;
  }

  function render() {
    const account = state.account;
    const wallet = account.wallet;
    const rows = projectRows();
    const totalProjects = Math.max(account.counts.projects, rows.length);
    const unread = account.counts.unreadNotifications;

    mount.innerHTML = `
      <div class="account-unified-shell">
        <section class="account-unified-hero">
          <div>
            <span class="account-unified-kicker">UCHIHA • حساب موحّد</span>
            <h1>مرحبًا ${escapeHtml(account.user.displayName)}</h1>
            <p>هذه ليست واجهة منفصلة. من هنا تدير الرصيد والمنتجات والمشاريع والإشعارات ضمن نفس تصميم وتنقّل المنصة.</p>
            <div class="account-unified-hero-actions">
              <a class="account-unified-button" href="/services">استعراض المنتجات والخدمات</a>
              <a class="account-unified-button-secondary" href="/create-store">إنشاء مشروع</a>
            </div>
          </div>
          <div class="account-unified-identity">
            <span class="account-unified-avatar">${escapeHtml(initials(account.user.displayName))}</span>
            <b>${escapeHtml(account.user.displayName)}</b>
            <small>${escapeHtml(account.user.email)}</small>
          </div>
        </section>

        <section class="account-unified-metrics" aria-label="ملخص الحساب">
          <article class="account-unified-metric"><span>الرصيد المتاح</span><strong>${escapeHtml(formatMoney(wallet.availableMinor, wallet.currency))}</strong><small>${wallet.heldMinor ? `${escapeHtml(formatMoney(wallet.heldMinor, wallet.currency))} محجوز` : "لا يوجد رصيد محجوز"}</small></article>
          <article class="account-unified-metric"><span>المنتجات والمشاريع</span><strong>${totalProjects}</strong><small>مرتبطة بحسابك</small></article>
          <article class="account-unified-metric"><span>المتاجر</span><strong>${account.counts.stores}</strong><small>تملك صلاحية إدارتها</small></article>
          <article class="account-unified-metric"><span>الإشعارات الجديدة</span><strong>${unread}</strong><small>غير مقروءة</small></article>
        </section>

        <nav class="account-unified-tabs" role="tablist" aria-label="أقسام الحساب">
          ${tabButton("overview", "نظرة عامة")}
          ${tabButton("products", "منتجاتي ومشاريعي")}
          ${tabButton("wallet", "المحفظة")}
          ${tabButton("notifications", `الإشعارات${unread ? ` (${Math.min(unread, 99)})` : ""}`)}
          ${tabButton("settings", "الإعدادات")}
        </nav>

        ${panel("overview", `
          <div class="account-unified-grid">
            <article class="account-unified-card">
              <div class="account-unified-card-head"><div><h2>آخر المنتجات والمشاريع</h2><p>كل ما اشتريته أو أنشأته يظهر في حساب واحد.</p></div><button class="account-unified-small-button" type="button" data-tab-target="products">عرض الكل</button></div>
              ${projectsHtml(4)}
            </article>
            <aside class="account-unified-card">
              <div class="account-unified-card-head"><div><h2>إجراءات سريعة</h2><p>روابط واضحة دون واجهات متداخلة.</p></div></div>
              <div class="account-unified-actions">
                <a class="account-unified-action" href="/services"><b>المنتجات والخدمات</b><small>بوتات ومواقع وتطبيقات</small></a>
                <a class="account-unified-action" href="/create-store"><b>مشروع جديد</b><small>ابدأ من المعالج</small></a>
                <button class="account-unified-action" type="button" data-tab-target="wallet"><b>المحفظة</b><small>الرصيد والحركات</small></button>
                <a class="account-unified-action" href="/support"><b>الدعم</b><small>تواصل مع UCHIHA</small></a>
              </div>
            </aside>
          </div>`)}

        ${panel("products", `
          <article class="account-unified-card">
            <div class="account-unified-card-head"><div><h2>منتجاتي ومشاريعي</h2><p>المتاجر والبوتات والمواقع والتطبيقات ستبقى مجتمعة هنا.</p></div><a class="account-unified-small-button" href="/services">إضافة منتج</a></div>
            ${projectsHtml()}
          </article>`)}

        ${panel("wallet", `
          <article class="account-unified-card">
            <div class="account-unified-card-head"><div><h2>المحفظة</h2><p>رصيد موحّد للشراء والترقية والاسترداد.</p></div><a class="account-unified-small-button" href="/payment-methods">طرق الدفع</a></div>
            ${ledgerHtml()}
          </article>`)}

        ${panel("notifications", `
          <article class="account-unified-card">
            <div class="account-unified-card-head"><div><h2>الإشعارات</h2><p>تحديثات الحساب والطلبات والرصيد والأمان.</p></div>${unread ? '<button class="account-unified-small-button" type="button" data-read-all>تحديد الكل كمقروء</button>' : ""}</div>
            <div id="notificationNotice" class="account-unified-notice" hidden></div>
            ${notificationsHtml()}
          </article>`)}

        ${panel("settings", `
          <article class="account-unified-card">
            <div class="account-unified-card-head"><div><h2>إعدادات الحساب</h2><p>بياناتك واللغة والعملة والتنبيهات.</p></div></div>
            ${settingsHtml()}
          </article>`)}
      </div>`;

    syncSharedHeader();
  }

  function syncSharedHeader() {
    const actions = document.querySelector("#siteHeader .header-actions");
    if (!actions || !state.account) return;

    actions.querySelectorAll("[data-account-shell-control]").forEach((node) => node.remove());
    actions.querySelector(".header-login")?.remove();
    actions.querySelector(".header-create")?.remove();

    const mobileMenu = actions.querySelector(".mobile-menu-toggle");
    const wallet = document.createElement("a");
    wallet.className = "account-unified-header-wallet";
    wallet.dataset.accountShellControl = "wallet";
    wallet.href = "/account#wallet";
    wallet.innerHTML = `<small>الرصيد</small><b>${escapeHtml(formatMoney(state.account.wallet.availableMinor, state.account.wallet.currency))}</b>`;

    const notifications = document.createElement("a");
    notifications.className = "header-icon-button account-unified-header-notifications";
    notifications.dataset.accountShellControl = "notifications";
    notifications.href = "/account#notifications";
    notifications.setAttribute("aria-label", "الإشعارات");
    notifications.innerHTML = `🔔${state.account.counts.unreadNotifications ? `<span class="account-unified-header-badge">${Math.min(state.account.counts.unreadNotifications, 99)}</span>` : ""}`;

    const profile = document.createElement("a");
    profile.className = "header-create";
    profile.dataset.accountShellControl = "profile";
    profile.href = "/account";
    profile.textContent = "حسابي";

    for (const node of [wallet, notifications, profile]) {
      actions.insertBefore(node, mobileMenu || null);
    }

    const drawerActions = document.querySelector("#siteHeader .mobile-drawer-actions");
    if (drawerActions) {
      drawerActions.innerHTML = `
        <a class="secondary-button" href="/account#wallet">المحفظة</a>
        <a class="primary-button" href="/account">حسابي</a>`;
    }
  }

  function showNotice(id, message, error = false) {
    const node = document.getElementById(id);
    if (!node) return;
    node.hidden = false;
    node.classList.toggle("error", error);
    node.textContent = message;
  }

  function activateTab(key, updateUrl = true) {
    const normalized = normalizeTab(key);
    state.activeTab = normalized;
    mount.querySelectorAll("[data-account-panel]").forEach((panelNode) => {
      panelNode.hidden = panelNode.dataset.accountPanel !== normalized;
    });
    mount.querySelectorAll(".account-unified-tab[data-tab-target]").forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.tabTarget === normalized));
    });
    if (updateUrl) history.replaceState(null, "", `#${normalized}`);
    const tabs = mount.querySelector(".account-unified-tabs");
    if (tabs && tabs.getBoundingClientRect().top < 0) tabs.scrollIntoView({ block: "start" });
  }

  async function saveSettings(form) {
    const button = form.querySelector('button[type="submit"]');
    if (!button || button.disabled) return;
    const data = new FormData(form);
    button.disabled = true;
    button.textContent = "جارٍ الحفظ...";
    try {
      const payload = await requestJson("/api/platform/account", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": state.csrfToken
        },
        body: JSON.stringify({
          displayName: data.get("displayName"),
          locale: data.get("locale"),
          currency: data.get("currency"),
          timezone: data.get("timezone"),
          phone: data.get("phone"),
          telegramUsername: data.get("telegramUsername"),
          notifications: {
            orders: data.has("notifyOrders"),
            wallet: data.has("notifyWallet"),
            security: data.has("notifySecurity"),
            marketing: data.has("notifyMarketing")
          }
        })
      });
      state.account = payload.account;
      state.me.user.displayName = payload.account.user.displayName;
      render();
      activateTab("settings", false);
      showNotice("accountNotice", "تم حفظ إعدادات الحساب بنجاح.");
    } catch (error) {
      showNotice("accountNotice", error.message, true);
      button.disabled = false;
      button.textContent = "حفظ الإعدادات";
    }
  }

  async function markAllRead(button) {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await requestJson("/api/platform/notifications/read", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": state.csrfToken
        },
        body: JSON.stringify({ all: true })
      });
      state.account.notifications = state.account.notifications.map((item) => ({ ...item, isRead: true }));
      state.account.counts.unreadNotifications = 0;
      render();
      activateTab("notifications", false);
      showNotice("notificationNotice", "تم تحديد جميع الإشعارات كمقروءة.");
    } catch (error) {
      button.disabled = false;
      showNotice("notificationNotice", error.message, true);
    }
  }

  async function logout(button) {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await requestJson("/api/auth/logout", {
        method: "POST",
        headers: { "x-csrf-token": state.csrfToken }
      });
    } catch {
      // Redirecting clears the visible account even when the response is interrupted.
    }
    location.assign("/login");
  }

  function bindEvents() {
    mount.addEventListener("click", (event) => {
      const tabTarget = event.target.closest("[data-tab-target]");
      if (tabTarget) {
        event.preventDefault();
        activateTab(tabTarget.dataset.tabTarget);
        return;
      }

      const readAll = event.target.closest("[data-read-all]");
      if (readAll) {
        markAllRead(readAll);
        return;
      }

      const logoutButton = event.target.closest("[data-logout]");
      if (logoutButton) logout(logoutButton);
    });

    mount.addEventListener("submit", (event) => {
      if (event.target.id !== "accountSettingsForm") return;
      event.preventDefault();
      saveSettings(event.target);
    });

    window.addEventListener("hashchange", () => activateTab(location.hash.slice(1), false));
  }

  function renderError(error) {
    mount.innerHTML = `
      <section class="account-unified-error">
        <span class="account-unified-kicker">تعذر تحميل الحساب</span>
        <h1>لم نتمكن من فتح بياناتك</h1>
        <p>${escapeHtml(error.message || "حدث خطأ غير متوقع")}</p>
        <button class="account-unified-button" type="button" data-retry-account>إعادة المحاولة</button>
      </section>`;
    mount.querySelector("[data-retry-account]")?.addEventListener("click", load);
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    mount.innerHTML = `
      <section class="account-unified-loading">
        <div class="account-unified-spinner" aria-hidden="true"></div>
        <div><b>جارٍ تحميل حسابك</b><p>نجهّز الرصيد والمشاريع والإشعارات ضمن نفس واجهة المنصة.</p></div>
      </section>`;
    try {
      const me = await requestJson("/api/me");
      state.me = me;
      state.csrfToken = me.csrfToken;
      const payload = await requestJson("/api/platform/account");
      state.account = payload.account;
      render();
      activateTab(state.activeTab, false);
    } catch (error) {
      if (error.status === 401) {
        location.replace("/login?next=/account");
        return;
      }
      renderError(error);
    } finally {
      state.loading = false;
    }
  }

  bindEvents();
  load();
})();
