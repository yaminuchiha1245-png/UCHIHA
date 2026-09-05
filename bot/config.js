function isPlaceholderUrl(value){
  const v=String(value||"").toLowerCase();
  return /example\.com|your-domain|your_domain|change_me/.test(v);
}

function loadBotConfig(env=process.env){
  const config={
    nodeEnv:String(env.NODE_ENV||"development"),
    botToken:String(env.BOT_TOKEN||""),
    miniAppUrl:String(env.MINI_APP_URL||"https://example.com"),
    apiUrl:String(env.API_URL||"http://localhost:3000").replace(/\/$/,""),
    supportUsername:String(env.SUPPORT_USERNAME||"GameZoneSupport").replace(/^@/,""),
    requiredChannel:String(env.REQUIRED_CHANNEL||""),
    internalBotSecret:String(env.INTERNAL_BOT_SECRET||""),
    internalBotAdminSecret:String(env.INTERNAL_BOT_ADMIN_SECRET||""),
    adminIds:String(env.ADMIN_TELEGRAM_IDS||"").split(",").map(x=>x.trim()).filter(Boolean),
    apiTimeoutMs:Math.max(1000,Math.min(60000,Number(env.BOT_API_TIMEOUT_MS||12000)))
  };

  if(!config.botToken)throw new Error("BOT_TOKEN is required");
  if(config.nodeEnv==="production"){
    let mini;
    try{mini=new URL(config.miniAppUrl);}catch{throw new Error("MINI_APP_URL must be a valid production HTTPS URL")}
    if(mini.protocol!=="https:"||isPlaceholderUrl(config.miniAppUrl))throw new Error("MINI_APP_URL must be a non-placeholder HTTPS production URL");
    if(!config.internalBotSecret||config.internalBotSecret.length<24)throw new Error("INTERNAL_BOT_SECRET is required and must be strong in production");
    if(!config.internalBotAdminSecret||config.internalBotAdminSecret.length<24)throw new Error("INTERNAL_BOT_ADMIN_SECRET is required and must be strong in production");
    if(!config.adminIds.length)throw new Error("ADMIN_TELEGRAM_IDS must contain at least one Admin in production");
  }
  return config;
}

module.exports={loadBotConfig,isPlaceholderUrl};
