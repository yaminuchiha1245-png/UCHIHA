import { decryptSecret } from "./security.mjs";

function jsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function telegramJson(token, method, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.description || `Telegram HTTP ${response.status}`);
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

async function telegramPhoto(token, chatId, photo, caption, replyMarkup) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(photo || ""));
  if (!match) return telegramJson(token, "sendMessage", { chat_id: chatId, text: caption, reply_markup: replyMarkup });
  const bytes = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  const extension = match[1].endsWith("png") ? "png" : match[1].endsWith("webp") ? "webp" : "jpg";
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", String(caption || "").slice(0, 1000));
  form.append("reply_markup", JSON.stringify(replyMarkup));
  form.append("photo", new Blob([bytes], { type: match[1] }), `receipt.${extension}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      body: form,
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.description || `Telegram HTTP ${response.status}`);
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

export async function pushWalletProofToAdminBot(db, config, {
  store,
  proofId,
  customer,
  method,
  referenceText = null,
  proofDataUrl = null
}) {
  const ownerTelegramId = jsonObject(store.contact_data, {}).telegramOwnerId;
  if (!ownerTelegramId) return { sent: false, reason: "owner_telegram_id_missing" };

  const connection = (await db.query(
    `SELECT token_ciphertext, status
     FROM bot_connections
     WHERE tenant_id=$1 AND store_id=$2 AND purpose='admin' AND status='active'
     ORDER BY updated_at DESC LIMIT 1`,
    [store.tenant_id, store.id]
  )).rows[0];
  if (!connection) return { sent: false, reason: "admin_bot_not_active" };
  if (config.telegramMode === "fake") return { sent: true, simulated: true };

  const token = decryptSecret(connection.token_ciphertext, config.encryptionKey);
  const short = String(proofId || "").slice(0, 8);
  const customerName = customer.display_name || customer.email || "عميل";
  const proofKind = proofDataUrl ? "صورة إيصال" : "رقم عملية";
  const caption = `💳 إثبات تحويل جديد #${short}\n\n` +
    `العميل: ${customerName}\n` +
    `الطريقة: ${method.name}\n` +
    `نوع الإثبات: ${proofKind}\n` +
    `${referenceText ? `رقم العملية: ${referenceText}\n` : ""}` +
    `\nراجع التحويل وأدخل المبلغ الفعلي الذي وصل إليك.`;
  const replyMarkup = {
    inline_keyboard: [[
      { text: "✅ مراجعة الإثبات", callback_data: `adm:proof:${proofId}` },
      { text: "💳 كل الإثباتات", callback_data: "adm:proofs" }
    ]]
  };

  if (proofDataUrl) {
    await telegramPhoto(token, ownerTelegramId, proofDataUrl, caption, replyMarkup);
  } else {
    await telegramJson(token, "sendMessage", {
      chat_id: ownerTelegramId,
      text: caption,
      reply_markup: replyMarkup
    });
  }
  return { sent: true };
}
