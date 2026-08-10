(() => {
  "use strict";

  if (document.body?.dataset.page !== "account") return;
  const RELEASE = "2026.08.10.2-proof-history";
  if (document.documentElement.dataset.proofHistory === RELEASE) return;
  document.documentElement.dataset.proofHistory = RELEASE;

  const slug = decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] || "");
  if (!slug) return;
  let loading = false;
  let lastLoadedAt = 0;

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function currencyMinorFactor(currency) {
    try {
      const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
      return 10 ** digits;
    } catch {
      return 100;
    }
  }

  function money(minor, currency) {
    try {
      return new Intl.NumberFormat("ar", { style: "currency", currency }).format(Number(minor || 0) / currencyMinorFactor(currency));
    } catch {
      return `${Number(minor || 0)} ${currency || ""}`;
    }
  }

  function status(status) {
    return ({
      pending: ["قيد المراجعة", "warning"],
      approved: ["مكتملة", "success"],
      rejected: ["مرفوضة", "danger"],
      cancelled: ["ملغية", "danger"]
    })[status] || [status || "—", "info"];
  }

  function ensureMount() {
    const list = document.getElementById("paymentsList");
    if (!list) return null;
    let mount = document.getElementById("walletProofHistory");
    if (mount) return mount;
    mount = document.createElement("section");
    mount.id = "walletProofHistory";
    mount.className = "card";
    mount.style.marginBottom = "14px";
    mount.innerHTML = `
      <div class="section-heading compact">
        <div><h2>إثباتات التحويل المباشرة</h2><p>الطلبات المرسلة برقم العملية أو صورة الإيصال.</p></div>
      </div>
      <div id="walletProofHistoryList" class="record-list"><div class="skeleton-list"></div></div>`;
    list.before(mount);
    return mount;
  }

  function render(proofs) {
    ensureMount();
    const list = document.getElementById("walletProofHistoryList");
    if (!list) return;
    if (!proofs.length) {
      list.innerHTML = '<div class="empty-state">لم ترسل أي إثبات تحويل مباشر بعد.</div>';
      return;
    }
    list.innerHTML = proofs.map((proof) => {
      const [label, tone] = status(proof.status);
      const method = proof.paymentMethod?.name || "طريقة دفع";
      const reference = proof.referenceText ? `رقم العملية: ${escapeHtml(proof.referenceText)}` : "تم إرسال صورة إيصال";
      const credited = proof.creditedAmountMinor
        ? `<div><span>الرصيد المضاف</span><b>${escapeHtml(money(proof.creditedAmountMinor, proof.currency))}</b></div>`
        : "";
      return `
        <article class="record-card">
          <div class="record-card-header">
            <span class="record-icon">▣</span>
            <div><h3>${escapeHtml(method)}</h3><p>#${escapeHtml(String(proof.id || "").slice(0, 8))} · ${reference}</p></div>
            <span class="status-pill ${tone}">${escapeHtml(label)}</span>
          </div>
          <div class="record-meta">
            <div><span>نوع الإثبات</span><b>${proof.hasImage ? "صورة إيصال" : "رقم عملية"}</b></div>
            ${credited}
          </div>
          ${proof.reviewReason ? `<p class="record-note">${escapeHtml(proof.reviewReason)}</p>` : ""}
        </article>`;
    }).join("");
  }

  async function load({ force = false } = {}) {
    const section = document.querySelector('[data-section="payments"]');
    if (!section || section.hidden || loading) return;
    if (!force && Date.now() - lastLoadedAt < 15_000) return;
    loading = true;
    ensureMount();
    try {
      const response = await fetch(`/api/public/stores/${encodeURIComponent(slug)}/wallet-proofs`, { credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "تعذر تحميل إثباتات التحويل");
      render(Array.isArray(payload.proofs) ? payload.proofs : []);
      lastLoadedAt = Date.now();
    } catch (error) {
      const list = document.getElementById("walletProofHistoryList");
      if (list) list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    } finally {
      loading = false;
    }
  }

  function install() {
    ensureMount();
    load({ force: true });
    let queued = false;
    const root = document.getElementById("accountApp") || document.body;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        load();
      });
    }).observe(root, { attributes: true, childList: true, subtree: true, attributeFilter: ["hidden"] });
    window.addEventListener("popstate", () => setTimeout(() => load({ force: true }), 0));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
