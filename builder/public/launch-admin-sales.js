(() => {
  "use strict";

  async function api(path, { method = "GET", body, csrf } = {}) {
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrf) headers["x-csrf-token"] = csrf;
    const response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store"
    });
    const data = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.message || "تعذر إكمال العملية");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function escape(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function minorFactor(currency = "USD") {
    try {
      const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
      return 10 ** digits;
    } catch {
      return 100;
    }
  }

  function money(minor, currency = "USD") {
    const major = Number(minor || 0) / minorFactor(currency);
    try { return new Intl.NumberFormat("ar", { style: "currency", currency }).format(major); }
    catch { return `${major.toFixed(2)} ${currency}`; }
  }

  function date(value) {
    return value ? new Intl.DateTimeFormat("ar-SY", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
  }

  function installStyles() {
    if (document.querySelector("style[data-launch-admin-sales]")) return;
    const style = document.createElement("style");
    style.dataset.launchAdminSales = "true";
    style.textContent = `.launch-admin-table{width:100%;border-collapse:collapse;min-width:820px}.launch-admin-wrap{overflow:auto}.launch-admin-table th,.launch-admin-table td{padding:11px;border-bottom:1px solid #e2e5eb;text-align:start;vertical-align:top}.launch-admin-table small{display:block;margin-top:4px;opacity:.75}.launch-admin-buttons{display:flex;gap:7px;flex-wrap:wrap}.launch-admin-buttons button{min-height:38px;padding:7px 11px;border:0;border-radius:9px;font:inherit;font-weight:800;cursor:pointer}.launch-approve{background:#176a43;color:#fff}.launch-reject{background:#8f3044;color:#fff}.launch-offer-form{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.launch-offer-form label{display:grid;gap:6px;min-width:0;font-weight:700}.launch-offer-form input,.launch-offer-form select{width:100%;min-width:0;min-height:42px;padding:8px 10px;border:1px solid #d8dce4;border-radius:10px;font:inherit}.launch-offer-form .wide{grid-column:span 2}.launch-offer-check{display:flex!important;align-items:center;gap:8px!important}.launch-offer-check input{width:auto;min-height:auto}.launch-offer-form button{align-self:end;min-height:44px}.launch-offer-hint{grid-column:1/-1;font-size:.82rem;opacity:.72}@media(max-width:900px){.launch-offer-form{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.launch-offer-form{grid-template-columns:1fr}.launch-offer-form .wide{grid-column:auto}}`;
    document.head.append(style);
  }

  async function install() {
    if (!document.body?.classList.contains("platform-admin-page")) return;
    installStyles();
    const content = document.getElementById("platformContent");
    const nav = document.getElementById("platformNav");
    if (!content || !nav) return;
    let rendering = false;

    async function render() {
      if (!nav.querySelector('[data-section="subscriptions"].active') || rendering) return;
      rendering = true;
      try {
        const [me, data, offerData] = await Promise.all([
          api("/api/me"),
          api("/api/platform/subscription-requests"),
          api("/api/platform/subscription-offer")
        ]);
        const csrf = me.csrfToken || "";
        const offer = offerData.offer || {};
        const factor = minorFactor(offer.currency || "USD");
        const priceMajor = Number(offer.priceMinor || 0) / factor;
        const renewalMajor = Number(offer.renewalPriceMinor || 0) / factor;
        const rows = (data.requests || []).map((item) => {
          const metadata = item.metadata || {};
          const terminal = ["completed", "rejected", "cancelled"].includes(item.status);
          const actions = terminal ? "—" : `<div class="launch-admin-buttons"><button class="launch-approve" type="button" data-launch-review="approve" data-id="${escape(item.id)}">اعتماد وتفعيل</button><button class="launch-reject" type="button" data-launch-review="reject" data-id="${escape(item.id)}">رفض</button></div>`;
          return `<tr><td><strong>${escape(item.customerName || "—")}</strong><small dir="ltr">${escape(item.customerEmail || item.userId || "—")}</small></td><td><strong>${escape(metadata.offerName || "UCHIHA Full")}</strong><small>${escape(money(metadata.amountMinor, metadata.currency))}</small></td><td>${escape(metadata.paymentMethodName || "—")}<small>${escape(metadata.paymentNetwork || "")}</small></td><td dir="ltr">${escape(metadata.paymentReference || "—")}</td><td>${escape(item.status)}</td><td>${escape(date(item.createdAt))}</td><td>${actions}</td></tr>`;
        }).join("");
        content.innerHTML = `<div class="section-heading"><div><span class="section-kicker">UCHIHA SALES</span><h2>الاشتراك وطلبات التفعيل</h2><p>حدّد سعر الاشتراك، ثم تحقّق من كل تحويل قبل الموافقة.</p></div><button id="launchRefreshSubscriptions" class="primary-button" type="button">تحديث</button></div>
          <section class="admin-panel"><h3>إعداد عرض البيع</h3><form id="launchOfferForm" class="launch-offer-form">
            <label class="wide">اسم الاشتراك<input name="name" maxlength="120" required value="${escape(offer.name || "UCHIHA Full")}"></label>
            <label>السعر<input name="price" type="number" min="0" step="any" required value="${escape(priceMajor)}"></label>
            <label>سعر التجديد<input name="renewalPrice" type="number" min="0" step="any" required value="${escape(renewalMajor)}"></label>
            <label>العملة<input name="currency" maxlength="12" pattern="[A-Za-z0-9]{2,12}" required dir="ltr" value="${escape(offer.currency || "USD")}"></label>
            <label>المدة<input name="durationCount" type="number" min="1" max="3650" required value="${escape(offer.durationCount || 1)}"></label>
            <label>وحدة المدة<select name="durationUnit"><option value="day" ${offer.durationUnit === "day" ? "selected" : ""}>يوم</option><option value="month" ${!offer.durationUnit || offer.durationUnit === "month" ? "selected" : ""}>شهر</option><option value="year" ${offer.durationUnit === "year" ? "selected" : ""}>سنة</option></select></label>
            <label class="launch-offer-check"><input name="saleEnabled" type="checkbox" ${offer.saleEnabled ? "checked" : ""}>متاح للبيع</label>
            <label class="launch-offer-check"><input name="renewalEnabled" type="checkbox" ${offer.renewalEnabled ? "checked" : ""}>التجديد متاح</label>
            <small class="launch-offer-hint">يمكن استخدام رموز مثل USD وTRY وSYP وUSDT. تغيير السعر لا يعدّل الطلبات المدفوعة القديمة تلقائيًا؛ مراجعتها ستتوقف إذا اختلف السعر لحمايتك.</small>
            <button class="primary-button" type="submit">حفظ الاشتراك</button>
          </form></section>
          <section class="admin-panel launch-admin-wrap"><h3>طلبات التفعيل</h3><table class="launch-admin-table"><thead><tr><th>العميل</th><th>العرض</th><th>الدفع</th><th>مرجع التحويل</th><th>الحالة</th><th>التاريخ</th><th>الإجراء</th></tr></thead><tbody>${rows || '<tr><td colspan="7">لا توجد طلبات تفعيل حاليًا.</td></tr>'}</tbody></table></section>`;
        content.dataset.launchSubscriptions = "true";
        document.getElementById("launchRefreshSubscriptions")?.addEventListener("click", () => {
          content.dataset.launchSubscriptions = "false";
          render();
        });
        document.getElementById("launchOfferForm")?.addEventListener("submit", async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const button = form.querySelector('button[type="submit"]');
          const values = Object.fromEntries(new FormData(form).entries());
          const currency = String(values.currency || "USD").trim().toUpperCase();
          const nextFactor = minorFactor(currency);
          button.disabled = true;
          try {
            await api("/api/platform/subscription-offer", {
              method: "PATCH",
              csrf,
              body: {
                name: values.name,
                priceMinor: Math.round(Number(values.price) * nextFactor),
                renewalPriceMinor: Math.round(Number(values.renewalPrice) * nextFactor),
                currency,
                durationUnit: values.durationUnit,
                durationCount: Number(values.durationCount),
                saleEnabled: form.elements.saleEnabled.checked,
                renewalEnabled: form.elements.renewalEnabled.checked
              }
            });
            content.dataset.launchSubscriptions = "false";
            rendering = false;
            await render();
          } catch (error) {
            window.alert(error.message);
            button.disabled = false;
          }
        });
        content.querySelectorAll("[data-launch-review]").forEach((button) => button.addEventListener("click", async () => {
          const decision = button.dataset.launchReview;
          const message = decision === "approve" ? "هل تحققت من التحويل وتريد تفعيل الاشتراك؟" : "هل تريد رفض طلب التفعيل؟";
          if (!window.confirm(message)) return;
          button.disabled = true;
          try {
            await api(`/api/platform/subscription-requests/${button.dataset.id}/review`, { method: "POST", csrf, body: { decision } });
            content.dataset.launchSubscriptions = "false";
            rendering = false;
            await render();
          } catch (error) {
            window.alert(error.message);
            button.disabled = false;
          }
        }));
      } catch (error) {
        if (![401, 403].includes(error.status)) content.innerHTML = `<section class="admin-panel"><p>${escape(error.message)}</p></section>`;
      } finally {
        rendering = false;
      }
    }

    nav.addEventListener("click", (event) => {
      if (event.target.closest('[data-section="subscriptions"]')) window.setTimeout(render, 20);
    });
    new MutationObserver(() => {
      if (nav.querySelector('[data-section="subscriptions"].active') && content.dataset.launchSubscriptions !== "true") window.setTimeout(render, 20);
    }).observe(content, { childList: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
