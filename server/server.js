require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { initStore, readDB, writeDB, writeDBDurable, flushStore, closeStore, getStoreInfo, verifyPersistedState, listStoreHistory, verifyStoreHistory, verifyFinancialMirrorState, verifyFinancialJournalState, verifyWalletAuthorityState, verifyBusinessAuthorityState, id, ensureUser, getUser } = require("./store");
const { verifyTelegramInitData } = require("./lib/telegramAuth");
const { submitToProvider, getProviderOrderStatus } = require("./providers");
const { sendTelegramMessage, notifyAdmins } = require("./lib/notify");
const { signAdminToken, verifyAdminToken, verifyAdminPassword, safeEqualText } = require("./lib/adminAuth");
const { signUserToken, verifyUserToken } = require("./lib/userAuth");
const { encryptValue, decryptValue, maskValue, fingerprintValue } = require("./lib/inventoryCrypto");
const { createPairRecord, isExpired, publicPair, hashSecret } = require("./lib/devicePair");
const { anonymizeAndDeleteAccount } = require("./lib/accountLifecycle");
const { publicCategory, publicAnnouncement, publicFavorite, publicProduct, publicTransaction, publicSupportTicket, publicNotification, publicOrder, publicTopup, canCustomerCancel } = require("./lib/publicViews");
const { toCsv } = require("./lib/csv");
const { makeBackup } = require("./lib/backupFormat");
const { scanDatabaseIntegrity, repairSafeIntegrity, reconcileWalletBalances } = require("./lib/integrity");
const { lockMiddleware, withKeyLocks, getLockStats } = require("./lib/keyedLock");
const { CURRENT_SCHEMA_VERSION, migrateDatabase } = require("./lib/migrations");
const { validateOutboundUrlSync, assertSafeOutboundUrl } = require("./lib/outboundPolicy");
const { normalizePaymentReference, paymentReferenceIdentity, findDuplicatePaymentReference, findIdempotentTopup, sameTopupRequest } = require("./lib/topupPolicy");
const { appendAuditEntry } = require("./lib/auditChain");
const { buildCheckoutUrl:buildCheckoutUrlPolicy } = require("./lib/checkoutPolicy");
const { normalizeOrderInput, normalizeCouponCode, findIdempotentOrder, sameOrderRequest } = require("./lib/orderPolicy");
const { sanitizeProductInputSchema, sanitizeProviderInputMap, validateCustomerData } = require("./lib/productInput");
const { sanitizeDeliveryText } = require("./lib/deliveryPromise");
const { findAdminAdjustment, sameAdminAdjustment } = require("./lib/adminFinancialPolicy");
const { readBackupStatus, listBackupFiles, backupHealth } = require("./lib/backupStatus");
const { encodeBackupFile, decodeBackupKey } = require("./lib/backupCrypto");
const { makeProviderReviewError } = require("./lib/providerOutcomePolicy");
const { adminOrderConfirmationError } = require("./lib/adminOrderPolicy");
const { topupActionConfirmationError, topupApprovalEvidenceError } = require("./lib/adminTopupPolicy");
const { broadcastConfirmationError } = require("./lib/adminBroadcastPolicy");
const { canAutomationAccess } = require("./lib/adminAutomationPolicy");
const { canBotReadCustomer } = require("./lib/botUserPolicy");
const { parseImageDataUrl, normalizeImageUrl, safePurpose, safeFileName } = require("./lib/imageAsset");
const { publicCurrencies, sanitizeAdminCurrencies } = require("./lib/currencyConfig");
const { sanitizeDecision:sanitizeVerificationDecision, publicVerification } = require("./lib/verificationPolicy");

const app = express();
const UPLOAD_DIR=path.resolve(process.env.UPLOAD_DIR||path.join(__dirname,"uploads"));
const RECEIPT_DIR=path.resolve(process.env.RECEIPT_DIR||path.join(__dirname,"receipts"));
const IMAGE_UPLOAD_MAX_BYTES=Math.max(64*1024,Math.min(5*1024*1024,Number(process.env.IMAGE_UPLOAD_MAX_BYTES||2*1024*1024)));
const RECEIPT_MAX_BYTES=Math.max(64*1024,Math.min(5*1024*1024,Number(process.env.RECEIPT_MAX_BYTES||1024*1024)));
fs.mkdirSync(UPLOAD_DIR,{recursive:true});
fs.mkdirSync(RECEIPT_DIR,{recursive:true});
app.set("trust proxy",1);
app.use((req,res,next)=>{
  req.requestId=crypto.randomBytes(8).toString("hex");
  res.setHeader("X-Request-ID",req.requestId);
  next();
});
const allowedOrigins=String(process.env.ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean);
app.use(cors({origin:(origin,cb)=>{
  if(!origin||!allowedOrigins.length||allowedOrigins.includes(origin))return cb(null,true);
  return cb(new Error("origin_not_allowed"));
}}));
app.use((req,res,next)=>{
  if(req.path.startsWith("/api/"))res.setHeader("Cache-Control","no-store");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Referrer-Policy","same-origin");
  res.setHeader("X-Frame-Options","SAMEORIGIN");
  res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Resource-Policy","same-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies","none");
  res.setHeader("X-DNS-Prefetch-Control","off");
  res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; form-action 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
  if(process.env.NODE_ENV==="production")res.setHeader("Strict-Transport-Security","max-age=31536000; includeSubDomains");
  next();
});
app.use(express.json({limit:process.env.JSON_BODY_LIMIT||"2mb",strict:true}));

app.use("/assets", express.static(path.join(__dirname,"../assets")));
app.use("/uploads", express.static(UPLOAD_DIR,{fallthrough:false,maxAge:"7d",immutable:true}));
app.use("/admin", express.static(path.join(__dirname,"../admin")));
app.use("/", express.static(path.join(__dirname,"../miniapp")));

const now = () => new Date().toISOString();
const clientIp = req => String(req.ip || req.socket?.remoteAddress || "local");
const money = n => Number(Number(n||0).toFixed(2));
const cleanImageUrl=value=>normalizeImageUrl(value);
function persistImageDataUrl({dataUrl,purpose="asset",maxBytes=IMAGE_UPLOAD_MAX_BYTES,dir=UPLOAD_DIR,prefix="img"}={}){
  const parsed=parseImageDataUrl(dataUrl,{maxBytes});
  const safe=safePurpose(purpose),fileName=`${prefix}-${safe}-${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}.${parsed.ext}`;
  const finalPath=path.join(dir,fileName),tmpPath=finalPath+".tmp";
  fs.writeFileSync(tmpPath,parsed.buffer,{flag:"wx"});
  fs.renameSync(tmpPath,finalPath);
  return {fileName,mimeType:parsed.mimeType,size:parsed.size,path:finalPath};
}
function sendStoredFile(res,baseDir,fileName,mimeType){
  const safe=safeFileName(fileName);
  if(!safe||safe!==fileName)return res.status(404).json({error:"file_not_found"});
  const filePath=path.join(baseDir,safe);
  if(!fs.existsSync(filePath))return res.status(404).json({error:"file_not_found"});
  res.setHeader("Cache-Control","private, no-store");
  if(mimeType)res.type(mimeType);
  return res.sendFile(filePath);
}
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : "")).replace(/\/$/,"");
let integrityDirty=true;

const tgEsc = v => String(v??"").replace(/[&<>]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[ch]));
const SAFE_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
function cleanText(v,max=500){
  const x=String(v??"").trim();
  if(x.length>max)throw new Error("text_too_long");
  return x;
}
function validHttpUrl(value){
  if(!value)return true;
  try{return ["http:","https:"].includes(new URL(String(value)).protocol)}catch{return false}
}
function finiteNumber(v,{min=-Infinity,max=Infinity}={}){
  const n=Number(v);return Number.isFinite(n)&&n>=min&&n<=max?n:null;
}

const LOCK_TIMEOUT_MS=Math.max(1000,Number(process.env.OPERATION_LOCK_TIMEOUT_MS||30000));
const locksForUser=req=>[`user:${String(req.authTelegramId||req.params?.telegramId||req.body?.telegramId||"")}`];
const locksForOrderCreate=req=>{
  const keys=[`user:${String(req.authTelegramId||"")}`];
  const product=(readDB().products||[]).find(x=>String(x.id)===String(req.body?.productId||""));
  if(product?.delivery==="inventory")keys.push(`inventory-product:${product.id}`);
  const coupon=String(req.body?.couponCode||"").trim().toUpperCase();
  if(coupon)keys.push(`coupon:${coupon}`);
  return keys;
};
const locksForAccountDelete=req=>{
  const tid=String(req.authTelegramId||""),db=readDB(),keys=[`user:${tid}`];
  for(const usage of db.couponUsages||[])if(String(usage.telegramId)===tid&&usage.code)keys.push(`coupon:${String(usage.code).toUpperCase()}`);
  for(const pair of db.devicePairs||[])if(String(pair.telegramId||"")===tid&&pair.id)keys.push(`pair:${pair.id}`);
  return keys;
};
const locksForIntegrityRepair=()=>{
  const db=readDB(),keys=["integrity:global"];
  for(const c of db.coupons||[])if(c.code)keys.push(`coupon:${String(c.code).toUpperCase()}`);
  return keys;
};
const locksForWalletReconcile=()=>{
  const db=readDB(),keys=["integrity:global"];
  for(const u of db.users||[])if(u.telegramId)keys.push(`user:${String(u.telegramId)}`);
  return keys;
};
const locksForCustomerOrder=req=>[`user:${String(req.authTelegramId||"")}`,`order:${String(req.params?.orderNo||"")}`];
const locksForAdminOrder=req=>{
  const order=(readDB().orders||[]).find(x=>String(x.id)===String(req.params?.id||""));
  return order?[`order:${order.id}`,`user:${String(order.telegramId||"")}`]:[`order:${String(req.params?.id||"")}`];
};
const locksForTopupCreate=req=>{
  const keys=[`user:${String(req.authTelegramId||"")}`];
  const ref=paymentReferenceIdentity(req.body?.method||"manual",req.body?.reference||"");
  if(ref)keys.push(`payment-ref:${ref}`);
  return keys;
};
const locksForTopup=req=>{
  const db=readDB(),topupId=String(req.params?.id||req.body?.topupId||"");
  const topup=(db.topups||[]).find(x=>String(x.id)===topupId);
  const keys=topup?[`topup:${topup.id}`,`user:${String(topup.telegramId||"")}`]:[`topup:${topupId}`];
  const ref=paymentReferenceIdentity(req.params?.methodId||topup?.method||"",req.body?.reference||topup?.reference||"");
  if(ref)keys.push(`payment-ref:${ref}`);
  return keys;
};
const locksForProviderWebhook=req=>{
  const providerId=String(req.params?.providerId||""),providerOrderId=String(req.body?.providerOrderId||"");
  const order=(readDB().orders||[]).find(x=>String(x.providerUsed)===providerId&&String(x.providerOrderId)===providerOrderId);
  return order?[`order:${order.id}`,`user:${String(order.telegramId||"")}`]:[`provider-order:${providerId}:${providerOrderId}`];
};
const locksForInventoryProduct=req=>[`inventory-product:${String(req.body?.productId||req.query?.productId||"")}`];
const locksForInventoryItem=req=>{
  const item=(readDB().inventoryCodes||[]).find(x=>String(x.id)===String(req.params?.id||""));
  return item?[`inventory-product:${String(item.productId||"")}`,`inventory-item:${item.id}`]:[`inventory-item:${String(req.params?.id||"")}`];
};
const locksForCoupon=req=>[`coupon:${String(req.params?.code||req.body?.code||"").trim().toUpperCase()}`];
const locksForPairStatus=req=>{
  const pairId=String(req.body?.pairId||""),pair=(readDB().devicePairs||[]).find(x=>String(x.id)===pairId);
  return pair&&pair.telegramId?[`pair:${pairId}`,`user:${String(pair.telegramId)}`]:[`pair:${pairId}`];
};
const locksForPairApprove=req=>{
  const code=String(req.body?.code||"").trim().toUpperCase(),tid=String(req.body?.telegramUser?.id||"");
  const pair=(readDB().devicePairs||[]).find(x=>x.code===code&&x.status==="pending");
  const keys=pair?[`pair:${pair.id}`]:[`pair-code:${code}`];
  if(tid)keys.push(`user:${tid}`);
  return keys;
};
const financialLocks=keyFn=>lockMiddleware(keyFn,{timeoutMs:LOCK_TIMEOUT_MS});

function anonymousAccountId(){
  return `anon_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}
function createOrderNo(db){
  let value;
  do{
    const stamp=Date.now().toString(36).toUpperCase();
    const rand=crypto.randomBytes(3).toString("hex").toUpperCase();
    value=`GZ-${stamp}-${rand}`;
  }while((db.orders||[]).some(o=>o.orderNo===value));
  return value;
}


function publicUser(u){
  return {
    telegramId:u.telegramId, username:u.username, firstName:u.firstName, lastName:u.lastName,
    balance:money(u.balance), currency:u.currency||"USD", createdAt:u.createdAt
  };
}

function publicPaymentMethod(m){
  return {
    id:m.id,name:m.name,icon:m.icon||"",imageUrl:m.imageUrl||null,instructions:m.instructions||"",account:m.account||"",
    requiresReference:m.requiresReference!==false,requiresReceipt:m.requiresReceipt===true,minAmount:Number(m.minAmount||0),maxAmount:Number(m.maxAmount||0),sort:Number(m.sort||0)
  };
}
function publicStoreConfig(db){
  const x=db.settings||{};
  return {
    storeName:x.storeName||"Game Zone",
    tagline:x.tagline||"متجر المنتجات الرقمية",
    maintenance:!!x.maintenance,
    maintenanceMessage:x.maintenanceMessage||"المتجر تحت الصيانة",
    showAnnouncements:x.showAnnouncements!==false,
    minTopup:Number(x.minTopup||1),
    maxTopup:Number(x.maxTopup||1000),
    baseCurrency:"USD",
    currencies:publicCurrencies(x.currencies),
    pwaEnabled:x.pwaEnabled!==false,
    androidAppEnabled:x.androidAppEnabled!==false,
    privacyPolicyVersion:x.privacyPolicyVersion||null,
    termsVersion:x.termsVersion||null,
    allowAccountDeletion:x.allowAccountDeletion!==false,
    customerDataExportEnabled:x.customerDataExportEnabled!==false
  };
}
function deliveryText(value){
  return typeof value==="string"?value:JSON.stringify(value);
}
function storeProviderDelivery(order,value){
  if(value===undefined||value===null||String(value)==="")return false;
  const clear=deliveryText(value);
  if(clear.length>10000)throw new Error("provider_delivery_too_large");
  const fingerprint=fingerprintValue(clear);
  if(order.providerDeliveryFingerprint===fingerprint)return false;
  order.providerDelivery=encryptValue(clear);
  order.providerDeliveryFingerprint=fingerprint;
  order.providerDeliveryMasked=maskValue(clear);
  order.providerDeliveryUpdatedAt=now();
  return true;
}
function revealOrderDelivery(db,order){
  if(order.inventoryCodeId){
    const item=(db.inventoryCodes||[]).find(x=>x.id===order.inventoryCodeId&&x.orderNo===order.orderNo);
    if(!item)throw new Error("delivery_item_not_found");
    return {kind:"inventory",value:decryptValue(item)};
  }
  if(order.providerDelivery){
    return {kind:"provider",value:decryptValue(order.providerDelivery)};
  }
  throw new Error("digital_delivery_not_available");
}

function adminOnly(req,res,next){
  const auth=String(req.headers.authorization||"");
  const token=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(token){
    const verified=verifyAdminToken(token);
    if(verified.ok){
      const currentVersion=Number(readDB().settings?.adminSessionVersion||1);
      if(Number(verified.payload.ver||0)!==currentVersion)return res.status(401).json({ok:false,error:"admin_session_revoked"});
      req.admin=verified.payload;return next();
    }
  }
  const botSecret=process.env.INTERNAL_BOT_SECRET||"";
  const botAdminSecret=process.env.INTERNAL_BOT_ADMIN_SECRET||"";
  if(botSecret&&botAdminSecret&&safeEqualText(req.headers["x-bot-secret"]||"",botSecret)&&safeEqualText(req.headers["x-bot-admin-secret"]||"",botAdminSecret)){
    req.admin={sub:"internal-bot",role:"automation",internal:true};
    if(!canAutomationAccess(req.method,req.path)){
      recordSecurityEvent("automation_admin_forbidden",req,{method:req.method,path:req.path});
      return res.status(403).json({ok:false,error:"admin_automation_forbidden"});
    }
    return next();
  }
  const adminKey=process.env.ADMIN_KEY||"dev-admin-key";
  if(String(process.env.ALLOW_LEGACY_ADMIN_KEY||"false").toLowerCase()==="true"){
    const supplied=req.headers["x-admin-key"]||req.query.adminKey;
    if(safeEqualText(supplied||"",adminKey)){req.admin={sub:"legacy-key",role:"owner",legacy:true};return next();}
  }
  return res.status(401).json({ok:false,error:"admin_unauthorized"});
}
const rateBuckets=new Map();
const rateCleanup=setInterval(()=>{
  const cutoff=Date.now()-10*60*1000;
  for(const [key,bucket] of rateBuckets){if(!bucket||bucket.start<cutoff)rateBuckets.delete(key);}
  if(rateBuckets.size>50000)rateBuckets.clear();
},5*60*1000);
if(rateCleanup.unref)rateCleanup.unref();

function rateLimit(name,limit=20,windowMs=60000){
  return (req,res,next)=>{
    const key=`${name}:${clientIp(req)}`;
    const t=Date.now();let b=rateBuckets.get(key);
    if(!b||t-b.start>windowMs)b={start:t,count:0};
    b.count++;rateBuckets.set(key,b);
    if(b.count>limit)return res.status(429).json({ok:false,error:"rate_limited"});
    next();
  };
}
function recordSecurityEvent(type,req,meta={}){
  const db=readDB();db.securityEvents||=[];db.securityEvents.unshift({id:id("sec"),type,meta,ip:clientIp(req),requestId:req.requestId||null,createdAt:now()});db.securityEvents=db.securityEvents.slice(0,1000);writeDB(db);
}
function userOnly(req,res,next){
  const botSecret=process.env.INTERNAL_BOT_SECRET||"";
  if(botSecret && safeEqualText(req.headers["x-bot-secret"]||"",botSecret)){
    if(!canBotReadCustomer(req.method,req.path)){
      recordSecurityEvent("bot_customer_impersonation_forbidden",req,{method:req.method,path:req.path});
      return res.status(403).json({ok:false,error:"bot_customer_mutation_forbidden"});
    }
    const tid=String(req.query.telegramId||"");
    const user=tid?getUser(tid):null;
    if(!user)return res.status(401).json({ok:false,error:"user_session_invalid"});
    req.authTelegramId=tid;req.authUser=user;
    return next();
  }
  const auth=String(req.headers.authorization||"");
  const token=auth.startsWith("Bearer ")?auth.slice(7):"";
  const verified=verifyUserToken(token);
  if(!verified.ok)return res.status(401).json({ok:false,error:"user_unauthorized"});
  const tid=String(verified.payload.sub),user=getUser(tid);
  if(!user)return res.status(401).json({ok:false,error:"user_session_invalid"});
  if(Number(verified.payload.ver||1)!==Number(user.sessionVersion||1))return res.status(401).json({ok:false,error:"user_session_revoked"});
  req.authTelegramId=tid;req.authUser=user;
  return next();
}
function botOnly(req,res,next){
  const expected=process.env.INTERNAL_BOT_SECRET;
  if(expected && !safeEqualText(req.headers["x-bot-secret"]||"",expected))return res.status(401).json({ok:false,error:"bot_unauthorized"});
  next();
}
function paymentWebhookAuth(req,res,next){
  const expected=String(process.env.PAYMENT_WEBHOOK_SECRET||"");
  const supplied=String(req.headers["x-payment-webhook-secret"]||"");
  if(!expected||!safeEqualText(supplied,expected))return res.status(401).json({ok:false,error:"payment_webhook_unauthorized"});
  next();
}
function providerWebhookAuth(req,res,next){
  const provider=(readDB().providers||[]).find(x=>String(x.id)===String(req.params?.providerId||""));
  const specific=provider?.webhookSecretEnv?String(process.env[provider.webhookSecretEnv]||""):"";
  const expected=specific||String(process.env.PROVIDER_WEBHOOK_SECRET||"");
  const supplied=String(req.headers["x-provider-webhook-secret"]||"");
  if(!expected||!safeEqualText(supplied,expected))return res.status(401).json({ok:false,error:"webhook_unauthorized"});
  req.webhookProvider=provider||null;
  next();
}
function storeOpen(req,res,next){
  const settings=readDB().settings||{};
  if(settings.maintenance)return res.status(503).json({ok:false,error:"maintenance",message:settings.maintenanceMessage||"المتجر تحت الصيانة"});
  next();
}
function pushAudit(db, req, action, meta={}){
  db.adminAudit ||= [];
  appendAuditEntry(db.adminAudit,{
    id:id("audit"),action,meta,
    ip:clientIp(req),requestId:req.requestId||null,
    createdAt:now()
  });
  db.adminAudit=db.adminAudit.slice(0,1000);
}
function pushProviderLog(db, entry){
  db.providerLogs ||= [];
  db.providerLogs.unshift({id:id("plog"),...entry,createdAt:now()});
  db.providerLogs=db.providerLogs.slice(0,1500);
}
function addNotification(db, telegramId, title, body, type="info", ref=null){
  db.notifications ||= [];
  db.notifications.unshift({id:id("noti"),telegramId:String(telegramId),title,body,type,ref,read:false,createdAt:now()});
}

function addOrderEvent(db, orderNo, status, note="", source="system"){
  db.orderEvents ||= [];
  db.orderEvents.unshift({id:id("oev"),orderNo,status,note,source,createdAt:now()});
}

async function persistCritical(db){
  try{
    await writeDBDurable(db);
    integrityDirty=true;
  }catch(e){
    console.error("Critical storage persistence failed:",e.causeMessage||e.message);
    if(process.env.NODE_ENV==="production"&&String(process.env.STORAGE_FAIL_FAST||"true").toLowerCase()!=="false"){
      setTimeout(()=>process.exit(1),150);
    }
    throw e;
  }
}

function applyTopupAction(db, topup, action, source="admin"){
  if(!topup)throw new Error("topup_not_found");
  if(topup.status!=="pending")return {idempotent:true,user:db.users.find(x=>String(x.telegramId)===String(topup.telegramId))||null};
  if(!["approve","reject"].includes(action))throw new Error("invalid_topup_action");
  topup.status=action==="approve"?"approved":"rejected";
  topup.updatedAt=now();topup.processedBy=source;
  const user=db.users.find(x=>String(x.telegramId)===String(topup.telegramId));
  if(action==="approve"){
    if(!user)throw new Error("user_not_found");
    user.balance=money(Number(user.balance)+Number(topup.amount));user.updatedAt=now();
    db.transactions.push({
      id:id("txn"),telegramId:String(user.telegramId),type:"topup",amount:Number(topup.amount),
      currency:topup.currency||"USD",reference:topup.id,createdAt:now()
    });
    addNotification(db,topup.telegramId,"تم قبول شحن الرصيد",`أضيف $${Number(topup.amount).toFixed(2)} إلى رصيدك`,"topup",topup.id);
  }else{
    addNotification(db,topup.telegramId,"تم رفض طلب الشحن",`تم رفض طلب الشحن ${topup.id}`,"topup",topup.id);
  }
  return {idempotent:false,user};
}
function buildCheckoutUrl(template,topup){
  return buildCheckoutUrlPolicy(template,topup,{requireHttps:process.env.NODE_ENV==="production"});
}

const syncRuntime={
  running:false,lastRunAt:null,lastFinishedAt:null,lastScanned:0,lastUpdated:0,lastErrors:0,lastError:null,nextRunAt:null
};
const maintenanceRuntime={
  lastRunAt:null,lastRemoved:{notifications:0,providerLogs:0,audit:0,security:0,devicePairs:0,deletedAccounts:0},lastError:null
};
const integrityRuntime={lastRunAt:null,lastCounts:{critical:0,warning:0,info:0},lastAlertSignature:null,lastError:null};
let syncTimer=null;
const broadcastRuntime={running:false,currentId:null,lastFinishedAt:null,lastError:null};
let broadcastKickScheduled=false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));


app.get("/api/health",(req,res)=>{
  const st=getStoreInfo();
  res.json({
    ok:!st.lastPersistError&&!st.pgPoolError&&!st.lastStateVerifyError&&!st.lastFinancialMirrorError&&!st.lastFinancialJournalError&&!st.lastWalletAuthorityError&&!st.lastBusinessAuthorityError,
    service:"game-zone-api",version:"1.0.0-rc.20",time:now(),
    storage:{driver:st.driver,healthy:!st.lastPersistError&&!st.pgPoolError&&!st.lastStateVerifyError&&!st.lastFinancialMirrorError&&!st.lastFinancialJournalError&&!st.lastWalletAuthorityError&&!st.lastBusinessAuthorityError,stateRevision:st.stateRevision||null,financialMirrorRevision:st.financialMirrorRevision||null,financialJournalEntries:st.financialJournalEntries||0,walletAuthorityRevision:st.walletAuthorityLastStateRevision||null,businessAuthorityRevision:st.businessAuthorityLastStateRevision||null},
    workers:{syncRunning:!!syncRuntime.running,maintenanceLastRunAt:maintenanceRuntime.lastRunAt}
  });
});
app.get("/api/health/live",(req,res)=>res.json({ok:true,service:"game-zone-api",time:now()}));
app.get("/api/health/ready",(req,res)=>{
  const st=getStoreInfo(),last=new Date(integrityRuntime.lastRunAt||0).getTime();
  if(integrityDirty||!Number.isFinite(last)||Date.now()-last>60000)runIntegrityMonitoring({notify:false});
  const counts=integrityRuntime.lastCounts||{critical:0};
  const ready=!shuttingDown&&!st.lastPersistError&&!st.pgPoolError&&!st.lastStateVerifyError&&!st.lastFinancialMirrorError&&!st.lastFinancialJournalError&&!st.lastWalletAuthorityError&&!st.lastBusinessAuthorityError&&Number(counts.critical||0)===0;
  res.status(ready?200:503).json({ok:ready,service:"game-zone-api",time:now()});
});
app.get("/api/config",(req,res)=>{
  const db=readDB();
  res.json({...publicStoreConfig(db),version:"1.0.0-rc.20",botUsername:process.env.BOT_USERNAME||"",
    privacyPolicyUrl:publicBaseUrl?`${publicBaseUrl}/privacy.html`:"/privacy.html",
    termsUrl:publicBaseUrl?`${publicBaseUrl}/terms.html`:"/terms.html",
    accountDeletionUrl:publicBaseUrl?`${publicBaseUrl}/account-deletion.html`:"/account-deletion.html",
    paymentMethods:(db.paymentMethods||[]).filter(x=>x.active).sort((a,b)=>(a.sort||0)-(b.sort||0)).map(publicPaymentMethod)});
});

app.get("/api/announcements",(req,res)=>{
  const db=readDB();
  res.json((db.announcements||[]).filter(a=>a.active).sort((a,b)=>(a.sort||0)-(b.sort||0)).map(publicAnnouncement));
});

app.post("/api/device/pair/start",rateLimit("device_pair_start",12,60000),async(req,res)=>{
  const db=readDB();db.devicePairs ||= [];
  const minutes=Number(db.settings?.devicePairExpiryMinutes||10);
  // Keep active pending pairs bounded.
  db.devicePairs=db.devicePairs.filter(p=>!isExpired(p)||p.status==="approved").slice(0,300);
  let pair=createPairRecord({id:id("pair"),minutes});
  while(db.devicePairs.some(x=>x.code===pair.code&&!isExpired(x)))pair=createPairRecord({id:id("pair"),minutes});
  const responseSecret=pair.secret;
  delete pair.secret;
  db.devicePairs.unshift(pair);await persistCritical(db);
  const botUsername=String(process.env.BOT_USERNAME||"").replace(/^@/,"");
  res.json({
    ok:true,
    pair:{...publicPair(pair),secret:responseSecret},
    telegramDeepLink:botUsername?`https://t.me/${botUsername}?start=pair_${pair.code}`:null
  });
});
app.post("/api/device/pair/status",rateLimit("device_pair_status",120,60000),financialLocks(locksForPairStatus),async(req,res)=>{
  const pairId=String(req.body?.pairId||""),secret=String(req.body?.secret||"");
  const db=readDB(),pair=(db.devicePairs||[]).find(x=>x.id===pairId);
  if(!pair||!secret||!safeEqualText(pair.secretHash||"",hashSecret(secret)))return res.status(404).json({ok:false,error:"pair_not_found"});
  if(isExpired(pair)&&!pair.consumedAt)return res.json({ok:true,status:"expired",pair:publicPair(pair)});
  if(pair.status!=="approved"||!pair.telegramId)return res.json({ok:true,status:"pending",pair:publicPair(pair)});
  if(pair.consumedAt)return res.json({ok:true,status:"consumed",pair:publicPair(pair)});
  const user=db.users.find(u=>String(u.telegramId)===String(pair.telegramId));
  if(!user)return res.status(404).json({ok:false,error:"paired_user_not_found"});
  pair.consumedAt=now();await persistCritical(db);
  res.json({
    ok:true,status:"approved",pair:publicPair(pair),
    user:publicUser(user),sessionToken:signUserToken(user.telegramId,Math.max(24,Number(db.settings?.deviceSessionDays||30)*24),Number(user.sessionVersion||1))
  });
});
app.post("/api/device/pair/approve",botOnly,rateLimit("device_pair_approve",30,60000),financialLocks(locksForPairApprove),async(req,res)=>{
  const code=String(req.body?.code||"").trim().toUpperCase();
  const telegramUser=req.body?.telegramUser||{};
  if(!code||!telegramUser?.id)return res.status(400).json({ok:false,error:"invalid_pair_approval"});
  const db=readDB(),pair=(db.devicePairs||[]).find(x=>x.code===code&&x.status==="pending");
  if(!pair||isExpired(pair))return res.status(404).json({ok:false,error:"pair_not_found_or_expired"});
  const user=ensureUser(telegramUser);
  // Reload after ensureUser() wrote the state.
  const latest=readDB(),target=(latest.devicePairs||[]).find(x=>x.id===pair.id);
  if(!target)return res.status(404).json({ok:false,error:"pair_not_found"});
  target.status="approved";target.telegramId=String(user.telegramId);target.approvedAt=now();
  await persistCritical(latest);
  res.json({ok:true,pair:publicPair(target),user:publicUser(user)});
});

