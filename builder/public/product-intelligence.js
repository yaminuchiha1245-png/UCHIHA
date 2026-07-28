(() => {
  const parts = location.pathname.split("/").filter(Boolean);
  const storeId = decodeURIComponent(parts[1] || "");
  const state = { csrf: "", analyses: [], batchOffset: 0 };
  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }
  function notice(message, type = "ok") {
    const node = $("intelligenceNotice");
    node.hidden = !message;
    node.className = `notice ${type === "error" ? "error" : "success"}`;
    node.textContent = message || "";
  }
  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && typeof options.body !== "string") {
      headers["content-type"] = "application/json";
      options.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, { credentials: "same-origin", ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "تعذر إكمال العملية");
    return data;
  }
  function fieldRow(field = {}) {
    const row = document.createElement("div");
    row.className = "field-row";
    row.innerHTML = `
      <label>المفتاح<input data-key value="${escapeHtml(field.key || "")}" maxlength="80"></label>
      <label>الاسم الظاهر<input data-label value="${escapeHtml(field.label || "")}" maxlength="120"></label>
      <label>النوع<select data-type>${["text","textarea","email","url","number","tel"].map((type) => `<option value="${type}" ${field.type === type ? "selected" : ""}>${type}</option>`).join("")}</select></label>
      <label class="field-required"><input data-required type="checkbox" ${field.required ? "checked" : ""}> مطلوب</label>
      <button class="remove-field" type="button" aria-label="حذف الحقل">×</button>`;
    row.querySelector(".remove-field").addEventListener("click", () => row.remove());
    return row;
  }
  function collectFields(card) {
    return [...card.querySelectorAll(".field-row")].map((row) => ({
      key: row.querySelector("[data-key]").value.trim(),
      label: row.querySelector("[data-label]").value.trim(),
      type: row.querySelector("[data-type]").value,
      required: row.querySelector("[data-required]").checked,
      maxLength: row.querySelector("[data-type]").value === "textarea" ? 2000 : 500
    })).filter((field) => field.key && field.label);
  }
  function render() {
    const queue = $("analysisQueue");
    queue.replaceChildren();
    $("visibleCount").textContent = String(state.analyses.length);
    $("reviewCount").textContent = String(state.analyses.filter((item) => item.status === "review_required").length);
    if (!state.analyses.length) {
      queue.innerHTML = '<div class="surface-card empty-state">لا توجد منتجات في هذه الحالة.</div>';
      return;
    }
    const template = $("analysisTemplate");
    for (const analysis of state.analyses) {
      const card = template.content.firstElementChild.cloneNode(true);
      card.dataset.analysisId = analysis.id;
      card.dataset.productId = analysis.productId;
      card.dataset.status = analysis.status;
      card.querySelector(".analysis-name").textContent = analysis.productName || "منتج";
      card.querySelector(".analysis-kind").textContent = `${analysis.detectedKind} · ${analysis.status}`;
      card.querySelector(".analysis-score strong").textContent = `${Math.round(analysis.confidence * 100)}%`;
      const signals = card.querySelector(".analysis-signals");
      for (const signal of analysis.signals || []) signals.insertAdjacentHTML("beforeend", `<span>${escapeHtml(signal)}</span>`);
      const editor = card.querySelector(".field-editor");
      for (const field of analysis.suggestedFields || []) editor.append(fieldRow(field));
      if (!(analysis.suggestedFields || []).length) editor.innerHTML = '<p class="empty-state">لا يحتاج المنتج حقولًا إضافية، أو لم يحدد المحلل حقولًا بثقة كافية.</p>';
      card.querySelector(".add-field").addEventListener("click", () => {
        editor.querySelector(".empty-state")?.remove();
        editor.append(fieldRow({ type: "text", required: true }));
      });
      card.querySelector(".reanalyze").addEventListener("click", () => reanalyze(card));
      card.querySelector(".dismiss-analysis").addEventListener("click", () => review(card, "dismiss"));
      card.querySelector(".approve-analysis").addEventListener("click", () => review(card, "approve"));
      queue.append(card);
    }
  }
  async function load() {
    notice("");
    $("analysisQueue").innerHTML = '<div class="surface-card empty-state">جاري التحميل…</div>';
    const status = $("analysisStatus").value;
    const data = await api(`/api/stores/${encodeURIComponent(storeId)}/product-analysis?status=${encodeURIComponent(status)}&limit=100`);
    state.analyses = data.analyses || [];
    $("analyzerVersion").textContent = data.analyzerVersion || "—";
    render();
  }
  async function analyzeMissing() {
    const button = $("analyzeMissing");
    button.disabled = true;
    try {
      const data = await api(`/api/stores/${encodeURIComponent(storeId)}/product-analysis/analyze-missing`, {
        method: "POST",
        headers: { "x-csrf-token": state.csrf },
        body: { limit: 50, offset: state.batchOffset }
      });
      state.batchOffset = data.nextOffset || 0;
      $("batchSummary").textContent = `تم تحليل ${data.processed} — طُبق تلقائيًا ${data.autoApplied} — للمراجعة ${data.reviewRequired}.`;
      notice("اكتملت دفعة التحليل وحُفظت النتائج.");
      await load();
    } catch (error) { notice(error.message, "error"); }
    finally { button.disabled = false; }
  }
  async function reanalyze(card) {
    try {
      await api(`/api/stores/${encodeURIComponent(storeId)}/products/${encodeURIComponent(card.dataset.productId)}/analyze`, {
        method: "POST", headers: { "x-csrf-token": state.csrf }, body: { apply: true }
      });
      notice("تمت إعادة تحليل المنتج.");
      await load();
    } catch (error) { notice(error.message, "error"); }
  }
  async function review(card, decision) {
    try {
      const fields = collectFields(card);
      await api(`/api/stores/${encodeURIComponent(storeId)}/product-analysis/${encodeURIComponent(card.dataset.analysisId)}/review`, {
        method: "PUT",
        headers: { "x-csrf-token": state.csrf },
        body: { decision, fields, options: [], note: decision === "approve" ? "اعتماد من لوحة المراجعة" : "استبعاد من لوحة المراجعة" }
      });
      notice(decision === "approve" ? "تم اعتماد الحقول وتطبيقها على المنتج." : "تم استبعاد التحليل.");
      await load();
    } catch (error) { notice(error.message, "error"); }
  }
  async function boot() {
    $("backToAdmin").href = `/admin/${encodeURIComponent(storeId)}`;
    try {
      const session = await api("/api/auth/session");
      state.csrf = session.csrfToken;
      await load();
    } catch (error) {
      if (/جلسة|دخول|authentication/i.test(error.message)) location.href = "/";
      else notice(error.message, "error");
    }
  }
  $("reloadAnalyses").addEventListener("click", () => load().catch((error) => notice(error.message, "error")));
  $("analysisStatus").addEventListener("change", () => load().catch((error) => notice(error.message, "error")));
  $("analyzeMissing").addEventListener("click", analyzeMissing);
  boot();
})();
