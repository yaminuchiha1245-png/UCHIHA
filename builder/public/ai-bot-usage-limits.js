(() => {
  "use strict";

  const section = document.querySelector("#limitsSection");
  const form = document.querySelector("#limitsForm");
  const usage = document.querySelector("#limitsUsageToday");
  const manager = document.querySelector("#managerSection");
  if (!section || !form || !usage || !manager) return;

  let loadedInstance = "";
  let loading = false;

  function currentInstanceId() {
    return new URLSearchParams(location.search).get("instance") || "";
  }

  function csrf() {
    return sessionStorage.getItem("uchihaBuilderCsrf") || "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toast(message, error = false) {
    const node = document.querySelector("#toast");
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("error", error);
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.hidden = true; }, 4200);
  }

  async function api(path, { method = "GET", body } = {}) {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : {
          "content-type": "application/json",
          "x-csrf-token": csrf()
        })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "تعذر تحميل حدود الاستخدام");
    return payload;
  }

  function stat(label, value) {
    return `<article class="ai-stat"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></article>`;
  }

  function render(payload) {
    const limits = payload.limits || {};
    const today = payload.usageToday || {};
    form.elements.freeDailyRequests.value = Number(limits.freeDailyRequests ?? 30);
    form.elements.proDailyRequests.value = Number(limits.proDailyRequests ?? 300);
    form.elements.freeDailyImages.value = Number(limits.freeDailyImages ?? 2);
    form.elements.proDailyImages.value = Number(limits.proDailyImages ?? 30);
    usage.innerHTML = [
      stat("طلبات اليوم", String(Number(today.requests || 0))),
      stat("صور اليوم", String(Number(today.images || 0))),
      stat("مستخدمون نشطون اليوم", String(Number(today.activeUsers || 0)))
    ].join("");
    section.hidden = false;
  }

  async function load(force = false) {
    const instanceId = currentInstanceId();
    if (!instanceId || manager.hidden || loading || (!force && loadedInstance === instanceId)) {
      if (!instanceId) section.hidden = true;
      return;
    }
    loading = true;
    try {
      const payload = await api(`/api/platform/ai-bots/${encodeURIComponent(instanceId)}/limits`);
      loadedInstance = instanceId;
      render(payload);
    } catch (error) {
      section.hidden = true;
      if (error.message) toast(error.message, true);
    } finally {
      loading = false;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const instanceId = currentInstanceId();
    if (!instanceId) return;
    const button = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form).entries());
    button.disabled = true;
    try {
      await api(`/api/platform/ai-bots/${encodeURIComponent(instanceId)}/limits`, {
        method: "PATCH",
        body: {
          freeDailyRequests: Number(values.freeDailyRequests),
          proDailyRequests: Number(values.proDailyRequests),
          freeDailyImages: Number(values.freeDailyImages),
          proDailyImages: Number(values.proDailyImages)
        }
      });
      toast("تم حفظ حدود الاستخدام");
      loadedInstance = "";
      await load(true);
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  const observer = new MutationObserver(() => {
    const current = currentInstanceId();
    if (current !== loadedInstance) load();
  });
  observer.observe(manager, { attributes: true, childList: true, subtree: true });
  window.addEventListener("popstate", () => {
    loadedInstance = "";
    load(true);
  });
  setTimeout(() => load(true), 0);
})();