app.post("/api/admin/login",rateLimit("admin_login",8,60000),(req,res)=>{
  const password=String(req.body?.password||"");
  if(!verifyAdminPassword(password)){
    recordSecurityEvent("admin_login_failed",req);
    return res.status(401).json({ok:false,error:"invalid_admin_credentials"});
  }
  const db=readDB(),hours=Number(db.settings?.adminSessionHours||12),version=Number(db.settings?.adminSessionVersion||1);
  const token=signAdminToken({subject:"admin",hours,version,role:"owner"});
  recordSecurityEvent("admin_login_success",req,{version});
  res.json({ok:true,token,role:"owner",sessionVersion:version,expiresInHours:hours});
});

app.get("/api/admin/session",adminOnly,(req,res)=>{
  res.json({ok:true,admin:{subject:req.admin?.sub||"admin",role:req.admin?.role||"owner",issuedAt:req.admin?.iat||null,expiresAt:req.admin?.exp||null,sessionVersion:Number(readDB().settings?.adminSessionVersion||1)}});
});
app.post("/api/admin/session/revoke-all",adminOnly,async(req,res)=>{
  if(String(req.body?.confirmation||"")!=="REVOKE_ALL_ADMIN_SESSIONS")return res.status(400).json({ok:false,error:"revoke_confirmation_required"});
  const db=readDB();
  db.settings.adminSessionVersion=Math.max(1,Number(db.settings?.adminSessionVersion||1))+1;
  pushAudit(db,req,"admin_sessions_revoke_all",{newVersion:db.settings.adminSessionVersion});
  await persistCritical(db);
  recordSecurityEvent("admin_sessions_revoked",req,{newVersion:db.settings.adminSessionVersion});
  res.json({ok:true,reauthRequired:true,sessionVersion:db.settings.adminSessionVersion});
});

app.post("/api/auth/telegram",rateLimit("telegram_auth",30,60000),async(req,res)=>{
  const maxAge=Math.max(60,Math.min(86400,Number(process.env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS||3600)));
  const verified=verifyTelegramInitData(req.body?.initData,process.env.BOT_TOKEN,maxAge);
  if(!verified.ok)return res.status(401).json(verified);
  const user=ensureUser(verified.user);await flushStore();
  res.json({ok:true,user:publicUser(user),sessionToken:signUserToken(user.telegramId,24,Number(user.sessionVersion||1))});
});
app.post("/api/users/sync",botOnly,async(req,res)=>{
  try{const user=ensureUser(req.body||{});await flushStore();res.json({ok:true,user:publicUser(user)});}
  catch(e){res.status(400).json({ok:false,error:e.message});}
});

app.get("/api/categories",(req,res)=>{
  const db=readDB();
  res.json(db.categories.filter(c=>c.active).sort((a,b)=>(a.sort||0)-(b.sort||0)).map(publicCategory));
});
app.get("/api/products",(req,res)=>{
  const db=readDB();
  let list=db.products.filter(p=>p.active);
  if(req.query.categoryId)list=list.filter(p=>p.categoryId===req.query.categoryId);
  if(req.query.featured==="1")list=list.filter(p=>p.featured);
  if(req.query.q){
    const q=String(req.query.q).toLowerCase();
    list=list.filter(p=>`${p.name} ${p.description}`.toLowerCase().includes(q));
  }
  res.json(list.map(p=>publicProduct(db,p)));
});
app.get("/api/products/:id",(req,res)=>{
  const p=readDB().products.find(x=>x.id===req.params.id&&x.active);
  if(!p)return res.status(404).json({error:"product_not_found"});
  res.json(publicProduct(readDB(),p));
});
app.get("/api/me",userOnly,(req,res)=>{
  const u=getUser(req.authTelegramId);
  if(!u)return res.status(404).json({error:"user_not_found"});
  res.json(publicUser(u));
});
app.post("/api/me/sessions/revoke-all",rateLimit("customer_session_revoke",4,3600000),userOnly,financialLocks(locksForUser),async(req,res)=>{
  if(String(req.body?.confirmation||"")!=="REVOKE_ALL_USER_SESSIONS")return res.status(400).json({ok:false,error:"revoke_confirmation_required"});
  const db=readDB(),u=(db.users||[]).find(x=>String(x.telegramId)===String(req.authTelegramId));
  if(!u)return res.status(404).json({ok:false,error:"user_not_found"});
  u.sessionVersion=Math.max(1,Number(u.sessionVersion||1))+1;u.updatedAt=now();
  addNotification(db,u.telegramId,"تم إبطال جلسات الحساب","تم تسجيل خروج جميع جلسات Game Zone. ستحتاج الأجهزة الأخرى إلى إعادة الربط.","security",null);
  await persistCritical(db);
  sendTelegramMessage(u.telegramId,"🔐 تم تسجيل خروج جميع جلسات <b>Game Zone</b> المرتبطة بحسابك. إذا لم تطلب ذلك، تواصل مع الدعم.");
  res.json({ok:true,reauthRequired:true,sessionVersion:u.sessionVersion});
});
app.get("/api/me/export",rateLimit("customer_export",4,3600000),userOnly,(req,res)=>{
  const db=readDB(),tid=String(req.authTelegramId),u=(db.users||[]).find(x=>String(x.telegramId)===tid);
  if(!u)return res.status(404).json({ok:false,error:"user_not_found"});
  if(db.settings?.customerDataExportEnabled===false)return res.status(403).json({ok:false,error:"data_export_disabled"});
  const result={
    exportedAt:now(),
    profile:publicUser(u),
    orders:(db.orders||[]).filter(x=>String(x.telegramId)===tid).map(x=>publicOrder(db,x)),
    transactions:(db.transactions||[]).filter(x=>String(x.telegramId)===tid).map(publicTransaction),
    topups:(db.topups||[]).filter(x=>String(x.telegramId)===tid).map(publicTopup),
    favorites:(db.favorites||[]).filter(x=>String(x.telegramId)===tid).map(publicFavorite),
    notifications:(db.notifications||[]).filter(x=>String(x.telegramId)===tid).map(publicNotification),
    supportTickets:(db.supportTickets||[]).filter(x=>String(x.telegramId)===tid).map(publicSupportTicket)
  };
  res.setHeader("Content-Disposition",`attachment; filename="game-zone-account-${tid}.json"`);
  res.json(result);
});
app.post("/api/me/delete",rateLimit("customer_delete",3,3600000),userOnly,financialLocks(locksForAccountDelete),async(req,res)=>{
  const confirmation=String(req.body?.confirmation||"");
  if(confirmation!=="DELETE")return res.status(400).json({ok:false,error:"delete_confirmation_required"});
  const db=readDB(),tid=String(req.authTelegramId),idx=(db.users||[]).findIndex(x=>String(x.telegramId)===tid);
  if(idx<0)return res.status(404).json({ok:false,error:"user_not_found"});
  if(db.settings?.allowAccountDeletion===false)return res.status(403).json({ok:false,error:"account_deletion_disabled"});
  const deletingUser=db.users[idx];
  if(Math.abs(Number(deletingUser.balance||0))>0.000001)return res.status(409).json({ok:false,error:"balance_must_be_zero_before_deletion",balance:Number(deletingUser.balance||0)});
  const activeOrders=(db.orders||[]).filter(x=>String(x.telegramId)===tid&&["pending","processing"].includes(x.status));
  const pendingTopups=(db.topups||[]).filter(x=>String(x.telegramId)===tid&&x.status==="pending");
  if(activeOrders.length)return res.status(409).json({ok:false,error:"active_orders_exist",count:activeOrders.length});
  if(pendingTopups.length)return res.status(409).json({ok:false,error:"pending_topups_exist",count:pendingTopups.length});

  const anonId=anonymousAccountId(),deletedAt=now();
  const result=anonymizeAndDeleteAccount(db,tid,{anonymousId:anonId,deletedAt,deletionId:id("deleted")});
  await persistCritical(db);
  res.json({ok:true,deletedAt,removed:result.removed});
});
app.get("/api/orders",userOnly,(req,res)=>{
  const db=readDB(),tid=String(req.authTelegramId||"");
  const orders=db.orders.filter(o=>String(o.telegramId)===tid).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  res.json(orders.map(o=>publicOrder(db,o)));
});
app.get("/api/orders/:orderNo",userOnly,(req,res)=>{
  const db=readDB(),tid=String(req.authTelegramId||"");
  const o=db.orders.find(x=>x.orderNo===req.params.orderNo&&String(x.telegramId)===tid);
  if(!o)return res.status(404).json({error:"order_not_found"});
  res.json(publicOrder(db,o));
});
app.get("/api/orders/:orderNo/receipt",userOnly,(req,res)=>{
  const db=readDB(),tid=String(req.authTelegramId||"");
  const o=db.orders.find(x=>x.orderNo===req.params.orderNo&&String(x.telegramId)===tid);
  if(!o)return res.status(404).json({error:"order_not_found"});
  const order=publicOrder(db,o);
  res.json({
    receiptVersion:"1",
    storeName:db.settings?.storeName||"Game Zone",
    generatedAt:now(),
    order:{
      orderNo:order.orderNo,
      productName:order.productName,
      customerInput:order.customerInput,
      customerData:order.customerData,
      basePrice:order.basePrice,
      discount:order.discount,
      finalPrice:order.finalPrice,
      currency:order.currency,
      status:order.status,
      deliveryText:order.deliveryText,
      createdAt:order.createdAt,
      updatedAt:order.updatedAt
    }
  });
});
app.post("/api/orders/:orderNo/cancel",rateLimit("customer_order_cancel",10,60000),userOnly,financialLocks(locksForCustomerOrder),async(req,res)=>{
  const db=readDB(),tid=String(req.authTelegramId||"");
  const o=db.orders.find(x=>x.orderNo===req.params.orderNo&&String(x.telegramId)===tid);
  if(!o)return res.status(404).json({ok:false,error:"order_not_found"});
  if(!canCustomerCancel(o))return res.status(409).json({ok:false,error:"order_cannot_be_cancelled"});
  const alreadyRefunded=(db.transactions||[]).some(t=>t.type==="refund"&&t.reference===o.orderNo);
  if(!alreadyRefunded){
    refundOrderInDB(db,o,Number(o.finalPrice||0),"إلغاء من العميل");
    rollbackCoupon(db,o.couponCode,o.orderNo);
  }
  o.status="cancelled";o.updatedAt=now();o.cancelledAt=now();o.cancelledBy="customer";
  addOrderEvent(db,o.orderNo,"cancelled","تم إلغاء الطلب من العميل","customer");
  addNotification(db,o.telegramId,"تم إلغاء الطلب",`تم إلغاء ${o.orderNo} وإعادة الرصيد`,"order",o.orderNo);
  await persistCritical(db);
  sendTelegramMessage(o.telegramId,`↩️ تم إلغاء الطلب <code>${tgEsc(o.orderNo)}</code> وإعادة <b>$${Number(o.finalPrice||0).toFixed(2)}</b> إلى رصيدك.`);
  notifyAdmins(`↩️ <b>إلغاء طلب من العميل</b>\n<code>${tgEsc(o.orderNo)}</code>\n${tgEsc(o.productName)}\nتم رد الرصيد تلقائيًا.`);
  res.json({ok:true,order:publicOrder(db,o),balance:getUser(tid)?.balance??0});
});


app.get("/api/orders/:orderNo/delivery",rateLimit("delivery_reveal",20,60000),userOnly,(req,res)=>{
  const db=readDB(),tid=String(req.authTelegramId||"");
  const o=db.orders.find(x=>x.orderNo===req.params.orderNo&&String(x.telegramId)===tid);
  if(!o)return res.status(404).json({error:"order_not_found"});
  if(o.status!=="completed"||(!o.inventoryCodeId&&!o.providerDelivery))return res.status(400).json({error:"digital_delivery_not_available"});
  try{
    const delivery=revealOrderDelivery(db,o);
    o.customerRevealCount=Number(o.customerRevealCount||0)+1;o.lastCustomerRevealAt=now();
    addOrderEvent(db,o.orderNo,"completed","تم عرض التسليم الرقمي داخل المتجر","customer");
    writeDB(db);
    res.json({ok:true,orderNo:o.orderNo,value:delivery.value,kind:delivery.kind,reveals:o.customerRevealCount});
  }catch(e){
    const status=e.message==="delivery_item_not_found"?404:500;
    res.status(status).json({error:e.message==="delivery_item_not_found"?"delivery_item_not_found":"delivery_decrypt_failed"});
  }
});
app.get("/api/wallet/transactions",userOnly,(req,res)=>{
  const db=readDB(),tid=String(req.authTelegramId||"");
  res.json(db.transactions.filter(t=>String(t.telegramId)===tid).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(publicTransaction));
});
app.get("/api/wallet/topups",userOnly,(req,res)=>{
  const db=readDB(),tid=String(req.authTelegramId||"");
  res.json((db.topups||[]).filter(t=>String(t.telegramId)===tid).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50).map(publicTopup));
});
app.post("/api/wallet/topups/:id/receipt",rateLimit("topup_receipt",12,60000),userOnly,async(req,res)=>{
  const db=readDB(),tid=String(req.authTelegramId||""),t=(db.topups||[]).find(x=>x.id===req.params.id&&String(x.telegramId)===tid);
  if(!t)return res.status(404).json({ok:false,error:"topup_not_found"});
  if(t.status!=="pending")return res.status(409).json({ok:false,error:"topup_receipt_locked"});
  let saved=null;
  try{
    saved=persistImageDataUrl({dataUrl:req.body?.dataUrl,purpose:"receipt",maxBytes:RECEIPT_MAX_BYTES,dir:RECEIPT_DIR,prefix:t.id});
    const old=t.receiptFileName||null;
    t.receiptFileName=saved.fileName;t.receiptMimeType=saved.mimeType;t.receiptSize=saved.size;t.receiptUploadedAt=now();
    await persistCritical(db);
    if(old&&old!==saved.fileName){try{fs.unlinkSync(path.join(RECEIPT_DIR,safeFileName(old)))}catch{}}
    res.status(201).json({ok:true,topup:publicTopup(t)});
  }catch(e){
    if(saved?.path){try{fs.unlinkSync(saved.path)}catch{}}
    const code=String(e.message||"receipt_upload_failed");
    res.status(code==="image_too_large"?413:400).json({ok:false,error:code});
  }
});
app.get("/api/wallet/topups/:id/receipt",userOnly,(req,res)=>{
  const db=readDB(),tid=String(req.authTelegramId||""),t=(db.topups||[]).find(x=>x.id===req.params.id&&String(x.telegramId)===tid);
  if(!t||!t.receiptFileName)return res.status(404).json({error:"receipt_not_found"});
  return sendStoredFile(res,RECEIPT_DIR,t.receiptFileName,t.receiptMimeType);
});

