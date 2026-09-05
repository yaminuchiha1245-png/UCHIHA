const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));

async function tg(method, payload, attempt = 0) {
  const token = process.env.BOT_TOKEN;
  if (!token) return { ok:false, skipped:true };

  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), Number(process.env.TELEGRAM_HTTP_TIMEOUT_MS||12000));
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify(payload),
      signal:controller.signal
    });
    const data = await r.json().catch(()=>({}));
    if (r.ok) return { ok:true, data };

    const retryAfter = Number(data?.parameters?.retry_after||0);
    if (attempt < 2 && (r.status===429 || r.status>=500)) {
      const delay = retryAfter > 0 ? Math.min(retryAfter*1000,10000) : 700*(attempt+1);
      await sleep(delay);
      return tg(method,payload,attempt+1);
    }
    return { ok:false, status:r.status, data };
  } catch (e) {
    if (attempt < 2 && (e.name==="AbortError" || e.name==="TypeError")) {
      await sleep(500*(attempt+1));
      return tg(method,payload,attempt+1);
    }
    return { ok:false, error:e.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function sendTelegramMessage(telegramId, text, options = {}) {
  if (!telegramId) return {ok:false,skipped:true};
  return tg("sendMessage", {
    chat_id: telegramId,
    text:String(text||""),
    parse_mode: options.parse_mode || "HTML",
    disable_web_page_preview: true,
    ...(options.reply_markup ? {reply_markup:options.reply_markup} : {})
  });
}

async function notifyAdmins(text, reply_markup) {
  const ids = String(process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",").map(s=>s.trim()).filter(Boolean);
  const results = [];
  for (const id of ids) {
    results.push(await sendTelegramMessage(id, text, { reply_markup }));
  }
  return results;
}

module.exports = { sendTelegramMessage, notifyAdmins };
