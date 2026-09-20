const SUPPORT_DOWNLOAD_HARDENING_APPS = new WeakSet();

function isSupportAttachmentRequest(request) {
  const url = String(request.raw?.url || request.url || "");
  return url.includes("/support-v2/attachments/");
}

function normalizedContentType(reply) {
  return String(reply.getHeader("content-type") || "").split(";", 1)[0].trim().toLowerCase();
}

export function installSupportChatDownloadHardening(app) {
  if (SUPPORT_DOWNLOAD_HARDENING_APPS.has(app)) return false;
  SUPPORT_DOWNLOAD_HARDENING_APPS.add(app);

  app.addHook("onSend", async (request, reply, payload) => {
    if (!isSupportAttachmentRequest(request)) return payload;
    const type = normalizedContentType(reply);
    if (type !== "application/pdf" && type !== "text/plain") return payload;

    const current = String(reply.getHeader("content-disposition") || "");
    const suffix = current.includes(";") ? current.slice(current.indexOf(";")) : "";
    reply.header("content-disposition", `attachment${suffix}`);
    reply.header("x-content-type-options", "nosniff");
    reply.header("cache-control", "private, no-store");
    return payload;
  });

  return true;
}
