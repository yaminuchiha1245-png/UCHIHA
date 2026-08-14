function requestPath(request) {
  return String(request.raw?.url || request.url || "").split("?")[0];
}

function isSubscriptionLaunchPath(pathname) {
  return pathname.startsWith("/api/subscription-")
    || pathname.startsWith("/api/platform/subscription-");
}

export function installLaunchConstraintErrors(app) {
  app.addHook("onError", async (request, _reply, error) => {
    if (error?.code !== "23514") return;
    if (!isSubscriptionLaunchPath(requestPath(request))) return;

    error.databaseCode = "23514";
    error.code = "subscription_state_conflict";
    error.statusCode = 409;
    error.message = "تغيّرت حالة الاشتراك أو طريقة الدفع. حدّث الصفحة وتحقق من البيانات ثم حاول مجددًا";
    delete error.details;
  });
}
