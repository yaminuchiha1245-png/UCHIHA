(() => {
  const storeId = decodeURIComponent(location.pathname.split("/")[2] || "");
  const state = { csrf: "", channels: [], identityOffset: 0, identityHasMore: false };
  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function dateTime(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }

  function showNotice(message, type = "error") {
    const node = $("accountAdminNotice");
    node.hidden = false;
    node.className = `notice ${type}`;
    node.textContent = message;
    node.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function hideNotice() {
    const node = $("accountAdminNotice");
    node.hidden = true;
    node.textContent = "";
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
      throw error;
    }
    return data;
  }

  const statusLabel = (value) => ({
    draft: "مسودة", pending_review: "قيد المراجعة", changes_required: "يحتاج تعديل",
    verified: "موثق", rejected: "مرفوض", active: "نشط", hidden: "مخفي", disabled: "معطل"
  })[value] || value;

  function setTab(name) {
    document.querySelectorAll("[data-admin-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.adminTab === name);
    });
    document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
      const active = panel.dataset.adminPanel === name;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
  }

  async function loadExperience() {
    const data = await api(`/api/stores/${encodeURIComponent(storeId)}/experience-settings`);
    const form = $("experienceSettingsForm");
    const settings = data.settings;
    form.elements.identityVerificationEnabled.checked = settings.identityVerificationEnabled;
    form.elements.identityFileMaxMb.value = (settings.identityFileMaxBytes / 1_000_000).toFixed(1);
    form.elements.identityRetentionDays.value = settings.identityRetentionDays;
    form.elements.floatingSupportEnabled.checked = settings.floatingSupportEnabled;
    form.elements.lightModeEnabled.checked = settings.lightModeEnabled;
    form.elements.storefrontApiEnabled.checked = settings.storefrontApiEnabled;
    form.elements.internalTransferEnabled.checked = settings.internalTransferEnabled;
    form.elements.withdrawalEnabled.checked = settings.withdrawalEnabled;
    form.elements.builderPromoUrl.value = settings.builderPromoUrl || "";
    form.elements.builderPromoImageUrl.value = settings.builderPromoImageUrl || "";
  }

  function resetSupportForm() {
    const form = $("supportChannelForm");
    form.reset();
    form.elements.id.value = "";
    form.elements.sortOrder.value = "0";
    form.elements.status.value = "active";
  }

  function renderChannels() {
    const list = $("supportChannelList");
    if (!state.channels.length) {
      list.innerHTML = '<div class="empty-admin">لم تضف وسائل تواصل بعد.</div>';
      return;
    }
    list.innerHTML = state.channels.map((channel) => `
      <article class="admin-list-item" data-channel-id="${escapeHtml(channel.id)}">
        <div>
          <strong>${escapeHtml(channel.name)}</strong>
          <span class="status-pill">${escapeHtml(statusLabel(channel.status))}</span>
          <p>${escapeHtml(channel.description || channel.type)}</p>
          <small>${escapeHtml(channel.target)}${channel.workingHours ? ` · ${escapeHtml(channel.workingHours)}` : ""}</small>
        </div>
        <div class="admin-list-actions">
          <button data-channel-action="edit" type="button">تعديل</button>
          <button class="danger" data-channel-action="delete" type="button">حذف</button>
        </div>
      </article>`).join("");
  }

  async function loadChannels() {
    const data = await api(`/api/stores/${encodeURIComponent(storeId)}/support-channels`);
    state.channels = data.channels;
    renderChannels();
  }

  function editChannel(id) {
    const channel = state.channels.find((item) => item.id === id);
    if (!channel) return;
    const form = $("supportChannelForm");
    form.elements.id.value = channel.id;
    form.elements.type.value = channel.type;
    form.elements.name.value = channel.name || "";
    form.elements.description.value = channel.description || "";
    form.elements.target.value = channel.target || "";
    form.elements.sortOrder.value = channel.sortOrder || 0;
    form.elements.status.value = channel.status || "active";
    form.elements.workingHours.value = channel.workingHours || "";
    form.elements.iconUrl.value = channel.iconUrl || "";
    form.elements.messageTemplate.value = channel.messageTemplate || "";
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function identityCard(request) {
    return `
      <article class="admin-list-item" data-identity-id="${escapeHtml(request.id)}">
        <div>
          <strong>${escapeHtml(request.fullName || request.customer?.name || "طلب توثيق")}</strong>
          <span class="status-pill">${escapeHtml(statusLabel(request.status))}</span>
          <p>${escapeHtml(request.customer?.email || "")}</p>
          <small>${escapeHtml(request.id)} · ${dateTime(request.updatedAt)}</small>
        </div>
        <div class="admin-list-actions"><button data-identity-open type="button">فتح الطلب</button></div>
      </article>`;
  }

  async function loadIdentity(reset = true) {
    const offset = reset ? 0 : state.identityOffset;
    const params = new URLSearchParams({
      status: $("identityStatus").value,
      query: $("identityQuery").value.trim(),
      limit: "30",
      offset: String(offset)
    });
    const data = await api(`/api/stores/${encodeURIComponent(storeId)}/identity-requests?${params}`);
    const list = $("identityRequestList");
    if (reset) list.innerHTML = "";
    list.insertAdjacentHTML("beforeend", data.requests.map(identityCard).join(""));
    state.identityOffset = offset + data.requests.length;
    state.identityHasMore = data.pagination.hasMore;
    $("identityMore").hidden = !state.identityHasMore;
    if (!list.children.length) list.innerHTML = '<div class="empty-admin">لا توجد طلبات مطابقة.</div>';
  }

  async function openIdentity(id) {
    hideNotice();
    const data = await api(`/api/stores/${encodeURIComponent(storeId)}/identity-requests/${encodeURIComponent(id)}`);
    const request = data.request;
    $("identityDetailTitle").textContent = `${request.fullName} — ${statusLabel(request.status)}`;
    $("identityDetailData").innerHTML = [
      ["العميل", request.customer?.name], ["البريد", request.customer?.email],
      ["نوع الوثيقة", request.documentType], ["رقم الوثيقة", request.documentNumber],
      ["تاريخ الميلاد", request.birthDate], ["الجنسية", request.nationality],
      ["الحالة", statusLabel(request.status)], ["تاريخ الإرسال", dateTime(request.submittedAt)],
      ["تفاصيل إضافية", request.additionalDetails || "—"], ["ملاحظة المراجعة", request.reviewNote || "—"]
    ].map(([label, value]) => `<div><small>${escapeHtml(label)}</small><b>${escapeHtml(value || "—")}</b></div>`).join("");
    const fileLabel = { front: "الوجه الأمامي", back: "الوجه الخلفي", selfie: "سيلفي مع الوثيقة" };
    $("identityDetailFiles").innerHTML = request.files.length ? request.files.map((file) => `
      <figure><a href="/api/stores/${encodeURIComponent(storeId)}/identity-requests/${encodeURIComponent(request.id)}/files/${encodeURIComponent(file.kind)}" target="_blank" rel="noopener">
        <img src="/api/stores/${encodeURIComponent(storeId)}/identity-requests/${encodeURIComponent(request.id)}/files/${encodeURIComponent(file.kind)}" alt="${escapeHtml(fileLabel[file.kind] || file.kind)}">
      </a><figcaption>${escapeHtml(fileLabel[file.kind] || file.kind)} · ${Math.ceil(file.sizeBytes / 1024)} KB</figcaption></figure>`).join("") : '<div class="empty-admin">لا توجد ملفات.</div>';
    $("identityDetailEvents").innerHTML = request.events.length ? request.events.map((event) => `
      <article><b>${escapeHtml(event.type)}</b><small>${escapeHtml(statusLabel(event.fromStatus || ""))} ← ${escapeHtml(statusLabel(event.toStatus || ""))} · ${dateTime(event.createdAt)}</small>${event.note ? `<p>${escapeHtml(event.note)}</p>` : ""}</article>`).join("") : "";
    const reviewForm = $("identityReviewForm");
    reviewForm.elements.requestId.value = request.id;
    reviewForm.hidden = request.status !== "pending_review";
    if (typeof $("identityAdminDialog").showModal === "function") $("identityAdminDialog").showModal();
    else $("identityAdminDialog").setAttribute("open", "");
  }

  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.adminTab));
  });

  $("experienceSettingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    hideNotice();
    const form = event.currentTarget;
    const submit = event.submitter;
    submit.disabled = true;
    try {
      await api(`/api/stores/${encodeURIComponent(storeId)}/experience-settings`, {
        method: "PUT",
        headers: { "x-csrf-token": state.csrf },
        body: {
          identityVerificationEnabled: form.elements.identityVerificationEnabled.checked,
          identityFileMaxBytes: Math.round(Number(form.elements.identityFileMaxMb.value) * 1_000_000),
          identityRetentionDays: Number(form.elements.identityRetentionDays.value),
          floatingSupportEnabled: form.elements.floatingSupportEnabled.checked,
          lightModeEnabled: form.elements.lightModeEnabled.checked,
          storefrontApiEnabled: form.elements.storefrontApiEnabled.checked,
          internalTransferEnabled: form.elements.internalTransferEnabled.checked,
          withdrawalEnabled: form.elements.withdrawalEnabled.checked,
          builderPromoUrl: form.elements.builderPromoUrl.value.trim() || null,
          builderPromoImageUrl: form.elements.builderPromoImageUrl.value.trim() || null
        }
      });
      showNotice("تم حفظ إعدادات تجربة العميل.", "success");
      await loadExperience();
    } catch (error) {
      showNotice(error.message);
    } finally {
      submit.disabled = false;
    }
  });

  $("supportChannelForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    hideNotice();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const id = values.id;
    delete values.id;
    values.sortOrder = Number(values.sortOrder || 0);
    const submit = event.submitter;
    submit.disabled = true;
    try {
      await api(id
        ? `/api/stores/${encodeURIComponent(storeId)}/support-channels/${encodeURIComponent(id)}`
        : `/api/stores/${encodeURIComponent(storeId)}/support-channels`, {
        method: id ? "PUT" : "POST",
        headers: { "x-csrf-token": state.csrf },
        body: values
      });
      resetSupportForm();
      await loadChannels();
      showNotice("تم حفظ وسيلة التواصل.", "success");
    } catch (error) {
      showNotice(error.message);
    } finally {
      submit.disabled = false;
    }
  });

  $("resetSupportChannel").addEventListener("click", resetSupportForm);
  $("supportChannelList").addEventListener("click", async (event) => {
    const row = event.target.closest("[data-channel-id]");
    const action = event.target.closest("[data-channel-action]")?.dataset.channelAction;
    if (!row || !action) return;
    if (action === "edit") return editChannel(row.dataset.channelId);
    if (!confirm("هل تريد حذف وسيلة التواصل؟")) return;
    try {
      await api(`/api/stores/${encodeURIComponent(storeId)}/support-channels/${encodeURIComponent(row.dataset.channelId)}`, {
        method: "DELETE", headers: { "x-csrf-token": state.csrf }
      });
      await loadChannels();
      showNotice("تم حذف وسيلة التواصل.", "success");
    } catch (error) {
      showNotice(error.message);
    }
  });

  $("identitySearch").addEventListener("click", () => loadIdentity(true).catch((error) => showNotice(error.message)));
  $("identityMore").addEventListener("click", () => loadIdentity(false).catch((error) => showNotice(error.message)));
  $("identityStatus").addEventListener("change", () => loadIdentity(true).catch((error) => showNotice(error.message)));
  $("identityRequestList").addEventListener("click", (event) => {
    const row = event.target.closest("[data-identity-id]");
    if (row && event.target.closest("[data-identity-open]")) openIdentity(row.dataset.identityId).catch((error) => showNotice(error.message));
  });
  $("closeIdentityAdminDialog").addEventListener("click", () => $("identityAdminDialog").close());
  $("identityAdminDialog").addEventListener("click", (event) => {
    if (event.target === $("identityAdminDialog")) $("identityAdminDialog").close();
  });
  $("identityReviewForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    hideNotice();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const submit = event.submitter;
    if (["changes_required", "rejected"].includes(values.status) && !values.note.trim()) {
      showNotice("اكتب ملاحظة واضحة للعميل.");
      return;
    }
    if (!confirm("هل تريد اعتماد قرار المراجعة؟")) return;
    submit.disabled = true;
    try {
      await api(`/api/stores/${encodeURIComponent(storeId)}/identity-requests/${encodeURIComponent(values.requestId)}/review`, {
        method: "POST",
        headers: { "x-csrf-token": state.csrf },
        body: { status: values.status, note: values.note.trim() }
      });
      $("identityAdminDialog").close();
      await loadIdentity(true);
      showNotice("تم حفظ قرار التوثيق وإشعار العميل.", "success");
    } catch (error) {
      showNotice(error.message);
    } finally {
      submit.disabled = false;
    }
  });

  async function init() {
    try {
      const [me, store] = await Promise.all([api("/api/me"), api(`/api/stores/${encodeURIComponent(storeId)}`)]);
      state.csrf = me.csrfToken;
      $("accountAdminStoreName").textContent = store.store.name;
      $("accountAdminBack").href = `/admin/${encodeURIComponent(storeId)}`;
      await Promise.all([loadExperience(), loadChannels(), loadIdentity(true)]);
    } catch (error) {
      if (error.status === 401) location.href = `/?next=${encodeURIComponent(location.pathname)}`;
      else showNotice(error.message);
    }
  }

  init();
})();
