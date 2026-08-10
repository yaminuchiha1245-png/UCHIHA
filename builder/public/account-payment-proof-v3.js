(() => {
  "use strict";

  if (document.body?.dataset.page !== "account") return;
  const RELEASE = "2026.08.10.5-payment-proof";
  if (document.documentElement.dataset.paymentProofUi === RELEASE) return;
  document.documentElement.dataset.paymentProofUi = RELEASE;

  const slug = decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] || "");
  if (!slug) return;

  const state = {
    methods: [],
    selectedMethod: null,
    imageDataUrl: "",
    methodsLoading: false,
    methodsLoadedAt: 0
  };

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options
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

  function methodLogo(method) {
    const preferred = {
      sham_cash: "/assets/payment-assets/sham-cash.svg",
      binance_pay: "/assets/payment-assets/binance-pay.svg",
      usdt_trc20: "/assets/payment-assets/usdt.svg"
    };
    return preferred[method.type] || method.logoUrl || "/assets/payment-assets/manual-payment.svg";
  }

  function destinationText(destination = {}) {
    const candidates = [
      destination.address,
      destination.walletAddress,
      destination.wallet_address,
      destination.account,
      destination.accountNumber,
      destination.account_number,
      destination.payId,
      destination.pay_id,
      destination.wallet,
      destination.number,
      destination.phone,
      destination.value,
      destination.iban
    ];
    return candidates.find((value) => typeof value === "string" && value.trim())?.trim() || "—";
  }

  function paymentQrUrl(method) {
    if (method.qrUrl) return method.qrUrl;
    if (destinationText(method.destination) === "—") return "";
    return `/api/public/stores/${encodeURIComponent(slug)}/payment-proof-methods/${encodeURIComponent(method.id)}/qr`;
  }

  function methodSubtitle(method) {
    if (method.network) return method.network;
    return ({
      sham_cash: "Sham Cash",
      binance_pay: "Binance Pay",
      usdt_trc20: "USDT"
    })[method.type] || "تحويل يدوي";
  }

  function copyText(value) {
    if (!value || value === "—") return;
    navigator.clipboard?.writeText(value).then(() => showInlineSuccess("تم نسخ بيانات التحويل.")).catch(() => {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      showInlineSuccess("تم نسخ بيانات التحويل.");
    });
  }

  function showInlineSuccess(message, type = "ok") {
    const notice = $("paymentProofNotice");
    if (!notice) return;
    notice.className = type === "error" ? "notice error" : "payment-proof-success";
    notice.textContent = message;
    notice.hidden = false;
  }

  function clearInlineNotice() {
    const notice = $("paymentProofNotice");
    if (!notice) return;
    notice.hidden = true;
    notice.textContent = "";
  }

  function hideElement(node) {
    if (node && !node.hidden) node.hidden = true;
  }

  async function loadMethods({ force = false } = {}) {
    if (state.methodsLoading) return;
    if (!force && state.methods.length && Date.now() - state.methodsLoadedAt < 30_000) {
      renderMethods();
      return;
    }
    state.methodsLoading = true;
    try {
      const data = await requestJson(`/api/public/stores/${encodeURIComponent(slug)}/payment-proof-methods`);
      state.methods = (Array.isArray(data.methods) ? data.methods : []).filter(
        (method) => destinationText(method.destination) !== "—"
      );
      state.methodsLoadedAt = Date.now();
      renderMethods();
    } catch (error) {
      const container = $("paymentMethods");
      if (container && !container.querySelector("[data-proof-method]")) {
        container.dataset.proofLaunch = "true";
        container.innerHTML = `<div class="payment-proof-empty">${escapeHtml(error.status === 401 ? "سجّل الدخول أولًا لاستخدام طرق الدفع." : error.message)}</div>`;
      }
    } finally {
      state.methodsLoading = false;
    }
  }

  function renderMethods() {
    const container = $("paymentMethods");
    if (!container) return;
    container.dataset.proofLaunch = "true";
    if (!state.methods.length) {
      container.innerHTML = '<div class="payment-proof-empty">لا توجد طرق دفع مكتملة الإعداد حاليًا.</div>';
      return;
    }
    container.innerHTML = state.methods.map((method) => `
      <button class="payment-proof-method-card" data-proof-method="${escapeHtml(method.id)}" type="button">
        <span class="payment-proof-method-logo"><img src="${escapeHtml(methodLogo(method))}" alt=""></span>
        <b>${escapeHtml(method.name)}</b>
        <small>${escapeHtml(methodSubtitle(method))}</small>
      </button>`).join("");
    container.querySelectorAll("[data-proof-method]").forEach((button) => {
      button.addEventListener("click", () => {
        const method = state.methods.find((item) => item.id === button.dataset.proofMethod);
        if (method) openMethod(method);
      });
    });
  }

  function ensureProofPanel() {
    const form = $("depositForm");
    if (!form) return null;
    form.dataset.proofUi = "true";
    if ($("paymentProofPanel")) return $("paymentProofPanel");

    const panel = document.createElement("section");
    panel.id = "paymentProofPanel";
    panel.className = "payment-proof-panel";
    panel.innerHTML = `
      <p class="payment-proof-intro">بعد التحويل لا تحتاج إلى كتابة المبلغ. اختر إحدى الطريقتين التاليتين لإرسال الإثبات، وسيقوم فريق المتجر بمراجعة التحويل وإضافة الرصيد الصحيح إلى حسابك.</p>

      <article class="payment-proof-option">
        <div class="payment-proof-option-head">
          <i>№</i>
          <div><b>إرسال رقم العملية أو الإيصال</b><small>اكتب رقم الطلب أو رقم العملية الظاهر في تطبيق الدفع.</small></div>
        </div>
        <div class="payment-proof-reference-row">
          <input id="paymentProofReference" type="text" maxlength="180" autocomplete="off" placeholder="رقم العملية / رقم الإيصال">
          <button id="sendPaymentReference" class="payment-proof-send" type="button">إرسال الإثبات</button>
        </div>
      </article>

      <article class="payment-proof-option">
        <div class="payment-proof-option-head">
          <i>▣</i>
          <div><b>إرسال صورة الإيصال</b><small>اختر صورة واضحة من الاستديو ثم أرسلها مباشرة.</small></div>
        </div>
        <div class="payment-proof-image-row">
          <label class="payment-proof-file-label">
            <input id="paymentProofImage" type="file" accept="image/jpeg,image/png,image/webp">
            <span id="paymentProofImageName">اختر صورة الإيصال</span>
          </label>
          <button id="sendPaymentImage" class="payment-proof-send" type="button">إرسال الصورة</button>
        </div>
      </article>

      <p class="payment-proof-choice-note">يكفي استخدام إحدى الطريقتين. لا ترسل الإثبات مرتين لنفس التحويل.</p>
      <div id="paymentProofNotice" class="notice" hidden></div>`;

    const legacyNotice = $("depositNotice");
    if (legacyNotice) legacyNotice.before(panel);
    else form.append(panel);

    $("paymentProofReference")?.addEventListener("input", clearInlineNotice);
    $("paymentProofImage")?.addEventListener("change", readImage);
    $("sendPaymentReference")?.addEventListener("click", submitReference);
    $("sendPaymentImage")?.addEventListener("click", submitImage);
    return panel;
  }

  function renderMethodTools(method) {
    const transferInfo = document.querySelector("#paymentTransferStep .transfer-info");
    if (!transferInfo) return;
    hideElement(transferInfo.querySelector(".destination-box"));
    hideElement($("transferQr"));
    transferInfo.querySelector(".payment-proof-method-tools")?.remove();

    const destination = destinationText(method.destination);
    const qrUrl = paymentQrUrl(method);
    const tools = document.createElement("div");
    tools.className = "payment-proof-method-tools";
    tools.innerHTML = `
      <button class="payment-proof-copy-strip" type="button" data-copy-destination>
        <code>${escapeHtml(destination)}</code><span>نسخ</span>
      </button>
      ${qrUrl ? '<button class="payment-proof-qr-action" type="button" data-show-qr>عرض QR</button>' : '<span></span>'}`;
    transferInfo.append(tools);
    tools.querySelector("[data-copy-destination]")?.addEventListener("click", () => copyText(destination));
    tools.querySelector("[data-show-qr]")?.addEventListener("click", (event) => {
      const qr = $("transferQr");
      if (!qr) return;
      qr.src = qrUrl;
      qr.hidden = !qr.hidden;
      event.currentTarget.textContent = qr.hidden ? "عرض QR" : "إخفاء QR";
    });
  }

  function openMethod(method) {
    state.selectedMethod = method;
    state.imageDataUrl = "";
    clearInlineNotice();
    hideElement($("paymentMethodsStep"));
    const transferStep = $("paymentTransferStep");
    transferStep.hidden = false;
    transferStep.dataset.proofUi = "true";
    if ($("fundsSubtitle")) $("fundsSubtitle").textContent = "حوّل إلى البيانات التالية ثم أرسل رقم العملية أو صورة الإيصال.";
    if ($("transferMethodLogo")) {
      $("transferMethodLogo").src = methodLogo(method);
      $("transferMethodLogo").alt = method.name;
    }
    if ($("transferMethodName")) $("transferMethodName").textContent = method.name;
    if ($("transferMethodNetwork")) $("transferMethodNetwork").textContent = method.network || "";
    if ($("transferDestination")) $("transferDestination").textContent = destinationText(method.destination);
    if ($("transferInstructions")) $("transferInstructions").textContent = method.instructions || "حوّل إلى البيانات الموضحة ثم أرسل إثباتًا واحدًا للمراجعة.";
    renderMethodTools(method);
    ensureProofPanel();
    if ($("paymentProofReference")) $("paymentProofReference").value = "";
    if ($("paymentProofImage")) $("paymentProofImage").value = "";
    if ($("paymentProofImageName")) $("paymentProofImageName").textContent = "اختر صورة الإيصال";
    transferStep.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function readImage() {
    clearInlineNotice();
    const input = $("paymentProofImage");
    const file = input?.files?.[0];
    state.imageDataUrl = "";
    if (!file) {
      if ($("paymentProofImageName")) $("paymentProofImageName").textContent = "اختر صورة الإيصال";
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      input.value = "";
      showInlineSuccess("نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WebP.", "error");
      return;
    }
    if (file.size > 1_500_000) {
      input.value = "";
      showInlineSuccess("حجم الصورة كبير. اختر صورة أصغر من 1.5MB.", "error");
      return;
    }
    if ($("paymentProofImageName")) $("paymentProofImageName").textContent = file.name;
    const reader = new FileReader();
    reader.onload = () => { state.imageDataUrl = String(reader.result || ""); };
    reader.onerror = () => showInlineSuccess("تعذر قراءة الصورة. اختر صورة أخرى.", "error");
    reader.readAsDataURL(file);
  }

  async function currentCsrf() {
    const data = await requestJson(`/api/public/stores/${encodeURIComponent(slug)}/customer/me`);
    return data.csrfToken;
  }

  async function sendProof({ referenceText = "", proofDataUrl = "", button }) {
    const method = state.selectedMethod;
    if (!method) {
      showInlineSuccess("اختر طريقة الدفع أولًا.", "error");
      return;
    }
    clearInlineNotice();
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = "جارٍ الإرسال";
    try {
      const csrfToken = await currentCsrf();
      const data = await requestJson(`/api/public/stores/${encodeURIComponent(slug)}/wallet-proofs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-customer-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID()
        },
        body: JSON.stringify({
          paymentMethodId: method.id,
          referenceText: referenceText || undefined,
          proofDataUrl: proofDataUrl || undefined
        })
      });
      const shortId = String(data.proof?.id || "").slice(0, 8);
      showInlineSuccess(`تم إرسال الإثبات${shortId ? ` رقم ${shortId}` : ""}. سيقوم فريق المتجر بمراجعة التحويل وإضافة الرصيد الصحيح إلى حسابك.`);
      if (referenceText && $("paymentProofReference")) $("paymentProofReference").value = "";
      if (proofDataUrl && $("paymentProofImage")) {
        $("paymentProofImage").value = "";
        state.imageDataUrl = "";
        $("paymentProofImageName").textContent = "اختر صورة الإيصال";
      }
    } catch (error) {
      showInlineSuccess(error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = previous;
    }
  }

  async function submitReference() {
    const reference = $("paymentProofReference")?.value?.trim() || "";
    if (!reference) {
      showInlineSuccess("اكتب رقم العملية أو رقم الإيصال أولًا.", "error");
      return;
    }
    await sendProof({ referenceText: reference, button: $("sendPaymentReference") });
  }

  async function submitImage() {
    if (!state.imageDataUrl) {
      showInlineSuccess("اختر صورة الإيصال أولًا.", "error");
      return;
    }
    await sendProof({ proofDataUrl: state.imageDataUrl, button: $("sendPaymentImage") });
  }

  function suppressLegacyDepositUi() {
    const form = $("depositForm");
    const step = $("paymentTransferStep");
    if (form && form.dataset.proofUi !== "true") form.dataset.proofUi = "true";
    if (step && step.dataset.proofUi !== "true") step.dataset.proofUi = "true";
    hideElement($("depositAmount")?.closest("label"));
    hideElement($("depositProof")?.closest("label"));
    hideElement($("submitDeposit"));
    hideElement(form?.querySelector(".calculation-box"));
    step?.querySelectorAll(".info-row").forEach(hideElement);
  }

  function bindBackRefresh() {
    const back = $("backToMethods");
    if (!back || back.dataset.proofRefresh === "true") return;
    back.dataset.proofRefresh = "true";
    back.addEventListener("click", () => {
      state.selectedMethod = null;
      setTimeout(() => loadMethods({ force: true }), 0);
    });
  }

  function normalize() {
    suppressLegacyDepositUi();
    bindBackRefresh();
    const addFunds = document.querySelector('[data-section="add-funds"]');
    if (!addFunds || addFunds.hidden) return;
    const container = $("paymentMethods");
    if (container && !container.querySelector("[data-proof-method]") && !$("paymentTransferStep")?.hidden) {
      ensureProofPanel();
    }
    if (container && !container.querySelector("[data-proof-method]") && $("paymentTransferStep")?.hidden !== false) {
      loadMethods();
    }
  }

  function install() {
    normalize();
    let queued = false;
    const target = $("accountApp") || document.body;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        normalize();
      });
    }).observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
