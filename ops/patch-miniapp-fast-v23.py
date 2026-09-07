from pathlib import Path
import re

APP=Path('miniapp/app.js')
INDEX=Path('miniapp/index.html')
CSS=Path('miniapp/v21.css')
SW=Path('miniapp/sw.js')
MANIFEST=Path('miniapp/manifest.webmanifest')

s=APP.read_text()

# 1) Telegram must leave its native loading screen immediately, before network I/O.
needle='const tg = window.Telegram?.WebApp || null;\n'
insert='''const tg = window.Telegram?.WebApp || null;\nfunction prepareTelegramShell(){\n  if(!tg)return;\n  try{\n    tg.ready();\n    tg.expand();\n    tg.setHeaderColor?.("#06080d");\n    tg.setBackgroundColor?.("#06080d");\n    tg.setBottomBarColor?.("#06080d");\n  }catch{}\n}\nprepareTelegramShell();\n'''
assert needle in s
s=s.replace(needle,insert,1)

# 2) Never let live HTTPS briefly expose preview balance/config before auth finishes.
start=s.index('const state = {')
end=s.index('};\nconst $=s=>',start)+2
new_state='''const state = {\n  user:API_BASE===null\n    ? {telegramId:"preview-1001",username:"gamezone_user",firstName:"مستخدم Game Zone",lastName:"",balance:25,currency:"USD"}\n    : {telegramId:"",username:"",firstName:"زائر",lastName:"",balance:0,currency:"USD"},\n  sessionToken:"",\n  config:API_BASE===null\n    ? {storeName:"Game Zone",tagline:"متجر المنتجات الرقمية",maintenance:false,showAnnouncements:true,minTopup:1,maxTopup:1000,paymentMethods:[{id:"manual",name:"تحويل يدوي",icon:"",imageUrl:null,instructions:"حوّل المبلغ ثم أدخل رقم العملية وارفع صورة الإيصال.",account:"حساب Game Zone التجريبي",requiresReference:true,minAmount:1,maxAmount:1000}]}\n    : {storeName:"Game Zone",tagline:"متجر المنتجات الرقمية",maintenance:false,showAnnouncements:true,minTopup:1,maxTopup:1000,paymentMethods:[]},\n  categories:[],products:[],orders:[],transactions:[],topups:[],supportTickets:[],favorites:[],notifications:[],announcements:[],preview:API_BASE===null\n}'''
s=s[:start]+new_state+s[end:]

# 3) authenticate() no longer owns Telegram ready/expand; startup already did it.
s=s.replace('      tg.ready();tg.expand();tg.setHeaderColor("#06080d");tg.setBackgroundColor("#06080d");\n      const raw=tg.initData;', '      const raw=tg.initData;',1)

# 4) Fast boot: public APIs in parallel; auth begins at same time; private data never blocks first paint.
boot_start=s.index('async function bootstrap(){')
boot_end=s.index('$("#readAllNotificationsBtn")',boot_start)
new_boot='''async function bootstrap(){\n  if(API_BASE===null){\n    state.categories=fallback.categories;state.products=fallback.products;state.announcements=fallback.announcements;state.preview=true;\n    renderConfig();renderAnnouncements();renderUser();renderHome();loadOrders();loadWallet();\n    toast("وضع المعاينة: رصيد تجريبي $25 — جرّب GZ10");return;\n  }\n\n  state.preview=false;\n  const authPromise=authenticate();\n  try{\n    const [config,categories,products,announcements]=await Promise.all([\n      api("/api/config"),api("/api/categories"),api("/api/products"),api("/api/announcements")\n    ]);\n    state.config=config;state.categories=categories;state.products=products;state.announcements=announcements;\n    renderConfig();renderAnnouncements();renderHome();\n  }catch(e){\n    console.error("game_zone_public_boot_failed",e);\n    toast("تعذر الاتصال بخادم Game Zone");\n    return;\n  }\n\n  const mode=await authPromise;\n  if(mode==="pair"){\n    state.user={telegramId:"",username:"",firstName:"زائر",lastName:"",balance:0,currency:"USD"};\n    renderUser();showAuthGate();\n    pairState=restorePairState();\n    if(pairState){renderPairState();schedulePairPoll()}\n    return;\n  }\n\n  hideAuthGate();\n  renderUser();\n  startLiveRefresh();\n  Promise.allSettled([loadPrivateData(),loadOrders(),loadWallet()]).then(()=>renderUser());\n}\n\nfunction setShortcutButtonState(status){\n  const btn=$("#homeShortcutBtn");if(!btn)return;\n  if(status==="added"){btn.disabled=true;btn.innerHTML='📲 الاختصار موجود <span>✓</span>';return}\n  if(status==="unsupported"){btn.disabled=false;btn.innerHTML='📲 إنشاء اختصار <span>＋</span>';return}\n  btn.disabled=false;btn.innerHTML='📲 إنشاء اختصار <span>＋</span>';\n}\nfunction initHomeShortcut(){\n  const btn=$("#homeShortcutBtn");if(!btn)return;\n  btn.onclick=()=>{\n    if(!tg||typeof tg.addToHomeScreen!=="function")return toast("حدّث Telegram لاستخدام اختصار المتجر");\n    try{tg.addToHomeScreen()}catch{toast("تعذر إنشاء الاختصار على هذا الجهاز")}\n  };\n  if(!tg||typeof tg.checkHomeScreenStatus!=="function"){setShortcutButtonState("unsupported");return}\n  try{tg.checkHomeScreenStatus(status=>setShortcutButtonState(status))}catch{setShortcutButtonState("unknown")}\n  try{tg.onEvent?.("homeScreenAdded",()=>{setShortcutButtonState("added");toast("تمت إضافة Game Zone إلى الشاشة الرئيسية")})}catch{}\n  try{tg.onEvent?.("homeScreenChecked",e=>setShortcutButtonState(e?.status||"unknown"))}catch{}\n}\ninitHomeShortcut();\n\n'''
s=s[:boot_start]+new_boot+s[boot_end:]
APP.write_text(s)

