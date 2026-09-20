(() => {
  "use strict";

  const RELEASE = "2026.08.08.catalog-v3";

  function optionItems(select) {
    return [...(select?.options || [])]
      .filter((option) => option.value)
      .map((option) => ({ value: option.value, label: option.textContent.trim() }));
  }

  function buildTree(parentSelect, productSelect) {
    const roots = optionItems(parentSelect).map((item) => ({ ...item, children: [] }));
    const rootById = new Map(roots.map((item) => [item.value, item]));
    const rootByName = new Map(roots.map((item) => [item.label, item]));

    for (const item of optionItems(productSelect)) {
      if (rootById.has(item.value)) continue;
      const parts = item.label.split("/").map((part) => part.trim()).filter(Boolean);
      const parent = parts.length > 1 ? rootByName.get(parts[0]) : null;
      if (parent) {
        parent.children.push({ value: item.value, label: parts.slice(1).join(" / ") });
      }
    }
    return roots;
  }

  function makeChoice(item, className, productSelect, productForm) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.dataset.categoryChoice = item.value;
    button.setAttribute("aria-label", `إضافة منتج داخل ${item.label}`);

    const label = document.createElement("span");
    label.textContent = item.label;
    button.append(label);

    button.addEventListener("click", () => {
      productSelect.value = item.value;
      productSelect.dispatchEvent(new Event("change", { bubbles: true }));
      productForm.scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => productForm.elements.name?.focus({ preventScroll: true }), 320);
    });
    return button;
  }

  function mount() {
    if (document.body?.dataset.page !== "admin") return;
    const panel = document.querySelector('[data-panel-view="catalog"]');
    const parentSelect = document.querySelector("#categoryParent");
    const productSelect = document.querySelector("#productCategory");
    const productForm = document.querySelector("#productForm");
    const tableCard = panel?.querySelector(".table-card");
    if (!panel || !parentSelect || !productSelect || !productForm || !tableCard) return;

    let overview = panel.querySelector(".catalog-category-overview");
    if (!overview) {
      overview = document.createElement("section");
      overview.className = "surface-card catalog-category-overview";
      overview.setAttribute("aria-labelledby", "catalogCategoryOverviewTitle");
      overview.innerHTML = `
        <div class="catalog-category-overview-head">
          <div><span class="eyebrow">هيكل التصفح</span><h3 id="catalogCategoryOverviewTitle">الأقسام الحالية</h3></div>
          <small data-category-summary>تحميل الأقسام</small>
        </div>
        <div class="catalog-category-tree" data-category-tree></div>`;
      tableCard.before(overview);
    }

    const tree = overview.querySelector("[data-category-tree]");
    const summary = overview.querySelector("[data-category-summary]");

    function render() {
      const roots = buildTree(parentSelect, productSelect);
      const childCount = roots.reduce((total, root) => total + root.children.length, 0);
      summary.textContent = `${roots.length} رئيسي · ${childCount} فرعي`;
      tree.replaceChildren();

      if (!roots.length) {
        const empty = document.createElement("p");
        empty.className = "catalog-category-empty";
        empty.textContent = "أضف أول قسم ليظهر هيكل التصفح هنا تلقائيًا.";
        tree.append(empty);
        return;
      }

      for (const root of roots) {
        const group = document.createElement("article");
        group.className = "catalog-category-group";
        const rootButton = makeChoice(root, "catalog-category-root", productSelect, productForm);
        const count = document.createElement("small");
        count.textContent = root.children.length ? `${root.children.length} فرعي` : "بدون فروع";
        rootButton.append(count);
        group.append(rootButton);

        if (root.children.length) {
          const children = document.createElement("div");
          children.className = "catalog-category-children";
          for (const child of root.children) {
            children.append(makeChoice(child, "catalog-category-child", productSelect, productForm));
          }
          group.append(children);
        }
        tree.append(group);
      }
    }

    const observer = new MutationObserver(render);
    observer.observe(parentSelect, { childList: true, subtree: true });
    observer.observe(productSelect, { childList: true, subtree: true });
    render();

    window.__uchihaAdminCatalog = { release: RELEASE, render };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
