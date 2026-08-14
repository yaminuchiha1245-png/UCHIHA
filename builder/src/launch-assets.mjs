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
function v41ProductionReset(){
 try{localStorage.removeItem('uchiha-platform-v19-demo')}catch(e){}
 try{persistDemoState=function(){}}catch(e){}
 try{chatUnreadCount=function(){return 0}}catch(e){}
 CONFIG.demoAdminMode=false;
 state.loggedIn=false;
 state.session=null;
 state.authReturn=null;
 state.reviewOrder=null;
 state.pendingOrder=null;
 state.stack=[{page:'home'}];
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
function v41ProductionSetGuest(){
 v41ProductionReset();
 render();
 return true;
}
function v41ProductionSetAccount(account,orders){
 v41ProductionReset();
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
 state.stack=[{page:'home'}];
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
 setAccount:v41ProductionSetAccount
});
v41ProductionReset();
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