app.get("/api/notifications",userOnly,(req,res)=>{
  const db=readDB(),tid=String(req.authTelegramId||"");
  res.json((db.notifications||[]).filter(n=>String(n.telegramId)===tid).slice(0,50).map(publicNotification));
});
app.post("/api/notifications/:id/read",userOnly,(req,res)=>{
  const db=readDB(),n=(db.notifications||[]).find(x=>x.id===req.params.id&&String(x.telegramId)===String(req.authTelegramId));
  if(!n)return res.status(404).json({error:"notification_not_found"});
  n.read=true;writeDB(db);res.json({ok:true});
});
app.post("/api/notifications/read-all",userOnly,(req,res)=>{
  const db=readDB(),tid=String(req.authTelegramId);let updated=0;
  for(const n of db.notifications||[]){if(String(n.telegramId)===tid&&!n.read){n.read=true;updated++;}}
  writeDB(db);res.json({ok:true,updated});
});
app.get("/api/favorites",userOnly,(req,res)=>{
  const db=readDB(),tid=String(req.authTelegramId||"");
  const ids=(db.favorites||[]).filter(f=>String(f.telegramId)===tid).map(f=>f.productId);
  res.json(db.products.filter(p=>ids.includes(p.id)&&p.active).map(p=>publicProduct(db,p)));
});
app.post("/api/favorites/toggle",userOnly,(req,res)=>{
  const {productId}=req.body||{};const telegramId=req.authTelegramId;
  if(!telegramId||!productId)return res.status(400).json({error:"invalid_request"});
  const db=readDB(); db.favorites ||= [];
  if(!db.products.some(p=>p.id===productId&&p.active))return res.status(404).json({error:"product_not_found"});
  const idx=db.favorites.findIndex(f=>String(f.telegramId)===String(telegramId)&&f.productId===productId);
  let active;
  if(idx>=0){db.favorites.splice(idx,1);active=false;} else {db.favorites.push({telegramId:String(telegramId),productId,createdAt:now()});active=true;}
  writeDB(db);res.json({ok:true,active});
});

app.post("/api/coupons/preview",rateLimit("coupon_preview",20,60000),userOnly,(req,res)=>{
  const {productId,couponCode}=req.body||{},telegramId=String(req.authTelegramId||"");
  const db=readDB(),p=db.products.find(x=>x.id===productId&&x.active);
  if(!p)return res.status(404).json({error:"product_not_found"});
  let price=Number(p.price),discount=0,valid=false,reason="invalid";
  const code=String(couponCode||"").trim().toUpperCase();
  const c=db.coupons.find(x=>x.active&&x.code.toUpperCase()===code);
  if(c){
    const globalAvailable=!c.maxUses||Number(c.uses||0)<Number(c.maxUses);
    const perUserUses=(db.couponUsages||[]).filter(x=>x.code===c.code&&String(x.telegramId)===telegramId).length;
    const userAvailable=!c.maxUsesPerUser||perUserUses<Number(c.maxUsesPerUser);
    if(globalAvailable&&userAvailable){
      discount=c.type==="percent"?price*(Number(c.value)/100):Number(c.value);
      if(c.maxDiscount)discount=Math.min(discount,Number(c.maxDiscount));
      discount=Math.min(discount,price); valid=true;reason="ok";
    }else reason=globalAvailable?"user_limit_reached":"coupon_limit_reached";
  }
  res.json({ok:true,valid,reason,basePrice:money(price),discount:money(discount),finalPrice:money(price-discount)});
});


app.get("/api/verification",userOnly,(req,res)=>{
  const db=readDB(),tid=String(req.authTelegramId||"");
  const row=(db.verificationRequests||[]).filter(x=>String(x.telegramId)===tid).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")))[0]||null;
  res.json(publicVerification(row));
});

app.post("/api/verification",rateLimit("verification_request",3,86400000),userOnly,financialLocks(locksForUser),async(req,res)=>{
  if(String(req.body?.confirmation||"")!=="REQUEST_VERIFICATION")return res.status(400).json({ok:false,error:"verification_confirmation_required"});
  const db=readDB(),tid=String(req.authTelegramId||"");
  const latest=(db.verificationRequests||[]).filter(x=>String(x.telegramId)===tid).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")))[0]||null;
  if(latest?.status==="pending")return res.status(409).json({ok:false,error:"verification_already_pending",verification:publicVerification(latest)});
  if(latest?.status==="verified")return res.status(409).json({ok:false,error:"verification_already_verified",verification:publicVerification(latest)});
  const row={id:id("verify"),telegramId:tid,status:"pending",rejectionReason:null,createdAt:now(),updatedAt:now(),reviewedAt:null};
  db.verificationRequests||=[];db.verificationRequests.unshift(row);
  addNotification(db,tid,"تم استلام طلب التحقق","طلب التحقق قيد المراجعة الآن.","verification",row.id);
  pushAudit(db,req,"verification_request",{verificationId:row.id,telegramId:tid});
  await persistCritical(db);
  notifyAdmins(`🪪 طلب تحقق حساب جديد\nTelegram ID: <code>${tgEsc(tid)}</code>\nالحالة: قيد المراجعة`);
  res.status(201).json({ok:true,verification:publicVerification(row)});
});

app.get("/api/support/tickets",userOnly,(req,res)=>{
  const db=readDB(),tid=String(req.authTelegramId||"");
  res.json((db.supportTickets||[]).filter(t=>String(t.telegramId)===tid).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50).map(publicSupportTicket));
});

app.post("/api/support/tickets",rateLimit("support",10,60000),userOnly,storeOpen,(req,res)=>{
  const telegramId=req.authTelegramId;
  let subject,message;
  try{subject=cleanText(req.body?.subject||"دعم فني",120)||"دعم فني";message=cleanText(req.body?.message,2000);}
  catch{return res.status(400).json({error:"support_text_too_long"});}
  if(!telegramId||!message)return res.status(400).json({error:"invalid_request"});
  const db=readDB();
  const ticket={id:id("ticket"),telegramId:String(telegramId),subject,message,status:"open",createdAt:now(),updatedAt:now()};
  db.supportTickets ||= [];
  db.supportTickets.unshift(ticket);
  addNotification(db,telegramId,"تم استلام طلب الدعم",`رقم التذكرة: ${ticket.id}`,"support",ticket.id);
  writeDB(db);
  notifyAdmins(`🎧 <b>تذكرة دعم جديدة</b>\nID: <code>${tgEsc(ticket.id)}</code>\nالمستخدم: <code>${tgEsc(telegramId)}</code>\n${tgEsc(ticket.subject)}`);
  res.json({ok:true,ticket:publicSupportTicket(ticket)});
});

function takeInventoryCode(db,productId,orderNo){
  db.inventoryCodes ||= [];
  const item=db.inventoryCodes.find(x=>x.productId===productId&&x.status==="available");
  if(!item)throw new Error("inventory_out_of_stock");
  const clear=decryptValue(item);
  item.status="delivered";item.orderNo=orderNo;item.updatedAt=now();
  return {item,clear};
}
function refundOrderInDB(db,order,amount,reason="refund"){
  const existing=(db.transactions||[]).find(t=>t.type==="refund"&&t.reference===order.orderNo);
  if(existing)return {idempotent:true,transaction:existing};
  const value=money(amount);
  const u=db.users.find(x=>String(x.telegramId)===String(order.telegramId));
  if(u){u.balance=money(Number(u.balance)+value);u.updatedAt=now();}
  const transaction={id:id("txn"),telegramId:String(order.telegramId),type:"refund",amount:value,currency:order.currency,reference:order.orderNo,createdAt:now()};
  db.transactions.push(transaction);
  addOrderEvent(db,order.orderNo,"refunded",reason,"system");
  return {idempotent:false,transaction};
}
function rollbackCoupon(db,code,orderNo=null){
  if(!code)return {rolledBack:false};
  const usages=db.couponUsages||[];
  let removed=0;
  if(orderNo){
    db.couponUsages=usages.filter(x=>{
      const match=x.code===code&&x.orderNo===orderNo;
      if(match)removed++;
      return !match;
    });
  }
  const c=(db.coupons||[]).find(x=>x.code===code);
  if(c){
    if(orderNo){
      if(removed>0)c.uses=Math.max(0,Number(c.uses||0)-removed);
    }else if(Number(c.uses||0)>0){
      c.uses=Number(c.uses)-1;removed=1;
    }
  }
  return {rolledBack:removed>0,removed};
}

app.post("/api/orders",rateLimit("orders",20,60000),userOnly,storeOpen,financialLocks(locksForOrderCreate),async(req,res)=>{
  const {productId,customerInput="",customerData=null,couponCode="",clientRequestId=""}=req.body||{};const telegramId=req.authTelegramId;
  const requestId=String(clientRequestId||"").trim(),normalizedCoupon=normalizeCouponCode(couponCode);
  if(requestId.length>128)return res.status(400).json({ok:false,error:"client_request_id_too_long"});
  if(String(couponCode||"").length>64)return res.status(400).json({ok:false,error:"coupon_code_too_long"});

  const db=readDB();
  const user=db.users.find(u=>String(u.telegramId)===String(telegramId));
  if(!user)return res.status(404).json({ok:false,error:"user_not_found"});
  const product=db.products.find(p=>p.id===productId&&p.active);
  if(!product)return res.status(404).json({ok:false,error:"product_not_found"});

  let normalizedCustomer;
  try{normalizedCustomer=validateCustomerData(product,customerData,customerInput);}
  catch(e){
    const code=String(e.message||"invalid_customer_data"),parts=code.split(":");
    return res.status(400).json({ok:false,error:parts[0],field:parts[1]||null});
  }
  const normalizedInput=normalizedCustomer.customerInput,normalizedCustomerData=normalizedCustomer.customerData;

  if(requestId){
    const existing=findIdempotentOrder(db.orders,{telegramId,clientRequestId:requestId});
    if(existing){
      if(!sameOrderRequest(existing,{productId,customerInput:normalizedInput,customerData:normalizedCustomerData,couponCode:normalizedCoupon})){
        return res.status(409).json({ok:false,error:"idempotency_conflict"});
      }
      return res.json({ok:true,idempotent:true,order:publicOrder(db,existing),balance:user.balance});
    }
  }

  let finalPrice=Number(product.price),discount=0,appliedCoupon=null;
  if(couponCode){
    const c=db.coupons.find(x=>x.active&&x.code.toUpperCase()===normalizedCoupon);
    if(c){
      const globalAvailable=!c.maxUses||Number(c.uses||0)<Number(c.maxUses);
      const perUserUses=(db.couponUsages||[]).filter(x=>x.code===c.code&&String(x.telegramId)===String(telegramId)).length;
      const userAvailable=!c.maxUsesPerUser||perUserUses<Number(c.maxUsesPerUser);
      if(globalAvailable&&userAvailable){
        discount=c.type==="percent"?finalPrice*(Number(c.value)/100):Number(c.value);
        if(c.maxDiscount)discount=Math.min(discount,Number(c.maxDiscount));
        discount=Math.min(discount,finalPrice);
        finalPrice=money(finalPrice-discount);
        c.uses=(c.uses||0)+1; appliedCoupon=c.code;
      }else{
        return res.status(400).json({ok:false,error:globalAvailable?"coupon_user_limit_reached":"coupon_limit_reached"});
      }
    }else{
      return res.status(400).json({ok:false,error:"invalid_coupon"});
    }
  }
  if(Number(user.balance)<finalPrice)return res.status(400).json({ok:false,error:"insufficient_balance",balance:user.balance,required:finalPrice});

  user.balance=money(Number(user.balance)-finalPrice);user.updatedAt=now();
  const order={
    id:id("ord"),orderNo:createOrderNo(db),telegramId:String(telegramId),
    productId:product.id,productName:product.name,customerInput:normalizedInput,customerData:normalizedCustomerData,
    deliveryText:sanitizeDeliveryText(product.deliveryText,product.delivery),
    basePrice:Number(product.price),discount:money(discount),finalPrice,cost:Number(product.cost||0),
    profit:money(finalPrice-Number(product.cost||0)),currency:product.currency,
    status:"processing",providerPrimary:product.providerPrimary||"manual",
    providerBackup:product.providerBackup||null,providerUsed:null,providerOrderId:null,
    couponCode:appliedCoupon,clientRequestId:requestId,createdAt:now(),updatedAt:now()
  };
  db.orders.push(order);
  db.transactions.push({id:id("txn"),telegramId:String(telegramId),type:"purchase",amount:-finalPrice,currency:product.currency,reference:order.orderNo,createdAt:now()});
  if(appliedCoupon){
    db.couponUsages ||= [];
    db.couponUsages.push({id:id("cuse"),code:appliedCoupon,telegramId:String(telegramId),orderNo:order.orderNo,createdAt:now()});
  }
  addOrderEvent(db,order.orderNo,"created","تم إنشاء الطلب","customer");
  addOrderEvent(db,order.orderNo,"processing","بدأت معالجة الطلب","system");
  addNotification(db,telegramId,"تم إنشاء الطلب",`${order.productName} — ${order.orderNo}`,"order",order.orderNo);
  await persistCritical(db);

  if(product.delivery==="inventory"){
    try{
      const invDB=readDB();
      const invOrder=invDB.orders.find(x=>x.id===order.id);
      const delivered=takeInventoryCode(invDB,product.id,order.orderNo);
      invOrder.status="completed";invOrder.providerUsed="inventory";invOrder.inventoryCodeId=delivered.item.id;invOrder.updatedAt=now();
      addOrderEvent(invDB,order.orderNo,"completed","تم التسليم من مخزون الأكواد","inventory");
      addNotification(invDB,telegramId,"تم تسليم المنتج",`${order.orderNo} اكتمل بنجاح`,`order`,order.orderNo);
      const remaining=(invDB.inventoryCodes||[]).filter(x=>x.productId===product.id&&x.status==="available").length;
      const lowThreshold=Number(invDB.settings?.inventoryLowStockThreshold||3);
      await persistCritical(invDB);
      if(remaining<=lowThreshold)notifyAdmins(`⚠️ <b>مخزون منخفض</b>
${tgEsc(product.name)}
المتبقي: <b>${remaining}</b>`);
      sendTelegramMessage(telegramId,`🔑 <b>تم تسليم طلبك</b>\nرقم الطلب: <code>${tgEsc(order.orderNo)}</code>\nالمنتج: <b>${tgEsc(order.productName)}</b>\nالكود: <code>${tgEsc(delivered.clear)}</code>\n\nاحتفظ بالكود في مكان آمن.`);
      notifyAdmins(`🔑 <b>تسليم فوري من المخزون</b>\n${tgEsc(order.orderNo)}\n${tgEsc(order.productName)}`);
      return res.json({ok:true,order:publicOrder(invDB,invOrder,{deliveryCode:delivered.clear}),balance:getUser(telegramId)?.balance??user.balance});
    }catch(e){
      const failDB=readDB(),failOrder=failDB.orders.find(x=>x.id===order.id);
      if(failOrder){failOrder.status="failed";failOrder.providerMessage=e.message;failOrder.updatedAt=now();}
      refundOrderInDB(failDB,order,finalPrice,e.message);rollbackCoupon(failDB,appliedCoupon,order.orderNo);
      addOrderEvent(failDB,order.orderNo,"failed",e.message,"inventory");
      addNotification(failDB,telegramId,"تعذر التسليم",`لم يتوفر مخزون للطلب ${order.orderNo} وتم رد الرصيد`,`refund`,order.orderNo);
      await persistCritical(failDB);
      sendTelegramMessage(telegramId,`⚠️ المنتج غير متوفر حاليًا في المخزون. تمت إعادة <b>$${finalPrice.toFixed(2)}</b> إلى رصيدك.`);
      return res.status(409).json({ok:false,error:"inventory_out_of_stock"});
    }
  }

  const log = entry => {
    const d=readDB();pushProviderLog(d,entry);writeDB(d);
  };

  let acceptedProviderResult=null;
  try{
    const latest=readDB();
    const result=await submitToProvider({order,product,providerConfigs:latest.providers||[],log});
    acceptedProviderResult=result;
    const db2=readDB(),o=db2.orders.find(x=>x.id===order.id);
    if(o){
      const providerConfig=(db2.providers||[]).find(x=>x.id===result.providerUsed);
      const initialStatus=normalizeProviderStatus(result.status||"processing");
      if(providerConfig?.type==="http"&&["pending","processing"].includes(initialStatus)&&!result.providerOrderId){
        throw makeProviderReviewError(result,"provider_order_id_missing_after_accept");
      }
      o.providerUsed=result.providerUsed||null;
      o.providerOrderId=result.providerOrderId||null;o.providerMessage=result.message||"";
      o.fallbackFrom=result.fallbackFrom||null;o.updatedAt=now();
      const normalized=applyProviderStatus(db2,o,result.status||"processing",result.message||"","provider_create");
      const newDelivery=normalized==="completed"?storeProviderDelivery(o,result.deliveryValue):false;
      if(["processing","pending"].includes(normalized))addNotification(db2,telegramId,"تحديث حالة الطلب",`${o.orderNo}: ${normalized}`,"order",o.orderNo);
      await persistCritical(db2);

      if(normalized==="failed"){
        sendTelegramMessage(telegramId,`⚠️ تعذر تنفيذ طلب <code>${tgEsc(o.orderNo)}</code>.\nتمت إعادة <b>$${Number(o.finalPrice).toFixed(2)}</b> إلى رصيدك.`);
        notifyAdmins(`⚠️ <b>فشل طلب عند الإنشاء</b>\n${tgEsc(o.orderNo)}\n${tgEsc(o.productName)}\nتم رد الرصيد للعميل.`);
        return res.status(502).json({ok:false,error:"provider_failed",balance:getUser(telegramId)?.balance??user.balance});
      }

      sendTelegramMessage(telegramId,`🎮 <b>Game Zone</b>\n\nتم إنشاء طلبك ✅\nرقم الطلب: <code>${tgEsc(o.orderNo)}</code>\nالمنتج: <b>${tgEsc(o.productName)}</b>\nالحالة: <b>${tgEsc(o.status)}</b>\nالمبلغ: <b>$${Number(o.finalPrice).toFixed(2)}</b>`);
      if(newDelivery&&o.status==="completed"){
        const delivered=await sendTelegramMessage(telegramId,`🔑 <b>التسليم الرقمي</b>\nطلب: <code>${tgEsc(o.orderNo)}</code>\nالقيمة: <code>${tgEsc(deliveryText(result.deliveryValue))}</code>\n\nيمكنك استرجاعها لاحقًا من تفاصيل الطلب.`);
        if(delivered.ok){
          const after=readDB(),current=after.orders.find(x=>x.id===o.id);
          if(current&&!current.providerDeliveryNotifiedAt){current.providerDeliveryNotifiedAt=now();await persistCritical(after);}
        }
      }
      notifyAdmins(`🛒 <b>طلب جديد</b>\n${tgEsc(o.orderNo)}\n${tgEsc(o.productName)}\nالمبلغ: $${Number(o.finalPrice).toFixed(2)}\nالحالة: ${tgEsc(o.status)}`);
      const responseDB=readDB(),responseOrder=responseDB.orders.find(x=>x.id===o.id)||o;
      return res.json({ok:true,order:publicOrder(responseDB,responseOrder,{deliveryCode:newDelivery&&responseOrder.status==="completed"?deliveryText(result.deliveryValue):null}),balance:getUser(telegramId)?.balance??user.balance});
    }
  }catch(originalError){
    let e=originalError;
    if(e?.message==="storage_persist_failed"){
      notifyAdmins(`🚨 <b>فشل حفظ حرج بعد تنفيذ طلب</b>\n<code>${tgEsc(order.orderNo)}</code>\nلن يتم رد الرصيد تلقائيًا لأن حالة المورد/التخزين تحتاج مراجعة.`);
      return res.status(503).json({ok:false,error:"storage_persist_failed",orderNo:order.orderNo});
    }
    if(acceptedProviderResult&&e.code!=="provider_outcome_uncertain"&&e.message!=="provider_outcome_uncertain"){
      e=makeProviderReviewError(acceptedProviderResult,e.message||"provider_post_accept_processing_failed");
    }
    const db2=readDB(),o=db2.orders.find(x=>x.id===order.id);
    if(e.code==="provider_outcome_uncertain"||e.message==="provider_outcome_uncertain"){
      if(o){
        o.status="pending";o.providerUsed=e.providerId||o.providerPrimary;o.providerOrderId=e.providerOrderId||o.providerOrderId||null;o.providerMessage=e.localReason||"provider_outcome_uncertain";o.updatedAt=now();o.requiresManualReview=true;o.reviewReason=e.localReason||"provider_outcome_uncertain";
        addOrderEvent(db2,o.orderNo,"pending","نتيجة المزود غير مؤكدة وتحتاج تحقق الإدارة","system");
        addNotification(db2,telegramId,"طلبك قيد التحقق",`${o.orderNo} قيد التحقق قبل أي إعادة إرسال أو استرجاع`,"order",o.orderNo);
      }
      await persistCritical(db2);
      sendTelegramMessage(telegramId,`⏳ طلب <code>${tgEsc(order.orderNo)}</code> قيد التحقق. لم نعد إرسال الطلب لمزود آخر حتى لا يحدث تنفيذ مكرر.`);
      notifyAdmins(`⚠️ <b>طلب يحتاج مراجعة مزود</b>\n<code>${tgEsc(order.orderNo)}</code>\nالمزود: <code>${tgEsc(e.providerId||order.providerPrimary)}</code>\nالنتيجة غير مؤكدة؛ لم يتم رد الرصيد أو الإرسال لمزود احتياطي.`);
      return res.status(202).json({ok:true,uncertain:true,order:publicOrder(db2,o),balance:getUser(telegramId)?.balance??user.balance});
    }
    if(o){o.status="failed";o.providerMessage=e.message;o.updatedAt=now();}
    refundOrderInDB(db2,order,finalPrice,"تمت إعادة الرصيد تلقائيًا");rollbackCoupon(db2,appliedCoupon,order.orderNo);
    addOrderEvent(db2,order.orderNo,"failed",e.message,"provider");
    addNotification(db2,telegramId,"تم استرجاع الرصيد",`فشل ${order.orderNo} وتمت إعادة $${finalPrice.toFixed(2)}`,"refund",order.orderNo);
    await persistCritical(db2);
    sendTelegramMessage(telegramId,`⚠️ تعذر تنفيذ طلب <code>${tgEsc(order.orderNo)}</code>.\nتمت إعادة <b>$${finalPrice.toFixed(2)}</b> إلى رصيدك.`);
    notifyAdmins(`⚠️ <b>فشل طلب</b>\n${tgEsc(order.orderNo)}\n${tgEsc(order.productName)}\nتم رد الرصيد للعميل.`);
    return res.status(502).json({ok:false,error:"provider_failed",balance:getUser(telegramId)?.balance??user.balance});
  }
});

