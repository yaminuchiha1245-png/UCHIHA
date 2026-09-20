(() => {
  "use strict";

  if (location.pathname !== "/account") return;

  const state = {
    me: null,
    account: null,
    csrfToken: ""
  };

  const icons = {
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path>',
    wallet: '<rect x="3" y="6" width="18" height="14" rx="3"></rect><path d="M16 11h5v5h-5a2.5 2.5 0 0 1 0-5Z"></path><path d="M5 6V5a2 2 0 0 1 2-2h10"></path>',
    user: '<circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path>',
    home: '<path d="m3 11 9-8 9 8"></path><path d="M5 10v10h14V10M9 20v-6h6v6"></path>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect>',
    plus: '<path d="M12 5v14M5 12h14"></path>',
    support: '<path d="M4 14a8 8 0 1 1 16 0"></path><path d="M4 14v4h3v-5H4M20 14v4h-3v-5h3M17 18c0 2-2 3-5 3"></path>',
    payment: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 10h18M7 15h3"></path>',
    logout: '<path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"></path>',
    store: '<path d="M4 10v10h16V10M3 10l2-6h14l2 6"></path><path d="M3 10c0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0"></path>',
    settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"></path>'
  };

  function icon(name) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function internalHref(value, fallback = "#") {
    const candidate = String(value || "");
    return candidate.startsWith("/") && !candidate.startsWith("//") ? candidate : fallback;
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || "تعذر إكمال العملية");
      error.status = response.status;
      error.code = payload.error;
      throw error;
    }
    return payload;
  }

  function formatMoney(minor, currency) {
    try {
      return new Intl.NumberFormat("ar", {
        style: "currency",
        currency: currency || "USD",
        maximumFractionDigits: 2
      }).format(Number(minor || 0) / 100);
    } catch {
      return `${(Number(minor || 0) / 100).toFixed(2)} ${currency || "USD"}`;
    }
  }

  function formatDate(value) {
    if (!value) return "—";
    try {
      return new Intl.DateTimeFormat("ar", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(value));
    } catch {
      return "—";
    }
  }

  function initials(name) {
    const parts = String(name || "U").trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
  }

  function renderLoading() {
    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";
    document.body.className = "platform-account-page";
    document.body.innerHTML = `
      <main class="account-loading" aria-live="polite">
        <div class="account-loading-card">
          <div class="account-loader" aria-hidden="true"></div>
          <b>جارٍ تجهيز حسابك المركزي</b>
          <p>نحمّل الرصيد والمشاريع والإشعارات والإعدادات.</p>
        </div>
      </main>`;
  }

  function renderError(error) {
    document.body.className = "platform-account-page";
    document.body.innerHTML = `
      <main class="account-error-page">
        <div class="account-error-card">
          <span class="account-kicker">تعذر تحميل الحساب</span>
          <h1>لم نتمكن من فتح لوحة حسابك</h1>
          <p>${escapeHtml(error.message || "حدث خطأ غير متوقع")}</p>
          <button class="account-button" type="button" data-retry-account>إعادة المحاولة</button>
        </div>
      </main>`;
    document.querySelector("[data-retry-account]")?.addEventListener("click", load);
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
      draft: "مسودة"
    };
    return labels[status] || "قيد الإعداد";
  }

  function projectsHtml() {
    const rows = projectRows();
    if (!rows.length) {
      return `<div class="account-empty"><b>لا توجد مشاريع حتى الآن</b><p>ابدأ أول مشروع، وبعدها ستجد الموقع والبوتات والتطبيقات من هذه الصفحة.</p></div>`;
    }
    return `<div class="account-project-list">${rows.map((item) => `
      <a class="account-project" href="${escapeHtml(internalHref(item.href, "/create-store"))}">
        <span class="account-project-icon">${escapeHtml(item.icon)}</span>
        <span class="account-project-copy"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.subtitle)}</small></span>
        <span class="account-status">${escapeHtml(statusLabel(item.status))}</span>
      </a>`).join("")}</div>`;
  }

  function notificationsHtml() {
    const items = state.account?.notifications || [];
    if (!items.length) {
      return `<div class="account-empty"><b>لا توجد إشعارات</b><p>ستظهر هنا تحديثات الطلبات والرصيد والأمان.</p></div>`;
    }
    return `<div class="account-notification-list">${items.map((item) => {
      const content = `<b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.body)}</p><time>${escapeHtml(formatDate(item.createdAt))}</time>`;
      return item.actionUrl
        ? `<a class="account-notification${item.isRead ? "" : " unread"}" href="${escapeHtml(internalHref(item.actionUrl))}">${content}</a>`
        : `<article class="account-notification${item.isRead ? "" : " unread"}">${content}</article>`;
    }).join("")}</div>`;
  }

  function ledgerHtml() {
    const items = state.account?.ledger || [];
    if (!items.length) {
      return `<div class="account-empty"><b>لا توجد حركات مالية</b><p>المحفظة جاهزة، وستظهر العمليات بعد تفعيل أول وسيلة شحن للمنصة.</p></div>`;
    }
    return `<div class="account-ledger-list">${items.map((item) => `
      <article class="account-ledger-entry">
        <div><b>${escapeHtml(item.description || item.type)}</b><small>${escapeHtml(formatDate(item.createdAt))}</small></div>
        <strong class="${item.amountMinor >= 0 ? "positive" : "negative"}">${escapeHtml(formatMoney(item.amountMinor, item.currency))}</strong>
      </article>`).join("")}</div>`;
  }

  function settingsHtml() {
    const user = state.account.user;
    const preferences = state.account.preferences;
    const notifications = preferences.notifications || {};
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return `
      <form id="accountSettingsForm" class="account-form">
        <label class="account-field">الاسم الكامل
          <input name="displayName" required maxlength="120" value="${escapeHtml(user.displayName)}">
        </label>
        <label class="account-field">البريد الإلكتروني
          <input type="email" value="${escapeHtml(user.email)}" readonly>
        </label>
        <label class="account-field">اللغة
          <select name="locale">
            <option value="ar"${preferences.locale === "ar" ? " selected" : ""}>العربية</option>
            <option value="en"${preferences.locale === "en" ? " selected" : ""}>English</option>
          </select>
        </label>
        <label class="account-field">العملة المفضلة
          <select name="currency">
            ${["USD", "EUR", "SAR", "AED", "TRY"].map((code) => `<option value="${code}"${preferences.currency === code ? " selected" : ""}>${code}</option>`).join("")}
          </select>
        </label>
        <label class="account-field">المنطقة الزمنية
          <input name="timezone" maxlength="80" value="${escapeHtml(preferences.timezone || browserTimezone)}">
        </label>
        <label class="account-field">رقم الهاتف
          <input name="phone" type="tel" maxlength="40" placeholder="+963..." value="${escapeHtml(preferences.phone || "")}">
        </label>
        <label class="account-field wide">معرف تيليجرام
          <input name="telegramUsername" maxlength="32" placeholder="username" value="${escapeHtml(preferences.telegramUsername || "")}">
        </label>
        <div class="account-check-grid">
          <label class="account-check"><input name="notifyOrders" type="checkbox"${notifications.orders !== false ? " checked" : ""}> تحديثات الطلبات</label>
          <label class="account-check"><input name="notifyWallet" type="checkbox"${notifications.wallet !== false ? " checked" : ""}> تحديثات الرصيد</label>
          <label class="account-check"><input name="notifySecurity" type="checkbox"${notifications.security !== false ? " checked" : ""}> تنبيهات الأمان</label>
          <label class="account-check"><input name="notifyMarketing" type="checkbox"${notifications.marketing === true ? " checked" : ""}> العروض والأخبار</label>
        </div>
        <div class="account-field wide">
          <button class="account-button" type="submit">حفظ الإعدادات</button>
        </div>
      </form>`;
  }

  function render() {
    const account = state.account;
    const wallet = account.wallet;
    const unread = account.counts.unreadNotifications;
    const totalProjects = Math.max(account.counts.projects, projectRows().length);
    document.body.className = "platform-account-page";
    document.body.innerHTML = `
      <a class="account-skip" href="#accountMain">تجاوز إلى المحتوى</a>
      <header class="account-header">
        <div class="account-shell account-header-inner">
          <a class="account-brand" href="/" aria-label="UCHIHA Builder">
            <img src="/assets/brand/platform-mark.svg" alt="" width="38" height="38">
            <span><b>UCHIHA</b><small>ACCOUNT</small></span>
          </a>
          <nav class="account-main-nav" aria-label="التنقل الرئيسي">
            <a href="/">الرئيسية</a>
            <a href="/services">الخدمات</a>
            <a href="/create-store">إنشاء مشروع</a>
            <a href="/account" aria-current="page">حسابي</a>
          </nav>
          <div class="account-header-actions">
            <a class="account-balance-pill" href="#walletSection"><small>الرصيد</small><b>${escapeHtml(formatMoney(wallet.availableMinor, wallet.currency))}</b></a>
            <button class="account-icon-button" type="button" data-open-notifications aria-label="الإشعارات">
              ${icon("bell")}${unread ? `<span class="account-notification-count">${Math.min(unread, 99)}</span>` : ""}
            </button>
            <button class="account-profile-button" type="button" data-open-settings>
              <span class="account-avatar">${escapeHtml(initials(account.user.displayName))}</span>
              <span>${escapeHtml(account.user.displayName)}</span>
            </button>
          </div>
        </div>
      </header>

      <main id="accountMain" class="account-shell account-main">
        <section class="account-hero">
          <span class="account-kicker">حساب UCHIHA المركزي</span>
          <h1>مرحبًا ${escapeHtml(account.user.displayName)}</h1>
          <p>من هنا ستدير الرصيد والمشاريع والمنتجات والتحديثات، سواء اشتريت من UCHIHA مباشرة أو أضفت منتجًا من متجر خارجي.</p>
          <div class="account-hero-actions">
            <a class="account-button" href="/services">استعراض الخدمات</a>
            <a class="account-button-secondary" href="/create-store">${icon("plus")} إنشاء مشروع</a>
          </div>
        </section>

        <section class="account-metrics" aria-label="ملخص الحساب">
          <article class="account-metric"><span>الرصيد المتاح</span><strong>${escapeHtml(formatMoney(wallet.availableMinor, wallet.currency))}</strong><small>${wallet.heldMinor ? `${formatMoney(wallet.heldMinor, wallet.currency)} محجوز` : "لا يوجد رصيد محجوز"}</small></article>
          <article class="account-metric"><span>المشاريع والخدمات</span><strong>${totalProjects}</strong><small>مرتبطة بهذا الحساب</small></article>
          <article class="account-metric"><span>المتاجر</span><strong>${account.counts.stores}</strong><small>متاجر تملك صلاحية إدارتها</small></article>
          <article class="account-metric"><span>الإشعارات الجديدة</span><strong>${unread}</strong><small>تنبيهات غير مقروءة</small></article>
        </section>

        <div class="account-layout">
          <div class="account-column">
            <section class="account-card">
              <div class="account-card-head"><div><h2>مشاريعي وخدماتي</h2><p>المتاجر والمكوّنات المرتبطة بحسابك.</p></div><a class="account-small-button" href="/services">إضافة خدمة</a></div>
              ${projectsHtml()}
            </section>

            <section id="walletSection" class="account-card">
              <div class="account-card-head"><div><h2>المحفظة</h2><p>سجل موحد لعمليات الشراء والشحن والاسترداد.</p></div><a class="account-small-button" href="/payment-methods">طرق الدفع</a></div>
              ${ledgerHtml()}
            </section>

            <section id="settingsSection" class="account-card">
              <div class="account-card-head"><div><h2>إعدادات الحساب</h2><p>بياناتك واللغة والعملة وتنبيهات UCHIHA.</p></div><button class="account-small-button" type="button" data-logout>${icon("logout")} خروج</button></div>
              <div id="accountFormNotice" class="account-notice" hidden></div>
              ${settingsHtml()}
            </section>
          </div>

          <aside class="account-column">
            <section class="account-card">
              <div class="account-card-head"><div><h2>إجراءات سريعة</h2><p>أهم ما تحتاجه دون ضياع.</p></div></div>
              <div class="account-quick-grid">
                <a class="account-action" href="/services">${icon("grid")}<span><b>الخدمات</b><small>بوتات ومواقع وتطبيقات</small></span></a>
                <a class="account-action" href="/create-store">${icon("store")}<span><b>مشروع جديد</b><small>ابدأ من معالج واضح</small></span></a>
                <a class="account-action" href="/payment-methods">${icon("payment")}<span><b>طرق الدفع</b><small>راجع الطرق المتاحة</small></span></a>
                <a class="account-action" href="/support">${icon("support")}<span><b>الدعم</b><small>تواصل مع UCHIHA</small></span></a>
              </div>
            </section>

            <section id="notificationsSection" class="account-card">
              <div class="account-card-head"><div><h2>الإشعارات</h2><p>التحديثات المهمة لحسابك.</p></div>${unread ? '<button class="account-small-button" type="button" data-read-all>تحديد الكل كمقروء</button>' : ""}</div>
              ${notificationsHtml()}
            </section>
          </aside>
        </div>
      </main>

      <footer class="account-footer">© ${new Date().getFullYear()} UCHIHA Builder — حساب واحد لكل مشاريعك الرقمية.</footer>
      <nav class="account-bottom-nav" aria-label="التنقل السفلي">
        <a href="/">${icon("home")}<span>الرئيسية</span></a>
        <a href="/services">${icon("grid")}<span>الخدمات</span></a>
        <a href="#walletSection">${icon("wallet")}<span>الرصيد</span></a>
        <a class="active" href="/account">${icon("user")}<span>حسابي</span></a>
      </nav>`;

    bindEvents();
  }

  function showNotice(message, error = false) {
    const node = document.getElementById("accountFormNotice");
    if (!node) return;
    node.hidden = false;
    node.classList.toggle("error", error);
    node.textContent = message;
  }

  function bindEvents() {
    document.querySelector("[data-open-notifications]")?.addEventListener("click", () => {
      document.getElementById("notificationsSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.querySelector("[data-open-settings]")?.addEventListener("click", () => {
      document.getElementById("settingsSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.querySelector("[data-read-all]")?.addEventListener("click", markAllRead);
    document.querySelector("[data-logout]")?.addEventListener("click", logout);
    document.getElementById("accountSettingsForm")?.addEventListener("submit", saveSettings);
  }

  async function saveSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const data = new FormData(form);
    button.disabled = true;
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
      showNotice("تم حفظ إعدادات الحساب بنجاح.");
      document.getElementById("settingsSection")?.scrollIntoView({ block: "start" });
    } catch (error) {
      showNotice(error.message, true);
    } finally {
      if (document.body.contains(button)) button.disabled = false;
    }
  }

  async function markAllRead(event) {
    const button = event.currentTarget;
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
      document.getElementById("notificationsSection")?.scrollIntoView({ block: "start" });
    } catch (error) {
      button.disabled = false;
      alert(error.message);
    }
  }

  async function logout(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await requestJson("/api/auth/logout", {
        method: "POST",
        headers: { "x-csrf-token": state.csrfToken }
      });
    } catch {
      // The local session should still be left even when the network response is lost.
    }
    location.assign("/login");
  }

  async function load() {
    renderLoading();
    try {
      const me = await requestJson("/api/me");
      state.me = me;
      state.csrfToken = me.csrfToken;
      const payload = await requestJson("/api/platform/account");
      state.account = payload.account;
      render();
    } catch (error) {
      if (error.status === 401) {
        location.replace("/login?next=/account");
        return;
      }
      renderError(error);
    }
  }

  load();
})();
