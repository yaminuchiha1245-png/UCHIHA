function pathOf(request) {
  return String(request.raw?.url || request.url || "").split("?")[0].replace(/\/+$/, "") || "/";
}

function isBlockedCustomerAdminRoute(method, path) {
  if (method === "PATCH" && /^\/api\/platform\/ai-bots\/[0-9a-f-]+$/i.test(path)) return true;
  if (["GET", "PATCH"].includes(method) && /^\/api\/platform\/ai-bots\/[0-9a-f-]+\/limits$/i.test(path)) return true;
  if (["POST", "PATCH", "DELETE"].includes(method) && /^\/api\/platform\/ai-bots\/[0-9a-f-]+\/models(?:\/[^/]+)?$/i.test(path)) return true;
  if (method === "POST" && /^\/api\/platform\/ai-bots\/[0-9a-f-]+\/users\/\d{5,20}\/(?:pro|ban)$/i.test(path)) return true;
  // Even the UCHIHA platform owner prices/monitors the product only. Provider/model
  // configuration for a purchased bot belongs to that bot owner's Telegram /admin.
  if (
    method === "PATCH" &&
    /^\/api\/platform\/admin\/ai-bots\/[0-9a-f-]+\/models\/[^/]+\/provider$/i.test(path)
  ) return true;
  return false;
}

export function installAiBotTelegramOnlyAdminGuard(app) {
  app.addHook("preHandler", async (request, reply) => {
    const method = String(request.method || "").toUpperCase();
    const path = pathOf(request);
    if (!isBlockedCustomerAdminRoute(method, path)) return;
    return reply.code(410).send({
      error: "telegram_admin_only",
      message: "إدارة إعدادات البوت المشتَرى تتم من داخل Telegram عبر /admin فقط"
    });
  });
}

export { isBlockedCustomerAdminRoute };
