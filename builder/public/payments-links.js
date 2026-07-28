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
      error.details = data.details;
      throw error;
    }
    return data;
  }

  if (page === "store") {
    const slug = decodeURIComponent(parts[1] || "");
    const walletUrl = `/store/${encodeURIComponent(slug)}/wallet`;
    document.querySelectorAll("[data-wallet-link]").forEach((link) => {
      link.href = walletUrl;
    });

    const form = document.querySelector("#orderForm");
    const notice = document.querySelector("#orderNotice");
    const normalSubmit = form?.querySelector('button[value="submit"]');
    if (form && normalSubmit) {
      const walletButton = document.createElement("button");
      walletButton.type = "button";
      walletButton.className = "store-button store-button-secondary";
      walletButton.textContent = "شراء من رصيد الحساب";
      walletButton.style.marginTop = "8px";
      normalSubmit.insertAdjacentElement("afterend", walletButton);

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
          const values = Object.fromEntries(new FormData(form));
          const inputData = {};
          for (const [key, value] of Object.entries(values)) {
            if (key.startsWith("input_")) inputData[key.slice(6)] = value;
          }
          const result = await api(`/api/public/stores/${encodeURIComponent(slug)}/orders/wallet`, {
            method: "POST",
            headers: {
              "x-customer-csrf-token": session.csrfToken,
              "idempotency-key": crypto.randomUUID()
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
            location.href = walletUrl;
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
  }
})();
