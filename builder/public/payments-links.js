(() => {
  const page = document.body.dataset.page;
  const parts = location.pathname.split("/").filter(Boolean);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[char]);
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && typeof options.body !== "string") {
      headers["content-type"] = "application/json";
      options.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, { credentials: "same-origin", ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || "تعذر إكمال العملية");
      error.status = response.status;
      error.code = data.error;
      error.details = data.details;
      throw error;
    }
    return data;
  }

  if (page === "store") {
    const slug = decodeURIComponent(parts[1] || "");
    const walletUrl = `/store/${encodeURIComponent(slug)}/wallet`;
    document.querySelectorAll("[data-wallet-link]").forEach((link) => {
      link.href = `${walletUrl}${link.dataset.walletSection || ""}`;
    });
    document.querySelectorAll("[data-support-link]").forEach((link) => {
      link.href = `/store/${encodeURIComponent(slug)}/support`;
    });

    const form = document.querySelector("#orderForm");
    const notice = document.querySelector("#orderNotice");
    const normalSubmit = form?.querySelector('button[value="submit"]');
    if (form && normalSubmit) {
      const walletButton = document.createElement("button");
      walletButton.type = "button";
      walletButton.dataset.walletPurchase = "true";
      walletButton.className = "store-button store-button-secondary";
      walletButton.textContent = "شراء من رصيد الحساب";
      walletButton.style.marginTop = "8px";
      normalSubmit.insertAdjacentElement("afterend", walletButton);

      const resetWalletAttempt = () => {
        delete walletButton.dataset.idempotencyKey;
        walletButton.disabled = false;
        walletButton.textContent = "شراء من رصيد الحساب";
      };
      form.addEventListener("input", resetWalletAttempt);
      form.addEventListener("change", resetWalletAttempt);
      form.addEventListener("uchiha:order-opened", resetWalletAttempt);

      walletButton.addEventListener("click", async () => {
        const original = walletButton.textContent;
        walletButton.disabled = true;
        walletButton.textContent = "جارٍ التحقق من الرصيد...";
        if (notice) {
          notice.hidden = true;
          notice.textContent = "";
        }
        try {
          const session = await api(`/api/public/stores/${encodeURIComponent(slug)}/customer/me`);
          if (!form.elements.customerName.value) form.elements.customerName.value = session.customer.displayName || "";
          if (!form.elements.customerEmail.value) form.elements.customerEmail.value = session.customer.email || "";
          if (!form.reportValidity()) {
            walletButton.disabled = false;
            walletButton.textContent = original;
            return;
          }
          const values = Object.fromEntries(new FormData(form));
          const inputData = {};
          for (const [key, value] of Object.entries(values)) {
            if (key.startsWith("input_")) inputData[key.slice(6)] = value;
          }
          const result = await api(`/api/public/stores/${encodeURIComponent(slug)}/orders/wallet`, {
            method: "POST",
            headers: {
              "x-customer-csrf-token": session.csrfToken,
              "idempotency-key": walletButton.dataset.idempotencyKey || (walletButton.dataset.idempotencyKey = crypto.randomUUID())
            },
            body: {
              items: [
                {
                  productId: values.productId,
                  quantity: Number(values.quantity || 1),
                  inputData
                }
              ]
            }
          });
          if (notice) {
            notice.hidden = false;
            notice.className = "notice success";
            notice.innerHTML = `تم الدفع من الرصيد وإنشاء الطلب <b>${escapeHtml(result.order.orderNumber)}</b>.`;
          }
          normalSubmit.disabled = true;
          walletButton.disabled = true;
          walletButton.textContent = "تم الدفع من الرصيد";
        } catch (error) {
          if (error.status === 401) {
            const next = `${location.pathname}${location.search}${location.hash}`;
            location.href = `${walletUrl}?next=${encodeURIComponent(next)}`;
            return;
          }
          if (notice) {
            notice.hidden = false;
            notice.className = "notice error";
            notice.textContent = error.message;
          }
          walletButton.disabled = false;
          walletButton.textContent = original;
        }
      });
    }
  }

  if (page === "admin") {
    const storeId = decodeURIComponent(parts[1] || "");
    document.querySelectorAll("[data-payments-link]").forEach((link) => {
      link.href = `/admin/${encodeURIComponent(storeId)}/payments`;
    });
    document.querySelectorAll("[data-intelligence-link]").forEach((link) => {
      link.href = `/admin/${encodeURIComponent(storeId)}/product-intelligence`;
    });
    document.querySelectorAll("[data-support-admin-link]").forEach((link) => {
      link.href = `/admin/${encodeURIComponent(storeId)}/support`;
    });
  }
})();
