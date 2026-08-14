import { readFileSync } from "node:fs";

const RELEASE = "2026.08.14.3";
const ACCOUNT_DOCUMENT = readFileSync(new URL("../public/account-unified.html", import.meta.url), "utf8");
const V41_DOCUMENT = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const PUBLIC_DOCUMENT = readFileSync(new URL("../public/platform-v5.html", import.meta.url), "utf8");
const V41_STYLES = [`/assets/v41-responsive.css?v=${RELEASE}`];
const V41_BRIDGE = `/assets/v41-production-bridge.js?v=${RELEASE}`;
const STOREFRONT_STYLES = [`/assets/store-desktop-responsive.css?v=${RELEASE}`];
const PLATFORM_STYLES = [
  `/assets/platform-v5.css?v=${RELEASE}`,
  `/assets/platform-v5-responsive.css?v=${RELEASE}`,
  `/assets/platform-v5-polish.css?v=${RELEASE}`
];
const PLATFORM_SCRIPTS = [
  `/assets/platform-v5-recovery.js?v=${RELEASE}`,
  `/assets/platform-v5.js?v=${RELEASE}`,
  `/assets/platform-v5-stability.js?v=${RELEASE}`,
  `/assets/platform-v5-polish.js?v=${RELEASE}`
];

const V41_RUNTIME_MARKER = "render();\nhideBootLoader();\n})();";
const V41_RUNTIME_ADAPTER = String.raw`
/* UCHIHA production runtime adapter — injected inside the approved v41 IIFE. */
function v41ProductionCurrency(value){
 var next=String(value||'USD').trim().toUpperCase();
 return /^[A-Z]{3}$/.test(next)?next:'USD';
}
function v41ProductionLocalized(value,fallback){
 if(value&&typeof value==='object')return String(value.ar||value.en||fallback||'').trim();
 return String(value||fallback||'').trim();
}
function v41ProductionStableId(value,index){
 var raw=String(value||'');
 var tail=raw.replace(/[^0-9a-f]/gi,'').slice(-8),parsed=parseInt(tail||'',16);
 if(!isFinite(parsed))parsed=Number(index)||0;
 return 1000+(Math.abs(parsed)%900000);
}
function v41ProductionCategory(row){
 var key=[row&&row.key,row&&row.slug,row&&row.iconKey,v41ProductionLocalized(row&&row.name,'')].join(' ').toLowerCase();
 if(/telegram|\bbot\b|بوت/.test(key))return 'bots';
 if(/android|iphone|\bios\b|mobile|\bapp\b|تطبيق/.test(key))return 'apps';
 if(/domain|dns|دومين|نطاق/.test(key))return 'domains';
 if(/hosting|server|vps|deploy|استضاف|سيرفر/.test(key))return 'hosting';
 if(/store|shop|commerce|متجر/.test(key))return 'stores';
 return 'websites';
}
function v41ProductionResetSession(resetStack){
 try{localStorage.removeItem('uchiha-platform-v19-demo')}catch(e){}
 try{persistDemoState=function(){}}catch(e){}
 try{chatUnreadCount=function(){return 0}}catch(e){}
 CONFIG.demoAdminMode=false;
 state.loggedIn=false;
 state.session=null;
 state.authReturn=null;
 state.reviewOrder=null;
 state.pendingOrder=null;
 if(resetStack)state.stack=[{page:'home'}];
 state.orders=[];
 state.walletTxs=[];
 state.notifications=[];
 state.customerRecords=[];
 state.paymentRecords=[];
 state.adminLedger=[];
 state.chatThreads={};
 DEMO_USER.name='مستخدم UCHIHA';
 DEMO_USER.firstName='مستخدم';
 DEMO_USER.initial='م';
 DEMO_USER.accountId='';
 DEMO_USER.walletId='';
 DEMO_USER.phone='';
 DEMO_USER.telegram='';
 DEMO_USER.email='';
 DEMO_USER.balance=0;
 DEMO_USER.notifications=0;
 DEMO_USER.role='guest';
 DEMO_USER.status='active';
}
function v41ProductionResetCatalog(){
 services.splice(0,services.length);
 paymentMethods.splice(0,paymentMethods.length);
 state.catalogEdits={};
 state.catalogOrder=[];
 state.catalogCustomServices=[];
 state.catalogSelected=0;
 state.paymentOrder=[];
 state.paymentSelected='';
}
function v41ProductionMoneyFormatter(currency){
 var walletCurrency=v41ProductionCurrency(currency);
 CONFIG.currency=walletCurrency;
 money=function(value){
  var amount=Number(value)||0;
  try{return new Intl.NumberFormat(document.documentElement.lang||'ar',{style:'currency',currency:walletCurrency,maximumFractionDigits:2}).format(amount)}
  catch(e){return walletCurrency+' '+amount.toFixed(2)}
 };
 return walletCurrency;
}
function v41ProductionOrder(order){
 var status=String((order&&order.status)||'pending').toLowerCase();
 var terminal=['completed','complete','approved','rejected','cancelled','canceled','failed','refunded'].indexOf(status)>-1;
 var hasAmount=order&&order.amountMinor!==null&&order.amountMinor!==undefined&&isFinite(Number(order.amountMinor));
 return {
  id:String((order&&order.id)||''),
  product:String((order&&order.title)||'طلب UCHIHA'),
  status:String((order&&order.status)||'قيد المتابعة'),
  progress:terminal?100:35,
  done:terminal,
  createdAt:(order&&order.createdAt)||null,
  updatedAt:(order&&order.updatedAt)||null,
  amount:hasAmount?Number(order.amountMinor)/100:null,
  details:(order&&order.details&&typeof order.details==='object')?order.details:{}
 };
}
function v41ProductionService(row,index){
 var name=v41ProductionLocalized(row&&row.name,'خدمة UCHIHA');
 var description=v41ProductionLocalized(row&&row.description,'');
 var duration=v41ProductionLocalized(row&&row.estimatedDuration,'حسب المشروع');
 var features=row&&row.features&&typeof row.features==='object'?(row.features.ar||row.features.en||[]):[];
 var hasPrice=row&&row.startingPriceMinor!==null&&row.startingPriceMinor!==undefined&&isFinite(Number(row.startingPriceMinor));
 return {
  id:v41ProductionStableId((row&&row.id)||(row&&row.key),index),
  productionId:String((row&&row.id)||''),
  slug:String((row&&row.slug)||(row&&row.key)||''),
  cat:v41ProductionCategory(row),
  name:name,
  short:description.slice(0,90)||name,
  price:hasPrice?Number(row.startingPriceMinor)/100:null,
  currency:v41ProductionCurrency(row&&row.currency),
  time:duration||'حسب المشروع',
  badge:String((row&&row.status)==='coming_soon'?'قريبًا':''),
  desc:description,
  features:Array.isArray(features)?features.slice(0,8).map(function(x){return String(x||'').trim()}).filter(Boolean):[],
  visible:String((row&&row.status)||'active')!=='hidden',
  comingSoon:String((row&&row.status)||'')==='coming_soon'
 };
}
function v41ProductionAmountLabel(minor,currency){
 if(minor===null||minor===undefined||!isFinite(Number(minor)))return '—';
 var amount=Number(minor)/100,code=v41ProductionCurrency(currency);
 try{return new Intl.NumberFormat(document.documentElement.lang||'ar',{style:'currency',currency:code,maximumFractionDigits:2}).format(amount)}catch(e){return code+' '+amount.toFixed(2)}
}
function v41ProductionPayment(row,index){
 var name=v41ProductionLocalized(row&&row.name,'طريقة دفع');
 var instructions=Array.isArray(row&&row.instructions)?row.instructions:[];
 var ar=instructions.find(function(x){return String(x&&x.locale||'').toLowerCase()==='ar'})||instructions[0]||{};
 var key=String((row&&row.key)||(row&&row.id)||('payment-'+index));
 var mark=name.replace(/[^A-Za-z0-9\u0600-\u06ff]/g,'').slice(0,3).toUpperCase()||'PAY';
 var type=String((row&&row.type)||'payment').replace(/[_-]+/g,' ');
 return normalizePaymentMethod({
  id:key,
  productionId:String((row&&row.id)||''),
  name:name,
  mark:mark,
  kind:type,
  icon:/bank/i.test(type)?'card':'wallet',
  logo:String((row&&row.logoUrl)||''),
  color:'#3e8cff',
  soft:'#3e8cff20',
  account:String((row&&row.accountIdentifier)||''),
  qr:String((row&&row.qrUrl)||(row&&row.qrImageUrl)||''),
  min:v41ProductionAmountLabel(row&&row.minimumAmountMinor,row&&row.currency),
  max:v41ProductionAmountLabel(row&&row.maximumAmountMinor,row&&row.currency),
  network:String((row&&row.network)||''),
  currency:v41ProductionCurrency(row&&row.currency),
  fee:'حسب الطريقة',
  net:'بعد تأكيد التحويل',
  proof:'رقم العملية أو صورة الإيصال',
  instructions:String(ar.body||'')+(ar.warning?' — '+String(ar.warning):''),
  visible:String((row&&row.status)||'active')==='active',
  configured:!!(row&&row.configured)
 });
}
function v41ProductionSyncPortal(portal){
 if(!portal||typeof portal!=='object')return false;
 var serviceRows=Array.isArray(portal.services)?portal.services:[];
 var paymentRows=Array.isArray(portal.paymentMethods)?portal.paymentMethods:[];
 services.splice(0,services.length);
 serviceRows.filter(function(row){var st=String((row&&row.status)||'active');return st==='active'||st==='coming_soon'}).forEach(function(row,index){services.push(v41ProductionService(row,index))});
 paymentMethods.splice(0,paymentMethods.length);
 paymentRows.filter(function(row){return String((row&&row.status)||'active')==='active'}).forEach(function(row,index){paymentMethods.push(v41ProductionPayment(row,index))});
 state.catalogEdits={};
 state.catalogCustomServices=[];
 state.catalogOrder=services.map(function(s){return s.id});
 state.catalogSelected=(services[0]&&services[0].id)||0;
 state.paymentOrder=paymentMethods.map(function(m){return m.id});
 state.paymentSelected=(paymentMethods[0]&&paymentMethods[0].id)||'';
 ensureCatalogOrder();
 ensurePaymentOrder();
 var presentation=portal.settings&&portal.settings['portal.presentation'];
 if(presentation&&typeof presentation==='object'&&Number(presentation.sliderAutoplayMs)>0){CONFIG.sliderAutoplayMs=Number(presentation.sliderAutoplayMs)}
 render();
 return true;
}
function v41ProductionSetGuest(){
 v41ProductionResetSession(false);
 render();
 return true;
}
function v41ProductionSetAccount(account,orders){
 var stack=Array.isArray(state.stack)&&state.stack.length?state.stack.slice():[{page:'home'}];
 v41ProductionResetSession(false);
 state.stack=stack;
 if(!account||!account.user){render();return false}
 var user=account.user||{},wallet=account.wallet||{},preferences=account.preferences||{};
 var notices=Array.isArray(account.notifications)?account.notifications:[];
 var displayName=String(user.displayName||user.email||'مستخدم UCHIHA').trim();
 var parts=displayName.split(/\s+/).filter(Boolean),first=parts[0]||'مستخدم';
 var currency=v41ProductionMoneyFormatter(wallet.currency);
 DEMO_USER.name=displayName;
 DEMO_USER.firstName=first;
 DEMO_USER.initial=first.charAt(0)||'م';
 DEMO_USER.accountId=String(user.email||user.id||'');
 DEMO_USER.walletId=currency;
 DEMO_USER.phone=String(preferences.phone||'');
 DEMO_USER.telegram=preferences.telegramUsername?'@'+preferences.telegramUsername:'';
 DEMO_USER.email=String(user.email||'');
 DEMO_USER.balance=Math.max(0,Number(wallet.availableMinor||0))/100;
 DEMO_USER.createdAt=user.createdAt||'';
 DEMO_USER.role=user.isPlatformAdmin?'admin':'customer';
 DEMO_USER.status=String(user.status||'active');
 state.loggedIn=true;
 state.session={id:'production',role:DEMO_USER.role,permissions:[],lastLogin:new Date().toISOString()};
 state.orders=(Array.isArray(orders)?orders:[]).map(v41ProductionOrder);
 state.notifications=notices.map(function(notification){return {
  id:String((notification&&notification.id)||''),
  title:String((notification&&notification.title)||''),
  body:String((notification&&notification.body)||''),
  orderId:'',
  type:String((notification&&notification.type)||'info'),
  read:!!(notification&&notification.isRead),
  time:(notification&&notification.createdAt)||null
 }});
 DEMO_USER.notifications=state.notifications.filter(function(notification){return !notification.read}).length;
 render();
 return true;
}
window.__UCHIHA_V41_RUNTIME__=Object.freeze({
 release:'${RELEASE}',
 setGuest:v41ProductionSetGuest,
 setAccount:v41ProductionSetAccount,
 syncAccount:v41ProductionSetAccount,
 syncPortal:v41ProductionSyncPortal
});
v41ProductionResetSession(true);
v41ProductionResetCatalog();
`;