app.post("/api/wallet/topup-intents",rateLimit("topup",10,60000),userOnly,storeOpen,financialLocks(locksForTopupCreate),async(req,res)=>{
  const {amount,method="manual",reference="",clientRequestId=""}=req.body||{};const telegramId=req.authTelegramId;
  const value=Number(amount),methodId=String(method||"manual"),normalizedReference=normalizePaymentReference(reference),requestId=String(clientRequestId||"").trim();
  if(!SAFE_ID.test(methodId))return res.status(400).json({ok:false,error:"invalid_payment_method"});
  if(String(reference||"").length>250)return res.status(400).json({ok:false,error:"payment_reference_too_long"});
  if(requestId.length>128)return res.status(400).json({ok:false,error:"client_request_id_too_long"});
  const db=readDB();
  if(requestId){
    const existing=findIdempotentTopup(db.topups||[],{telegramId,clientRequestId:requestId});
    if(existing){
      if(!sameTopupRequest(existing,{amount:value,method:methodId,reference:normalizedReference}))return res.status(409).json({ok:false,error:"idempotency_conflict"});
      const existingMethod=(db.paymentMethods||[]).find(x=>x.id===existing.method);
      return res.json({ok:true,idempotent:true,topup:publicTopup(existing),checkoutUrl:existingMethod?.checkoutUrlTemplate?buildCheckoutUrl(existingMethod.checkoutUrlTemplate,existing):null});
    }
  }
  const min=Number(db.settings?.minTopup||1),max=Number(db.settings?.maxTopup||1000);
  if(!telegramId||!Number.isFinite(value)||value<min||value>max)return res.status(400).json({ok:false,error:"invalid_amount",min,max});
  if(!db.users.some(u=>String(u.telegramId)===String(telegramId)))return res.status(404).json({ok:false,error:"user_not_found"});
  const pm=(db.paymentMethods||[]).find(x=>x.id===methodId&&x.active);
  if(!pm)return res.status(400).json({ok:false,error:"payment_method_unavailable"});
  if(pm){
    const methodMin=Number(pm.minAmount||min),methodMax=Number(pm.maxAmount||max);
    if(value<methodMin||value>methodMax)return res.status(400).json({ok:false,error:"payment_method_amount_out_of_range",min:methodMin,max:methodMax});
    if(pm.requiresReference&&!normalizedReference)return res.status(400).json({ok:false,error:"payment_reference_required"});
  }
  if(normalizedReference){
    const duplicate=findDuplicatePaymentReference(db.topups||[],{method:methodId,reference:normalizedReference});
    if(duplicate)return res.status(409).json({ok:false,error:"payment_reference_already_used",topupId:duplicate.id});
  }
  const topup={id:id("topup"),telegramId:String(telegramId),amount:value,currency:"USD",method:methodId,reference:normalizedReference,requiresReceipt:pm.requiresReceipt===true,clientRequestId:requestId,status:"pending",createdAt:now(),updatedAt:now()};
  db.topups.push(topup);addNotification(db,telegramId,"طلب شحن الرصيد",`تم إنشاء طلب شحن بقيمة $${value.toFixed(2)}`,"topup",topup.id);await persistCritical(db);
  notifyAdmins(`💳 <b>طلب شحن جديد</b>\nالمستخدم: <code>${telegramId}</code>\nالمبلغ: <b>$${value.toFixed(2)}</b>\nID: <code>${topup.id}</code>`,
    {inline_keyboard:[[
      {text:"✅ قبول",callback_data:`adm_topup_approve:${topup.id}`},
      {text:"❌ رفض",callback_data:`adm_topup_reject:${topup.id}`}
    ]]}
  );
  const checkoutUrl=pm?.checkoutUrlTemplate?buildCheckoutUrl(pm.checkoutUrlTemplate,topup):null;
  res.json({ok:true,topup:publicTopup(topup),checkoutUrl});
});

app.post("/api/payment-webhook/:methodId",rateLimit("payment_webhook",120,60000),paymentWebhookAuth,financialLocks(locksForTopup),async(req,res)=>{
  const {topupId,status,reference="",amount=null}=req.body||{};
  if(!topupId||!status)return res.status(400).json({ok:false,error:"topup_id_and_status_required"});
  if(String(reference||"").length>250)return res.status(400).json({ok:false,error:"payment_reference_too_long"});
  if(!SAFE_ID.test(String(req.params.methodId||"")))return res.status(400).json({ok:false,error:"invalid_payment_method"});
  const db=readDB(),t=(db.topups||[]).find(x=>x.id===String(topupId)&&x.method===req.params.methodId);
  if(!t)return res.status(404).json({ok:false,error:"topup_not_found"});
  if(amount!==null&&(!Number.isFinite(Number(amount))||Math.abs(Number(amount)-Number(t.amount))>0.01))return res.status(400).json({ok:false,error:"amount_mismatch"});
  const normalized=String(status).toLowerCase();
  const action=["paid","success","successful","completed","approved"].includes(normalized)?"approve":
    ["failed","cancelled","canceled","rejected","expired"].includes(normalized)?"reject":null;
  if(!action)return res.status(400).json({ok:false,error:"unsupported_payment_status"});
  if(reference){
    const normalizedReference=normalizePaymentReference(reference);
    const duplicate=findDuplicatePaymentReference(db.topups||[],{method:t.method,reference:normalizedReference,excludeId:t.id});
    if(duplicate)return res.status(409).json({ok:false,error:"payment_reference_already_used",topupId:duplicate.id});
    t.reference=normalizedReference;
  }
  // A gateway may report a final failure and later a successful settlement.
  // Permit rejected -> approved only when no credit transaction exists yet.
  if(action==="approve"&&t.status==="rejected"){
    const credited=(db.transactions||[]).some(x=>x.type==="topup"&&x.reference===t.id);
    if(!credited){t.status="pending";t.updatedAt=now();}
  }
  try{
    const result=applyTopupAction(db,t,action,`payment_webhook:${req.params.methodId}`);
    pushAudit(db,req,"payment_webhook",{methodId:req.params.methodId,topupId:t.id,action,idempotent:result.idempotent});
    await persistCritical(db);
    if(!result.idempotent){
      if(action==="approve")sendTelegramMessage(t.telegramId,`✅ تم تأكيد دفعتك تلقائيًا.\\nالمبلغ: <b>$${Number(t.amount).toFixed(2)}</b>\\nالرصيد الجديد: <b>$${Number(result.user?.balance||0).toFixed(2)}</b>`);
      else sendTelegramMessage(t.telegramId,`❌ لم تكتمل عملية الدفع للطلب <code>${tgEsc(t.id)}</code>.`);
    }
    res.json({ok:true,idempotent:result.idempotent,topupId:t.id,status:t.status});
  }catch(e){res.status(400).json({ok:false,error:e.message});}
});

app.get("/api/admin/topups/:id/receipt",adminOnly,(req,res)=>{
  const t=(readDB().topups||[]).find(x=>x.id===req.params.id);
  if(!t||!t.receiptFileName)return res.status(404).json({error:"receipt_not_found"});
  return sendStoredFile(res,RECEIPT_DIR,t.receiptFileName,t.receiptMimeType);
});

/* Admin */
app.get("/api/admin/dashboard",adminOnly,(req,res)=>{
  const db=readDB(),completed=db.orders.filter(o=>o.status==="completed"),integrity=scanDatabaseIntegrity(db);
  const revenue=completed.reduce((s,o)=>s+Number(o.finalPrice??o.price??0),0);
  const profit=completed.reduce((s,o)=>s+Number(o.profit??0),0);
  res.json({
    users:db.users.length,products:db.products.length,categories:db.categories.length,orders:db.orders.length,completedOrders:completed.length,
    openTickets:(db.supportTickets||[]).filter(t=>t.status==="open").length,
    pendingTopups:db.topups.filter(t=>t.status==="pending").length,providerReviewOrders:db.orders.filter(o=>o.requiresManualReview).length,integrityCritical:integrity.counts.critical,integrityWarnings:integrity.counts.warning,revenue:money(revenue),profit:money(profit),
    providers:(db.providers||[]).filter(p=>p.active).length,failedProviderCalls:(db.providerLogs||[]).filter(l=>l.ok===false).length,inventoryAvailable:(db.inventoryCodes||[]).filter(x=>x.status==="available").length,inventoryLowStockProducts:db.products.filter(p=>p.delivery==="inventory"&&((db.inventoryCodes||[]).filter(x=>x.productId===p.id&&x.status==="available").length)<=Number(db.settings?.inventoryLowStockThreshold||3)).length
  });
});
app.get("/api/admin/users",adminOnly,(req,res)=>res.json(readDB().users.sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""))));
app.post("/api/admin/users/:telegramId/balance",adminOnly,financialLocks(locksForUser),async(req,res)=>{
  const value=Number(req.body?.amount),requestId=String(req.body?.clientRequestId||"").trim();
  if(!Number.isFinite(value)||value===0)return res.status(400).json({error:"invalid_amount"});
  if(requestId.length>128)return res.status(400).json({error:"client_request_id_too_long"});
  const db=readDB(),u=db.users.find(x=>String(x.telegramId)===String(req.params.telegramId));
  if(!u)return res.status(404).json({error:"user_not_found"});
  if(requestId){
    const existing=findAdminAdjustment(db.transactions,{telegramId:u.telegramId,clientRequestId:requestId});
    if(existing){
      if(!sameAdminAdjustment(existing,{amount:value}))return res.status(409).json({error:"idempotency_conflict"});
      return res.json({ok:true,idempotent:true,user:publicUser(u)});
    }
  }
  const nextBalance=money(Number(u.balance)+value);
  if(nextBalance<0)return res.status(400).json({error:"insufficient_user_balance",balance:u.balance});
  u.balance=nextBalance;u.updatedAt=now();
  db.transactions.push({id:id("txn"),telegramId:String(u.telegramId),type:value>0?"admin_credit":"admin_debit",amount:value,currency:u.currency||"USD",reference:"ADMIN",adminRequestId:requestId||null,createdAt:now()});
  pushAudit(db,req,"balance_update",{telegramId:u.telegramId,amount:value});await persistCritical(db);
  sendTelegramMessage(u.telegramId,`💰 تم تحديث رصيدك في <b>Game Zone</b>.\nالرصيد الحالي: <b>$${u.balance.toFixed(2)}</b>`);
  res.json({ok:true,user:publicUser(u)});
});
app.get("/api/admin/products",adminOnly,(req,res)=>{const db=readDB();res.json(db.products.map(p=>({...p,stock:p.delivery==="inventory"?(db.inventoryCodes||[]).filter(x=>x.productId===p.id&&x.status==="available").length:undefined})));});
app.post("/api/admin/products",adminOnly,(req,res)=>{
  const db=readDB(),b=req.body||{};
  let name,imageUrl,description,inputLabel;
  try{name=cleanText(b.name,160);imageUrl=cleanImageUrl(b.imageUrl);description=cleanText(b.description||"",1000);inputLabel=cleanText(b.inputLabel||"بيانات الطلب",120);}
  catch(e){return res.status(400).json({error:e.message==="invalid_image_url"?"invalid_image_url":"product_text_too_long"});}
  if(!name||!b.categoryId)return res.status(400).json({error:"name_and_category_required"});
  if(!db.categories.some(c=>c.id===b.categoryId))return res.status(400).json({error:"category_not_found"});
  const price=finiteNumber(b.price,{min:0,max:1000000}),cost=finiteNumber(b.cost||0,{min:0,max:1000000});
  if(price===null||cost===null)return res.status(400).json({error:"invalid_product_price"});
  const delivery=["manual","auto","inventory"].includes(String(b.delivery||"manual"))?String(b.delivery||"manual"):"manual";
  let providerPrimary=delivery==="inventory"?"inventory":String(b.providerPrimary||"manual"),providerBackup=b.providerBackup?String(b.providerBackup):null;
  if(!(db.providers||[]).some(x=>x.id===providerPrimary))return res.status(400).json({error:"provider_primary_not_found"});
  if(providerBackup&&!(db.providers||[]).some(x=>x.id===providerBackup))return res.status(400).json({error:"provider_backup_not_found"});
  if(providerBackup===providerPrimary)providerBackup=null;
  let inputSchema,providerInputMap;
  try{
    inputSchema=sanitizeProductInputSchema("inputSchema" in b?b.inputSchema:undefined,{fallbackLabel:inputLabel});
    providerInputMap=sanitizeProviderInputMap(b.providerInputMap,inputSchema);
  }catch(e){return res.status(400).json({error:String(e.message||"invalid_product_input_schema")});}
  if(b.id&&!SAFE_ID.test(String(b.id)))return res.status(400).json({error:"invalid_product_id"});
  const productId=b.id?String(b.id):id("prd");
  if(db.products.some(x=>x.id===productId))return res.status(409).json({error:"product_exists"});
  const p={id:productId,categoryId:String(b.categoryId),name,icon:cleanText(b.icon||"",20),imageUrl,description,price,cost,currency:cleanText(b.currency||"USD",8),inputLabel,inputSchema,providerInputMap,delivery,deliveryText:sanitizeDeliveryText(b.deliveryText,delivery),providerPrimary,providerBackup,providerProductId:b.providerProductId?cleanText(b.providerProductId,160):null,active:b.active!==false,featured:!!b.featured};
  p.profit=money(p.price-p.cost);db.products.push(p);pushAudit(db,req,"product_create",{productId:p.id});writeDB(db);res.json({ok:true,product:p});
});
app.patch("/api/admin/products/:id",adminOnly,(req,res)=>{
  const db=readDB(),p=db.products.find(x=>x.id===req.params.id);if(!p)return res.status(404).json({error:"product_not_found"});
  try{
    if("name" in req.body)p.name=cleanText(req.body.name,160);
    if("icon" in req.body)p.icon=cleanText(req.body.icon,20);
    if("imageUrl" in req.body)p.imageUrl=cleanImageUrl(req.body.imageUrl);
    if("description" in req.body)p.description=cleanText(req.body.description,1000);
    if("inputLabel" in req.body)p.inputLabel=cleanText(req.body.inputLabel,120);
    if("currency" in req.body)p.currency=cleanText(req.body.currency,8);
    if("providerProductId" in req.body)p.providerProductId=req.body.providerProductId?cleanText(req.body.providerProductId,160):null;
  }catch(e){return res.status(400).json({error:e.message==="invalid_image_url"?"invalid_image_url":"product_text_too_long"});}
  if("inputSchema" in req.body||"providerInputMap" in req.body){
    try{
      const nextSchema="inputSchema" in req.body?sanitizeProductInputSchema(req.body.inputSchema,{fallbackLabel:p.inputLabel||"بيانات الطلب",allowLegacyFallback:false}):sanitizeProductInputSchema(p.inputSchema,{fallbackLabel:p.inputLabel||"بيانات الطلب",allowLegacyFallback:p.inputSchema==null});
      const nextMap=sanitizeProviderInputMap("providerInputMap" in req.body?req.body.providerInputMap:p.providerInputMap,nextSchema);
      p.inputSchema=nextSchema;p.providerInputMap=nextMap;
    }catch(e){return res.status(400).json({error:String(e.message||"invalid_product_input_schema")});}
  }
  if("categoryId" in req.body){if(!db.categories.some(c=>c.id===req.body.categoryId))return res.status(400).json({error:"category_not_found"});p.categoryId=req.body.categoryId;}
  if("delivery" in req.body){if(!["manual","auto","inventory"].includes(req.body.delivery))return res.status(400).json({error:"invalid_delivery"});p.delivery=req.body.delivery;}
  if("deliveryText" in req.body)p.deliveryText=sanitizeDeliveryText(req.body.deliveryText,p.delivery);
  else if(!p.deliveryText)p.deliveryText=sanitizeDeliveryText("",p.delivery);
  if("providerPrimary" in req.body)p.providerPrimary=req.body.providerPrimary?String(req.body.providerPrimary):"manual";
  if("providerBackup" in req.body)p.providerBackup=req.body.providerBackup?String(req.body.providerBackup):null;
  if("active" in req.body)p.active=!!req.body.active;if("featured" in req.body)p.featured=!!req.body.featured;
  if(p.delivery==="inventory")p.providerPrimary="inventory";
  if(!(db.providers||[]).some(x=>x.id===p.providerPrimary))return res.status(400).json({error:"provider_primary_not_found"});
  if(p.providerBackup&&!(db.providers||[]).some(x=>x.id===p.providerBackup))return res.status(400).json({error:"provider_backup_not_found"});
  if(p.providerBackup===p.providerPrimary)p.providerBackup=null;
  if("price" in req.body){const n=finiteNumber(req.body.price,{min:0,max:1000000});if(n===null)return res.status(400).json({error:"invalid_product_price"});p.price=n;}
  if("cost" in req.body){const n=finiteNumber(req.body.cost,{min:0,max:1000000});if(n===null)return res.status(400).json({error:"invalid_product_cost"});p.cost=n;}
  p.profit=money(Number(p.price)-Number(p.cost||0));pushAudit(db,req,"product_update",{productId:p.id});writeDB(db);res.json({ok:true,product:p});
});
app.get("/api/admin/orders",adminOnly,(req,res)=>res.json(readDB().orders.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))));
app.get("/api/admin/orders/:id",adminOnly,(req,res)=>{
  const db=readDB(),o=db.orders.find(x=>x.id===req.params.id);if(!o)return res.status(404).json({error:"order_not_found"});
  res.json({...o,timeline:(db.orderEvents||[]).filter(e=>e.orderNo===o.orderNo).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))});
});
app.post("/api/admin/orders/:id/manual-start",adminOnly,financialLocks(locksForAdminOrder),async(req,res)=>{
  const db=readDB(),o=db.orders.find(x=>x.id===req.params.id);
  if(!o)return res.status(404).json({error:"order_not_found"});
  if(!(o.providerUsed==="manual"||o.providerPrimary==="manual"))return res.status(409).json({error:"not_manual_order"});
  if(!["pending","processing"].includes(o.status))return res.status(409).json({error:"order_not_active"});
  if(o.inventoryCodeId||o.providerDelivery)return res.status(409).json({error:"order_already_delivered"});
  if(!o.manualFulfillmentStartedAt){
    o.manualFulfillmentStartedAt=now();o.manualFulfillmentStartedBy="admin";o.updatedAt=now();
    addOrderEvent(db,o.orderNo,"processing","بدأت الإدارة التنفيذ اليدوي","admin");
    addNotification(db,o.telegramId,"بدأ تنفيذ الطلب",`${o.orderNo} دخل مرحلة التنفيذ اليدوي`,"order",o.orderNo);
    pushAudit(db,req,"manual_order_start",{orderId:o.id,orderNo:o.orderNo});
    await persistCritical(db);
    sendTelegramMessage(o.telegramId,`🧑‍💻 بدأ التنفيذ اليدوي لطلب <code>${tgEsc(o.orderNo)}</code>. لم يعد الإلغاء الذاتي متاحًا أثناء التنفيذ.`);
  }
  res.json({ok:true,order:o});
});

