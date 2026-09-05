(() => {
  "use strict";

  const pageMount = document.getElementById("platformPage");
  if (!pageMount) return;

  const CATEGORY_TREE = [
    ["telegram-bots", "بوتات تلغرام"],
    ["websites", "المواقع"],
    ["mobile-apps", "تطبيقات الجوال"],
    ["artificial-intelligence", "الذكاء الاصطناعي"],
    ["api-integrations", "واجهات API"],
    ["hosting-domains", "الاستضافة والدومينات"]
  ];

  function stillLoading() {
    return Boolean(pageMount.querySelector(":scope > .v5-loading"));
  }

  function staticHome() {
    return `<div class="v5-shell" data-v5-recovery>
      <form class="v5-search" action="/services" method="get">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
        <input name="q" type="search" autocomplete="off" placeholder="ابحث...">
      </form>
      <section class="v5-section">
        <div class="v5-section-title"><h2>الأقسام الرئيسية</h2></div>
        <div class="v5-category-grid">
          ${CATEGORY_TREE.map(([slug, name]) => `<a class="v5-category-card" href="/category/${slug}"><span class="v5-card-media empty" aria-hidden="true"></span><span class="v5-category-name">${name}</span></a>`).join("")}
        </div>
      </section>
    </div>`;
  }

  function connectionFallback() {
    return `<div class="v5-shell" data-v5-recovery>
      <div class="v5-empty">
        <div>
          <b>تعذر تحميل البيانات الآن</b>
          <p>المحتوى الأساسي متاح، ويمكنك إعادة المحاولة بعد لحظات.</p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px">
            <button class="v5-primary" type="button" data-v5-retry>إعادة المحاولة</button>
            <a class="v5-primary" href="/">الرئيسية</a>
          </div>
        </div>
      </div>
    </div>`;
  }

  function revealFallback() {
    if (!stillLoading()) return;
    const pathname = location.pathname.replace(/\/+$/, "") || "/";
    pageMount.innerHTML = pathname === "/" || pathname === "/services"
      ? staticHome()
      : connectionFallback();
    pageMount.dataset.recoveryRendered = "true";
    pageMount.querySelector("[data-v5-retry]")?.addEventListener("click", () => location.reload());
  }

  const fallbackTimer = window.setTimeout(revealFallback, 1800);
  const stopFallback = new MutationObserver(() => {
    if (!stillLoading()) {
      window.clearTimeout(fallbackTimer);
      stopFallback.disconnect();
    }
  });
  stopFallback.observe(pageMount, { childList: true, subtree: false });

  window.addEventListener("error", revealFallback, { once: true });
  window.addEventListener("unhandledrejection", revealFallback, { once: true });
})();
