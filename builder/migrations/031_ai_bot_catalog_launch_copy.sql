-- UCHIHA Builder migration 031: align sellable AI-bot catalog metadata with
-- the final launch architecture. Website provisions BotFather token + owner ID;
-- OpenAI and ongoing administration live inside the purchased Telegram bot.

UPDATE service_catalog
SET summary='بوت Telegram جاهز للبيع؛ يتم تشغيله من الموقع ثم ربط OpenAI وإدارة Free وPRO من داخل /admin في البوت.',
    capabilities='["telegram","per_bot_openai","free_model","pro_model","image_generation","telegram_admin"]'::jsonb,
    updated_at=NOW()
WHERE service_key='ai_chatbot';

UPDATE platform_services
SET description_ar='بوت Telegram ذكاء اصطناعي جاهز للبيع. بعد الشراء يضع العميل BotFather Token ومعرف Telegram للمالك في الموقع، ثم يدير OpenAI والنماذج وPRO والمستخدمين والحدود من /admin داخل البوت.',
    description_en='A ready-to-sell Telegram AI bot. After purchase, the customer provisions the BotFather token and owner Telegram ID on the website, then manages OpenAI, models, PRO, users and limits from /admin inside the bot.',
    features_ar='["UCHIHA AI V1 مجاني","UCHIHA AI V2 PRO","برمجة ودراسة وإنشاء صور","ربط OpenAI من داخل البوت","لوحة /admin كاملة داخل Telegram"]'::jsonb,
    features_en='["Free UCHIHA AI V1","PRO UCHIHA AI V2","Coding, study and image generation","Per-bot OpenAI connection","Full Telegram /admin panel"]'::jsonb,
    catalog_category_slug='telegram-bots',
    catalog_subcategory_slug='ai-bots',
    order_schema='{"fields":[{"key":"displayName","type":"text","required":true},{"key":"telegramBotToken","type":"secret","required":true},{"key":"ownerTelegramId","type":"text","required":true}]}'::jsonb,
    updated_at=NOW()
WHERE service_key='ai-chatbot' AND tenant_id IS NULL AND store_id IS NULL;