app.get("/api/admin/orders/:id/delivery",rateLimit("admin_order_delivery",30,60000),adminOnly,(req,res)=>{
  const db=readDB(),o=db.orders.find(x=>x.id===req.params.id);if(!o)return res.status(404).json({error:"order_not_found"});
  try{
    const delivery=revealOrderDelivery(db,o);
    pushAudit(db,req,"order_delivery_reveal",{orderId:o.id,orderNo:o.orderNo,kind:delivery.kind});writeDB(db);
    res.json({ok:true,kind:delivery.kind,value:delivery.value,masked:maskValue(delivery.value)});
  }catch(e){res.status(404).json({ok:false,error:"digital_delivery_not_available"});}
});
app.post("/api/admin/orders/:id/delivery",rateLimit("admin_order_delivery_set",20,60000),adminOnly,financialLocks(locksForAdminOrder),async(req,res)=>{
  const db=readDB(),o=db.orders.find(x=>x.id===req.params.id);if(!o)return res.status(404).json({error:"order_not_found"});
  const value=req.body?.value,overwrite=req.body?.overwrite===true;
  if(value===undefined||value===null||!String(value).trim())return res.status(400).json({error:"delivery_value_required"});
  if(String(value).length>10000)return res.status(400).json({error:"delivery_value_too_large"});
  if(db.transactions.some(t=>t.type==="refund"&&t.reference===o.orderNo))return res.status(409).json({error:"refunded_order_cannot_deliver"});
  if(o.inventoryCodeId)return res.status(409).json({error:"inventory_delivery_locked"});
  if(o.providerDelivery&&!overwrite)return res.status(409).json({error:"delivery_already_exists"});

  const newDelivery=storeProviderDelivery(o,String(value));
  if(!newDelivery&&!overwrite)return res.status(409).json({error:"delivery_unchanged"});
  o.status="completed";
  o.providerUsed=o.providerUsed||"manual";
  o.requiresManualReview=false;o.reviewResolvedAt=now();
  o.updatedAt=now();
  addOrderEvent(db,o.orderNo,"completed","تم التسليم يدويًا من الإدارة","admin");
  addNotification(db,o.telegramId,"تم تسليم المنتج",`${o.orderNo} اكتمل وأصبح التسليم الرقمي متاحًا`,"order",o.orderNo);
  pushAudit(db,req,"order_delivery_set",{orderId:o.id,orderNo:o.orderNo,overwrite});
  await persistCritical(db);

  const notice=await sendTelegramMessage(o.telegramId,`🔑 <b>تم تسليم طلبك</b>\nرقم الطلب: <code>${tgEsc(o.orderNo)}</code>\nالقيمة: <code>${tgEsc(String(value))}</code>\n\nيمكنك استرجاعها من تفاصيل الطلب داخل Game Zone.`);
  if(notice.ok){
    const latest=readDB(),current=latest.orders.find(x=>x.id===o.id);
    if(current){current.providerDeliveryNotifiedAt=now();await persistCritical(latest);}
  }
  res.json({ok:true,order:o,masked:o.providerDeliveryMasked});
});
app.patch("/api/admin/orders/:id",adminOnly,financialLocks(locksForAdminOrder),async(req,res)=>{
  const db=readDB(),o=db.orders.find(x=>x.id===req.params.id);if(!o)return res.status(404).json({error:"order_not_found"});
  const b=req.body||{};let note="";
  try{if("note" in b)note=cleanText(b.note,1000);}catch{return res.status(400).json({error:"order_note_too_long"});}
  if("status" in b){
    const status=String(b.status);if(!["pending","processing","completed","failed","refunded","cancelled"].includes(status))return res.status(400).json({error:"invalid_order_status"});
    const refunded=db.transactions.some(t=>t.type==="refund"&&t.reference===o.orderNo);
    if(status==="completed"&&refunded)return res.status(409).json({error:"refunded_order_cannot_complete"});
    if(o.status==="completed"&&status!=="completed")return res.status(409).json({error:"completed_order_locked"});
    if(["refunded","cancelled"].includes(o.status)&&status!==o.status)return res.status(409).json({error:"terminal_order_locked"});
    if(["failed","cancelled","refunded"].includes(status)&&(o.inventoryCodeId||o.providerDelivery))return res.status(409).json({error:"delivered_order_cannot_fail"});
    if(["pending","processing"].includes(status)&&["completed","failed","refunded","cancelled"].includes(o.status))return res.status(409).json({error:"terminal_order_cannot_reopen"});
    const confirmationError=adminOrderConfirmationError(o,status,refunded,b);
    if(confirmationError)return res.status(400).json({error:confirmationError});
    if(["failed","cancelled","refunded"].includes(status)&&!refunded){
      refundOrderInDB(db,o,Number(o.finalPrice||0),note||"استرجاع من الإدارة");rollbackCoupon(db,o.couponCode,o.orderNo);
      addNotification(db,o.telegramId,"تم استرجاع الرصيد",`تمت إعادة $${Number(o.finalPrice||0).toFixed(2)} للطلب ${o.orderNo}`,"refund",o.orderNo);
    }
    o.status=status;
    if(["completed","failed","refunded","cancelled"].includes(status)){o.requiresManualReview=false;o.reviewResolvedAt=now();}
    addOrderEvent(db,o.orderNo,o.status,note||"تحديث من الإدارة","admin");
  }
  if("note" in b)o.adminNote=note;o.updatedAt=now();
  pushAudit(db,req,"order_update",{orderId:o.id,status:o.status});addNotification(db,o.telegramId,"تحديث الطلب",`${o.orderNo}: ${o.status}`,"order",o.orderNo);await persistCritical(db);
  sendTelegramMessage(o.telegramId,`📦 تحديث طلب <code>${tgEsc(o.orderNo)}</code>\nالحالة الجديدة: <b>${tgEsc(o.status)}</b>`);res.json({ok:true,order:o});
});
app.get("/api/admin/topups",adminOnly,(req,res)=>res.json(readDB().topups.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))));
app.post("/api/admin/topups/:id/:action",adminOnly,financialLocks(locksForTopup),async(req,res)=>{
  const action=req.params.action;if(!["approve","reject"].includes(action))return res.status(400).json({error:"invalid_action"});
  const confirmationError=topupActionConfirmationError(action,req.body||{});
  if(confirmationError)return res.status(400).json({ok:false,error:confirmationError});
  const db=readDB(),t=db.topups.find(x=>x.id===req.params.id);if(!t)return res.status(404).json({error:"topup_not_found"});
  const evidenceError=action==="approve"?topupApprovalEvidenceError(t):null;if(evidenceError)return res.status(409).json({ok:false,error:evidenceError});
  try{
    const result=applyTopupAction(db,t,action,"admin");
    pushAudit(db,req,`topup_${action}`,{topupId:t.id,idempotent:result.idempotent});await persistCritical(db);
    if(!result.idempotent){
      if(action==="approve")sendTelegramMessage(t.telegramId,`✅ تم قبول طلب شحن الرصيد.\nالمبلغ: <b>$${Number(t.amount).toFixed(2)}</b>\nالرصيد الجديد: <b>$${Number(result.user?.balance||0).toFixed(2)}</b>`);
      else sendTelegramMessage(t.telegramId,`❌ تم رفض طلب شحن الرصيد رقم <code>${t.id}</code>.`);
    }
    res.json({ok:true,idempotent:result.idempotent,topup:t});
  }catch(e){res.status(400).json({ok:false,error:e.message});}
});
app.get("/api/admin/profits",adminOnly,(req,res)=>{
  const db=readDB(),rows=db.orders.filter(o=>o.status==="completed").map(o=>({orderNo:o.orderNo,productName:o.productName,revenue:Number(o.finalPrice??o.price??0),cost:Number(o.cost||0),profit:Number(o.profit||0),createdAt:o.createdAt}));
  const totals=rows.reduce((a,r)=>({revenue:a.revenue+r.revenue,cost:a.cost+r.cost,profit:a.profit+r.profit}),{revenue:0,cost:0,profit:0});
  res.json({totals:{revenue:money(totals.revenue),cost:money(totals.cost),profit:money(totals.profit)},rows});
});
app.get("/api/admin/coupons",adminOnly,(req,res)=>res.json(readDB().coupons));
app.post("/api/admin/coupons",adminOnly,financialLocks(locksForCoupon),(req,res)=>{
  const db=readDB(),b=req.body||{},code=String(b.code||"").trim().toUpperCase();
  if(!/^[A-Z0-9_-]{2,32}$/.test(code))return res.status(400).json({error:"invalid_coupon_code"});
  if(db.coupons.some(c=>c.code===code))return res.status(409).json({error:"coupon_exists"});
  const type=["percent","fixed"].includes(b.type)?b.type:"percent";
  const value=finiteNumber(b.value,{min:0,max:type==="percent"?100:1000000});
  const maxDiscount=b.maxDiscount===null||b.maxDiscount===""||b.maxDiscount===undefined?null:finiteNumber(b.maxDiscount,{min:0,max:1000000});
  const maxUses=b.maxUses===null||b.maxUses===""||b.maxUses===undefined?null:finiteNumber(b.maxUses,{min:1,max:100000000});
  if(value===null||maxDiscount===null&&b.maxDiscount!==null&&b.maxDiscount!==""&&b.maxDiscount!==undefined||maxUses===null&&b.maxUses!==null&&b.maxUses!==""&&b.maxUses!==undefined)return res.status(400).json({error:"invalid_coupon_values"});
  const maxUsesPerUser=b.maxUsesPerUser===null||b.maxUsesPerUser===""||b.maxUsesPerUser===undefined?1:finiteNumber(b.maxUsesPerUser,{min:1,max:1000000});
  if(maxUsesPerUser===null)return res.status(400).json({error:"invalid_coupon_user_limit"});
  const c={code,type,value,maxDiscount,active:b.active!==false,uses:0,maxUses,maxUsesPerUser};
  db.coupons.push(c);pushAudit(db,req,"coupon_create",{code:c.code});writeDB(db);res.json({ok:true,coupon:c});
});
app.patch("/api/admin/coupons/:code",adminOnly,financialLocks(locksForCoupon),(req,res)=>{
  const db=readDB(),code=String(req.params.code||"").toUpperCase(),c=(db.coupons||[]).find(x=>x.code===code);
  if(!c)return res.status(404).json({error:"coupon_not_found"});
  const b=req.body||{};
  if("type" in b){if(!["percent","fixed"].includes(b.type))return res.status(400).json({error:"invalid_coupon_type"});c.type=b.type;}
  if("value" in b){const n=finiteNumber(b.value,{min:0,max:c.type==="percent"?100:1000000});if(n===null)return res.status(400).json({error:"invalid_coupon_value"});c.value=n;}
  if("maxDiscount" in b){if(b.maxDiscount===null||b.maxDiscount==="")c.maxDiscount=null;else{const n=finiteNumber(b.maxDiscount,{min:0,max:1000000});if(n===null)return res.status(400).json({error:"invalid_coupon_max_discount"});c.maxDiscount=n;}}
  if("maxUses" in b){if(b.maxUses===null||b.maxUses==="")c.maxUses=null;else{const n=finiteNumber(b.maxUses,{min:1,max:100000000});if(n===null)return res.status(400).json({error:"invalid_coupon_max_uses"});c.maxUses=n;}}
  if("maxUsesPerUser" in b){if(b.maxUsesPerUser===null||b.maxUsesPerUser==="")c.maxUsesPerUser=null;else{const n=finiteNumber(b.maxUsesPerUser,{min:1,max:1000000});if(n===null)return res.status(400).json({error:"invalid_coupon_user_limit"});c.maxUsesPerUser=n;}}
  if("active" in b)c.active=!!b.active;
  pushAudit(db,req,"coupon_update",{code:c.code});writeDB(db);res.json({ok:true,coupon:c});
});

app.get("/api/admin/providers",adminOnly,(req,res)=>res.json(readDB().providers||[]));
app.post("/api/admin/providers",adminOnly,(req,res)=>{
  const db=readDB(),b=req.body||{},providerId=String(b.id||"").trim();
  if(!SAFE_ID.test(providerId)||!b.name||!b.type)return res.status(400).json({error:"invalid_provider_fields"});
  if((db.providers||[]).some(p=>p.id===providerId))return res.status(409).json({error:"provider_exists"});
  if(!["http","manual","demo","inventory"].includes(String(b.type)))return res.status(400).json({error:"invalid_provider_type"});
  if(b.baseUrl&&!validHttpUrl(b.baseUrl))return res.status(400).json({error:"invalid_provider_base_url"});
  const allowPrivateNetwork=b.allowPrivateNetwork===true,allowInsecureHttp=b.allowInsecureHttp===true;
  if(String(b.type)==="http"&&b.baseUrl){
    try{validateOutboundUrlSync(b.baseUrl,{allowPrivateNetwork,allowInsecureHttp});}
    catch(e){return res.status(400).json({error:e.message});}
  }
  let name,secretEnv,webhookSecretEnv,orderPath,statusPath;
  try{
    name=cleanText(b.name,120);secretEnv=b.secretEnv?cleanText(b.secretEnv,120):null;webhookSecretEnv=b.webhookSecretEnv?cleanText(b.webhookSecretEnv,120):null;
    orderPath=b.orderPath?cleanText(b.orderPath,500):null;statusPath=b.statusPath?cleanText(b.statusPath,500):null;
  }catch{return res.status(400).json({error:"provider_text_too_long"});}
  const priority=finiteNumber(b.priority??10,{min:0,max:100000}),timeoutMs=finiteNumber(b.timeoutMs??12000,{min:500,max:120000});
  if(priority===null||timeoutMs===null)return res.status(400).json({error:"invalid_provider_numbers"});
  const p={
    id:providerId,name,type:String(b.type),active:b.active!==false,priority,timeoutMs,fallbackOnAmbiguous:b.fallbackOnAmbiguous===true,
    allowPrivateNetwork,allowInsecureHttp,
    secretEnv,webhookSecretEnv,baseUrl:b.baseUrl?String(b.baseUrl):null,orderPath,statusPath,
    orderMethod:["GET","POST","PUT","PATCH"].includes(String(b.orderMethod||"POST").toUpperCase())?String(b.orderMethod||"POST").toUpperCase():"POST",
    statusMethod:["GET","POST"].includes(String(b.statusMethod||"GET").toUpperCase())?String(b.statusMethod||"GET").toUpperCase():"GET",
    authMode:["bearer","header","query","none"].includes(String(b.authMode||"bearer"))?String(b.authMode||"bearer"):"bearer",
    authHeader:b.authHeader?cleanText(b.authHeader,100):null,authQuery:b.authQuery?cleanText(b.authQuery,100):null,authPrefix:b.authPrefix==null?null:cleanText(b.authPrefix,100),
    requestFields:b.requestFields&&typeof b.requestFields==="object"&&!Array.isArray(b.requestFields)?b.requestFields:null,
    fixedPayload:b.fixedPayload&&typeof b.fixedPayload==="object"&&!Array.isArray(b.fixedPayload)?b.fixedPayload:null,
    statusRequestFields:b.statusRequestFields&&typeof b.statusRequestFields==="object"&&!Array.isArray(b.statusRequestFields)?b.statusRequestFields:null,
    statusFixedPayload:b.statusFixedPayload&&typeof b.statusFixedPayload==="object"&&!Array.isArray(b.statusFixedPayload)?b.statusFixedPayload:null,
    responseOrderIdPath:b.responseOrderIdPath?cleanText(b.responseOrderIdPath,200):null,
    responseStatusPath:b.responseStatusPath?cleanText(b.responseStatusPath,200):null,
    responseMessagePath:b.responseMessagePath?cleanText(b.responseMessagePath,200):null,
    responseDeliveryPath:b.responseDeliveryPath?cleanText(b.responseDeliveryPath,200):null
  };
  db.providers.push(p);pushAudit(db,req,"provider_create",{providerId:p.id});writeDB(db);res.json({ok:true,provider:p});
});
app.patch("/api/admin/providers/:id",adminOnly,(req,res)=>{
  const db=readDB(),p=(db.providers||[]).find(x=>x.id===req.params.id);if(!p)return res.status(404).json({error:"provider_not_found"});
  const b=req.body||{};
  if("type" in b&&!["http","manual","demo","inventory"].includes(String(b.type)))return res.status(400).json({error:"invalid_provider_type"});
  if("baseUrl" in b&&b.baseUrl&&!validHttpUrl(b.baseUrl))return res.status(400).json({error:"invalid_provider_base_url"});
  const nextType="type" in b?String(b.type):p.type;
  const nextBaseUrl="baseUrl" in b?(b.baseUrl?String(b.baseUrl):null):p.baseUrl;
  const nextAllowPrivate="allowPrivateNetwork" in b?!!b.allowPrivateNetwork:!!p.allowPrivateNetwork;
  const nextAllowInsecure="allowInsecureHttp" in b?!!b.allowInsecureHttp:!!p.allowInsecureHttp;
  if(nextType==="http"&&nextBaseUrl){
    try{validateOutboundUrlSync(nextBaseUrl,{allowPrivateNetwork:nextAllowPrivate,allowInsecureHttp:nextAllowInsecure});}
    catch(e){return res.status(400).json({error:e.message});}
  }
  try{
    if("name" in b)p.name=cleanText(b.name,120);
    if("secretEnv" in b)p.secretEnv=b.secretEnv?cleanText(b.secretEnv,120):null;
    if("webhookSecretEnv" in b)p.webhookSecretEnv=b.webhookSecretEnv?cleanText(b.webhookSecretEnv,120):null;
    if("orderPath" in b)p.orderPath=b.orderPath?cleanText(b.orderPath,500):null;
    if("statusPath" in b)p.statusPath=b.statusPath?cleanText(b.statusPath,500):null;
    for(const k of ["authHeader","authQuery","authPrefix"]){if(k in b)p[k]=b[k]==null||b[k]===""?null:cleanText(b[k],100);}
    for(const k of ["responseOrderIdPath","responseStatusPath","responseMessagePath","responseDeliveryPath"]){if(k in b)p[k]=b[k]?cleanText(b[k],200):null;}
  }catch{return res.status(400).json({error:"provider_text_too_long"});}
  if("type" in b)p.type=String(b.type);if("active" in b)p.active=!!b.active;if("fallbackOnAmbiguous" in b)p.fallbackOnAmbiguous=!!b.fallbackOnAmbiguous;if("allowPrivateNetwork" in b)p.allowPrivateNetwork=!!b.allowPrivateNetwork;if("allowInsecureHttp" in b)p.allowInsecureHttp=!!b.allowInsecureHttp;if("baseUrl" in b)p.baseUrl=b.baseUrl?String(b.baseUrl):null;
  if("priority" in b){const n=finiteNumber(b.priority,{min:0,max:100000});if(n===null)return res.status(400).json({error:"invalid_provider_priority"});p.priority=n;}
  if("timeoutMs" in b){const n=finiteNumber(b.timeoutMs,{min:500,max:120000});if(n===null)return res.status(400).json({error:"invalid_provider_timeout"});p.timeoutMs=n;}
  if("orderMethod" in b){const m=String(b.orderMethod).toUpperCase();if(!["GET","POST","PUT","PATCH"].includes(m))return res.status(400).json({error:"invalid_order_method"});p.orderMethod=m;}
  if("statusMethod" in b){const m=String(b.statusMethod).toUpperCase();if(!["GET","POST"].includes(m))return res.status(400).json({error:"invalid_status_method"});p.statusMethod=m;}
  if("authMode" in b){if(!["bearer","header","query","none"].includes(String(b.authMode)))return res.status(400).json({error:"invalid_auth_mode"});p.authMode=String(b.authMode);}
  if("requestFields" in b)p.requestFields=b.requestFields&&typeof b.requestFields==="object"&&!Array.isArray(b.requestFields)?b.requestFields:null;
  if("fixedPayload" in b)p.fixedPayload=b.fixedPayload&&typeof b.fixedPayload==="object"&&!Array.isArray(b.fixedPayload)?b.fixedPayload:null;
  if("statusRequestFields" in b)p.statusRequestFields=b.statusRequestFields&&typeof b.statusRequestFields==="object"&&!Array.isArray(b.statusRequestFields)?b.statusRequestFields:null;
  if("statusFixedPayload" in b)p.statusFixedPayload=b.statusFixedPayload&&typeof b.statusFixedPayload==="object"&&!Array.isArray(b.statusFixedPayload)?b.statusFixedPayload:null;
  pushAudit(db,req,"provider_update",{providerId:p.id});writeDB(db);res.json({ok:true,provider:p});
});
app.get("/api/admin/provider-logs",adminOnly,(req,res)=>{
  const db=readDB();let rows=db.providerLogs||[];
  if(req.query.providerId)rows=rows.filter(x=>x.providerId===req.query.providerId);
  res.json(rows.slice(0,300));
});
app.get("/api/admin/audit",adminOnly,(req,res)=>res.json((readDB().adminAudit||[]).slice(0,300)));
app.post("/api/admin/assets",adminOnly,rateLimit("admin_asset_upload",30,60000),(req,res)=>{
  try{
    const purpose=safePurpose(req.body?.purpose||"asset");
    const saved=persistImageDataUrl({dataUrl:req.body?.dataUrl,purpose,maxBytes:IMAGE_UPLOAD_MAX_BYTES,dir:UPLOAD_DIR,prefix:"asset"});
    res.status(201).json({ok:true,url:`/uploads/${saved.fileName}`,mimeType:saved.mimeType,size:saved.size});
  }catch(e){
    const code=String(e.message||"image_upload_failed");
    const status=code==="image_too_large"?413:400;
    res.status(status).json({ok:false,error:code});
  }
});

