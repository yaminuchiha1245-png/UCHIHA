(() => {
  "use strict";

  const protectedSlugs = new Set(["uchiha-v1", "uchiha-v2"]);
  const form = document.querySelector("#addModelForm");
  const grid = document.querySelector("#modelsGrid");
  if (!form || !grid) return;

  function instanceId() {
    return new URLSearchParams(location.search).get("instance") || "";
  }

  function csrf() {
    return sessionStorage.getItem("uchihaBuilderCsrf") || "";
  }

  function showMessage(message, error = false) {
    const toast = document.querySelector("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle("error", error);
    toast.hidden = false;
    clearTimeout(showMessage.timer);
    showMessage.timer = setTimeout(() => { toast.hidden = true; }, 4200);
  }

  async function mutate(path, { method, body } = {}) {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-csrf-token": csrf()
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "تعذر تنفيذ العملية");
    return payload;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = instanceId();
    if (!id) {
      showMessage("اختر البوت الذي تريد إدارة نماذجه أولًا.", true);
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form).entries());
    button.disabled = true;
    try {
      await mutate(`/api/platform/ai-bots/${encodeURIComponent(id)}/models`, {
        method: "POST",
        body: values
      });
      showMessage("تمت إضافة النموذج إلى البوت.");
      location.reload();
    } catch (error) {
      showMessage(error.message, true);
      button.disabled = false;
    }
  });

  function decorateModelCards() {
    const id = instanceId();
    if (!id) return;
    grid.querySelectorAll("form[data-model]").forEach((card) => {
      const slug = card.dataset.model || "";
      if (!slug || protectedSlugs.has(slug) || card.querySelector("[data-delete-model]")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ai-button ai-secondary ai-small";
      button.dataset.deleteModel = slug;
      button.textContent = "حذف النموذج";
      button.addEventListener("click", async () => {
        if (!window.confirm("حذف هذا النموذج؟ سيتم نقل مستخدميه إلى النموذج المجاني تلقائيًا.")) return;
        button.disabled = true;
        try {
          await mutate(`/api/platform/ai-bots/${encodeURIComponent(id)}/models/${encodeURIComponent(slug)}`, {
            method: "DELETE"
          });
          showMessage("تم حذف النموذج.");
          location.reload();
        } catch (error) {
          showMessage(error.message, true);
          button.disabled = false;
        }
      });
      card.append(button);
    });
  }

  new MutationObserver(decorateModelCards).observe(grid, { childList: true });
  decorateModelCards();
})();