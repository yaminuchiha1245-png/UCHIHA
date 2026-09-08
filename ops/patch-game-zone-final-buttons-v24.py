from pathlib import Path

V21=Path('miniapp/v21.js')
APP=Path('miniapp/app.js')
INDEX=Path('miniapp/index.html')
CSS=Path('miniapp/v21.css')
SW=Path('miniapp/sw.js')
BOT=Path('bot/bot.js')

# Fix the Mini App mutation feedback loop that can starve WebView touch/click handling.
s=V21.read_text()
old='''    btn.classList.add("gz21-balance-chip");\n    btn.setAttribute("aria-label","فتح المحفظة");\n    btn.innerHTML=`<span class="gz21-balance-amount">${moneyRaw(shown)} ${code}</span><span class="gz21-balance-label">رصيدك</span>`;\n    btn.onclick=()=>{try{go("wallet")}catch{location.hash="#wallet"}};'''
new='''    btn.classList.add("gz21-balance-chip");\n    btn.setAttribute("aria-label","فتح المحفظة");\n    const balanceHtml=`<span class="gz21-balance-amount">${moneyRaw(shown)} ${code}</span><span class="gz21-balance-label">رصيدك</span>`;\n    if(btn.innerHTML!==balanceHtml)btn.innerHTML=balanceHtml;\n    if(!btn.dataset.gz21Bound){btn.dataset.gz21Bound="1";btn.onclick=()=>{try{go("wallet")}catch{location.hash="#wallet"}}}'''
assert old in s, 'balance refresh anchor missing'
s=s.replace(old,new,1)

old_obs='''    const observer=new MutationObserver(()=>{refreshBalanceChip();if(!$q("#gz21WalletHero"))installWallet();if(!$q("#gz21KycBtn"))installKyc();if($q("#authGate:not(.hidden)"))renderPairUpgrade()});\n    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["class"]});'''
new_obs='''    // Observe only the auth gate. Observing the whole document while rewriting\n    // balance HTML creates a mutation feedback loop that can freeze Telegram WebView clicks.\n    const gate=$q("#authGate");\n    if(gate){\n      let scheduled=false;\n      const observer=new MutationObserver(()=>{\n        if(scheduled)return;\n        scheduled=true;\n        requestAnimationFrame(()=>{\n          scheduled=false;\n          if($q("#authGate:not(.hidden)"))renderPairUpgrade();\n          refreshBalanceChip();\n        });\n      });\n      observer.observe(gate,{attributes:true,attributeFilter:["class"]});\n    }'''
assert old_obs in s, 'observer anchor missing'
s=s.replace(old_obs,new_obs,1)
V21.write_text(s)

# Add a tiny front-end error safety net so a single bad click never silently kills interaction.
a=APP.read_text()
boot_anchor='''const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];\n'''
boot_insert='''const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];\nwindow.addEventListener("error",event=>{\n  console.error("GAME_ZONE_UI_ERROR",event?.error||event?.message||"unknown");\n});\nwindow.addEventListener("unhandledrejection",event=>{\n  console.error("GAME_ZONE_UI_REJECTION",event?.reason||"unknown");\n});\n'''
assert boot_anchor in a, 'app helper anchor missing'
a=a.replace(boot_anchor,boot_insert,1)
APP.write_text(a)

# Force a new static generation in Telegram/PWA caches.
h=INDEX.read_text()
h=h.replace('manifest.webmanifest?v=230','manifest.webmanifest?v=240')
h=h.replace('styles.css?v=230','styles.css?v=240')
h=h.replace('v21.css?v=230','v21.css?v=240')
h=h.replace('app.js?v=230','app.js?v=240')
h=h.replace('v21.js?v=230','v21.js?v=240')
INDEX.write_text(h)

c=CSS.read_text()
marker='/* GAME_ZONE_BUTTON_RELIABILITY_V24 */'
if marker not in c:
    c += '''\n\n/* GAME_ZONE_BUTTON_RELIABILITY_V24 */\nbutton,[role="button"],a{-webkit-tap-highlight-color:transparent;touch-action:manipulation}\nbutton{user-select:none;-webkit-user-select:none}\nbutton:disabled{pointer-events:none}\n'''
CSS.write_text(c)

sw=SW.read_text().replace('game-zone-v23-static','game-zone-v24-static').replace('game-zone-v22-live','game-zone-v24-static')
SW.write_text(sw)

# Telegram callback diagnostics + graceful fallback for stale buttons from older bot messages.
b=BOT.read_text()
launch_anchor='''bot.catch((err,ctx)=>console.error("BOT ERROR",ctx.updateType,err));\nbot.launch().then(()=>console.log("Game Zone bot v3.2 production started"));'''
launch_new='''bot.on("callback_query",async ctx=>{\n  const data=String(ctx.callbackQuery?.data||"");\n  console.warn("BOT UNHANDLED CALLBACK",data.slice(0,80));\n  try{await ctx.answerCbQuery("تم تحديث Game Zone. افتح القائمة الجديدة وأعد المحاولة.",{show_alert:false})}catch{}\n  try{await ctx.reply("هذا الزر من رسالة قديمة أو لم يعد صالحًا. افتح القائمة المحدثة عبر /menu.",menu())}catch{}\n});\n\nbot.catch(async (err,ctx)=>{\n  console.error("BOT ERROR",ctx?.updateType,String(err?.stack||err||"unknown").slice(0,1200));\n  if(ctx?.callbackQuery){\n    try{await ctx.answerCbQuery("تعذر تنفيذ الزر الآن. أعد المحاولة من القائمة الجديدة.",{show_alert:false})}catch{}\n    try{await ctx.reply("حدث خطأ مؤقت أثناء تنفيذ الزر. افتح /menu ثم أعد المحاولة.",menu())}catch{}\n  }\n});\nbot.launch().then(()=>console.log("Game Zone bot v3.3 button-reliability production started"));'''
assert launch_anchor in b, 'bot launch anchor missing'
b=b.replace(launch_anchor,launch_new,1)
BOT.write_text(b)

print('GAME_ZONE_BUTTON_RELIABILITY_V24=PATCHED')