const PUBLIC_DOCUMENT_PATHS = new Set([
  "/",
  "/login",
  "/register",
  "/services",
  "/showcase",
  "/payment-methods",
  "/api-services",
  "/support",
  "/contact",
  "/about",
  "/privacy",
  "/terms",
  "/refund-policy",
  "/add-balance",
  "/orders",
  "/index.html",
  "/login.html",
  "/register.html",
  "/services.html",
  "/showcase.html",
  "/payment-methods.html",
  "/api-services.html",
  "/support.html",
  "/contact.html",
  "/about.html",
  "/privacy.html",
  "/terms.html",
  "/refund-policy.html"
]);

const PLATFORM_ALIAS_ROUTES = [
  "/index.html",
  "/login.html",
  "/register",
  "/register.html",
  "/services.html",
  "/showcase.html",
  "/payment-methods.html",
  "/api-services",
  "/api-services.html",
  "/support.html",
  "/contact.html",
  "/about",
  "/about.html",
  "/privacy.html",
  "/terms.html",
  "/refund-policy",
  "/refund-policy.html"
];

function pagePath(request) {
  return String(request.raw?.url || request.url || "").split("?")[0].replace(/\/+$/, "") || "/";
}

function injectAssets(html, assets) {
  let output = html;
  for (const source of assets.styles) {
    if (output.includes(source)) continue;
    output = output.replace(/<\/head>/i, `<link rel="stylesheet" href="${source}"></head>`);
  }
  for (const source of assets.scripts) {
    if (output.includes(source)) continue;
    output = output.replace(/<\/body>/i, `<script src="${source}" defer></script></body>`);
  }
  return output;
}