app.get("/api/admin/payment-methods",adminOnly,(req,res)=>res.json(readDB().paymentMethods||[]));
app.post("/api/admin/payment-methods",adminOnly,(req,res)=>{
  const db=readDB(),b=req.body||{},methodId=String(b.id||"").trim();
  if(!SAFE_ID.test(methodId)||!b.name)return res.status(400).json({error:"invalid_payment_method_fields"});
  if((db.paymentMethods||[]).some(x=>x.id===methodId))return res.status(409).json({error:"payment_method_exists"});
  if(b.checkoutUrlTemplate){
    const sample=buildCheckoutUrl(String(b.checkoutUrlTemplate),{id:"sample",amount:1,telegramId:"1",reference:"x"});
    if(!sample)return res.status(400).json({error:"invalid_checkout_url_template"});
  }
  let name,icon,imageUrl,instructions,account,checkoutUrlTemplate;
  try{name=cleanText(b.name,120);icon=cleanText(b.icon||"",20);imageUrl=cleanImageUrl(b.imageUrl);instructions=cleanText(b.instructions||"",1000);account=cleanText(b.account||"",500);checkoutUrlTemplate=b.checkoutUrlTemplate?cleanText(b.checkoutUrlTemplate,1000):null;}
  catch(e){return res.status(400).json({error:e.message==="invalid_image_url"?"invalid_image_url":"payment_text_too_long"});}
  const minAmount=finiteNumber(b.minAmount??1,{min:0,max:1000000}),maxAmount=finiteNumber(b.maxAmount??1000,{min:0,max:1000000}),sort=finiteNumber(b.sort??10,{min:0,max:100000});
  if(minAmount===null||maxAmount===null||sort===null||maxAmount<minAmount)return res.status(400).json({error:"invalid_payment_limits"});
  const m={id:methodId,name,icon,imageUrl,active:b.active!==false,sort,instructions,account,requiresReference:b.requiresReference!==false,requiresReceipt:b.requiresReceipt===true,minAmount,maxAmount,checkoutUrlTemplate};
  db.paymentMethods||=[];db.paymentMethods.push(m);pushAudit(db,req,"payment_method_create",{id:m.id});writeDB(db);res.json({ok:true,method:m});
});
app.patch("/api/admin/payment-methods/:id",adminOnly,(req,res)=>{
  const db=readDB(),m=(db.paymentMethods||[]).find(x=>x.id===req.params.id);if(!m)return res.status(404).json({error:"payment_method_not_found"});
  const b=req.body||{};
  if("checkoutUrlTemplate" in b&&b.checkoutUrlTemplate){
    const sample=buildCheckoutUrl(String(b.checkoutUrlTemplate),{id:"sample",amount:1,telegramId:"1",reference:"x"});
    if(!sample)return res.status(400).json({error:"invalid_checkout_url_template"});
  }
  try{
    if("name" in b)m.name=cleanText(b.name,120);if("icon" in b)m.icon=cleanText(b.icon,20);if("imageUrl" in b)m.imageUrl=cleanImageUrl(b.imageUrl);
    if("instructions" in b)m.instructions=cleanText(b.instructions,1000);if("account" in b)m.account=cleanText(b.account,500);
    if("checkoutUrlTemplate" in b)m.checkoutUrlTemplate=b.checkoutUrlTemplate?cleanText(b.checkoutUrlTemplate,1000):null;
  }catch(e){return res.status(400).json({error:e.message==="invalid_image_url"?"invalid_image_url":"payment_text_too_long"});}
  if("active" in b)m.active=!!b.active;if("requiresReference" in b)m.requiresReference=!!b.requiresReference;if("requiresReceipt" in b)m.requiresReceipt=!!b.requiresReceipt;
  if("sort" in b){const n=finiteNumber(b.sort,{min:0,max:100000});if(n===null)return res.status(400).json({error:"invalid_payment_sort"});m.sort=n;}
  if("minAmount" in b){const n=finiteNumber(b.minAmount,{min:0,max:1000000});if(n===null)return res.status(400).json({error:"invalid_payment_min"});m.minAmount=n;}
  if("maxAmount" in b){const n=finiteNumber(b.maxAmount,{min:0,max:1000000});if(n===null)return res.status(400).json({error:"invalid_payment_max"});m.maxAmount=n;}
  if(Number(m.maxAmount)<Number(m.minAmount))return res.status(400).json({error:"invalid_payment_limits"});
  pushAudit(db,req,"payment_method_update",{id:m.id});writeDB(db);res.json({ok:true,method:m});
});


app.get("/api/admin/categories",adminOnly,(req,res)=>res.json(readDB().categories));
app.post("/api/admin/categories",adminOnly,(req,res)=>{
  const db=readDB(),b=req.body||{},categoryId=String(b.id||"").trim();
  if(!SAFE_ID.test(categoryId)||!b.name)return res.status(400).json({error:"invalid_category_fields"});
  if(db.categories.some(c=>c.id===categoryId))return res.status(409).json({error:"category_exists"});
  let name,icon,imageUrl,description;try{name=cleanText(b.name,100);icon=cleanText(b.icon||"",20);imageUrl=cleanImageUrl(b.imageUrl);description=cleanText(b.description||"",500);}catch(e){return res.status(400).json({error:e.message==="invalid_image_url"?"invalid_image_url":"category_text_too_long"});}
  const parentId=b.parentId?String(b.parentId):null;if(parentId&&(!SAFE_ID.test(parentId)||!db.categories.some(c=>c.id===parentId)))return res.status(400).json({error:"category_parent_not_found"});
  const sort=finiteNumber(b.sort??db.categories.length+1,{min:0,max:100000});if(sort===null)return res.status(400).json({error:"invalid_category_sort"});
  const c={id:categoryId,name,icon,imageUrl,parentId,description,sort,active:b.active!==false};
  db.categories.push(c);pushAudit(db,req,"category_create",{categoryId:c.id});writeDB(db);res.json({ok:true,category:c});
});
app.patch("/api/admin/categories/:id",adminOnly,(req,res)=>{
  const db=readDB(),c=db.categories.find(x=>x.id===req.params.id);if(!c)return res.status(404).json({error:"category_not_found"});
  const b=req.body||{};try{if("name" in b)c.name=cleanText(b.name,100);if("icon" in b)c.icon=cleanText(b.icon,20);if("imageUrl" in b)c.imageUrl=cleanImageUrl(b.imageUrl);if("description" in b)c.description=cleanText(b.description,500);}catch(e){return res.status(400).json({error:e.message==="invalid_image_url"?"invalid_image_url":"category_text_too_long"});}
  if("parentId" in b){const parentId=b.parentId?String(b.parentId):null;if(parentId===c.id)return res.status(400).json({error:"category_parent_cycle"});if(parentId&&!db.categories.some(x=>x.id===parentId))return res.status(400).json({error:"category_parent_not_found"});let walk=parentId,seen=new Set([c.id]);while(walk){if(seen.has(walk))return res.status(400).json({error:"category_parent_cycle"});seen.add(walk);walk=db.categories.find(x=>x.id===walk)?.parentId||null;}c.parentId=parentId;}
  if("sort" in b){const n=finiteNumber(b.sort,{min:0,max:100000});if(n===null)return res.status(400).json({error:"invalid_category_sort"});c.sort=n;}if("active" in b)c.active=!!b.active;
  pushAudit(db,req,"category_update",{categoryId:c.id});writeDB(db);res.json({ok:true,category:c});
});

app.get("/api/admin/users/:telegramId",adminOnly,(req,res)=>{
  const db=readDB(),u=db.users.find(x=>String(x.telegramId)===String(req.params.telegramId));
  if(!u)return res.status(404).json({error:"user_not_found"});
  res.json({user:publicUser(u),orders:db.orders.filter(o=>String(o.telegramId)===String(u.telegramId)).slice(-20).reverse(),transactions:db.transactions.filter(t=>String(t.telegramId)===String(u.telegramId)).slice(-30).reverse()});
});

app.get("/api/admin/announcements",adminOnly,(req,res)=>res.json(readDB().announcements||[]));
app.post("/api/admin/announcements",adminOnly,(req,res)=>{
  const db=readDB(),b=req.body||{};let title,body;
  try{title=cleanText(b.title,120);body=cleanText(b.body,1200);}catch{return res.status(400).json({error:"announcement_text_too_long"});}
  if(!title||!body)return res.status(400).json({error:"title_and_body_required"});
  const type=["info","offer","warning"].includes(String(b.type||"info"))?String(b.type||"info"):"info";
  const sort=finiteNumber(b.sort??1,{min:0,max:100000});if(sort===null)return res.status(400).json({error:"invalid_announcement_sort"});
  const a={id:id("ann"),title,body,type,active:b.active!==false,sort,createdAt:now()};
  db.announcements.unshift(a);pushAudit(db,req,"announcement_create",{announcementId:a.id});writeDB(db);res.json({ok:true,announcement:a});
});
app.patch("/api/admin/announcements/:id",adminOnly,(req,res)=>{
  const db=readDB(),a=(db.announcements||[]).find(x=>x.id===req.params.id);if(!a)return res.status(404).json({error:"announcement_not_found"});
  const b=req.body||{};try{if("title" in b)a.title=cleanText(b.title,120);if("body" in b)a.body=cleanText(b.body,1200);}catch{return res.status(400).json({error:"announcement_text_too_long"});}
  if("type" in b){if(!["info","offer","warning"].includes(String(b.type)))return res.status(400).json({error:"invalid_announcement_type"});a.type=String(b.type);}
  if("active" in b)a.active=!!b.active;if("sort" in b){const n=finiteNumber(b.sort,{min:0,max:100000});if(n===null)return res.status(400).json({error:"invalid_announcement_sort"});a.sort=n;}
  pushAudit(db,req,"announcement_update",{announcementId:a.id});writeDB(db);res.json({ok:true,announcement:a});
});

app.get("/api/admin/settings",adminOnly,(req,res)=>res.json(readDB().settings||{}));
app.patch("/api/admin/settings",adminOnly,(req,res)=>{
  const db=readDB(),b=req.body||{},next={...(db.settings||{})},changed=[];
  try{
    if("storeName" in b){next.storeName=cleanText(b.storeName,100);changed.push("storeName");}
    if("tagline" in b){next.tagline=cleanText(b.tagline,180);changed.push("tagline");}
    if("maintenanceMessage" in b){next.maintenanceMessage=cleanText(b.maintenanceMessage,500);changed.push("maintenanceMessage");}
  }catch{return res.status(400).json({error:"settings_text_too_long"});}
  for(const k of ["maintenance","showAnnouncements","orderSyncEnabled"]){if(k in b){next[k]=!!b[k];changed.push(k);}}
  const numericRules={
    minTopup:{min:0,max:1000000},maxTopup:{min:0,max:1000000},orderSyncIntervalMs:{min:15000,max:86400000},
    orderSyncBatchSize:{min:1,max:1000},inventoryLowStockThreshold:{min:0,max:100000},adminSessionHours:{min:1,max:168},
    devicePairExpiryMinutes:{min:2,max:60},deviceSessionDays:{min:1,max:365},
    notificationRetentionDays:{min:7,max:3650},providerLogRetentionDays:{min:7,max:3650},auditRetentionDays:{min:30,max:3650}
  };
  for(const [k,rule] of Object.entries(numericRules)){if(k in b){const n=finiteNumber(b[k],rule);if(n===null)return res.status(400).json({error:`invalid_setting_${k}`});next[k]=n;changed.push(k);}}
  if(Number(next.maxTopup)<Number(next.minTopup))return res.status(400).json({error:"invalid_topup_limits"});
  if("currencies" in b){
    try{next.currencies=sanitizeAdminCurrencies(b.currencies);changed.push("currencies");}
    catch(e){return res.status(400).json({error:String(e.message||"invalid_currencies")});}
  }
  db.settings=next;pushAudit(db,req,"settings_update",{keys:changed});writeDB(db);res.json({ok:true,settings:db.settings});
});

app.get("/api/admin/verifications",adminOnly,(req,res)=>{
  const rows=(readDB().verificationRequests||[]).slice().sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  res.json(rows.map(x=>publicVerification(x,{admin:true})));
});
app.patch("/api/admin/verifications/:id",adminOnly,financialLocks(req=>[`verification:${String(req.params?.id||"")}`]),async(req,res)=>{
  const db=readDB(),row=(db.verificationRequests||[]).find(x=>String(x.id)===String(req.params.id));
  if(!row)return res.status(404).json({ok:false,error:"verification_not_found"});
  if(row.status!=="pending")return res.status(409).json({ok:false,error:"verification_already_reviewed",verification:publicVerification(row,{admin:true})});
  let decision;try{decision=sanitizeVerificationDecision(req.body||{});}catch(e){return res.status(400).json({ok:false,error:String(e.message||"invalid_verification_decision")});}
  row.status=decision.status;row.rejectionReason=decision.rejectionReason;row.reviewedAt=now();row.updatedAt=now();
  const verified=row.status==="verified";
  addNotification(db,row.telegramId,verified?"تم توثيق حسابك":"تعذر اعتماد التحقق",verified?"تم اعتماد التحقق بنجاح.":(row.rejectionReason||"يمكنك إرسال طلب جديد بعد مراجعة البيانات."),"verification",row.id);
  pushAudit(db,req,verified?"verification_approve":"verification_reject",{verificationId:row.id,telegramId:String(row.telegramId)});
  await persistCritical(db);
  sendTelegramMessage(row.telegramId,verified?"✅ تم <b>توثيق حساب Game Zone</b> بنجاح.":`⚠️ تعذر اعتماد طلب التحقق في Game Zone.${row.rejectionReason?`\nالسبب: ${tgEsc(row.rejectionReason)}`:""}`);
  res.json({ok:true,verification:publicVerification(row,{admin:true})});
});

app.get("/api/admin/support-tickets",adminOnly,(req,res)=>res.json((readDB().supportTickets||[]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))));
app.patch("/api/admin/support-tickets/:id",adminOnly,(req,res)=>{
  const db=readDB(),t=(db.supportTickets||[]).find(x=>x.id===req.params.id);if(!t)return res.status(404).json({error:"ticket_not_found"});
  const b=req.body||{};let reply=null;
  if("status" in b){if(!["open","pending","closed"].includes(String(b.status)))return res.status(400).json({error:"invalid_ticket_status"});t.status=String(b.status);}
  if("reply" in b){try{reply=cleanText(b.reply,3500);}catch{return res.status(400).json({error:"support_reply_too_long"});}t.reply=reply;}
  t.updatedAt=now();
  if(reply){sendTelegramMessage(t.telegramId,`🎧 <b>رد الدعم الفني</b>\n\n${tgEsc(reply)}`);addNotification(db,t.telegramId,"رد الدعم الفني",reply,"support",t.id);}
  pushAudit(db,req,"support_ticket_update",{ticketId:t.id,status:t.status});writeDB(db);res.json({ok:true,ticket:t});
});

app.post("/api/admin/broadcast",adminOnly,(req,res)=>{
  const confirmationError=broadcastConfirmationError(req.body||{});
  if(confirmationError)return res.status(400).json({ok:false,error:confirmationError});
  let title,message;const audience=String(req.body?.audience||"all");
  try{title=cleanText(req.body?.title||"Game Zone",100)||"Game Zone";message=cleanText(req.body?.message,3500);}catch{return res.status(400).json({error:"broadcast_text_too_long"});}
  if(!message)return res.status(400).json({error:"message_required"});
  if(!["all","positive_balance"].includes(audience))return res.status(400).json({error:"invalid_audience"});
  const db=readDB();let users=db.users||[];if(audience==="positive_balance")users=users.filter(u=>Number(u.balance)>0);
  const b={id:id("broadcast"),title,message,audience,total:users.length,sent:0,failed:0,processed:0,status:"queued",createdAt:now(),startedAt:null,finishedAt:null};
  db.broadcasts||=[];db.broadcasts.unshift(b);pushAudit(db,req,"broadcast_create",{broadcastId:b.id,audience,total:users.length});writeDB(db);
  kickBroadcastWorker();
  res.status(202).json({ok:true,queued:true,broadcast:b});
});
async function processBroadcastJob(jobId){
  const snapshot=readDB(),job=(snapshot.broadcasts||[]).find(x=>x.id===jobId);
  if(!job)return;
  let users=snapshot.users||[];if(job.audience==="positive_balance")users=users.filter(u=>Number(u.balance)>0);
  job.total=users.length;job.status="running";job.startedAt=job.startedAt||now();writeDB(snapshot);
  broadcastRuntime.running=true;broadcastRuntime.currentId=jobId;broadcastRuntime.lastError=null;

  const startIndex=Math.max(0,Number(job.processed||0));
  for(let i=startIndex;i<users.length;i++){
    const u=users[i],r=await sendTelegramMessage(u.telegramId,`📢 <b>${tgEsc(job.title)}</b>\n\n${tgEsc(job.message)}`);
    const d=readDB(),j=(d.broadcasts||[]).find(x=>x.id===jobId);
    if(!j)break;
    if(r.ok){j.sent=Number(j.sent||0)+1;addNotification(d,u.telegramId,job.title,job.message,"broadcast",job.id);}
    else j.failed=Number(j.failed||0)+1;
    j.processed=i+1;
    writeDB(d);
    await sleep(Number(process.env.BROADCAST_DELAY_MS||45));
  }
  const done=readDB(),j=(done.broadcasts||[]).find(x=>x.id===jobId);
  if(j){j.status="completed";j.finishedAt=now();writeDB(done);}
  broadcastRuntime.running=false;broadcastRuntime.currentId=null;broadcastRuntime.lastFinishedAt=now();
}
async function runBroadcastQueue(){
  if(broadcastRuntime.running)return;
  while(true){
    const db=readDB(),job=(db.broadcasts||[]).slice().reverse().find(x=>["queued","running"].includes(x.status));
    if(!job)break;
    try{await processBroadcastJob(job.id);}
    catch(e){
      broadcastRuntime.lastError=e.message;broadcastRuntime.running=false;broadcastRuntime.currentId=null;
      const d=readDB(),j=(d.broadcasts||[]).find(x=>x.id===job.id);
      if(j){j.status="failed";j.error=e.message;j.finishedAt=now();writeDB(d);}
    }
  }
}
function kickBroadcastWorker(){
  if(broadcastKickScheduled)return;
  broadcastKickScheduled=true;
  setImmediate(async()=>{broadcastKickScheduled=false;await runBroadcastQueue();});
}
app.get("/api/admin/broadcast-runtime",adminOnly,(req,res)=>res.json({ok:true,runtime:broadcastRuntime}));
app.get("/api/admin/broadcasts",adminOnly,(req,res)=>res.json(readDB().broadcasts||[]));

app.post("/api/admin/providers/:id/test",adminOnly,async(req,res)=>{
  const initial=readDB(),p=(initial.providers||[]).find(x=>x.id===req.params.id);
  if(!p)return res.status(404).json({error:"provider_not_found"});
  const started=Date.now();let ok=true,error=null;
  try{
    if(p.type==="http"){
      if(!p.baseUrl)throw new Error("missing_base_url");
      const safe=await assertSafeOutboundUrl(p.baseUrl,{allowPrivateNetwork:p.allowPrivateNetwork===true,allowInsecureHttp:p.allowInsecureHttp===true});
      const u=new URL(safe),controller=new AbortController();
      const t=setTimeout(()=>controller.abort(),Math.min(Number(p.timeoutMs||5000),5000));
      try{
        const probe=await fetch(u.origin,{method:"HEAD",signal:controller.signal,redirect:"manual"});
        if(probe.status>=300&&probe.status<400)throw new Error("provider_redirect_forbidden");
      }finally{clearTimeout(t);}
    }
  }catch(e){ok=false;error=e.message;}
  const result={providerId:p.id,ok,durationMs:Date.now()-started,error};
  const latest=readDB();pushProviderLog(latest,result);pushAudit(latest,req,"provider_test",{providerId:p.id,ok});writeDB(latest);res.json(result);
});

app.get("/api/admin/export/:kind.csv",adminOnly,(req,res)=>{
  const db=readDB(),kind=req.params.kind;let rows=[],headers=[];
  if(kind==="orders"){headers=["orderNo","telegramId","productName","finalPrice","profit","status","providerUsed","createdAt"];rows=db.orders.map(o=>headers.map(h=>o[h]??""));}
  else if(kind==="users"){headers=["telegramId","username","firstName","lastName","balance","currency","createdAt"];rows=db.users.map(u=>headers.map(h=>u[h]??""));}
  else if(kind==="profits"){headers=["orderNo","productName","finalPrice","cost","profit","createdAt"];rows=db.orders.filter(o=>o.status==="completed").map(o=>headers.map(h=>o[h]??""));}
  else return res.status(404).json({error:"unsupported_export"});
  const csv=toCsv(headers,rows);
  res.setHeader("content-type","text/csv; charset=utf-8");res.setHeader("content-disposition",`attachment; filename="game-zone-${kind}.csv"`);res.send("\uFEFF"+csv);
});


function normalizeProviderStatus(status){
  const s=String(status||"").toLowerCase();
  if(["completed","complete","success","successful","done","delivered"].includes(s))return "completed";
  if(["failed","error","cancelled","canceled","rejected"].includes(s))return "failed";
  if(["pending","queued","waiting"].includes(s))return "pending";
  return "processing";
}
function applyProviderStatus(db,order,status,message="",source="provider"){
  const normalized=normalizeProviderStatus(status);
  const before=order.status;
  const alreadyRefunded=db.transactions.some(t=>t.type==="refund"&&t.reference===order.orderNo);

  // Provider callbacks/polls must never reverse a financially terminal state.
  if(before==="completed"&&normalized!=="completed"){
    order.providerMessage=message||order.providerMessage||"";order.updatedAt=now();
    addOrderEvent(db,order.orderNo,before,"تم تجاهل حالة مزود متأخرة بعد اكتمال الطلب","system");
    return before;
  }
  if(alreadyRefunded&&normalized==="completed"){
    order.providerMessage=message||order.providerMessage||"";order.updatedAt=now();
    addOrderEvent(db,order.orderNo,before,"تم تجاهل اكتمال متأخر لأن الرصيد سبق استرجاعه","system");
    return before;
  }
  if(["refunded","cancelled"].includes(before)&&normalized!==before){
    order.providerMessage=message||order.providerMessage||"";order.updatedAt=now();
    return before;
  }

  order.status=normalized;order.providerMessage=message||order.providerMessage||"";order.updatedAt=now();
  if(["completed","failed"].includes(normalized)){order.requiresManualReview=false;order.reviewResolvedAt=now();}
  if(before!==normalized)addOrderEvent(db,order.orderNo,normalized,message||"تحديث حالة المزود",source);
  if(normalized==="failed"&&!alreadyRefunded){
    refundOrderInDB(db,order,Number(order.finalPrice||0),message||"provider_failed");rollbackCoupon(db,order.couponCode,order.orderNo);
    addNotification(db,order.telegramId,"تم استرجاع الرصيد",`فشل ${order.orderNo} وتمت إعادة $${Number(order.finalPrice||0).toFixed(2)}`,"refund",order.orderNo);
  }
  if(normalized==="completed"&&before!=="completed")addNotification(db,order.telegramId,"اكتمل الطلب",`${order.orderNo} اكتمل بنجاح`,"order",order.orderNo);
  return order.status;
}

