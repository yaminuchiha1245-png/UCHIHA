function pathOf(request) {
  return String(request.raw?.url || request.url || "").split("?")[0];
}

function validTelegramId(value) {
  return /^\d{5,20}$/.test(String(value ?? "").trim());
}

export function installAiBotProvisioningGuard(app) {
  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;
    if (!/^\/api\/platform\/ai-bots\/[0-9a-f-]+\/token$/i.test(pathOf(request))) return;

    const token = String(request.body?.telegramBotToken ?? "").trim();
    const ownerTelegramId = String(request.body?.ownerTelegramId ?? "").trim();

    if (!token) {
      return reply.code(422).send({
        error: "telegram_token_required",
        message: "Telegram Bot Token مطلوب لتشغيل البوت"
      });
    }
    if (!validTelegramId(ownerTelegramId)) {
      return reply.code(422).send({
        error: "owner_telegram_id_required",
        message: "Telegram ID الصحيح للمالك مطلوب حتى تعمل لوحة /admin"
      });
    }
  });
}