export function productionV41Document() {
  let output = V41_DOCUMENT
    .replace("<title>UCHIHA Platform — v41 Final Demo</title>", "<title>UCHIHA Platform</title>");
  if (!output.includes("window.__UCHIHA_V41_RUNTIME__") && output.includes(V41_RUNTIME_MARKER)) {
    output = output.replace(V41_RUNTIME_MARKER, `${V41_RUNTIME_ADAPTER}\n${V41_RUNTIME_MARKER}`);
  }
  if (!output.includes(V41_BRIDGE)) {
    output = output.replace(/<\/head>/i, `<script src="${V41_BRIDGE}"></script></head>`);
  }
  return output;
}

function normalizeStorefrontRelease(html) {
  return html
    .replaceAll("2026.08.11.2", RELEASE)
    .replaceAll("20260801-platform", RELEASE)
    .replace('href="/assets/styles.css"', `href="/assets/styles.css?v=${RELEASE}"`)
    .replace('href="/assets/ui-v2.css"', `href="/assets/ui-v2.css?v=${RELEASE}"`)
    .replace('src="/assets/i18n.js"', `src="/assets/i18n.js?v=${RELEASE}"`)
    .replace('src="/assets/payments-links.js"', `src="/assets/payments-links.js?v=${RELEASE}"`);
}