# 5) Remove render-blocking Google Fonts network dependency, add manifest + cache-busted local assets + shortcut button.
h=INDEX.read_text()
h=re.sub(r'\s*<link rel="preconnect" href="https://fonts.googleapis.com">\n\s*<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n\s*<link href="https://fonts.googleapis.com/css2\?family=Cairo:[^\n]+\n','\n',h,count=1)
if '<link rel="manifest"' not in h:
    h=h.replace('  <meta name="theme-color" content="#06080d" />','  <meta name="theme-color" content="#06080d" />\n  <link rel="manifest" href="./manifest.webmanifest?v=230" />',1)
h=h.replace('<link rel="stylesheet" href="./styles.css" />','<link rel="stylesheet" href="./styles.css?v=230" />')
h=re.sub(r'<link rel="stylesheet" href="\./v21\.css\?v=\d+" />','<link rel="stylesheet" href="./v21.css?v=230" />',h)
shortcut='      <button id="homeShortcutBtn">📲 إنشاء اختصار <span>＋</span></button>\n'
anchor='      <button id="privacyBtn">سياسة الخصوصية <span>›</span></button>\n'
assert anchor in h
if 'id="homeShortcutBtn"' not in h:h=h.replace(anchor,shortcut+anchor,1)
h=h.replace('<script src="./app.js"></script>','<script src="./app.js?v=230"></script>')
h=re.sub(r'<script src="\./v21\.js\?v=\d+"></script>','<script src="./v21.js?v=230"></script>',h)
INDEX.write_text(h)

# 6) Small interaction polish. Keep motion subtle and respect reduced-motion.
c=CSS.read_text()
marker='/* GAME_ZONE_FAST_LIVE_V23 */'
if marker not in c:
    c += '''\n\n/* GAME_ZONE_FAST_LIVE_V23 */\nhtml{scroll-behavior:smooth}\nbody{font-family:"Cairo","Noto Sans Arabic",system-ui,-apple-system,"Segoe UI",Arial,sans-serif}\n.catalog-card,.bottom-nav button,.search-wrap button,.cta,.secondary-btn,.settings button{\n  -webkit-tap-highlight-color:transparent;transition:transform .16s ease,border-color .18s ease,background-color .18s ease,box-shadow .18s ease,opacity .18s ease\n}\n.catalog-card:active,.bottom-nav button:active,.cta:active,.secondary-btn:active,.settings button:active{transform:scale(.975)}\n.catalog-card{animation:gzFastCardIn .28s cubic-bezier(.2,.8,.2,1) both}\n.catalog-card:nth-child(2){animation-delay:.025s}.catalog-card:nth-child(3){animation-delay:.05s}.catalog-card:nth-child(4){animation-delay:.075s}\n.catalog-image img{opacity:0;transform:scale(1.025);animation:gzFastImageIn .24s ease-out .03s forwards}\n.screen.active{animation:gzFastScreenIn .18s ease-out both}\n#homeShortcutBtn:disabled{opacity:.62}\n@keyframes gzFastCardIn{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}\n@keyframes gzFastImageIn{to{opacity:1;transform:none}}\n@keyframes gzFastScreenIn{from{opacity:.72;transform:translateY(3px)}to{opacity:1;transform:none}}\n@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.catalog-card,.screen.active,.catalog-image img{animation:none!important;transition:none!important;transform:none!important;opacity:1!important}}\n'''
CSS.write_text(c)

# 7) Force Telegram/PWA clients onto a new cache generation.
sw=SW.read_text().replace('const CACHE="game-zone-v22-static";','const CACHE="game-zone-v23-static";').replace('const CACHE="game-zone-v21-static";','const CACHE="game-zone-v23-static";')
SW.write_text(sw)

m=MANIFEST.read_text().replace('Game Zone v1.0 RC20 — متجر المنتجات الرقمية','Game Zone — متجر المنتجات الرقمية')
MANIFEST.write_text(m)

print('GAME_ZONE_FAST_LIVE_V23=PATCHED')
