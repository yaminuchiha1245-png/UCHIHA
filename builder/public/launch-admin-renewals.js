(() => {
  "use strict";

  if (!document.body?.classList.contains("platform-admin-page")) return;

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function minorFactor(currency = "USD") {
    try {
      return 10 ** new Intl.NumberFormat("en", { style: "currency", currency })
        .resolvedOptions().maximumFractionDigits;
    } catch {
      return 100;
    }
  }

  function money(minor, currency = "USD") {
    const major = Number(minor || 0) / minorFactor(currency);
    try {
      return new Intl.NumberFormat("ar", { style: "currency", currency }).format(major);
    } catch {
      return `${major.toFixed(2)} ${currency}`;
    }
  }

  function date(value) {
    if (!value) return "—";
    try {
      return new Intl.DateTimeFormat("ar-SY", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
    } catch {
      return "—";
    }
  }

  async function api(path, { method = "GET", body, csrf = "" } = {}) {
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrf) headers["x-csrf-token"] = csrf;
    const response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.message || "تعذر إكمال العملية");
      error.status = response.status;
      error.code = payload?.error;
      throw error;
    }
    return payload;
  }

  function installStyles() {
    if (document.querySelector("style[data-launch-admin-renewals]")) return;
    const style = document.createElement("style");
    style.dataset.launchAdminRenewals = "true";
    style.textContent = `.launch-renewal-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.launch-renewal-badge{display:inline-flex;padding:4px 8px;border-radius:999px;background:#fff4db;color:#845400;font-size:.78rem;font-weight:800}.launch-renewal-meta{display:grid;gap:3px}.launch-renewal-meta small{opacity:.72}.launch-renewal-empty{padding:18px;text-align:center;opacity:.75}`;
    document.head.append(style);
  }

  async function install() {
    installStyles();
    const nav = document.getElementById("platformNav");
    const content = document.getElementById("platformContent");
    if (!nav || !content) return;
    let loading = false;

    async function renderRenewals() {
      if (loading) return;
      if (!nav.querySelector('[data-section="subscriptions"].active')) return;
      if (content.dataset.launchSubscriptions !== "true") return;
      if (content.querySelector("[data-launch-renewals]")) return;
      loading = true;
      try {
        const [me, data] = await Promise.all([
          api("/api/me"),
          api("/api/platform/subscription-renewals")
        ]);
        const csrf = me.csrfToken || "";
        const rows = data.requests || [];
        const section = document.createElement("section");
        section.className = "admin-panel launch-admin-wrap";
        section.dataset.launchRenewals = "true";
        const tableRows = rows.map((item) => {
          const metadata = item.metadata || {};
          const terminal = ["completed", "rejected", "cancelled"].includes(item.status);
          const actions = terminal
            ? "—"
            : `<div class="launch-admin-buttons"><button class="launch-approve" type="button" data-renewal-review="approve" data-id="${escapeHtml(item.id)}">اعتماد التجديد</button><button class="launch-reject" type="button" data-renewal-review="reject" data-id="${escapeHtml(item.id)}">رفض</button></div>`;
          return `<tr>
            <td><div class="launch-renewal-meta"><strong>${escapeHtml(metadata.storeName || "متجر UCHIHA")}</strong><small>${escapeHtml(item.customerName || item.customerEmail || item.userId || "—")}</small></div></td>
            <td><strong>${escapeHtml(money(metadata.amountMinor, metadata.currency || "USD"))}</strong><small>${escapeHtml(metadata.offerName || "UCHIHA Full")}</small></td>
            <td>${escapeHtml(metadata.paymentMethodName || "—")}<small>${escapeHtml(metadata.paymentNetwork || "")}</small></td>
            <td dir="ltr">${escapeHtml(metadata.paymentReference || "—")}</td>
            <td><span class="launch-renewal-badge">${escapeHtml(item.status || "new")}</span></td>
            <td>${escapeHtml(date(item.createdAt))}</td>
            <td>${actions}</td>
          </tr>`;
        }).join("");
        section.innerHTML = `
          <div class="launch-renewal-summary">
            <div><h3>طلبات تجديد الاشتراك</h3><p>تحقق من مرجع التحويل قبل الاعتماد. الاعتماد يمدد الاشتراك ويعيد المتجر فقط إذا كان متوقفًا بسبب انتهاء الاشتراك.</p></div>
            <button class="primary-button" type="button" data-refresh-renewals>تحديث التجديدات</button>
          </div>
          <table class="launch-admin-table">
            <thead><tr><th>المتجر / العميل</th><th>المبلغ</th><th>طريقة الدفع</th><th>مرجع التحويل</th><th>الحالة</th><th>التاريخ</th><th>الإجراء</th></tr></thead>
            <tbody>${tableRows || '<tr><td colspan="7" class="launch-renewal-empty">لا توجد طلبات تجديد حاليًا.</td></tr>'}</tbody>
          </table>`;
        content.append(section);

        section.querySelector("[data-refresh-renewals]")?.addEventListener("click", () => {
          section.remove();
          renderRenewals();
        });

        section.querySelectorAll("[data-renewal-review]").forEach((button) => {
          button.addEventListener("click", async () => {
            const decision = button.dataset.renewalReview;
            const confirmMessage = decision === "approve"
              ? "هل تحققت من التحويل وتريد اعتماد التجديد؟"
              : "هل تريد رفض طلب التجديد؟";
            if (!window.confirm(confirmMessage)) return;
            button.disabled = true;
            try {
              const result = await api(`/api/platform/subscription-renewals/${encodeURIComponent(button.dataset.id)}/review`, {
                method: "POST",
                csrf,
                body: { decision }
              });
              if (decision === "approve") {
                const suffix = result.reactivated ? " وتمت إعادة المتجر بعد انتهاء الاشتراك." : ".";
                window.alert(`تم اعتماد التجديد${suffix}`);
              }
              section.remove();
              await renderRenewals();
            } catch (error) {
              window.alert(error.message);
              button.disabled = false;
            }
          });
        });
      } catch (error) {
        if (![401, 403].includes(error.status)) {
          const section = document.createElement("section");
          section.className = "admin-panel";
          section.dataset.launchRenewals = "true";
          section.textContent = `تعذر تحميل طلبات التجديد: ${error.message}`;
          content.append(section);
        }
      } finally {
        loading = false;
      }
    }

    nav.addEventListener("click", () => window.setTimeout(renderRenewals, 60));
    new MutationObserver(() => window.setTimeout(renderRenewals, 40))
      .observe(content, { childList: true, subtree: false });
    renderRenewals();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