async function syncProviderOrders({force=false}={}){
  if(syncRuntime.running)return {ok:false,skipped:true,reason:"already_running",runtime:{...syncRuntime}};
  const db=readDB();
  const enabled=db.settings?.orderSyncEnabled!==false;
  if(!enabled&&!force)return {ok:false,skipped:true,reason:"disabled",runtime:{...syncRuntime}};
  const batchSize=Math.max(1,Number(db.settings?.orderSyncBatchSize||10));
  const candidates=db.orders.filter(o=>
    ["processing","pending"].includes(o.status) &&
    o.providerUsed && o.providerUsed!=="inventory" &&
    o.providerOrderId
  ).slice(0,batchSize);

  syncRuntime.running=true;syncRuntime.lastRunAt=now();syncRuntime.lastScanned=candidates.length;
  syncRuntime.lastUpdated=0;syncRuntime.lastErrors=0;syncRuntime.lastError=null;

  for(const candidate of candidates){
    const log=entry=>{const d=readDB();pushProviderLog(d,entry);writeDB(d);};
    try{
      await withKeyLocks([`order:${candidate.id}`,`user:${String(candidate.telegramId||"")}`],async()=>{
        const snapshot=readDB();
        const current=snapshot.orders.find(x=>x.id===candidate.id);
        if(!current||!["processing","pending"].includes(current.status))return;
        const result=await getProviderOrderStatus({order:current,providerConfigs:snapshot.providers||[],log});
        const latest=readDB(),o=latest.orders.find(x=>x.id===candidate.id);
        if(!o||!["processing","pending"].includes(o.status))return;
        const before=o.status;
        const status=applyProviderStatus(latest,o,result.status,result.message,"provider_auto_sync");
        const newDelivery=status==="completed"?storeProviderDelivery(o,result.deliveryValue):false;
        if(before!==status){
          syncRuntime.lastUpdated++;
          addNotification(latest,o.telegramId,"تحديث تلقائي للطلب",`${o.orderNo}: ${status}`,"order",o.orderNo);
        }
        // Persist the financial/order state before any network notification await.
        await persistCritical(latest);
        if(newDelivery&&status==="completed"&&!o.providerDeliveryNotifiedAt){
          const sent=await sendTelegramMessage(o.telegramId,`🔑 <b>تم تجهيز التسليم الرقمي</b>\nطلب: <code>${tgEsc(o.orderNo)}</code>\nالقيمة: <code>${tgEsc(deliveryText(result.deliveryValue))}</code>`);
          if(sent.ok){
            const after=readDB(),fresh=after.orders.find(x=>x.id===o.id);
            if(fresh&&!fresh.providerDeliveryNotifiedAt){fresh.providerDeliveryNotifiedAt=now();await persistCritical(after);}
          }
        }
        if(before!==status)sendTelegramMessage(o.telegramId,`🔄 تحديث تلقائي للطلب <code>${tgEsc(o.orderNo)}</code>\nالحالة: <b>${tgEsc(status)}</b>`);
      },{timeoutMs:LOCK_TIMEOUT_MS});
    }catch(e){
      syncRuntime.lastErrors++;syncRuntime.lastError=e.message;
    }
  }
  syncRuntime.running=false;syncRuntime.lastFinishedAt=now();
  return {ok:true,runtime:{...syncRuntime}};
}
function olderThanDays(createdAt,days){
  const ts=new Date(createdAt||0).getTime();
  return Number.isFinite(ts)&&ts < Date.now()-Math.max(1,Number(days||1))*86400000;
}
function runDataMaintenance({source="system"}={}){
  const db=readDB(),removed={notifications:0,providerLogs:0,audit:0,security:0,devicePairs:0,deletedAccounts:0};
  const trim=(key,days)=>{
    const before=(db[key]||[]).length;
    db[key]=(db[key]||[]).filter(x=>!olderThanDays(x.createdAt||x.deletedAt,days));
    return before-db[key].length;
  };
  removed.notifications=trim("notifications",db.settings?.notificationRetentionDays||180);
  removed.providerLogs=trim("providerLogs",db.settings?.providerLogRetentionDays||90);
  removed.audit=trim("adminAudit",db.settings?.auditRetentionDays||365);
  removed.security=trim("securityEvents",db.settings?.auditRetentionDays||365);
  removed.deletedAccounts=trim("deletedAccounts",365);
  const beforePairs=(db.devicePairs||[]).length;
  db.devicePairs=(db.devicePairs||[]).filter(p=>{
    if(!isExpired(p))return true;
    if(p.status==="approved"&&p.consumedAt)return Date.now()-new Date(p.consumedAt).getTime()<86400000;
    return false;
  });
  removed.devicePairs=beforePairs-db.devicePairs.length;
  db.storageMeta ||= {};
  db.storageMeta.lastMaintenanceAt=now();
  db.storageMeta.lastMaintenanceSource=source;
  writeDB(db);
  maintenanceRuntime.lastRunAt=now();maintenanceRuntime.lastRemoved=removed;maintenanceRuntime.lastError=null;
  return removed;
}
function runIntegrityMonitoring({notify=true}={}){
  try{
    const result=scanDatabaseIntegrity(readDB());
    integrityRuntime.lastRunAt=now();integrityRuntime.lastCounts=result.counts;integrityRuntime.lastError=null;integrityDirty=false;
    const critical=result.issues.filter(x=>x.severity==="critical");
    const signature=critical.length?crypto.createHash("sha256").update(JSON.stringify(critical.map(x=>[x.code,x.orderNo||x.topupId||x.telegramId||x.ref||""]).sort())).digest("hex"):null;
    if(notify&&critical.length&&signature!==integrityRuntime.lastAlertSignature){
      const sample=critical.slice(0,5).map(x=>`• ${x.code}: ${x.message}`).join("\n");
      notifyAdmins(`🚨 <b>Game Zone Data Integrity</b>\nتم اكتشاف <b>${critical.length}</b> مشكلة حرجة.\n${tgEsc(sample)}\n\nافتح Admin → التشغيل → مركز سلامة البيانات.`);
    }
    integrityRuntime.lastAlertSignature=signature;
    return result;
  }catch(e){integrityRuntime.lastError=e.message;return null;}
}

function cleanupDevicePairs(){
  const db=readDB();const before=(db.devicePairs||[]).length;
  db.devicePairs=(db.devicePairs||[]).filter(p=>{
    const expired=isExpired(p);
    if(!expired)return true;
    if(p.status==="approved"&&p.consumedAt){
      return Date.now()-new Date(p.consumedAt).getTime()<24*3600*1000;
    }
    return false;
  }).slice(0,300);
  if(db.devicePairs.length!==before)writeDB(db);
}
function scheduleNextSync(){
  if(syncTimer)clearTimeout(syncTimer);
  const db=readDB();
  const ms=Math.max(15000,Number(process.env.ORDER_SYNC_INTERVAL_MS||db.settings?.orderSyncIntervalMs||60000));
  syncRuntime.nextRunAt=new Date(Date.now()+ms).toISOString();
  syncTimer=setTimeout(async()=>{
    try{
      await syncProviderOrders();cleanupDevicePairs();
      const last=new Date(readDB().storageMeta?.lastMaintenanceAt||0).getTime();
      if(!Number.isFinite(last)||Date.now()-last>6*3600000)runDataMaintenance({source:"scheduled"});
      const lastIntegrity=new Date(integrityRuntime.lastRunAt||0).getTime();
      if(!Number.isFinite(lastIntegrity)||Date.now()-lastIntegrity>6*3600000)runIntegrityMonitoring({notify:true});
    }catch(e){syncRuntime.lastError=e.message;}
    scheduleNextSync();
  },ms);
  if(syncTimer.unref)syncTimer.unref();
}
app.get("/api/admin/sync-worker",adminOnly,(req,res)=>res.json({ok:true,runtime:syncRuntime,settings:{enabled:readDB().settings?.orderSyncEnabled!==false,intervalMs:Number(process.env.ORDER_SYNC_INTERVAL_MS||readDB().settings?.orderSyncIntervalMs||60000),batchSize:Number(readDB().settings?.orderSyncBatchSize||10)}}));
app.get("/api/admin/maintenance",adminOnly,(req,res)=>res.json({ok:true,runtime:maintenanceRuntime,settings:{
  notificationRetentionDays:Number(readDB().settings?.notificationRetentionDays||180),
  providerLogRetentionDays:Number(readDB().settings?.providerLogRetentionDays||90),
  auditRetentionDays:Number(readDB().settings?.auditRetentionDays||365)
}}));
app.post("/api/admin/maintenance/run",adminOnly,(req,res)=>{
  try{
    const removed=runDataMaintenance({source:"admin"});
    const db=readDB();pushAudit(db,req,"maintenance_run",{removed});writeDB(db);
    res.json({ok:true,removed,runtime:maintenanceRuntime});
  }catch(e){maintenanceRuntime.lastError=e.message;res.status(500).json({ok:false,error:"maintenance_failed"});}
});
app.post("/api/admin/sync-worker/run",adminOnly,async(req,res)=>{
  const result=await syncProviderOrders({force:true});
  const db=readDB();pushAudit(db,req,"sync_worker_manual_run",result.runtime||{});writeDB(db);res.json(result);
});

app.post("/api/admin/orders/:id/sync",adminOnly,financialLocks(locksForAdminOrder),async(req,res)=>{
  const db=readDB(),order=db.orders.find(x=>x.id===req.params.id);
  if(!order)return res.status(404).json({error:"order_not_found"});
  if(order.providerUsed==="inventory")return res.json({ok:true,skipped:true,reason:"inventory_order",order});
  const log=entry=>{const d=readDB();pushProviderLog(d,entry);writeDB(d);};
  try{
    const result=await getProviderOrderStatus({order,providerConfigs:db.providers||[],log});
    const latest=readDB(),o=latest.orders.find(x=>x.id===order.id);
    const status=applyProviderStatus(latest,o,result.status,result.message,"provider_sync");
    const newDelivery=status==="completed"?storeProviderDelivery(o,result.deliveryValue):false;
    pushAudit(latest,req,"order_provider_sync",{orderId:o.id,status,newDelivery});
    await persistCritical(latest);
    if(newDelivery&&status==="completed"&&!o.providerDeliveryNotifiedAt){
      const sent=await sendTelegramMessage(o.telegramId,`🔑 <b>تم تجهيز التسليم الرقمي</b>\nطلب: <code>${tgEsc(o.orderNo)}</code>\nالقيمة: <code>${tgEsc(deliveryText(result.deliveryValue))}</code>`);
      if(sent.ok){
        const after=readDB(),current=after.orders.find(x=>x.id===o.id);
        if(current&&!current.providerDeliveryNotifiedAt){current.providerDeliveryNotifiedAt=now();await persistCritical(after);}
      }
    }
    sendTelegramMessage(o.telegramId,`🔄 تحديث الطلب <code>${tgEsc(o.orderNo)}</code>\nالحالة: <b>${tgEsc(status)}</b>`);
    res.json({ok:true,order:o});
  }catch(e){res.status(502).json({ok:false,error:e.message});}
});

app.post("/api/provider-webhook/:providerId",rateLimit("provider_webhook",120,60000),providerWebhookAuth,financialLocks(locksForProviderWebhook),async(req,res)=>{
  const {providerOrderId,status,message="",deliveryValue=null}=req.body||{};
  if(!providerOrderId||!status)return res.status(400).json({error:"provider_order_id_and_status_required"});
  if(!SAFE_ID.test(String(req.params.providerId||"")))return res.status(400).json({error:"invalid_provider_id"});
  if(String(providerOrderId).length>200||String(status).length>100||String(message||"").length>1000||String(deliveryValue??"").length>10000)return res.status(400).json({error:"provider_webhook_payload_too_long"});
  const db=readDB(),o=db.orders.find(x=>x.providerUsed===req.params.providerId&&String(x.providerOrderId)===String(providerOrderId));
  if(!o)return res.status(404).json({error:"order_not_found"});
  const before=o.status;
  const normalized=applyProviderStatus(db,o,status,message,"provider_webhook");
  const newDelivery=normalized==="completed"?storeProviderDelivery(o,deliveryValue):false;
  const replay=before===normalized&&!newDelivery;
  pushProviderLog(db,{providerId:req.params.providerId,orderNo:o.orderNo,providerOrderId:String(providerOrderId),ok:true,status:normalized,operation:replay?"webhook_replay":"webhook",deliveryReceived:newDelivery});
  await persistCritical(db);
  if(newDelivery&&normalized==="completed"&&!o.providerDeliveryNotifiedAt){
    const sent=await sendTelegramMessage(o.telegramId,`🔑 <b>تم تجهيز التسليم الرقمي</b>\nطلب: <code>${tgEsc(o.orderNo)}</code>\nالقيمة: <code>${tgEsc(deliveryText(deliveryValue))}</code>`);
    if(sent.ok){
      const after=readDB(),current=after.orders.find(x=>x.id===o.id);
      if(current&&!current.providerDeliveryNotifiedAt){current.providerDeliveryNotifiedAt=now();await persistCritical(after);}
    }
  }
  if(!replay)sendTelegramMessage(o.telegramId,`📦 تحديث طلب <code>${tgEsc(o.orderNo)}</code>\nالحالة: <b>${tgEsc(normalized)}</b>`);
  res.json({ok:true,idempotent:replay,orderNo:o.orderNo,status:normalized});
});

app.get("/api/admin/inventory",adminOnly,(req,res)=>{
  const db=readDB();let rows=db.inventoryCodes||[];
  if(req.query.productId)rows=rows.filter(x=>x.productId===req.query.productId);
  res.json(rows.map(x=>({id:x.id,productId:x.productId,status:x.status,orderNo:x.orderNo||null,masked:maskValue(x.encrypted?(()=>{try{return decryptValue(x)}catch{return "encrypted"}})():x.value),encrypted:!!x.encrypted,createdAt:x.createdAt,updatedAt:x.updatedAt})));
});
app.get("/api/admin/inventory/summary",adminOnly,(req,res)=>{
  const db=readDB();
  const rows=db.products.filter(p=>p.delivery==="inventory").map(p=>{
    const all=(db.inventoryCodes||[]).filter(x=>x.productId===p.id);
    return {productId:p.id,productName:p.name,available:all.filter(x=>x.status==="available").length,delivered:all.filter(x=>x.status==="delivered").length,total:all.length};
  });res.json(rows);
});
app.post("/api/admin/inventory/bulk",adminOnly,financialLocks(locksForInventoryProduct),(req,res)=>{
  const {productId,codes,text}=req.body||{};
  const db=readDB(),product=db.products.find(p=>p.id===productId);
  if(!product)return res.status(404).json({error:"product_not_found"});
  const list=Array.isArray(codes)?codes:String(text||"").split(/\r?\n/);
  if(list.length>5000)return res.status(400).json({error:"too_many_inventory_codes",max:5000});
  const clean=[...new Set(list.map(x=>String(x).trim()).filter(Boolean))];
  if(!clean.length)return res.status(400).json({error:"codes_required"});
  if(clean.some(code=>code.length>500))return res.status(400).json({error:"inventory_code_too_long"});
  if(product.delivery!=="inventory")return res.status(400).json({error:"product_not_inventory_delivery"});
  db.inventoryCodes||=[];let added=0,duplicates=0;
  const fingerprints=new Set(db.inventoryCodes.filter(x=>x.productId===productId&&x.fingerprint).map(x=>x.fingerprint));
  for(const code of clean){
    const fingerprint=fingerprintValue(code);
    if(fingerprints.has(fingerprint)){duplicates++;continue;}
    const enc=encryptValue(code);
    db.inventoryCodes.push({id:id("inv"),productId,...enc,fingerprint,status:"available",orderNo:null,createdAt:now(),updatedAt:now()});fingerprints.add(fingerprint);added++;
  }
  pushAudit(db,req,"inventory_bulk_add",{productId,added,duplicates});writeDB(db);res.json({ok:true,added,duplicates});
});
app.get("/api/admin/inventory/:id/reveal",adminOnly,(req,res)=>{
  const db=readDB(),item=(db.inventoryCodes||[]).find(x=>x.id===req.params.id);
  if(!item)return res.status(404).json({error:"inventory_item_not_found"});
  try{pushAudit(db,req,"inventory_reveal",{inventoryId:item.id});writeDB(db);res.json({ok:true,value:decryptValue(item),status:item.status,orderNo:item.orderNo||null});}
  catch(e){res.status(500).json({error:e.message});}
});
app.post("/api/admin/inventory/:id/disable",adminOnly,financialLocks(locksForInventoryItem),(req,res)=>{
  const db=readDB(),item=(db.inventoryCodes||[]).find(x=>x.id===req.params.id);
  if(!item)return res.status(404).json({error:"inventory_item_not_found"});
  if(item.status==="delivered")return res.status(400).json({error:"delivered_item_locked"});
  item.status="disabled";item.updatedAt=now();pushAudit(db,req,"inventory_disable",{inventoryId:item.id});writeDB(db);res.json({ok:true,item:{...item,value:undefined,valueEnc:undefined}});
});
app.get("/api/admin/backup",rateLimit("admin_backup",6,3600000),adminOnly,(req,res)=>{
  const db=readDB(),stamp=new Date().toISOString().replace(/[:.]/g,"-");
  pushAudit(db,req,"backup_download",{createdAt:now()});
  writeDB(db);
  const backup=makeBackup(db,{version:"1.0.0-rc.20",createdAt:now()});
  const encrypted=!!String(process.env.BACKUP_ENCRYPTION_KEY||"").trim();
  const payload=encodeBackupFile(backup,{encrypt:encrypted});
  res.setHeader("Content-Disposition",`attachment; filename="game-zone-backup-${stamp}${encrypted?".encrypted":""}.json"`);
  res.setHeader("X-Game-Zone-Backup-Encrypted",encrypted?"yes":"no");
  res.json(payload);
});
app.get("/api/admin/integrity",adminOnly,(req,res)=>{
  const hours=finiteNumber(req.query.reviewStaleHours??24,{min:1,max:720})||24;
  const result=scanDatabaseIntegrity(readDB(),{reviewStaleHours:hours});
  integrityRuntime.lastRunAt=now();integrityRuntime.lastCounts=result.counts;integrityRuntime.lastError=null;
  res.json({...result,runtime:integrityRuntime});
});
app.post("/api/admin/integrity/repair-safe",adminOnly,financialLocks(locksForIntegrityRepair),async(req,res)=>{
  if(String(req.body?.confirmation||"")!=="REPAIR_SAFE")return res.status(400).json({ok:false,error:"repair_confirmation_required"});
  const db=readDB(),before=scanDatabaseIntegrity(db);
  const result=repairSafeIntegrity(db);
  pushAudit(db,req,"integrity_repair_safe",{changes:result.changes,before:before.counts});
  await persistCritical(db);
  const after=scanDatabaseIntegrity(db);
  res.json({ok:true,result,before:before.counts,after:after.counts,integrity:after});
});
app.post("/api/admin/integrity/reconcile-wallets",adminOnly,financialLocks(locksForWalletReconcile),async(req,res)=>{
  if(String(req.body?.confirmation||"")!=="RECONCILE_WALLETS")return res.status(400).json({ok:false,error:"wallet_reconcile_confirmation_required"});
  const db=readDB(),before=scanDatabaseIntegrity(db);
  const result=reconcileWalletBalances(db);
  pushAudit(db,req,"integrity_reconcile_wallets",{changes:result.changes,before:before.counts});
  await persistCritical(db);
  const after=scanDatabaseIntegrity(db);
  notifyAdmins(`🧾 <b>Wallet reconciliation</b>\nتم تعديل ${result.count} محفظة بواسطة مركز سلامة البيانات.`);
  res.json({ok:true,result,before:before.counts,after:after.counts,integrity:after});
});
app.get("/api/admin/schema",adminOnly,(req,res)=>{
  const db=readDB();
  res.json({ok:true,currentSchemaVersion:CURRENT_SCHEMA_VERSION,databaseSchemaVersion:Number(db.schemaVersion||0),migrationMeta:db.storageMeta?{schemaMigratedAt:db.storageMeta.schemaMigratedAt||null,schemaMigratedFrom:db.storageMeta.schemaMigratedFrom??null}:{}});
});
app.get("/api/admin/locks",adminOnly,(req,res)=>res.json({ok:true,timeoutMs:LOCK_TIMEOUT_MS,locks:getLockStats()}));
app.get("/api/admin/backups",adminOnly,(req,res)=>{
  const dir=process.env.BACKUP_DIR||path.join(__dirname,"backups");
  const status=readBackupStatus(dir),maxAgeHours=Math.max(1,Number(process.env.BACKUP_MAX_AGE_HOURS||48));
  res.json({ok:true,status,health:backupHealth(status,{maxAgeHours,dir}),maxAgeHours,files:listBackupFiles(dir,{limit:50})});
});
app.get("/api/admin/storage",adminOnly,(req,res)=>res.json({ok:true,storage:getStoreInfo()}));
app.get("/api/admin/storage/history",adminOnly,async(req,res)=>{
  try{res.json({ok:true,history:await listStoreHistory(Math.max(1,Math.min(100,Number(req.query.limit||20))))});}
  catch(e){res.status(503).json({ok:false,error:"storage_history_unavailable",detail:e.message});}
});
app.post("/api/admin/storage/verify",adminOnly,async(req,res)=>{
  const current=await verifyPersistedState(),history=await verifyStoreHistory(200);
  const ok=current.ok&&history.ok;
  res.status(ok?200:503).json({ok,current,history});
});
app.get("/api/admin/storage/financial-mirror",adminOnly,async(req,res)=>{
  // Diagnostics must remain viewable even when drift exists; readiness still fails separately.
  res.json(await verifyFinancialMirrorState());
});
app.get("/api/admin/storage/financial-journal",adminOnly,async(req,res)=>{
  // Journal diagnostics remain visible during drift for recovery/incident response.
  res.json(await verifyFinancialJournalState());
});
app.get("/api/admin/storage/wallet-authority",adminOnly,async(req,res)=>{
  // Wallet authority diagnostics remain visible during drift for incident response/recovery.
  res.json(await verifyWalletAuthorityState());
});
app.get("/api/admin/storage/business-authority",adminOnly,async(req,res)=>{
  // Order/Top-up authority diagnostics remain visible during drift for incident response.
  res.json(await verifyBusinessAuthorityState());
});
app.post("/api/admin/storage/flush",adminOnly,async(req,res)=>{
  try{const info=await flushStore({throwOnError:true});res.json({ok:true,storage:info});}
  catch{res.status(503).json({ok:false,error:"storage_persist_failed",storage:getStoreInfo()});}
});

app.get("/api/admin/security-events",adminOnly,(req,res)=>res.json((readDB().securityEvents||[]).slice(0,300)));

