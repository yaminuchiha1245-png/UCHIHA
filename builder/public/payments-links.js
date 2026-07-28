(() => {
  const page = document.body.dataset.page;
  const parts = location.pathname.split("/").filter(Boolean);
  if (page === "store") {
    const slug = decodeURIComponent(parts[1] || "");
    document.querySelectorAll("[data-wallet-link]").forEach((link) => {
      link.href = `/store/${encodeURIComponent(slug)}/wallet`;
    });
  }
  if (page === "admin") {
    const storeId = decodeURIComponent(parts[1] || "");
    document.querySelectorAll("[data-payments-link]").forEach((link) => {
      link.href = `/admin/${encodeURIComponent(storeId)}/payments`;
    });
  }
})();