function documentResponse(reply, document) {
  reply.removeHeader("content-length");
  reply.header("content-type", "text/html; charset=utf-8");
  reply.header("cache-control", "no-store, max-age=0");
  reply.header("pragma", "no-cache");
  reply.header("expires", "0");
  return document;
}

function responseHtml(payload) {
  if (Buffer.isBuffer(payload)) return payload.toString("utf8");
  if (typeof payload === "string") return payload;
  return null;
}

function registerPlatformRoutes(app) {
  const handler = async (_request, reply) => documentResponse(reply, PUBLIC_DOCUMENT);
  app.get("/category/:categorySlug", handler);
  app.get("/category/:categorySlug/:subcategorySlug", handler);
  app.get("/product/:productSlug", handler);
  app.get("/add-balance", handler);
  app.get("/add-balance/:methodKey", handler);
  app.get("/orders", handler);
  for (const path of PLATFORM_ALIAS_ROUTES) app.get(path, handler);
}

export function installLaunchAssetInjection(app) {
  registerPlatformRoutes(app);

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.method !== "GET") return payload;
    const pathname = pagePath(request);

    if (pathname === "/account") {
      return documentResponse(
        reply,
        injectAssets(ACCOUNT_DOCUMENT, {
          styles: [...PLATFORM_STYLES, `/assets/account-renewals.css?v=${RELEASE}`],
          scripts: [...PLATFORM_SCRIPTS, `/assets/account-renewals.js?v=${RELEASE}`]
        })
      );
    }

    if (pathname === "/" || pathname === "/index.html") {
      return documentResponse(
        reply,
        injectAssets(productionV41Document(), { styles: V41_STYLES, scripts: [] })
      );
    }

    if (PUBLIC_DOCUMENT_PATHS.has(pathname)) {
      return documentResponse(reply, PUBLIC_DOCUMENT);
    }

    if (pathname === "/create-store") {
      const html = responseHtml(payload);
      if (!html || !/<\/body>/i.test(html)) return payload;
      return documentResponse(
        reply,
        injectAssets(html, {
          styles: [...PLATFORM_STYLES, `/assets/platform-unified-compat.css?v=${RELEASE}`],
          scripts: [
            `/assets/platform-v5-builder.js?v=${RELEASE}`,
            `/assets/launch-builder-sales.js?v=${RELEASE}`,
            `/assets/launch-payment-method-guard.js?v=${RELEASE}`
          ]
        })
      );
    }

    if (/^\/store\/[^/]+$/.test(pathname)) {
      const html = responseHtml(payload);
      if (!html || !/<\/body>/i.test(html)) return payload;
      const currentStorefront = normalizeStorefrontRelease(html);
      return documentResponse(
        reply,
        injectAssets(currentStorefront, { styles: STOREFRONT_STYLES, scripts: [] })
      );
    }

    if (/^\/admin\/[^/]+$/.test(pathname)) {
      const html = responseHtml(payload);
      if (!html || !/<\/body>/i.test(html)) return payload;
      return documentResponse(
        reply,
        injectAssets(html, {
          styles: [`/assets/admin-bot-link-v1.css?v=${RELEASE}`],
          scripts: [`/assets/admin-bot-link-v1.js?v=${RELEASE}`]
        })
      );
    }

    if (pathname === "/platform-admin") {
      const html = responseHtml(payload);
      if (!html || !/<\/body>/i.test(html)) return payload;
      return documentResponse(
        reply,
        injectAssets(html, {
          styles: [],
          scripts: [
            `/assets/launch-admin-sales.js?v=${RELEASE}`,
            `/assets/launch-admin-renewals.js?v=${RELEASE}`
          ]
        })
      );
    }

    return payload;
  });
}