app.use((req,res,next)=>{
  if(req.path.startsWith("/api/"))return res.status(404).json({ok:false,error:"api_not_found"});
  next();
});
app.use((err,req,res,next)=>{
  const message=String(err?.message||"internal_error");
  const status=message==="origin_not_allowed"?403:500;
  if(status>=500)console.error(`Unhandled request error [${req.requestId||"no-request-id"}]:`,err);
  res.status(status).json({ok:false,error:status===403?"origin_not_allowed":"internal_error"});
});

async function prepareRuntimeData(){
  const db=readDB();let changed=false;
  const preMigration=JSON.parse(JSON.stringify(db));
  const migration=migrateDatabase(db);
  if(migration.changed){
    changed=true;
    const dir=process.env.BACKUP_DIR||path.join(__dirname,"backups");
    fs.mkdirSync(dir,{recursive:true});
    const stamp=new Date().toISOString().replace(/[:.]/g,"-");
    const safety=path.join(dir,`pre-migration-v${migration.from}-to-v${migration.to}-${stamp}.json`);
    const preMigrationBackup=makeBackup(preMigration,{version:"1.0.0-rc.20"});
    fs.writeFileSync(safety,JSON.stringify(encodeBackupFile(preMigrationBackup),null,2),"utf8");
    console.log("Pre-migration safety backup:",safety);
  }
  if(process.env.INVENTORY_ENCRYPTION_KEY){
    for(const item of db.inventoryCodes||[]){
      let clear=null;
      try{clear=item.encrypted?decryptValue(item):item.value;}catch{}
      if(clear!==undefined&&clear!==null&&!item.fingerprint){item.fingerprint=fingerprintValue(clear);changed=true;}
      if(!item.encrypted&&clear!==undefined&&clear!==null){
        const enc=encryptValue(clear);
        delete item.value;Object.assign(item,enc);item.updatedAt=now();changed=true;
      }
    }
  }
  if(process.env.NODE_ENV==="production"&&String(process.env.ALLOW_DEMO_PRODUCTS||"false").toLowerCase()!=="true"){
    for(const product of db.products||[]){
      if(product.id==="gz-demo-code"||product.providerPrimary==="demo"){
        if(product.active){product.active=false;changed=true;}
      }
    }
    for(const provider of db.providers||[]){
      if(provider.id==="demo"&&provider.active){provider.active=false;changed=true;}
    }
  }
  if(changed){writeDB(db);await flushStore({throwOnError:true});}
}

function buildReadiness(){
  const db=readDB(),storage=getStoreInfo();
  const checks=[];
  const add=(id,ok,label,detail="")=>checks.push({id,ok:!!ok,label,detail});
  const botUsername=String(process.env.BOT_USERNAME||"").replace(/^@/,"");
  add("storage",storage.driver==="postgres"&&storage.postgresConnected,"PostgreSQL","يُنصح بتشغيل PostgreSQL في الإنتاج.");
  add("storage_health",!storage.lastPersistError&&!storage.pgPoolError,"سلامة التخزين","لا يجب وجود خطأ حفظ أو Pool قبل الإطلاق.");
  add("durable_ack",storage.durableAcknowledgementAvailable===true,"تأكيد الحفظ قبل نجاح العمليات الحرجة","الطلبات والشحن والرصيد تنتظر اكتمال الحفظ الدائم قبل إرسال النجاح.");
  add("state_integrity",storage.driver!=="postgres"||(!storage.lastStateVerifyError&&!!storage.stateRevision&&!!storage.stateDataSha256),"سلامة Snapshot PostgreSQL",storage.lastStateVerifyError||`revision ${storage.stateRevision||"-"} / ${String(storage.stateDataSha256||"-").slice(0,12)}`);
  add("state_hmac",storage.driver!=="postgres"||storage.stateHmacPresent,"HMAC لحالة PostgreSQL","يحمي Snapshot وسجل الاستعادة من تعديل البيانات+الهاش بدون سر السيرفر.");
  add("financial_mirror",storage.driver!=="postgres"||(
    storage.financialMirrorEnabled&&
    !storage.lastFinancialMirrorError&&
    Number(storage.financialMirrorRevision||0)===Number(storage.stateRevision||0)
  ),"مرآة PostgreSQL المالية",storage.lastFinancialMirrorError||`revision ${storage.financialMirrorRevision||"-"} / state ${storage.stateRevision||"-"}`);
  add("financial_journal",storage.driver!=="postgres"||(
    storage.financialJournalEnabled&&
    !storage.lastFinancialJournalError&&
    Number(storage.financialJournalLastStateRevision||0)===Number(storage.stateRevision||0)
  ),"السجل المالي غير القابل للتفسير الصامت",storage.lastFinancialJournalError||`entries ${storage.financialJournalEntries||0} / revision ${storage.financialJournalLastStateRevision||"-"}`);
  add("wallet_authority",storage.driver!=="postgres"||(
    storage.walletAuthorityEnabled&&
    !storage.lastWalletAuthorityError&&
    Number(storage.walletAuthorityLastStateRevision||0)===Number(storage.stateRevision||0)
  ),"سلطة الرصيد في PostgreSQL",storage.lastWalletAuthorityError||`accounts ${storage.walletAuthorityActiveAccountCount||0} / total $${Number(storage.walletAuthorityTotalBalance||0).toFixed(2)} / revision ${storage.walletAuthorityLastStateRevision||"-"}`);
  add("business_authority",storage.driver!=="postgres"||(
    storage.businessAuthorityEnabled&&
    !storage.lastBusinessAuthorityError&&
    Number(storage.businessAuthorityLastStateRevision||0)===Number(storage.stateRevision||0)
  ),"سلطة الطلبات والشحن في PostgreSQL",storage.lastBusinessAuthorityError||`orders ${storage.businessAuthorityOrderCount||0} / topups ${storage.businessAuthorityTopupCount||0} / revision ${storage.businessAuthorityLastStateRevision||"-"}`);
  add("schema",Number(db.schemaVersion||0)===CURRENT_SCHEMA_VERSION,"إصدار بنية البيانات",`الحالي ${Number(db.schemaVersion||0)} / المطلوب ${CURRENT_SCHEMA_VERSION}`);
  add("single_instance_lock",storage.driver!=="postgres"||(!storage.singleInstanceLockRequired?process.env.NODE_ENV!=="production":storage.singleInstanceLockAcquired),"قفل PostgreSQL أحادي الخادم","يحمي Snapshot runtime من تشغيل أكثر من Server writer.");
  const lockStats=getLockStats();
  add("operation_locks",lockStats.waiting<50,"أقفال العمليات",lockStats.waiting?`${lockStats.waiting} عملية تنتظر الآن`:"لا يوجد ضغط انتظار.");
  const integrity=scanDatabaseIntegrity(db);
  add("data_integrity",integrity.counts.critical===0,"سلامة البيانات",integrity.counts.critical?`${integrity.counts.critical} مشكلة حرجة — افتح مركز سلامة البيانات.`:"لا توجد مشاكل حرجة.");
  add("bot_token",!!process.env.BOT_TOKEN,"Telegram Bot Token");
  add("bot_username",!!botUsername,"BOT_USERNAME","مطلوب لربط تطبيق Android بحساب Telegram.");
  add("bot_internal_secret",String(process.env.INTERNAL_BOT_SECRET||"").length>=24,"سر اتصال البوت","يفصل طلبات Telegram Bot الداخلية عن العملاء.");
  add("bot_admin_secret",String(process.env.INTERNAL_BOT_ADMIN_SECRET||"").length>=24,"سر صلاحيات Bot Automation","صلاحيات البوت الإدارية محدودة بالـallowlist ولا تستخدم مفتاح Owner.");
  add("admin_secret",!!process.env.ADMIN_SESSION_SECRET&&!!process.env.ADMIN_PASSWORD,"حماية الإدارة");
  add("audit_hmac",String(process.env.AUDIT_HMAC_KEY||"").length>=32,"مفتاح سلامة Audit","مطلوب HMAC مستقل لسجل الإدارة في الإنتاج.");
  add("backup_encryption",!!decodeBackupKey(process.env.BACKUP_ENCRYPTION_KEY),"تشفير النسخ الاحتياطية","مطلوب مفتاح AES-256 مستقل لحماية ملفات النسخ على القرص.");
  add("user_secret",!!process.env.USER_SESSION_SECRET,"جلسات المستخدمين");
  add("inventory_key",!!process.env.INVENTORY_ENCRYPTION_KEY,"تشفير المخزون");
  add("origins",!!process.env.ALLOWED_ORIGINS,"Allowed Origins");
  add("public_base",!!publicBaseUrl&&validHttpUrl(publicBaseUrl),"Public Base URL","مطلوب لروابط الخصوصية وحذف الحساب خارج التطبيق.");
  const activeProviders=(db.providers||[]).filter(p=>p.active);
  const activeProducts=(db.products||[]).filter(p=>p.active);
  const autoProducts=activeProducts.filter(p=>p.delivery==="auto");
  const inventoryProducts=activeProducts.filter(p=>p.delivery==="inventory");
  const realHttpProviders=activeProviders.filter(p=>p.type==="http"&&p.id!=="demo");
  add("providers",realHttpProviders.some(p=>p.baseUrl&&p.orderPath),"مزود API فعلي","أضف مزود HTTP حقيقي قبل تشغيل منتجات API التلقائية.");
  add("provider_status",!db.settings?.orderSyncEnabled||realHttpProviders.every(p=>!!p.statusPath),"مسار مزامنة المزود","عند تفعيل المزامنة يجب ضبط Status Path لكل مزود HTTP فعال.");
  add("provider_secrets",realHttpProviders.every(p=>!p.secretEnv||!!process.env[p.secretEnv]),"أسرار المزودين","كل secretEnv لمزود فعال يجب أن يملك قيمة في بيئة التشغيل.");
  add("provider_webhook_secrets",realHttpProviders.every(p=>!p.webhookSecretEnv||!!process.env[p.webhookSecretEnv]),"أسرار Webhook للمزودين","كل webhookSecretEnv لمزود فعال يجب أن يملك قيمة في بيئة التشغيل.");
  const allowPrivateProd=String(process.env.ALLOW_PRODUCTION_PRIVATE_PROVIDER||"false").toLowerCase()==="true";
  const allowInsecureProd=String(process.env.ALLOW_PRODUCTION_INSECURE_PROVIDER||"false").toLowerCase()==="true";
  add("provider_private_network",allowPrivateProd||realHttpProviders.every(p=>p.allowPrivateNetwork!==true),"شبكات المزود الخاصة","يفضل منع private/loopback provider targets في الإنتاج.");
  add("provider_https",allowInsecureProd||realHttpProviders.every(p=>p.allowInsecureHttp!==true&&(!p.baseUrl||/^https:\/\//i.test(String(p.baseUrl)))),"HTTPS للمزودين","كل مزود حقيقي يجب أن يستخدم HTTPS إلا باستثناء إنتاج صريح.");

  add("auto_product_mapping",autoProducts.every(p=>{
    const provider=realHttpProviders.find(x=>x.id===p.providerPrimary);
    if(!provider||!provider.baseUrl||!provider.orderPath||!p.providerProductId)return false;
    try{
      const schema=sanitizeProductInputSchema(p.inputSchema,{fallbackLabel:p.inputLabel||"بيانات الطلب",allowLegacyFallback:p.inputSchema==null});
      sanitizeProviderInputMap(p.providerInputMap,schema);
      return schema.every((field,index)=>{
        if(!field.required)return true;
        if(p.providerInputMap?.[field.key]||provider.requestFields?.[`customerData.${field.key}`])return true;
        return index===0&&provider.requestFields?.customerInput!==null;
      });
    }catch{return false;}
  }),"ربط منتجات API","كل منتج Auto يحتاج مزود HTTP فعلي وProvider Product ID وربط حقول Player ID/Server ID المطلوبة مع API.");
  add("inventory_stock",inventoryProducts.every(p=>(db.inventoryCodes||[]).some(x=>x.productId===p.id&&x.status==="available")),"مخزون المنتجات الرقمية","كل منتج Inventory فعال يجب أن يملك كودًا متاحًا.");
  add("payments",(db.paymentMethods||[]).some(m=>m.active&&m.account&&!/not configured|يتم تحديد|غير مضبوط/i.test(String(m.account))),"طريقة دفع مضبوطة");
  add("no_demo_products",!activeProducts.some(p=>p.id==="gz-demo-code"||p.providerPrimary==="demo"),"تعطيل المنتجات التجريبية");
  add("inventory_encrypted",!(db.inventoryCodes||[]).some(x=>!x.encrypted&&x.status==="available"),"تشفير الأكواد المتاحة");
  const backupDir=process.env.BACKUP_DIR||path.join(__dirname,"backups"),backupStatus=readBackupStatus(backupDir),backupMaxAgeHours=Math.max(1,Number(process.env.BACKUP_MAX_AGE_HOURS||48)),backupState=backupHealth(backupStatus,{maxAgeHours:backupMaxAgeHours,dir:backupDir});
  add("backup_recent",process.env.NODE_ENV!=="production"||backupState.ok,"نسخة احتياطية حديثة",backupState.ok?`آخر نسخة قبل ${backupState.ageHours} ساعة`:`${backupState.reason||"backup_missing"} — الحد ${backupMaxAgeHours} ساعة`);
  return {ready:checks.every(x=>x.ok),checks};
}
app.get("/api/admin/readiness",adminOnly,(req,res)=>res.json(buildReadiness()));

function validateProductionConfig(){
  if(process.env.NODE_ENV!=="production")return;
  const required=["BOT_TOKEN","BOT_USERNAME","INTERNAL_BOT_SECRET","INTERNAL_BOT_ADMIN_SECRET","ADMIN_PASSWORD","ADMIN_SESSION_SECRET","USER_SESSION_SECRET","PROVIDER_WEBHOOK_SECRET","PAYMENT_WEBHOOK_SECRET","INVENTORY_ENCRYPTION_KEY","BACKUP_ENCRYPTION_KEY","AUDIT_HMAC_KEY","STATE_HMAC_KEY","FINANCIAL_JOURNAL_HMAC_KEY","WALLET_AUTHORITY_HMAC_KEY","BUSINESS_AUTHORITY_HMAC_KEY","ALLOWED_ORIGINS","PUBLIC_BASE_URL"];
  const missing=required.filter(k=>!process.env[k]);
  if(missing.length)throw new Error(`Missing production secrets: ${missing.join(", ")}`);
  if(String(process.env.ALLOW_LEGACY_ADMIN_KEY||"false").toLowerCase()==="true")throw new Error("ALLOW_LEGACY_ADMIN_KEY must be false in production");
  if(String(process.env.ALLOWED_ORIGINS||"").includes("*"))throw new Error("Wildcard ALLOWED_ORIGINS is not permitted in production");
  if(!/^https:\/\//i.test(String(process.env.PUBLIC_BASE_URL||"")))throw new Error("PUBLIC_BASE_URL must use https in production");
  const distinctSecrets=["INTERNAL_BOT_SECRET","INTERNAL_BOT_ADMIN_SECRET","ADMIN_SESSION_SECRET","USER_SESSION_SECRET","PROVIDER_WEBHOOK_SECRET","PAYMENT_WEBHOOK_SECRET","AUDIT_HMAC_KEY","STATE_HMAC_KEY","FINANCIAL_JOURNAL_HMAC_KEY","WALLET_AUTHORITY_HMAC_KEY","BUSINESS_AUTHORITY_HMAC_KEY","INVENTORY_ENCRYPTION_KEY","BACKUP_ENCRYPTION_KEY"].map(k=>String(process.env[k]||""));
  if(new Set(distinctSecrets).size!==distinctSecrets.length)throw new Error("Production security secrets must be distinct");
  if(String(process.env.AUDIT_HMAC_KEY||"").length<32)throw new Error("AUDIT_HMAC_KEY must be at least 32 characters");
  if(String(process.env.STATE_HMAC_KEY||"").length<32)throw new Error("STATE_HMAC_KEY must be at least 32 characters");
  if(String(process.env.FINANCIAL_JOURNAL_HMAC_KEY||"").length<32)throw new Error("FINANCIAL_JOURNAL_HMAC_KEY must be at least 32 characters");
  if(String(process.env.WALLET_AUTHORITY_HMAC_KEY||"").length<32)throw new Error("WALLET_AUTHORITY_HMAC_KEY must be at least 32 characters");
  if(String(process.env.BUSINESS_AUTHORITY_HMAC_KEY||"").length<32)throw new Error("BUSINESS_AUTHORITY_HMAC_KEY must be at least 32 characters");
  if(!decodeBackupKey(process.env.BACKUP_ENCRYPTION_KEY))throw new Error("BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes");
  if(safeEqualText(String(process.env.BACKUP_ENCRYPTION_KEY||""),String(process.env.INVENTORY_ENCRYPTION_KEY||"")))throw new Error("BACKUP_ENCRYPTION_KEY must differ from INVENTORY_ENCRYPTION_KEY");
  if(String(process.env.STORAGE_DRIVER||"json").toLowerCase()!=="postgres")throw new Error("Production Server requires STORAGE_DRIVER=postgres");
  if(String(process.env.PG_FINANCIAL_MIRROR||"true").toLowerCase()!=="true")throw new Error("PG_FINANCIAL_MIRROR must be true in production");
  if(String(process.env.PG_FINANCIAL_JOURNAL||"true").toLowerCase()!=="true")throw new Error("PG_FINANCIAL_JOURNAL must be true in production");
  if(String(process.env.PG_WALLET_AUTHORITY||"true").toLowerCase()!=="true")throw new Error("PG_WALLET_AUTHORITY must be true in production");
  if(String(process.env.PG_BUSINESS_AUTHORITY||"true").toLowerCase()!=="true")throw new Error("PG_BUSINESS_AUTHORITY must be true in production");
  if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is required for PostgreSQL storage");
  if(String(process.env.STORAGE_DRIVER||"json").toLowerCase()==="postgres"&&String(process.env.PG_SINGLE_INSTANCE_LOCK||"false").toLowerCase()!=="true")throw new Error("PG_SINGLE_INSTANCE_LOCK must be true for the production Server");
  const db=readDB();
  if(Number(db.schemaVersion||0)!==CURRENT_SCHEMA_VERSION)throw new Error(`Database schema version mismatch: ${db.schemaVersion||0} != ${CURRENT_SCHEMA_VERSION}`);
  if((db.inventoryCodes||[]).some(x=>!x.encrypted&&x.status==="available"))throw new Error("Production inventory contains unencrypted available codes");
  const activeHttpProviders=(db.providers||[]).filter(p=>p.active&&p.type==="http"&&p.id!=="demo");
  if(activeHttpProviders.some(p=>p.allowPrivateNetwork===true)&&String(process.env.ALLOW_PRODUCTION_PRIVATE_PROVIDER||"false").toLowerCase()!=="true")throw new Error("Production provider private-network access requires ALLOW_PRODUCTION_PRIVATE_PROVIDER=true");
  if(activeHttpProviders.some(p=>p.allowInsecureHttp===true||p.baseUrl&&!/^https:\/\//i.test(String(p.baseUrl)))&&String(process.env.ALLOW_PRODUCTION_INSECURE_PROVIDER||"false").toLowerCase()!=="true")throw new Error("Production providers must use HTTPS unless ALLOW_PRODUCTION_INSECURE_PROVIDER=true");

}
let stateVerifyTimer=null,stateVerifyRunning=false;
async function runStateVerification({notify=false}={}){
  if(stateVerifyRunning)return getStoreInfo();
  stateVerifyRunning=true;
  try{
    const result=await verifyPersistedState();
    if(!result.ok&&notify)notifyAdmins(`🚨 <b>فشل تحقق حالة PostgreSQL</b>\n${tgEsc(result.error||"state_verify_failed")}`);
    return result;
  }finally{stateVerifyRunning=false}
}
function startStateVerifier(){
  const interval=Math.max(60000,Number(process.env.STATE_VERIFY_INTERVAL_MS||300000));
  if(stateVerifyTimer)clearInterval(stateVerifyTimer);
  stateVerifyTimer=setInterval(()=>runStateVerification({notify:true}).catch(e=>console.error("State verifier error:",e.message)),interval);
  stateVerifyTimer.unref?.();
}

const PORT=Number(process.env.PORT||3000);
const SHUTDOWN_GRACE_MS=Math.max(1000,Number(process.env.SHUTDOWN_GRACE_MS||10000));
let httpServer=null,shuttingDown=false;
async function startServer(){
  const storage=await initStore();
  await prepareRuntimeData();
  const stateCheck=await runStateVerification({notify:false});
  if(!stateCheck.ok)throw new Error(`Persisted state verification failed: ${stateCheck.error||"unknown"}`);
  validateProductionConfig();
  startStateVerifier();
  scheduleNextSync();
  kickBroadcastWorker();
  runIntegrityMonitoring({notify:true});
  httpServer=app.listen(PORT,()=>console.log(`Game Zone v1.0 RC20 running at http://localhost:${PORT} [storage=${storage.driver}]`));
}
async function shutdown(signal){
  if(shuttingDown)return;
  shuttingDown=true;
  console.log(`Game Zone shutdown requested: ${signal}`);
  try{
    if(syncTimer)clearTimeout(syncTimer);
    if(stateVerifyTimer)clearInterval(stateVerifyTimer);
    clearInterval(rateCleanup);
    if(httpServer){
      const closePromise=new Promise(resolve=>httpServer.close(resolve));
      const timeoutPromise=new Promise(resolve=>setTimeout(resolve,SHUTDOWN_GRACE_MS,"timeout"));
      const result=await Promise.race([closePromise.then(()=>"closed"),timeoutPromise]);
      if(result==="timeout"){
        console.warn("HTTP graceful shutdown timed out; closing remaining connections");
        try{httpServer.closeIdleConnections?.();}catch{}
        try{httpServer.closeAllConnections?.();}catch{}
      }
    }
    await closeStore();
  }catch(e){
    console.error("Shutdown error:",e);
  }finally{process.exit(0);}
}
process.once("SIGINT",()=>shutdown("SIGINT"));
process.once("SIGTERM",()=>shutdown("SIGTERM"));
startServer().catch(err=>{console.error("Game Zone startup failed:",err);process.exit(1);});
