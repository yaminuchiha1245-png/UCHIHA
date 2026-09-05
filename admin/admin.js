const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const preview=!/^https?:$/.test(location.protocol);
let adminToken=localStorage.getItem("gamezone_admin_token")||"",data={};
const filters={orders:"",orderStatus:"",products:"",productDelivery:"",topups:"",topupStatus:"",users:"",support:"",supportStatus:""};
const norm=v=>String(v??"").toLowerCase().trim();


const mock={
 dashboard:{users:128,products:35,categories:6,orders:421,completedOrders:398,pendingTopups:6,openTickets:3,revenue:3874.25,profit:641.8,providers:3,failedProviderCalls:4,inventoryAvailable:3,inventoryLowStockProducts:1,integrityCritical:0,integrityWarnings:1},
 categories:[
  {id:"games",name:"شحن الألعاب",icon:"",imageUrl:null,parentId:null,description:"",sort:1,active:true},
  {id:"digital-cards",name:"البطاقات الرقمية",icon:"",imageUrl:null,parentId:null,description:"",sort:2,active:true},
  {id:"pubg",name:"PUBG Mobile",icon:"",imageUrl:null,parentId:"games",description:"",sort:1,active:true},
  {id:"freefire",name:"Free Fire",icon:"",imageUrl:null,parentId:"games",description:"",sort:2,active:true},
  {id:"steam",name:"Steam",icon:"",imageUrl:null,parentId:"digital-cards",description:"",sort:1,active:true}
 ],
 products:[
  {id:"pubg-60",name:"60 UC",categoryId:"pubg",imageUrl:null,price:.99,cost:.8,profit:.19,inputLabel:"Player ID",inputSchema:[{key:"playerId",label:"Player ID",type:"text",required:true,maxLength:64}],providerInputMap:{playerId:"player_id"},providerPrimary:"demo",providerBackup:"manual",delivery:"auto",deliveryText:"فوري",active:true,featured:false},
  {id:"steam-10",name:"Steam $10",categoryId:"steam",imageUrl:null,price:10.3,cost:10,profit:.3,providerPrimary:"manual",providerBackup:null,delivery:"manual",deliveryText:"ضمن أوقات العمل",active:true,featured:false},
  {id:"gz-demo-code",name:"Game Zone — كود رقمي تجريبي",categoryId:"offers",price:1.5,cost:.5,profit:1,providerPrimary:"inventory",providerBackup:null,delivery:"inventory",stock:3,active:true,featured:true}
 ],
 orders:[
  {id:"o1",orderNo:"GZ-38194211",telegramId:"8120730186",productName:"PUBG Mobile — 325 UC",finalPrice:5.35,profit:.65,status:"completed",providerUsed:"demo",createdAt:new Date().toISOString()},
  {id:"o2",orderNo:"GZ-38194004",telegramId:"99112008",productName:"Google Play $10",finalPrice:10.8,profit:.8,status:"processing",providerUsed:"manual",createdAt:new Date(Date.now()-5000000).toISOString()}
 ],
 topups:[{id:"topup_preview_1",telegramId:"8120730186",amount:20,status:"pending",method:"manual",receiptUploaded:true,receiptUploadedAt:new Date().toISOString(),createdAt:new Date().toISOString()}],
 users:[{telegramId:"8120730186",username:"gamezone_user",firstName:"مستخدم Game Zone",balance:25,currency:"USD"},{telegramId:"99112008",username:"player_one",firstName:"Player",balance:7.4,currency:"USD"}],
 profits:{totals:{revenue:3874.25,cost:3232.45,profit:641.8},rows:[{orderNo:"GZ-38194211",productName:"PUBG Mobile — 325 UC",revenue:5.35,cost:4.7,profit:.65,createdAt:new Date().toISOString()}]},
 coupons:[{code:"GZ10",type:"percent",value:10,maxDiscount:5,active:true,uses:12,maxUses:100,maxUsesPerUser:1}],
 providers:[
  {id:"demo",name:"Demo Provider",type:"demo",active:true,priority:1,timeoutMs:12000,secretEnv:null,baseUrl:null,orderPath:null},
  {id:"manual",name:"Manual Fulfillment",type:"manual",active:true,priority:99,timeoutMs:12000,secretEnv:null,baseUrl:null,orderPath:null,statusPath:null},
  {id:"inventory",name:"Digital Inventory",type:"inventory",active:true,priority:0,timeoutMs:1000,secretEnv:null,baseUrl:null,orderPath:null,statusPath:null}
 ],
 providerLogs:[
  {id:"l1",providerId:"demo",orderNo:"GZ-38194211",ok:true,durationMs:184,status:"completed",createdAt:new Date().toISOString()},
  {id:"l2",providerId:"supplier-x",orderNo:"GZ-38194004",ok:false,durationMs:12003,error:"timeout",createdAt:new Date(Date.now()-3000000).toISOString()}
 ],
 payments:[
  {id:"manual",name:"تحويل يدوي",icon:"",imageUrl:null,active:true,sort:1,instructions:"حوّل المبلغ ثم ارفع صورة الإيصال.",account:"حساب Game Zone التجريبي",requiresReference:true,minAmount:1,maxAmount:1000},
  {id:"usdt",name:"USDT",icon:"",imageUrl:null,active:false,sort:2,instructions:"أرسل USDT ثم ارفع صورة الإيصال وأدخل TXID.",account:"غير مضبوط",requiresReference:true,minAmount:5,maxAmount:5000}
 ],
 syncWorker:{ok:true,runtime:{running:false,lastRunAt:new Date(Date.now()-60000).toISOString(),lastFinishedAt:new Date(Date.now()-59000).toISOString(),lastScanned:4,lastUpdated:1,lastErrors:0,lastError:null,nextRunAt:new Date(Date.now()+60000).toISOString()},settings:{enabled:true,intervalMs:60000,batchSize:10}},
 maintenance:{ok:true,runtime:{lastRunAt:new Date(Date.now()-3600000).toISOString(),lastRemoved:{notifications:2,providerLogs:4,audit:0,security:0,devicePairs:1,deletedAccounts:0},lastError:null},settings:{notificationRetentionDays:180,providerLogRetentionDays:90,auditRetentionDays:365}},
 storage:{ok:true,storage:{driver:"postgres",initialized:true,postgresConnected:true,lastPersistAt:new Date().toISOString(),lastPersistError:null,singleInstanceLockRequired:true,singleInstanceLockAcquired:true,stateRevision:42,stateDataSha256:"9d1d8bff02a94ce2b6d2c84d7340f2c4d89c0afbcdeffeed1234567890abcdef",stateHmacPresent:true,lastStateVerifyAt:new Date().toISOString(),lastStateVerifyError:null,stateHistoryPruned:3,financialMirrorEnabled:true,financialMirrorRevision:42,lastFinancialMirrorAt:new Date().toISOString(),lastFinancialMirrorVerifyAt:new Date().toISOString(),lastFinancialMirrorError:null,financialJournalEnabled:true,financialJournalEntries:688,financialJournalCutoverRevision:38,financialJournalLastStateRevision:42,lastFinancialJournalVerifyAt:new Date().toISOString(),lastFinancialJournalError:null,walletAuthorityEnabled:true,walletAuthorityCutoverRevision:38,walletAuthorityLastStateRevision:42,walletAuthorityAccountCount:128,walletAuthorityActiveAccountCount:128,walletAuthorityTotalBalance:2487.5,lastWalletAuthorityVerifyAt:new Date().toISOString(),lastWalletAuthorityError:null,businessAuthorityEnabled:true,businessAuthorityCutoverRevision:39,businessAuthorityLastStateRevision:42,businessAuthorityOrderCount:412,businessAuthorityTopupCount:91,lastBusinessAuthorityVerifyAt:new Date().toISOString(),lastBusinessAuthorityError:null}},
 financialMirror:{ok:true,enabled:true,verifiedAt:new Date().toISOString(),actual:{stateRevision:42,counts:{users:128,orders:412,transactions:688,topups:91},totals:{userBalances:2487.5,transactionAmounts:9234.1,topupAmounts:5180,orderRevenue:6746.6},digests:{users:"u",orders:"o",transactions:"t",topups:"p"},updatedAt:new Date().toISOString()},errors:[]},
 financialJournal:{ok:true,enabled:true,entryCount:688,currentStateTransactions:688,cutoverRevision:38,lastStateRevision:42,updatedAt:new Date().toISOString(),verifiedAt:new Date().toISOString(),errors:[]},
 walletAuthority:{ok:true,enabled:true,stateRevision:42,cutoverRevision:38,accountCount:128,activeAccountCount:128,totalBalance:2487.5,digest:"wallet-preview-digest",updatedAt:new Date().toISOString(),verifiedAt:new Date().toISOString(),errors:[]},
 businessAuthority:{ok:true,enabled:true,stateRevision:42,cutoverRevision:39,orderCount:412,topupCount:91,orderDigest:"order-authority-preview",topupDigest:"topup-authority-preview",updatedAt:new Date().toISOString(),verifiedAt:new Date().toISOString(),errors:[]},
 storageHistory:{ok:true,history:[
   {revision:41,dataSha256:"aa11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900",hmacPresent:true,createdAt:new Date(Date.now()-3600000).toISOString(),dataBytes:245810},
   {revision:40,dataSha256:"bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900aa11",hmacPresent:true,createdAt:new Date(Date.now()-7200000).toISOString(),dataBytes:244901}
 ]},
 backups:{ok:true,status:{ok:true,completedAt:new Date(Date.now()-2*3600000).toISOString(),file:"game-zone-preview.json",verified:true,dataSha256:"preview-sha256"},health:{ok:true,ageHours:2},maxAgeHours:48,files:[{name:"game-zone-preview.json",type:"backup",size:45821,modifiedAt:new Date(Date.now()-2*3600000).toISOString()}]},
 schema:{ok:true,currentSchemaVersion:7,databaseSchemaVersion:7,migrationMeta:{schemaMigratedAt:new Date().toISOString(),schemaMigratedFrom:5}},
 locks:{ok:true,timeoutMs:30000,locks:{activeKeys:0,waiting:0,acquired:42,released:42,timedOut:0,maxWaiting:1}},
 adminSession:{ok:true,admin:{subject:"admin",role:"owner",issuedAt:Math.floor(Date.now()/1000)-60,expiresAt:Math.floor(Date.now()/1000)+36000,sessionVersion:1}},
 integrity:{ok:true,scannedAt:new Date().toISOString(),counts:{critical:0,warning:1,info:0},total:1,issues:[{code:"coupon_counter_mismatch",severity:"warning",message:"مثال معاينة: عداد كوبون يحتاج مزامنة.",repairable:true}]},
 readiness:{ready:false,checks:[
  {id:"storage",ok:true,label:"PostgreSQL",detail:""},
  {id:"state_integrity",ok:true,label:"سلامة Snapshot PostgreSQL",detail:"revision 42 / 9d1d8bff02a9"},
  {id:"state_hmac",ok:true,label:"HMAC لحالة PostgreSQL",detail:""},
  {id:"financial_journal",ok:true,label:"السجل المالي",detail:"688 entries / revision 42"},
  {id:"wallet_authority",ok:true,label:"سلطة الرصيد في PostgreSQL",detail:"128 accounts / $2487.50 / revision 42"},
  {id:"business_authority",ok:true,label:"سلطة الطلبات والشحن في PostgreSQL",detail:"412 orders / 91 topups / revision 42"},
  {id:"bot_token",ok:true,label:"Telegram Bot Token",detail:""},
  {id:"bot_username",ok:true,label:"BOT_USERNAME",detail:""},
  {id:"admin_secret",ok:true,label:"حماية الإدارة",detail:""},
  {id:"user_secret",ok:true,label:"جلسات المستخدمين",detail:""},
  {id:"inventory_key",ok:true,label:"تشفير المخزون",detail:""},
  {id:"providers",ok:false,label:"مزود تنفيذ فعلي",detail:"أدخل مزود API الحقيقي قبل الإطلاق."},
  {id:"payments",ok:false,label:"طريقة دفع مضبوطة",detail:"أدخل حساب الدفع الحقيقي."},
  {id:"no_demo_products",ok:false,label:"تعطيل المنتجات التجريبية",detail:""}
 ]},
 announcements:[{id:"ann1",title:"مرحبًا بك في Game Zone",body:"تابع العروض والمنتجات الجديدة.",type:"info",active:true,sort:1}],
 verification:[{id:"verify_preview_1",telegramId:"8120730186",status:"pending",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),reviewedAt:null,rejectionReason:null}],
 support:[{id:"ticket_1",telegramId:"8120730186",subject:"مشكلة في طلب",message:"أحتاج متابعة الطلب.",status:"open",createdAt:new Date().toISOString()}],
 broadcasts:[{id:"br1",title:"Game Zone",message:"عرض جديد!",audience:"all",total:128,sent:126,failed:2,processed:128,status:"completed",createdAt:new Date().toISOString(),finishedAt:new Date().toISOString()}],
 settings:{storeName:"Game Zone",tagline:"متجر المنتجات الرقمية",maintenance:false,maintenanceMessage:"المتجر تحت الصيانة",minTopup:1,maxTopup:1000,showAnnouncements:true,orderSyncEnabled:true,orderSyncIntervalMs:60000,orderSyncBatchSize:10,currencies:[{code:"USD",name:"دولار أمريكي",symbol:"$",enabled:true,rate:1},{code:"EUR",name:"يورو",symbol:"€",enabled:false,rate:.92},{code:"TRY",name:"ليرة تركية",symbol:"₺",enabled:false,rate:41},{code:"SYP",name:"ليرة سورية",symbol:"ل.س",enabled:false,rate:10000}]},
 inventorySummary:[{productId:"gz-demo-code",productName:"Game Zone — كود رقمي تجريبي",available:3,delivered:0,total:3}],
 inventory:[
  {id:"inv_demo_1",productId:"gz-demo-code",status:"available",orderNo:null,masked:"GZ-************026",encrypted:false,createdAt:new Date().toISOString()},
  {id:"inv_demo_2",productId:"gz-demo-code",status:"available",orderNo:null,masked:"GZ-************026",encrypted:false,createdAt:new Date().toISOString()},
  {id:"inv_demo_3",productId:"gz-demo-code",status:"available",orderNo:null,masked:"GZ-************026",encrypted:false,createdAt:new Date().toISOString()}
 ],
 security:[{id:"sec1",type:"admin_login_success",ip:"preview",createdAt:new Date().toISOString()}],
 audit:[{id:"a1",action:"product_update",meta:{productId:"pubg-60"},createdAt:new Date().toISOString()}]
};
async function api(path,options={}){
 if(preview){
  if(path.includes("sync-worker/run")){mock.syncWorker.runtime.lastRunAt=new Date().toISOString();mock.syncWorker.runtime.lastFinishedAt=new Date().toISOString();mock.syncWorker.runtime.lastScanned=3;mock.syncWorker.runtime.lastUpdated=1;return mock.syncWorker}
  if(path.includes("sync-worker"))return mock.syncWorker;
  if(path.includes("/maintenance/run")){mock.maintenance.runtime.lastRunAt=new Date().toISOString();return {...mock.maintenance,removed:mock.maintenance.runtime.lastRemoved}}
  if(path.includes("/maintenance"))return mock.maintenance;
  if(path.includes("/integrity/reconcile-wallets")){mock.integrity={ok:true,scannedAt:new Date().toISOString(),counts:{critical:0,warning:0,info:0},total:0,issues:[]};return {ok:true,result:{count:0,changes:[]},integrity:mock.integrity}}
  if(path.includes("/integrity/repair-safe")){mock.integrity={ok:true,scannedAt:new Date().toISOString(),counts:{critical:0,warning:0,info:0},total:0,issues:[]};return {ok:true,result:{count:1,changes:[{type:"coupon_counter"}]},integrity:mock.integrity}}
  if(path.includes("/integrity"))return mock.integrity;
  if(path.includes("/schema"))return mock.schema;if(path.includes("/locks"))return mock.locks;
  if(path.includes("/backups"))return mock.backups;
  if(path==="/api/admin/session")return mock.adminSession;
  if(path.includes("/readiness"))return mock.readiness;
  if(path.includes("/storage/financial-mirror"))return mock.financialMirror;
  if(path.includes("/storage/financial-journal"))return mock.financialJournal;
  if(path.includes("/storage/wallet-authority"))return mock.walletAuthority;
  if(path.includes("/storage/business-authority"))return mock.businessAuthority;
  if(path.includes("/storage/history"))return mock.storageHistory;
  if(path.includes("/storage/verify"))return {ok:true,current:{ok:true,driver:"postgres",revision:mock.storage.storage.stateRevision,dataSha256:mock.storage.storage.stateDataSha256,verifiedAt:new Date().toISOString()},history:{ok:true,checked:2,errors:[]}};
  if(path.includes("/storage/flush"))return mock.storage;if(path.includes("/storage"))return mock.storage;
  if(path.includes("inventory/summary"))return mock.inventorySummary;if(path.includes("/inventory"))return mock.inventory;if(path.includes("security-events"))return mock.security;
  if(path.includes("dashboard"))return mock.dashboard;if(path.includes("categories"))return mock.categories;if(path.includes("products"))return mock.products;if(path.includes("orders"))return mock.orders;
  if(path.includes("topups"))return mock.topups;if(path.includes("users"))return mock.users;if(path.includes("profits"))return mock.profits;
  if(path.includes("coupons"))return mock.coupons;if(path.includes("provider-logs"))return mock.providerLogs;if(path.includes("providers"))return mock.providers;
  if(path.includes("payment-methods"))return mock.payments;if(path.includes("announcements"))return mock.announcements;if(path.includes("verifications"))return mock.verification;if(path.includes("support-tickets"))return mock.support;if(path.includes("broadcasts"))return mock.broadcasts;if(path.includes("/settings"))return mock.settings;if(path.includes("audit"))return mock.audit;return {ok:true};
 }
 const headers={"content-type":"application/json",...(adminToken?{authorization:`Bearer ${adminToken}`}:{}) ,...(options.headers||{})};
 const r=await fetch(path,{...options,headers});
 const d=await r.json().catch(()=>({}));
 if(r.status===401&&path!=="/api/admin/login"){showLogin("انتهت جلسة الإدارة أو لم يتم تسجيل الدخول.");throw new Error("admin_unauthorized")}
 if(!r.ok)throw new Error(d.error||"request_failed");return d;
}
function showLogin(msg=""){$("#loginGate")?.classList.remove("hidden");if($("#loginMsg"))$("#loginMsg").textContent=msg}
function hideLogin(){$("#loginGate")?.classList.add("hidden");if($("#loginMsg"))$("#loginMsg").textContent=""}
async function loginAdmin(){
 if(preview){adminToken="preview";hideLogin();return load()}
 const password=$("#adminPassword")?.value||"";if(!password)return showLogin("أدخل كلمة مرور الإدارة.");
 try{
  const r=await fetch("/api/admin/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password})});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"login_failed");
  adminToken=d.token;localStorage.setItem("gamezone_admin_token",adminToken);$("#adminPassword").value="";hideLogin();await load();toast("تم تسجيل الدخول بنجاح");
 }catch(e){showLogin("كلمة المرور غير صحيحة أو تعذر تسجيل الدخول.")}
}
const money=v=>"$"+Number(v||0).toFixed(2);
function esc(v){
  return String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
}
const attr=esc;
const safeJson=v=>esc(JSON.stringify(v??{}));
function toast(t){const e=$("#toast");e.textContent=t;e.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("show"),2300)}
async function readFileAsDataUrl(file,maxBytes=2*1024*1024){
 if(!file)return null;if(file.size>maxBytes)throw new Error("image_too_large");
 if(!/^image\/(jpeg|png|webp)$/i.test(file.type||""))throw new Error("invalid_image_type");
 return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error("image_read_failed"));r.readAsDataURL(file)});
}
async function uploadAdminImage(file,purpose){
 if(!file)return null;const dataUrl=await readFileAsDataUrl(file);
 if(preview)return dataUrl;
 const r=await api("/api/admin/assets",{method:"POST",body:JSON.stringify({dataUrl,purpose})});return r.url;
}
function imageCell(item,label="صورة"){
 return item?.imageUrl?`<img class="admin-thumb" src="${attr(item.imageUrl)}" alt="">`:`<span class="admin-thumb admin-thumb-empty">${esc(label)}</span>`;
}
function pill(s){const cls=["completed","approved","available","delivered","closed"].includes(s)?"ok":["failed","rejected","disabled"].includes(s)?"bad":"warn";return `<span class="pill ${cls}">${esc(s)}</span>`}
function rowEmpty(n=5){return `<tr><td colspan="${n}">لا توجد بيانات</td></tr>`}
async function load(){
 try{
  const [dashboard,categories,products,orders,topups,users,profits,coupons,providers,providerLogs,payments,announcements,verification,support,broadcasts,settings,audit,inventorySummary,inventory,security,syncWorker,maintenance,integrity,schema,locks,adminSession,backups,storage,financialMirror,financialJournal,walletAuthority,businessAuthority,storageHistory,readiness]=await Promise.all([
   api("/api/admin/dashboard"),api("/api/admin/categories"),api("/api/admin/products"),api("/api/admin/orders"),api("/api/admin/topups"),api("/api/admin/users"),
   api("/api/admin/profits"),api("/api/admin/coupons"),api("/api/admin/providers"),api("/api/admin/provider-logs"),api("/api/admin/payment-methods"),
   api("/api/admin/announcements"),api("/api/admin/verifications"),api("/api/admin/support-tickets"),api("/api/admin/broadcasts"),api("/api/admin/settings"),api("/api/admin/audit"),
   api("/api/admin/inventory/summary"),api("/api/admin/inventory"),api("/api/admin/security-events"),api("/api/admin/sync-worker"),api("/api/admin/maintenance"),api("/api/admin/integrity"),api("/api/admin/schema"),api("/api/admin/locks"),api("/api/admin/session"),api("/api/admin/backups"),api("/api/admin/storage"),api("/api/admin/storage/financial-mirror"),api("/api/admin/storage/financial-journal"),api("/api/admin/storage/wallet-authority"),api("/api/admin/storage/business-authority"),api("/api/admin/storage/history"),api("/api/admin/readiness")
  ]);
  data={dashboard,categories,products,orders,topups,users,profits,coupons,providers,providerLogs,payments,announcements,verification,support,broadcasts,settings,audit,inventorySummary,inventory,security,syncWorker,maintenance,integrity,schema,locks,adminSession,backups,storage,financialMirror,financialJournal,walletAuthority,businessAuthority,storageHistory,readiness};renderAll();if(preview)toast("وضع معاينة لوحة الإدارة Game Zone RC20");
 }catch(e){toast("تحقق من مفتاح الإدارة");console.error(e)}
}
function renderAll(){renderDashboard();renderOrders();renderProducts();renderInventory();renderCategories();renderTopups();renderUsers();renderVerification();renderProfits();renderCoupons();renderProviders();renderProviderLogs();renderPayments();renderOperations();renderAnnouncements();renderSupport();renderBroadcasts();renderSettings();renderAudit();renderSecurity()}
function renderDashboard(){
 const d=data.dashboard||{};
 $("#stats").innerHTML=[
  ["المستخدمون",d.users,"حساب"],["الأقسام",d.categories||0,"قسم"],["الطلبات",d.orders,`${d.completedOrders||0} مكتمل`],
  ["الإيرادات",money(d.revenue),"إجمالي المبيعات"],["صافي الربح",money(d.profit),`${d.pendingTopups||0} شحن معلق`],
  ["الدعم",d.openTickets||0,"تذكرة مفتوحة"],["مراجعة المورد",d.providerReviewOrders||0,"طلب غير مؤكد"],["سلامة البيانات",d.integrityCritical||0,`${d.integrityWarnings||0} تحذير`],["مزودو API",d.providers||0,"فعال"],["أخطاء API",d.failedProviderCalls||0,"مسجلة"],
  ["الأكواد المتاحة",d.inventoryAvailable||0,`${d.inventoryLowStockProducts||0} مخزون منخفض`]
 ].map(x=>`<div class="stat"><span>${esc(x[0])}</span><strong>${esc(x[1])}</strong><i>${esc(x[2])}</i></div>`).join("");
 const os=(data.orders||[]).slice(0,5);
 $("#quickOrders").innerHTML=`<table><thead><tr><th>الطلب</th><th>المنتج</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>${os.map(o=>`<tr><td>${esc(o.orderNo)}</td><td>${esc(o.productName)}</td><td>${money(o.finalPrice)}</td><td>${pill(o.status)}</td></tr>`).join("")||rowEmpty(4)}</tbody></table>`;
}
function renderOrders(){
 let os=data.orders||[];
 const q=norm(filters.orders);if(q)os=os.filter(o=>norm(`${o.orderNo} ${o.telegramId} ${o.productName}`).includes(q));
 if(filters.orderStatus==="review")os=os.filter(o=>o.requiresManualReview);
 else if(filters.orderStatus)os=os.filter(o=>o.status===filters.orderStatus);
 $("#ordersTable").innerHTML=`<table><thead><tr><th>الطلب</th><th>المستخدم</th><th>المنتج</th><th>المبلغ</th><th>الربح</th><th>المزود</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${os.map(o=>`<tr><td><button data-action="order-detail" data-id="${attr(o.id)}">${esc(o.orderNo)}</button></td><td>${esc(o.telegramId)}</td><td>${esc(o.productName)}</td><td>${money(o.finalPrice)}</td><td>${money(o.profit)}</td><td>${esc(o.providerUsed||"-")}</td><td>${pill(o.status)}${o.requiresManualReview?'<br><span class="review-flag">⚠ مراجعة المورد</span>':""}</td><td><div class="actions"><button data-action="set-order" data-id="${attr(o.id)}" data-status="completed">مكتمل</button><button data-action="set-order" data-id="${attr(o.id)}" data-status="processing">معالجة</button>${(o.providerUsed==="manual"||o.providerPrimary==="manual")&&["pending","processing"].includes(o.status)&&!o.manualFulfillmentStartedAt?`<button class="primary" data-action="manual-start" data-id="${attr(o.id)}">بدء يدوي</button>`:""}<button class="danger" data-action="set-order" data-id="${attr(o.id)}" data-status="failed">فشل</button>${o.providerOrderId?`<button data-action="sync-order" data-id="${attr(o.id)}">مزامنة</button>`:""}</div></td></tr>`).join("")||rowEmpty(8)}</tbody></table>`;
}
function renderProducts(){
 let ps=data.products||[];
 const q=norm(filters.products);if(q)ps=ps.filter(p=>norm(`${p.name} ${p.id} ${p.categoryId} ${p.providerPrimary||""}`).includes(q));
 if(filters.productDelivery)ps=ps.filter(p=>(p.delivery||"manual")===filters.productDelivery);
 $("#productsTable").innerHTML=`<table><thead><tr><th>المنتج</th><th>القسم</th><th>السعر</th><th>التكلفة</th><th>الربح</th><th>التسليم</th><th>الأساسي</th><th>الاحتياطي</th><th>الحالة</th><th>تعديل</th></tr></thead><tbody>${ps.map(p=>`<tr><td><b>${esc(p.name)}</b>${p.delivery==="inventory"?`<br><small class="${Number(p.stock||0)<=3?"stock-low":"stock-ok"}">المخزون: ${Number(p.stock??0)}</small>`:""}</td><td>${esc(p.categoryId)}</td><td>${money(p.price)}</td><td>${money(p.cost)}</td><td>${money(p.profit??(p.price-p.cost))}</td><td>${esc(p.delivery||"manual")}</td><td>${esc(p.providerPrimary||"-")}</td><td>${esc(p.providerBackup||"-")}</td><td>${p.active?'<span class="pill ok">فعال</span>':'<span class="pill bad">متوقف</span>'}</td><td><button data-action="edit-product" data-id="${attr(p.id)}">تعديل</button></td></tr>`).join("")||rowEmpty(10)}</tbody></table>`;
}
function renderTopups(){
 let ts=data.topups||[];
 const q=norm(filters.topups);if(q)ts=ts.filter(t=>norm(`${t.id} ${t.telegramId} ${t.reference||""} ${t.method||""}`).includes(q));
 if(filters.topupStatus)ts=ts.filter(t=>t.status===filters.topupStatus);
 $("#topupsTable").innerHTML=`<table><thead><tr><th>ID</th><th>المستخدم</th><th>المبلغ</th><th>الطريقة</th><th>المرجع</th><th>الإيصال</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${ts.map(t=>`<tr><td>${esc(t.id)}</td><td>${esc(t.telegramId)}</td><td>${money(t.amount)}</td><td>${esc(t.method)}</td><td>${esc(t.reference||"-")}</td><td>${t.receiptUploaded?`<button data-action="receipt-topup" data-id="${attr(t.id)}">عرض الإيصال</button>`:"-"}</td><td>${pill(t.status)}</td><td>${t.status==="pending"?`<div class="actions"><button class="primary" data-action="topup" data-id="${attr(t.id)}" data-topup-action="approve">قبول</button><button class="danger" data-action="topup" data-id="${attr(t.id)}" data-topup-action="reject">رفض</button></div>`:"-"}</td></tr>`).join("")||rowEmpty(8)}</tbody></table>`;
}
function renderUsers(){
 let us=data.users||[];
 const q=norm(filters.users);if(q)us=us.filter(u=>norm(`${u.telegramId} ${u.firstName||""} ${u.lastName||""} ${u.username||""}`).includes(q));
 $("#usersTable").innerHTML=`<table><thead><tr><th>ID</th><th>الاسم</th><th>المعرف</th><th>الرصيد</th><th>إجراء</th></tr></thead><tbody>${us.map(u=>`<tr><td><button data-action="user-detail" data-id="${attr(u.telegramId)}">${esc(u.telegramId)}</button></td><td>${esc(u.firstName||"-")}</td><td>${esc(u.username?"@"+u.username:"-")}</td><td>${money(u.balance)}</td><td><div class="actions"><button data-action="balance" data-id="${attr(u.telegramId)}" data-plus="1">＋ رصيد</button><button data-action="balance" data-id="${attr(u.telegramId)}" data-plus="0">− رصيد</button></div></td></tr>`).join("")||rowEmpty(5)}</tbody></table>`;
}
function renderProfits(){
 const p=data.profits||{totals:{},rows:[]},t=p.totals||{};
 $("#profitStats").innerHTML=[["الإيرادات",money(t.revenue)],["التكلفة",money(t.cost)],["صافي الربح",money(t.profit)]].map(x=>`<div class="stat"><span>${esc(x[0])}</span><strong>${esc(x[1])}</strong></div>`).join("");
 $("#profitsTable").innerHTML=`<table><thead><tr><th>الطلب</th><th>المنتج</th><th>الإيراد</th><th>التكلفة</th><th>الربح</th></tr></thead><tbody>${(p.rows||[]).map(r=>`<tr><td>${esc(r.orderNo)}</td><td>${esc(r.productName)}</td><td>${money(r.revenue)}</td><td>${money(r.cost)}</td><td>${money(r.profit)}</td></tr>`).join("")||rowEmpty(5)}</tbody></table>`;
}
function renderCoupons(){
 const cs=data.coupons||[];
 $("#couponsTable").innerHTML=`<table><thead><tr><th>الكود</th><th>النوع</th><th>القيمة</th><th>الاستخدام</th><th>لكل مستخدم</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${cs.map(c=>`<tr><td><b>${esc(c.code)}</b></td><td>${esc(c.type)}</td><td>${esc(c.value)}${c.type==="percent"?"%":"$"}</td><td>${Number(c.uses||0)}/${esc(c.maxUses||"∞")}</td><td>${esc(c.maxUsesPerUser||"∞")}</td><td>${c.active?'<span class="pill ok">فعال</span>':'<span class="pill bad">متوقف</span>'}</td><td><button data-action="edit-coupon" data-id="${attr(c.code)}">تعديل</button></td></tr>`).join("")||rowEmpty(7)}</tbody></table>`;
}
function renderProviders(){
 const ps=data.providers||[];
 $("#providersTable").innerHTML=`<table><thead><tr><th>المزود</th><th>النوع</th><th>الأولوية</th><th>Timeout</th><th>Secret ENV</th><th>الحالة</th><th>اختبار</th><th>إجراء</th></tr></thead><tbody>${ps.map(p=>`<tr><td><span class="provider-dot ${p.active?"":"off"}"></span><b>${esc(p.name)}</b><br><small>${esc(p.id)}</small></td><td>${esc(p.type)}</td><td>${Number(p.priority||0)}</td><td>${Number(p.timeoutMs||0)}ms</td><td>${esc(p.secretEnv||"-")}</td><td>${p.active?'<span class="pill ok">فعال</span>':'<span class="pill bad">متوقف</span>'}</td><td><button data-action="test-provider" data-id="${attr(p.id)}">اختبار</button></td><td><button data-action="edit-provider" data-id="${attr(p.id)}">تعديل</button></td></tr>`).join("")||rowEmpty(8)}</tbody></table>`;
}
function renderProviderLogs(){
 const ls=data.providerLogs||[];
 $("#providerLogsTable").innerHTML=`<table><thead><tr><th>الوقت</th><th>المزود</th><th>الطلب</th><th>المدة</th><th>النتيجة</th><th>الخطأ</th></tr></thead><tbody>${ls.map(l=>`<tr><td>${new Date(l.createdAt).toLocaleString("ar")}</td><td>${esc(l.providerId)}</td><td>${esc(l.orderNo||"-")}</td><td>${Number(l.durationMs||0)}ms</td><td>${l.ok?'<span class="pill ok">نجاح</span>':'<span class="pill bad">فشل</span>'}</td><td>${esc(l.error||l.status||"-")}</td></tr>`).join("")||rowEmpty(6)}</tbody></table>`;
}
function renderPayments(){
 const ms=data.payments||[];
 $("#paymentsTable").innerHTML=`<table><thead><tr><th>الصورة</th><th>الطريقة</th><th>ID</th><th>الحساب</th><th>الحدود</th><th>المرجع</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${ms.map(m=>`<tr><td>${imageCell(m,"فارغة")}</td><td><b>${esc(m.name)}</b><br><small>${esc(m.instructions||"")}</small></td><td>${esc(m.id)}</td><td>${esc(m.account||"-")}</td><td>${money(m.minAmount||0)} — ${money(m.maxAmount||0)}</td><td>${m.requiresReference?"مطلوب":"اختياري"}</td><td>${m.active?'<span class="pill ok">فعال</span>':'<span class="pill bad">متوقف</span>'}</td><td><div class="actions"><button data-action="edit-payment" data-id="${attr(m.id)}">تعديل</button><button data-action="toggle-payment" data-id="${attr(m.id)}" data-active="${m.active?"0":"1"}">${m.active?"تعطيل":"تفعيل"}</button></div></td></tr>`).join("")||rowEmpty(8)}</tbody></table>`;
}
function renderOperations(){
 const sw=data.syncWorker||{},r=sw.runtime||{},st=(data.storage||{}).storage||{},schema=data.schema||{},lk=(data.locks||{}).locks||{};
 $("#operationsStats").innerHTML=[
  ["المزامنة",r.running?"تعمل":"جاهزة",`${r.lastUpdated||0} تحديث آخر مرة`],
  ["طلبات مفحوصة",r.lastScanned||0,`${r.lastErrors||0} أخطاء`],
  ["التخزين",st.driver||"-",st.postgresConnected?"PostgreSQL متصل":"وضع محلي"],
  ["Schema",`${schema.databaseSchemaVersion||0}/${schema.currentSchemaVersion||0}`,schema.databaseSchemaVersion===schema.currentSchemaVersion?"محدث":"يحتاج ترقية"],
  ["أقفال العمليات",lk.activeKeys||0,`${lk.waiting||0} انتظار / ${lk.timedOut||0} timeout`],
  ["قفل الخادم",st.singleInstanceLockRequired?(st.singleInstanceLockAcquired?"مفعل":"غير حاصل"):"غير مطلوب",st.singleInstanceLockRequired?"PostgreSQL advisory lock":"وضع محلي"],
  ["آخر حفظ",st.lastPersistAt?new Date(st.lastPersistAt).toLocaleTimeString("ar"):"-",st.lastPersistError||"بدون أخطاء"]
 ].map(x=>`<div class="stat"><span>${esc(x[0])}</span><strong>${esc(x[1])}</strong><i>${esc(x[2])}</i></div>`).join("");
 $("#syncWorkerInfo").innerHTML=`<div class="runtime-card"><b>الحالة: ${r.running?"قيد التشغيل":"متوقف الآن"}</b><span>الفاصل: ${Number(sw.settings?.intervalMs||0)} ms</span><span>حجم الدفعة: ${Number(sw.settings?.batchSize||0)}</span><span>آخر تشغيل: ${r.lastRunAt?new Date(r.lastRunAt).toLocaleString("ar"):"-"}</span><span>التشغيل القادم: ${r.nextRunAt?new Date(r.nextRunAt).toLocaleString("ar"):"-"}</span><span>${esc(r.lastError?"آخر خطأ: "+r.lastError:"لا توجد أخطاء في آخر تشغيل")}</span></div>`;
 const rd=data.readiness||{checks:[]};
 $("#storageInfo").innerHTML=`<div class="runtime-card"><b>Driver: ${esc(st.driver||"-")}</b><span>Initialized: ${st.initialized?"yes":"no"}</span><span>PostgreSQL: ${st.postgresConnected?"connected":"not connected"}</span><span>Single writer lock: ${st.singleInstanceLockRequired?(st.singleInstanceLockAcquired?"locked":"FAILED"):"n/a"}</span><span>Snapshot revision: ${st.stateRevision??"-"}</span><span>Snapshot SHA-256: ${esc(st.stateDataSha256?String(st.stateDataSha256).slice(0,24)+"…":"-")}</span><span>Snapshot HMAC: ${st.stateHmacPresent?"verified/present":"missing"}</span><span>آخر تحقق: ${st.lastStateVerifyAt?new Date(st.lastStateVerifyAt).toLocaleString("ar"):"-"}</span><span class="${st.lastStateVerifyError?"runtime-bad":"runtime-good"}">${esc(st.lastStateVerifyError?"Snapshot error: "+st.lastStateVerifyError:"Snapshot integrity verified")}</span><span>History pruned: ${Number(st.stateHistoryPruned||0)}</span><span>Schema: ${Number(schema.databaseSchemaVersion||0)} / ${Number(schema.currentSchemaVersion||0)}</span><span>Operation locks: ${Number(lk.activeKeys||0)} active — ${Number(lk.waiting||0)} waiting — ${Number(lk.timedOut||0)} timed out</span><span>آخر حفظ: ${esc(st.lastPersistAt||"-")}</span><span>${esc(st.lastPersistError?"خطأ: "+st.lastPersistError:"الحفظ سليم")}</span></div>
 <div class="runtime-card"><b class="${rd.ready?"runtime-good":"runtime-warn"}">${rd.ready?"✅ جاهزية الإنتاج مكتملة":"⚠️ عناصر مطلوبة قبل الإطلاق"}</b>${(rd.checks||[]).map(x=>`<span class="${x.ok?"runtime-good":"runtime-bad"}">${x.ok?"✓":"✕"} ${esc(x.label)}${x.detail?` — ${esc(x.detail)}`:""}</span>`).join("")}</div>`;
 const fm=data.financialMirror||{};
 const fma=fm.actual||{};
 const counts=fma.counts||{},totals=fma.totals||{};
 $("#financialMirrorInfo").innerHTML=`<div class="runtime-card"><b class="${fm.ok?"runtime-good":"runtime-bad"}">${fm.ok?"✅ المرآة المالية متطابقة":"❌ انحراف في المرآة المالية"}</b><span>Mirror revision: ${fma.stateRevision??st.financialMirrorRevision??"-"}</span><span>Users / Orders / Transactions / Topups: ${Number(counts.users||0)} / ${Number(counts.orders||0)} / ${Number(counts.transactions||0)} / ${Number(counts.topups||0)}</span><span>User balances total: ${money(totals.userBalances||0)}</span><span>Order revenue mirror: ${money(totals.orderRevenue||0)}</span><span>آخر تحقق: ${fm.verifiedAt?new Date(fm.verifiedAt).toLocaleString("ar"):"-"}</span>${(fm.errors||[]).slice(0,4).map(e=>`<span class="runtime-bad">${esc(e.section||"mirror")}.${esc(e.key||"")} — expected ${esc(e.expected)} / actual ${esc(e.actual)}</span>`).join("")}</div>`;
 const fj=data.financialJournal||{};
 $("#financialJournalInfo").innerHTML=`<div class="runtime-card"><b class="${fj.ok?"runtime-good":"runtime-bad"}">${fj.ok?"✅ السجل المالي متحقق":"❌ مشكلة في السجل المالي"}</b><span>Journal entries: ${Number(fj.entryCount||0)}</span><span>Current state transactions: ${Number(fj.currentStateTransactions||0)}</span><span>Cutover revision: ${fj.cutoverRevision??"-"}</span><span>Last state revision: ${fj.lastStateRevision??st.financialJournalLastStateRevision??"-"}</span><span>Raw Telegram IDs: لا يتم تخزينها في Journal</span><span>آخر تحقق: ${fj.verifiedAt?new Date(fj.verifiedAt).toLocaleString("ar"):"-"}</span>${(fj.errors||[]).slice(0,5).map(e=>`<span class="runtime-bad">${esc(e.type||"journal_error")}${e.sourceTransactionId?` — ${esc(e.sourceTransactionId)}`:""}</span>`).join("")}</div>`;
 const wa=data.walletAuthority||{};
 $("#walletAuthorityInfo").innerHTML=`<div class="runtime-card"><b class="${wa.ok?"runtime-good":"runtime-bad"}">${wa.ok?"✅ سلطة الرصيد متطابقة":"❌ تعارض في سلطة الرصيد"}</b><span>Active wallet accounts: ${Number(wa.activeAccountCount||0)}</span><span>All authority rows: ${Number(wa.accountCount||0)}</span><span>Total authoritative balance: ${money(wa.totalBalance||0)}</span><span>Cutover revision: ${wa.cutoverRevision??st.walletAuthorityCutoverRevision??"-"}</span><span>Last state revision: ${wa.stateRevision??st.walletAuthorityLastStateRevision??"-"}</span><span>Wallet identity: HMAC pseudonymous key — لا يتم تخزين Telegram ID الخام في جدول السلطة</span><span>آخر تحقق: ${wa.verifiedAt?new Date(wa.verifiedAt).toLocaleString("ar"):"-"}</span>${(wa.errors||[]).slice(0,6).map(e=>`<span class="runtime-bad">${esc(e.type||"wallet_authority_error")}${e.walletKey?` — ${esc(e.walletKey)}`:""}</span>`).join("")}</div>`;
 const ba=data.businessAuthority||{};
 $("#businessAuthorityInfo").innerHTML=`<div class="runtime-card"><b class="${ba.ok?"runtime-good":"runtime-bad"}">${ba.ok?"✅ سلطة الطلبات والشحن متطابقة":"❌ تعارض في سلطة الطلبات/الشحن"}</b><span>Authoritative orders: ${Number(ba.orderCount||0)}</span><span>Authoritative top-ups: ${Number(ba.topupCount||0)}</span><span>Cutover revision: ${ba.cutoverRevision??st.businessAuthorityCutoverRevision??"-"}</span><span>Last state revision: ${ba.stateRevision??st.businessAuthorityLastStateRevision??"-"}</span><span>Customer identity: HMAC pseudonymous subject key — بدون Telegram ID خام في جداول السلطة</span><span>Immutable order fields + status transitions + payment reference are protected</span><span>آخر تحقق: ${ba.verifiedAt?new Date(ba.verifiedAt).toLocaleString("ar"):"-"}</span>${(ba.errors||[]).slice(0,6).map(e=>`<span class="runtime-bad">${esc(e.type||"business_authority_error")}${e.id?` — ${esc(e.id)}`:""}</span>`).join("")}</div>`;
 const sh=(data.storageHistory||{}).history||[];
 $("#stateHistoryInfo").innerHTML=`<div class="table-wrap"><table><thead><tr><th>Revision</th><th>الوقت</th><th>الحجم</th><th>SHA-256</th><th>HMAC</th></tr></thead><tbody>${sh.map(x=>`<tr><td>${Number(x.revision||0)}</td><td>${x.createdAt?new Date(x.createdAt).toLocaleString("ar"):"-"}</td><td>${(Number(x.dataBytes||0)/1024).toFixed(1)} KB</td><td><code>${esc(String(x.dataSha256||"").slice(0,20))}…</code></td><td>${x.hmacPresent?'<span class="pill ok">نعم</span>':'<span class="pill bad">لا</span>'}</td></tr>`).join("")||rowEmpty(5)}</tbody></table></div>`;
 const bk=data.backups||{},bks=bk.status||{},bkh=bk.health||{},bkfiles=bk.files||[];
 $("#backupHealthInfo").innerHTML=`<div class="runtime-card"><b class="${bkh.ok?"runtime-good":"runtime-bad"}">${bkh.ok?"✅ النسخ الاحتياطي سليم":"✕ النسخ الاحتياطي يحتاج انتباه"}</b><span>آخر ملف: ${esc(bks.file||"-")}</span><span>آخر نجاح: ${bks.completedAt?new Date(bks.completedAt).toLocaleString("ar"):"-"}</span><span>العمر: ${bkh.ageHours==null?"-":Number(bkh.ageHours).toFixed(2)+" ساعة"} / الحد ${Number(bk.maxAgeHours||48)} ساعة</span><span>SHA-256: ${bks.verified?"verified":"not verified"}</span>${bks.error?`<span class="runtime-bad">آخر خطأ: ${esc(bks.error)}</span>`:""}</div><div class="table-wrap"><table><thead><tr><th>الملف</th><th>النوع</th><th>الحجم</th><th>التاريخ</th></tr></thead><tbody>${bkfiles.slice(0,10).map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.type)}</td><td>${Math.max(0,Number(x.size||0)/1024).toFixed(1)} KB</td><td>${x.modifiedAt?new Date(x.modifiedAt).toLocaleString("ar"):"-"}</td></tr>`).join("")||rowEmpty(4)}</tbody></table></div>`;
 const sess=(data.adminSession||{}).admin||{};
 const exp=sess.expiresAt?new Date(Number(sess.expiresAt)*1000).toLocaleString("ar"):"-";
 $("#adminSessionInfo").innerHTML=`<div class="runtime-card"><b>الدور: ${esc(sess.role||"owner")}</b><span>Session version: ${Number(sess.sessionVersion||0)}</span><span>تنتهي الجلسة: ${esc(exp)}</span><span>زر الإبطال يخرج كل جلسات الإدارة الحالية فورًا، بما فيها هذه الجلسة.</span></div>`;
 const mt=data.maintenance||{},mr=mt.runtime||{},rm=mr.lastRemoved||{};
 $("#maintenanceInfo").innerHTML=`<div class="runtime-card"><b>آخر تنظيف: ${mr.lastRunAt?new Date(mr.lastRunAt).toLocaleString("ar"):"لم يعمل بعد"}</b><span>الإشعارات: ${Number(rm.notifications||0)} محذوف</span><span>Provider Logs: ${Number(rm.providerLogs||0)}</span><span>Audit: ${Number(rm.audit||0)} / Security: ${Number(rm.security||0)}</span><span>Device Pairs: ${Number(rm.devicePairs||0)} / Deleted Accounts: ${Number(rm.deletedAccounts||0)}</span><span>الاحتفاظ: إشعارات ${Number(mt.settings?.notificationRetentionDays||0)} يوم — API ${Number(mt.settings?.providerLogRetentionDays||0)} يوم — Audit ${Number(mt.settings?.auditRetentionDays||0)} يوم</span>${mr.lastError?`<span class="runtime-bad">${esc(mr.lastError)}</span>`:""}</div>`;
 const it=data.integrity||{counts:{critical:0,warning:0,info:0},issues:[]},ic=it.counts||{};
 const severityLabel={critical:"حرجة",warning:"تحذير",info:"معلومة"};
 $("#integrityInfo").innerHTML=`<div class="integrity-summary"><div class="stat"><span>حرجة</span><strong class="${Number(ic.critical||0)?"runtime-bad":"runtime-good"}">${Number(ic.critical||0)}</strong></div><div class="stat"><span>تحذيرات</span><strong class="${Number(ic.warning||0)?"runtime-warn":"runtime-good"}">${Number(ic.warning||0)}</strong></div><div class="stat"><span>معلومات</span><strong>${Number(ic.info||0)}</strong></div><div class="stat"><span>آخر فحص</span><strong>${it.scannedAt?new Date(it.scannedAt).toLocaleTimeString("ar"):"-"}</strong></div></div><div class="integrity-list">${(it.issues||[]).slice(0,40).map(x=>`<div class="integrity-row ${attr(x.severity)}"><b>${esc(severityLabel[x.severity]||x.severity)} — ${esc(x.code)}</b><span>${esc(x.message)}</span>${x.repairable?'<em>قابل للإصلاح</em>':""}</div>`).join("")||'<div class="runtime-card"><b class="runtime-good">✅ لم يكتشف الفحص مشاكل في سلامة البيانات</b></div>'}</div>`;
}
function renderAudit(){
 const as=data.audit||[];
 $("#auditTable").innerHTML=`<table><thead><tr><th>الوقت</th><th>العملية</th><th>التفاصيل</th><th>IP</th></tr></thead><tbody>${as.map(a=>`<tr><td>${new Date(a.createdAt).toLocaleString("ar")}</td><td>${esc(a.action)}</td><td><code>${safeJson(a.meta||{})}</code></td><td>${esc(a.ip||"-")}</td></tr>`).join("")||rowEmpty(4)}</tbody></table>`;
}
function renderCategories(){
 const cs=data.categories||[],byId=new Map(cs.map(c=>[c.id,c]));
 $("#categoriesTable").innerHTML=`<table><thead><tr><th>الصورة</th><th>القسم</th><th>ID</th><th>القسم الأب</th><th>الترتيب</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${cs.map(c=>`<tr><td>${imageCell(c,"فارغة")}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.id)}</td><td>${esc(c.parentId?(byId.get(c.parentId)?.name||c.parentId):"رئيسي")}</td><td>${Number(c.sort||0)}</td><td>${c.active?'<span class="pill ok">فعال</span>':'<span class="pill bad">متوقف</span>'}</td><td><button data-action="edit-category" data-id="${attr(c.id)}">تعديل</button></td></tr>`).join("")||rowEmpty(7)}</tbody></table>`;
}
function renderAnnouncements(){
 const as=data.announcements||[];
 $("#announcementsTable").innerHTML=`<table><thead><tr><th>العنوان</th><th>النص</th><th>النوع</th><th>الترتيب</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${as.map(a=>`<tr><td><b>${esc(a.title)}</b></td><td>${esc(a.body)}</td><td>${esc(a.type)}</td><td>${Number(a.sort||0)}</td><td>${a.active?'<span class="pill ok">فعال</span>':'<span class="pill bad">متوقف</span>'}</td><td><button data-action="edit-announcement" data-id="${attr(a.id)}">تعديل</button></td></tr>`).join("")||rowEmpty(6)}</tbody></table>`;
}
function renderSupport(){
 let ts=data.support||[];
 const q=norm(filters.support);if(q)ts=ts.filter(t=>norm(`${t.id} ${t.telegramId} ${t.subject} ${t.message}`).includes(q));
 if(filters.supportStatus)ts=ts.filter(t=>t.status===filters.supportStatus);
 $("#supportTable").innerHTML=`<table><thead><tr><th>ID</th><th>المستخدم</th><th>العنوان</th><th>الرسالة</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${ts.map(t=>`<tr><td>${esc(t.id)}</td><td>${esc(t.telegramId)}</td><td>${esc(t.subject)}</td><td>${esc(t.message)}</td><td>${pill(t.status)}</td><td><button data-action="reply-ticket" data-id="${attr(t.id)}">رد</button></td></tr>`).join("")||rowEmpty(6)}</tbody></table>`;
}
function renderBroadcasts(){
 const bs=data.broadcasts||[];
 $("#broadcastHistory").innerHTML=`<table><thead><tr><th>الوقت</th><th>العنوان</th><th>الجمهور</th><th>الحالة</th><th>التقدم</th><th>نجح</th><th>فشل</th></tr></thead><tbody>${bs.map(b=>{
   const total=Number(b.total||0),processed=Number(b.processed??(Number(b.sent||0)+Number(b.failed||0)));
   const progress=total>0?Math.min(100,Math.round(processed/total*100)):100;
   const status=b.status||((processed>=total&&total>0)?"completed":"queued");
   return `<tr><td>${new Date(b.createdAt).toLocaleString("ar")}</td><td>${esc(b.title)}</td><td>${esc(b.audience)}</td><td>${pill(status)}</td><td><progress class="progress-native" max="100" value="${progress}">${progress}%</progress><small>${processed}/${total} — ${progress}%</small></td><td>${Number(b.sent||0)}</td><td>${Number(b.failed||0)}</td></tr>`;
 }).join("")||rowEmpty(7)}</tbody></table>`;
}
function renderVerification(){
 const rows=data.verification||[],el=$("#verificationTable");if(!el)return;
 el.innerHTML=`<table><thead><tr><th>Telegram ID</th><th>الحالة</th><th>تاريخ الطلب</th><th>تاريخ المراجعة</th><th>إجراء</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.telegramId)}</td><td>${pill(x.status)}</td><td>${x.createdAt?new Date(x.createdAt).toLocaleString("ar"):"-"}</td><td>${x.reviewedAt?new Date(x.reviewedAt).toLocaleString("ar"):"-"}</td><td>${x.status==="pending"?`<button data-verification-action="verified" data-verification-id="${attr(x.id)}">اعتماد</button> <button class="danger" data-verification-action="rejected" data-verification-id="${attr(x.id)}">رفض</button>`:(x.rejectionReason?esc(x.rejectionReason):"تمت المراجعة")}</td></tr>`).join("")||rowEmpty(5)}</tbody></table>`;
 $$('[data-verification-action]').forEach(btn=>btn.onclick=()=>reviewVerification(btn.dataset.verificationId,btn.dataset.verificationAction));
}
async function reviewVerification(id,status){
 const row=(data.verification||[]).find(x=>String(x.id)===String(id));if(!row)return;
 let rejectionReason=null;
 if(status==="verified"&&!confirm(`اعتماد توثيق المستخدم ${row.telegramId}؟ تأكد من اكتمال المطابقة عبر القناة الرسمية أولًا.`))return;
 if(status==="rejected"){rejectionReason=prompt("سبب الرفض (اختياري، سيظهر للمستخدم):","");if(rejectionReason===null)return;}
 if(preview){row.status=status;row.rejectionReason=rejectionReason||null;row.reviewedAt=new Date().toISOString();renderVerification();return toast(status==="verified"?"تم اعتماد التحقق":"تم رفض التحقق")}
 try{await api(`/api/admin/verifications/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({status,rejectionReason})});await load();toast(status==="verified"?"تم اعتماد التحقق":"تم رفض التحقق")}catch{toast("تعذر تحديث حالة التحقق")}
}

function renderSettings(){
 const x=data.settings||{};
 const defaults=[{code:"USD",name:"دولار أمريكي",symbol:"$",enabled:true,rate:1},{code:"EUR",name:"يورو",symbol:"€",enabled:false,rate:1},{code:"TRY",name:"ليرة تركية",symbol:"₺",enabled:false,rate:1},{code:"SYP",name:"ليرة سورية",symbol:"ل.س",enabled:false,rate:1}];
 const remote=Array.isArray(x.currencies)?x.currencies:defaults;
 const currency=code=>remote.find(c=>String(c.code).toUpperCase()===code)||defaults.find(c=>c.code===code);
 const currencyFields=["USD","EUR","TRY","SYP"].map(code=>{const c=currency(code);const fixed=code==="USD";return `<div class="field"><label>${esc(c.name||code)} (${code})</label><select id="setCurrency${code}" ${fixed?"disabled":""}><option value="true" ${c.enabled?"selected":""}>مفعلة</option><option value="false" ${!c.enabled?"selected":""}>متوقفة</option></select></div><div class="field"><label>سعر العرض: 1 USD = ? ${code}</label><input id="setRate${code}" type="number" step="0.000001" min="0.000001" value="${Number(c.rate||1)}" ${fixed?"readonly":""}></div>`}).join("");
 $("#settingsForm").innerHTML=`<div class="field"><label>اسم المتجر</label><input id="setName" value="${attr(x.storeName||"Game Zone")}"></div><div class="field"><label>الوصف</label><input id="setTagline" value="${attr(x.tagline||"")}"></div><div class="field"><label>أقل شحن</label><input id="setMinTopup" type="number" value="${Number(x.minTopup||1)}"></div><div class="field"><label>أعلى شحن</label><input id="setMaxTopup" type="number" value="${Number(x.maxTopup||1000)}"></div><div class="field full"><label>رسالة الصيانة</label><input id="setMaintenanceMessage" value="${attr(x.maintenanceMessage||"")}"></div><div class="field"><label>وضع الصيانة</label><select id="setMaintenance"><option value="false" ${!x.maintenance?"selected":""}>متوقف</option><option value="true" ${x.maintenance?"selected":""}>مفعل</option></select></div><div class="field"><label>إظهار الإعلانات</label><select id="setAnnouncements"><option value="true" ${x.showAnnouncements!==false?"selected":""}>نعم</option><option value="false" ${x.showAnnouncements===false?"selected":""}>لا</option></select></div><div class="field"><label>مزامنة الطلبات تلقائيًا</label><select id="setSyncEnabled"><option value="true" ${x.orderSyncEnabled!==false?"selected":""}>مفعلة</option><option value="false" ${x.orderSyncEnabled===false?"selected":""}>متوقفة</option></select></div><div class="field"><label>فاصل المزامنة ms</label><input id="setSyncInterval" type="number" value="${Number(x.orderSyncIntervalMs||60000)}"></div><div class="field"><label>حجم دفعة المزامنة</label><input id="setSyncBatch" type="number" value="${Number(x.orderSyncBatchSize||10)}"></div><div class="field"><label>الاحتفاظ بالإشعارات — أيام</label><input id="setNotificationRetention" type="number" value="${Number(x.notificationRetentionDays||180)}"></div><div class="field"><label>الاحتفاظ بسجل API — أيام</label><input id="setProviderLogRetention" type="number" value="${Number(x.providerLogRetentionDays||90)}"></div><div class="field"><label>الاحتفاظ بسجل الإدارة — أيام</label><input id="setAuditRetention" type="number" value="${Number(x.auditRetentionDays||365)}"></div><div class="field full"><h3>عملات العرض</h3><small>الرصيد المالي الأساسي يبقى USD. العملات الأخرى للعرض فقط حسب السعر الذي تحدده الإدارة.</small></div>${currencyFields}<button id="saveSettings" class="save">حفظ الإعدادات</button>`;
 $("#saveSettings").onclick=saveSettings;
}

function editCategory(id){
 const c=(data.categories||[]).find(x=>x.id===id);if(!c)return;
 modal(`<h3>تعديل القسم</h3><div class="form-grid">
  <div class="field full"><label>الاسم</label><input id="ceName" value="${attr(c.name)}"></div>
  <div class="field"><label>القسم الأب</label><select id="ceParent">${categoryOptions(c.parentId,{excludeId:id,includeRoot:true})}</select></div>
  <div class="field"><label>الترتيب</label><input id="ceSort" type="number" value="${Number(c.sort||0)}"></div>
  <div class="field full"><label>الصورة</label><input id="ceImage" type="file" accept="image/jpeg,image/png,image/webp"></div>
  <div class="field"><label>الحالة</label><select id="ceActive"><option value="true" ${c.active?"selected":""}>فعال</option><option value="false" ${!c.active?"selected":""}>متوقف</option></select></div>
  <div class="field full"><label>الوصف الداخلي</label><input id="ceDesc" value="${attr(c.description||"")}"></div>
 </div><button class="save" id="ceSave">حفظ</button>`);
 $("#ceSave").onclick=async()=>{
  try{
   const file=$("#ceImage").files?.[0]||null,imageUrl=file?await uploadAdminImage(file,"category"):c.imageUrl||null;
   const patch={name:$("#ceName").value,parentId:$("#ceParent").value||null,imageUrl,icon:"",sort:Number($("#ceSort").value),active:$("#ceActive").value==="true",description:$("#ceDesc").value};
   if(preview){Object.assign(c,patch);$("#modal").classList.remove("show");renderCategories();return toast("تم الحفظ")}
   await api(`/api/admin/categories/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify(patch)});$("#modal").classList.remove("show");await load();toast("تم الحفظ");
  }catch(e){toast(e.message==="image_too_large"?"الصورة أكبر من 2MB":"تعذر الحفظ")}
 };
}
function editAnnouncement(id){
 const a=(data.announcements||[]).find(x=>x.id===id);if(!a)return;
 modal(`<h3>تعديل الإعلان</h3><div class="form-grid"><div class="field full"><label>العنوان</label><input id="aeTitle" value="${attr(a.title)}"></div><div class="field full"><label>النص</label><input id="aeBody" value="${attr(a.body)}"></div><div class="field"><label>الحالة</label><select id="aeActive"><option value="true" ${a.active?"selected":""}>فعال</option><option value="false" ${!a.active?"selected":""}>متوقف</option></select></div><div class="field"><label>الترتيب</label><input id="aeSort" type="number" value="${Number(a.sort||1)}"></div></div><button class="save" id="aeSave">حفظ</button>`);
 $("#aeSave").onclick=async()=>{const patch={title:$("#aeTitle").value,body:$("#aeBody").value,active:$("#aeActive").value==="true",sort:Number($("#aeSort").value)};if(preview){Object.assign(a,patch);$("#modal").classList.remove("show");renderAnnouncements();return toast("تم الحفظ")}try{await api(`/api/admin/announcements/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify(patch)});$("#modal").classList.remove("show");await load();toast("تم الحفظ")}catch{toast("تعذر الحفظ")}};
}
function replyTicket(id){
 const t=(data.support||[]).find(x=>x.id===id);if(!t)return;
 modal(`<h3>الرد على التذكرة</h3><p>${esc(t.subject)}</p><div class="field"><label>الرد</label><textarea id="ticketReply" rows="5"></textarea></div><button class="save" id="ticketSend">إرسال الرد وإغلاق</button>`);
 $("#ticketSend").onclick=async()=>{const reply=$("#ticketReply").value.trim();if(!reply)return;if(preview){t.reply=reply;t.status="closed";$("#modal").classList.remove("show");renderSupport();return toast("تم إرسال الرد")}try{await api(`/api/admin/support-tickets/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({reply,status:"closed"})});$("#modal").classList.remove("show");await load();toast("تم إرسال الرد")}catch{toast("تعذر إرسال الرد")}};
}
async function orderDetail(id){
 let o;
 if(preview)o=(mock.orders||[]).find(x=>x.id===id);
 else{try{o=await api(`/api/admin/orders/${encodeURIComponent(id)}`)}catch{return toast("تعذر تحميل تفاصيل الطلب")}}
 if(!o)return;
 const timeline=(o.timeline||[]).map(e=>`<div><b>${esc(e.status)}</b><br>${esc(e.note||"")}<br><small>${e.createdAt?new Date(e.createdAt).toLocaleString("ar"):""}</small></div>`).join("")||"<div>لا يوجد سجل حالة بعد</div>";
 const hasDelivery=!!(o.inventoryCodeId||o.providerDelivery),canDeliver=!["failed","refunded","cancelled"].includes(o.status)&&!o.inventoryCodeId,canReplace=!!o.providerDelivery&&!o.inventoryCodeId;
 const product=(data.products||[]).find(p=>p.id===o.productId),labels=new Map((product?.inputSchema||[]).map(f=>[f.key,f.label||f.key]));const customerFields=o.customerData&&typeof o.customerData==="object"?Object.entries(o.customerData).map(([k,v])=>`<div class="stat"><span>${esc(labels.get(k)||k)}</span><strong>${esc(v)}</strong></div>`).join(""):(o.customerInput?`<div class="stat"><span>بيانات الطلب</span><strong>${esc(o.customerInput)}</strong></div>`:"");
 modal(`<h3>تفاصيل الطلب ${esc(o.orderNo)}</h3><div class="user-detail-grid"><div class="stat"><span>المنتج</span><strong>${esc(o.productName)}</strong></div>${customerFields}<div class="stat"><span>الحالة</span><strong>${esc(o.status)}</strong></div><div class="stat"><span>المبلغ</span><strong>${money(o.finalPrice)}</strong></div><div class="stat"><span>الربح</span><strong>${money(o.profit)}</strong></div><div class="stat"><span>المستخدم</span><strong>${esc(o.telegramId)}</strong></div><div class="stat"><span>المزود</span><strong>${esc(o.providerUsed||o.providerPrimary||"-")}</strong></div><div class="stat"><span>Provider Order ID</span><strong>${esc(o.providerOrderId||"-")}</strong></div>${o.manualFulfillmentStartedAt?`<div class="stat"><span>التنفيذ اليدوي</span><strong>بدأ ${new Date(o.manualFulfillmentStartedAt).toLocaleString("ar")}</strong></div>`:""}${o.requiresManualReview?`<div class="stat warning-stat"><span>مراجعة مطلوبة</span><strong>تحقق قبل الرد أو إعادة الإرسال${o.reviewReason?` — ${esc(o.reviewReason)}`:""}</strong></div>`:""}<div class="stat"><span>التسليم الرقمي</span><strong>${hasDelivery?esc(o.providerDeliveryMasked||"متوفر"):"غير متوفر"}</strong></div></div><div class="actions delivery-actions">${hasDelivery?`<button class="save" id="revealOrderDeliveryBtn">عرض التسليم</button>`:""}${canDeliver?`<button id="setManualDeliveryBtn">${canReplace?"استبدال التسليم":"تسليم رقمي يدوي"}</button>`:""}</div><h4>تتبع الطلب</h4><div class="timeline-mini">${timeline}</div>`);
 if(hasDelivery)$("#revealOrderDeliveryBtn").onclick=()=>revealOrderDelivery(id);
 if(canDeliver)$("#setManualDeliveryBtn").onclick=()=>setManualDelivery(id,canReplace);
}
async function revealOrderDelivery(id){
 if(preview)return modal(`<h3>التسليم الرقمي</h3><div class="receipt"><code>GZ-PREVIEW-DELIVERY-2026</code></div>`);
 try{
   const r=await api(`/api/admin/orders/${encodeURIComponent(id)}/delivery`);
   modal(`<h3>التسليم الرقمي</h3><div class="receipt"><code>${esc(r.value)}</code></div><p>النوع: ${esc(r.kind)}</p><p class="small-note">تم تسجيل عملية الكشف في Audit Log.</p>`);
 }catch{toast("لا يوجد تسليم رقمي لهذا الطلب")}
}
function setManualDelivery(id,overwrite=false){
 modal(`<h3>${overwrite?"استبدال":"تسليم"} القيمة الرقمية</h3><div class="field"><label>الكود / الرابط / بيانات التسليم</label><textarea id="manualDeliveryValue" rows="7" placeholder="أدخل القيمة التي سيستلمها العميل"></textarea></div>${overwrite?`<div class="danger-note">سيتم استبدال التسليم الحالي. استخدم هذا فقط إذا كانت القيمة السابقة خاطئة.</div>`:""}<button class="save" id="manualDeliverySave">تسليم للعميل</button>`);
 $("#manualDeliverySave").onclick=async()=>{
   const value=$("#manualDeliveryValue").value.trim();if(!value)return toast("أدخل قيمة التسليم");
   if(overwrite&&!confirm("تأكيد استبدال التسليم الحالي؟"))return;
   if(preview){$("#modal").classList.remove("show");return toast("تم التسليم في المعاينة")}
   try{
     await api(`/api/admin/orders/${encodeURIComponent(id)}/delivery`,{method:"POST",body:JSON.stringify({value,overwrite})});
     $("#modal").classList.remove("show");await load();toast("تم تسليم القيمة للعميل");
   }catch(e){toast("تعذر تسليم القيمة")}
 };
}
async function userDetail(tid){
 let u,orders=[],transactions=[];
 if(preview){u=(mock.users||[]).find(x=>x.telegramId===tid);orders=(mock.orders||[]).filter(x=>x.telegramId===tid)}
 else{try{const r=await api(`/api/admin/users/${encodeURIComponent(tid)}`);u=r.user;orders=r.orders||[];transactions=r.transactions||[]}catch{return toast("تعذر تحميل تفاصيل المستخدم")}}
 if(!u)return;
 modal(`<h3>تفاصيل المستخدم</h3><div class="user-detail-grid"><div class="stat"><span>الاسم</span><strong>${esc([u.firstName,u.lastName].filter(Boolean).join(" ")||"-")}</strong></div><div class="stat"><span>المعرف</span><strong>${esc(u.username?"@"+u.username:"-")}</strong></div><div class="stat"><span>Telegram ID</span><strong>${esc(u.telegramId)}</strong></div><div class="stat"><span>الرصيد</span><strong>${money(u.balance)}</strong></div><div class="stat"><span>الطلبات</span><strong>${orders.length}</strong></div><div class="stat"><span>الحركات</span><strong>${transactions.length}</strong></div></div><h4>آخر الطلبات</h4><div class="timeline-mini">${orders.slice(0,8).map(o=>`<div><b>${esc(o.orderNo)} — ${esc(o.productName)}</b><br>${esc(o.status)} — ${money(o.finalPrice)}</div>`).join("")||"<div>لا توجد طلبات</div>"}</div>`);
}
function editCoupon(code){
 const c=(data.coupons||[]).find(x=>x.code===code);if(!c)return;
 modal(`<h3>تعديل الكوبون ${esc(c.code)}</h3><div class="form-grid">
  <div class="field"><label>النوع</label><select id="ecType"><option value="percent" ${c.type==="percent"?"selected":""}>نسبة %</option><option value="fixed" ${c.type==="fixed"?"selected":""}>مبلغ ثابت</option></select></div>
  <div class="field"><label>القيمة</label><input id="ecValue" type="number" step=".01" value="${Number(c.value||0)}"></div>
  <div class="field"><label>أقصى خصم</label><input id="ecMaxDiscount" type="number" step=".01" value="${c.maxDiscount??""}"></div>
  <div class="field"><label>أقصى استخدام إجمالي</label><input id="ecMaxUses" type="number" value="${c.maxUses??""}"></div>
  <div class="field"><label>أقصى استخدام لكل مستخدم</label><input id="ecMaxUsesPerUser" type="number" value="${c.maxUsesPerUser??""}"></div>
  <div class="field"><label>الحالة</label><select id="ecActive"><option value="true" ${c.active?"selected":""}>فعال</option><option value="false" ${!c.active?"selected":""}>متوقف</option></select></div>
 </div><button class="save" id="ecSave">حفظ</button>`);
 $("#ecSave").onclick=async()=>{
  const patch={type:$("#ecType").value,value:Number($("#ecValue").value),maxDiscount:$("#ecMaxDiscount").value===""?null:Number($("#ecMaxDiscount").value),maxUses:$("#ecMaxUses").value===""?null:Number($("#ecMaxUses").value),maxUsesPerUser:$("#ecMaxUsesPerUser").value===""?null:Number($("#ecMaxUsesPerUser").value),active:$("#ecActive").value==="true"};
  if(preview){Object.assign(c,patch);$("#modal").classList.remove("show");renderCoupons();return toast("تم حفظ الكوبون")}
  try{await api(`/api/admin/coupons/${encodeURIComponent(code)}`,{method:"PATCH",body:JSON.stringify(patch)});$("#modal").classList.remove("show");await load();toast("تم حفظ الكوبون")}catch{toast("تعذر حفظ الكوبون")}
 };
}

async function saveSettings(){
 const patch={storeName:$("#setName").value,tagline:$("#setTagline").value,minTopup:Number($("#setMinTopup").value),maxTopup:Number($("#setMaxTopup").value),maintenanceMessage:$("#setMaintenanceMessage").value,maintenance:$("#setMaintenance").value==="true",showAnnouncements:$("#setAnnouncements").value==="true",orderSyncEnabled:$("#setSyncEnabled").value==="true",orderSyncIntervalMs:Number($("#setSyncInterval").value),orderSyncBatchSize:Number($("#setSyncBatch").value),notificationRetentionDays:Number($("#setNotificationRetention").value),providerLogRetentionDays:Number($("#setProviderLogRetention").value),auditRetentionDays:Number($("#setAuditRetention").value),currencies:["USD","EUR","TRY","SYP"].map(code=>({code,enabled:code==="USD"?true:$("#setCurrency"+code).value==="true",rate:code==="USD"?1:Number($("#setRate"+code).value)}))};
 if(preview){Object.assign(mock.settings,patch);data.settings=mock.settings;return toast("تم حفظ الإعدادات")}
 try{await api("/api/admin/settings",{method:"PATCH",body:JSON.stringify(patch)});await load();toast("تم حفظ الإعدادات")}catch{toast("تعذر حفظ الإعدادات")}
}
async function testProvider(id){
 if(preview){const p=mock.providers.find(x=>x.id===id);return toast(p?.type==="http"?"اختبار تجريبي: تحقق من الإعدادات":"✅ المزود جاهز")}
 try{const r=await api(`/api/admin/providers/${id}/test`,{method:"POST"});toast(r.ok?`✅ المزود متاح — ${r.durationMs}ms`:`❌ فشل الاختبار: ${r.error}`);await load()}catch{toast("تعذر اختبار المزود")}
}
async function exportCsv(kind){
 if(preview)return toast("التصدير يعمل عند تشغيل السيرفر");
 try{
   const r=await fetch(`/api/admin/export/${kind}.csv`,{headers:{authorization:`Bearer ${adminToken}`}});
   if(!r.ok)throw new Error("export_failed");
   const filename=`game-zone-${kind}.csv`;
   if(window.GameZoneAndroid?.saveTextFile){
     const text=await r.text(),result=window.GameZoneAndroid.saveTextFile(filename,text,"text/csv");
     if(String(result).startsWith("error")||result==="unsupported_android_version")throw new Error("android_save_failed");
     return toast("تم حفظ CSV في Downloads/GameZone");
   }
   const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");
   a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
 }catch{toast("تعذر التصدير")}
}


function renderInventory(){
 const summary=data.inventorySummary||[],rows=data.inventory||[];
 if($("#inventoryStats"))$("#inventoryStats").innerHTML=summary.map(x=>`<div class="stat"><span>${esc(x.productName)}</span><strong class="${Number(x.available||0)<=3?'stock-low':'stock-ok'}">${Number(x.available||0)}</strong><i>${Number(x.delivered||0)} مسلّم / ${Number(x.total||0)} إجمالي</i></div>`).join("")||`<div class="stat"><span>المخزون</span><strong>0</strong><i>لا توجد منتجات مخزنية</i></div>`;
 if($("#inventoryTable"))$("#inventoryTable").innerHTML=`<table><thead><tr><th>ID</th><th>المنتج</th><th>الكود</th><th>الحالة</th><th>الطلب</th><th>إجراء</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.id)}</td><td>${esc(x.productId)}</td><td><span class="inventory-code">${esc(x.masked||"***")}</span></td><td>${pill(x.status)}</td><td>${esc(x.orderNo||"-")}</td><td><div class="actions"><button data-action="reveal-inventory" data-id="${attr(x.id)}">كشف</button>${x.status==="available"?`<button class="danger" data-action="disable-inventory" data-id="${attr(x.id)}">تعطيل</button>`:""}</div></td></tr>`).join("")||rowEmpty(6)}</tbody></table>`;
}
function renderSecurity(){
 const rows=data.security||[];
 if($("#securityTable"))$("#securityTable").innerHTML=`<table><thead><tr><th>الوقت</th><th>النوع</th><th>IP</th><th>تفاصيل</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${new Date(x.createdAt).toLocaleString("ar")}</td><td>${esc(x.type)}</td><td>${esc(x.ip||"-")}</td><td><code>${safeJson(x.meta||{})}</code></td></tr>`).join("")||rowEmpty(4)}</tbody></table>`;
}
async function syncOrder(id){
 if(preview){const o=mock.orders.find(x=>x.id===id);if(o&&o.status!=="completed")o.status="completed";renderOrders();return toast("تمت مزامنة الطلب تجريبيًا")}
 try{const r=await api(`/api/admin/orders/${id}/sync`,{method:"POST"});await load();toast(r.skipped?"هذا الطلب لا يحتاج مزامنة":"تمت مزامنة حالة الطلب")}catch(e){toast("تعذر مزامنة الطلب")}
}
async function revealInventory(id){
 if(preview){const row=mock.inventory.find(x=>x.id===id);return modal(`<h3>الكود</h3><div class="receipt"><code>${esc(row?.id==='inv_demo_1'?'GZ-DEMO-ALPHA-2026':'GZ-DEMO-PREVIEW-2026')}</code></div><p class="small-note">الكشف الحقيقي مسجل في سجل الإدارة.</p>`)}
 try{const r=await api(`/api/admin/inventory/${id}/reveal`);modal(`<h3>الكود الرقمي</h3><div class="receipt"><code>${esc(r.value)}</code></div><p>الحالة: ${esc(r.status)} ${r.orderNo?`— الطلب ${esc(r.orderNo)}`:""}</p>`)}catch(e){toast("تعذر كشف الكود")}
}
async function disableInventory(id){
 if(!confirm("تعطيل هذا الكود غير المستخدم؟"))return;
 if(preview){const row=mock.inventory.find(x=>x.id===id);if(row)row.status="disabled";renderInventory();return toast("تم تعطيل الكود")}
 try{await api(`/api/admin/inventory/${id}/disable`,{method:"POST"});await load();toast("تم تعطيل الكود")}catch{toast("تعذر تعطيل الكود")}
}
async function startManualOrder(id){
 if(preview){const o=mock.orders.find(x=>x.id===id);if(o)o.manualFulfillmentStartedAt=new Date().toISOString();renderOrders();return toast("بدأ التنفيذ اليدوي في المعاينة")}
 if(!confirm("بدء التنفيذ اليدوي؟ بعد ذلك لن يستطيع العميل إلغاء الطلب ذاتيًا."))return;
 try{await api(`/api/admin/orders/${encodeURIComponent(id)}/manual-start`,{method:"POST",body:"{}"});await load();toast("تم قفل الطلب وبدء التنفيذ اليدوي")}catch{toast("تعذر بدء التنفيذ اليدوي")}
}
async function setOrder(id,status){
 const order=(data.orders||[]).find(x=>x.id===id);
 if(["failed","cancelled","refunded"].includes(status)){
   if(!confirm(`سيتم إنهاء الطلب ${order?.orderNo||""} وإرجاع الرصيد إذا لم يُسترجع سابقًا. متابعة؟`))return;
 }
 if(order?.requiresManualReview&&["completed","failed","cancelled","refunded"].includes(status)){
   if(!confirm("هذا الطلب في مراجعة المورد. هل تحققت يدويًا من نتيجة المورد وتريد إغلاق المراجعة بهذه الحالة؟"))return;
 }
 if(preview){const o=mock.orders.find(x=>x.id===id);if(o){o.status=status;o.requiresManualReview=false}data.orders=mock.orders;renderOrders();renderDashboard();return toast("تم تحديث الطلب في المعاينة")}
 const body={status};
 if(["failed","cancelled","refunded"].includes(status))body.confirmation="FAIL_AND_REFUND";
 if(order?.requiresManualReview&&["completed","failed","cancelled","refunded"].includes(status))body.reviewResolved=true;
 try{await api(`/api/admin/orders/${id}`,{method:"PATCH",body:JSON.stringify(body)});await load();toast("تم تحديث الطلب")}catch(e){
   if(e.data?.error==="refund_confirmation_required")toast("التأكيد المالي مطلوب لإرجاع الرصيد");
   else if(e.data?.error==="provider_review_confirmation_required")toast("يجب تأكيد مراجعة نتيجة المورد أولًا");
   else toast("تعذر التحديث")
 }
}
async function viewTopupReceipt(id){
 if(preview)return modal(`<h3>إيصال الشحن</h3><div class="admin-receipt-placeholder">معاينة صورة الإيصال</div>`);
 try{
  const r=await fetch(`/api/admin/topups/${encodeURIComponent(id)}/receipt`,{headers:{authorization:`Bearer ${adminToken}`}});
  if(!r.ok)throw new Error("receipt_failed");const blob=await r.blob(),url=URL.createObjectURL(blob);
  modal(`<h3>إيصال الشحن</h3><img class="admin-receipt-image" src="${attr(url)}" alt="إيصال الدفع">`);
  setTimeout(()=>URL.revokeObjectURL(url),60000);
 }catch{toast("تعذر عرض الإيصال")}
}
async function topupAction(id,action){
 const topup=(data.topups||[]).find(x=>x.id===id);
 if(!confirm(`${action==="approve"?"قبول":"رفض"} طلب الشحن ${id}${topup?` بقيمة ${money(topup.amount)}`:""}؟`))return;
 if(preview){const t=mock.topups.find(x=>x.id===id);if(t)t.status=action==="approve"?"approved":"rejected";renderTopups();return toast("تم تنفيذ الإجراء في المعاينة")}
 try{await api(`/api/admin/topups/${id}/${action}`,{method:"POST",body:JSON.stringify({confirmation:action==="approve"?"APPROVE_TOPUP":"REJECT_TOPUP"})});await load();toast("تم تنفيذ الإجراء")}catch{toast("تعذر تنفيذ الإجراء")}
}
async function balance(tid,plus){const raw=prompt(plus?"المبلغ المراد إضافته":"المبلغ المراد خصمه","10");if(!raw)return;let amount=Math.abs(Number(raw));if(!plus)amount=-amount;if(preview){const u=mock.users.find(x=>x.telegramId===tid);if(u)u.balance=Number((u.balance+amount).toFixed(2));renderUsers();return toast("تم تعديل الرصيد في المعاينة")}try{const clientRequestId=`admin-balance:${tid}:${Date.now()}:${Math.random().toString(36).slice(2,10)}`;await api(`/api/admin/users/${tid}/balance`,{method:"POST",body:JSON.stringify({amount,clientRequestId})});await load();toast("تم تعديل الرصيد")}catch{toast("تعذر تعديل الرصيد")}}
function modal(html){$("#modalBody").innerHTML=html;$("#modal").classList.add("show")}$("#modalClose").onclick=()=>$("#modal").classList.remove("show");$("#modal").onclick=e=>{if(e.target.id==="modal")$("#modal").classList.remove("show")};

function providerOptions(selected){return (data.providers||[]).map(p=>`<option value="${attr(p.id)}" ${p.id===selected?"selected":""}>${esc(p.name)}</option>`).join("")}
function categoryOptions(selected,{excludeId=null,includeRoot=false}={}){const rows=(data.categories||[]).filter(c=>c.id!==excludeId);return `${includeRoot?`<option value="">قسم رئيسي</option>`:""}${rows.map(c=>`<option value="${attr(c.id)}" ${c.id===selected?"selected":""}>${esc(c.name)}</option>`).join("")}`;}
function editProduct(id){
 const p=(data.products||[]).find(x=>x.id===id);if(!p)return;
 modal(`<h3>تعديل المنتج</h3><div class="form-grid">
  <div class="field full"><label>الاسم</label><input id="epName" value="${attr(p.name)}"></div>
  <div class="field"><label>القسم الفرعي</label><select id="epCategory">${categoryOptions(p.categoryId)}</select></div>
  <div class="field full"><label>الصورة</label><input id="epImage" type="file" accept="image/jpeg,image/png,image/webp"></div>
  <div class="field full"><label>الوصف — يظهر داخل التفاصيل فقط</label><textarea id="epDescription" rows="4">${esc(p.description||"")}</textarea></div>
  <div class="field"><label>السعر</label><input id="epPrice" type="number" step=".01" value="${Number(p.price||0)}"></div>
  <div class="field"><label>التكلفة</label><input id="epCost" type="number" step=".01" value="${Number(p.cost||0)}"></div>
  <div class="field"><label>العملة</label><input id="epCurrency" value="${attr(p.currency||"USD")}"></div>
  <div class="field"><label>عنوان بيانات الطلب القديم</label><input id="epInputLabel" value="${attr(p.inputLabel||"بيانات الطلب")}"></div>
  <div class="field full"><label>حقول بيانات العميل — JSON</label><textarea id="epInputSchema" rows="6" placeholder='[{"key":"playerId","label":"Player ID","type":"text","required":true}]'>${esc(JSON.stringify(Array.isArray(p.inputSchema)?p.inputSchema:[{key:"value",label:p.inputLabel||"بيانات الطلب",type:"text",required:true,maxLength:500}],null,2))}</textarea><small>يمكن إضافة Player ID وServer ID وUsername وغيرها. استخدم [] إذا المنتج لا يحتاج بيانات.</small></div>
  <div class="field full"><label>ربط حقول العميل مع API — JSON</label><textarea id="epProviderInputMap" rows="4" placeholder='{"playerId":"player_id","serverId":"zone_id"}'>${esc(JSON.stringify(p.providerInputMap||{},null,2))}</textarea></div>
  <div class="field"><label>طريقة التنفيذ الداخلية</label><select id="epDelivery"><option value="auto" ${p.delivery==="auto"?"selected":""}>مزود API</option><option value="manual" ${p.delivery==="manual"?"selected":""}>يدوي</option><option value="inventory" ${p.delivery==="inventory"?"selected":""}>مخزون أكواد</option></select></div>
  <div class="field"><label>نص التسليم الظاهر للعميل</label><input id="epDeliveryText" maxlength="120" value="${attr(p.deliveryText||"")}" placeholder="مثال: فوري / خلال 30 دقيقة / ضمن أوقات العمل"></div>
  <div class="field"><label>Provider Product ID</label><input id="epProviderProductId" value="${attr(p.providerProductId||"")}"></div>
  <div class="field"><label>المزود الأساسي</label><select id="epPrimary">${providerOptions(p.providerPrimary)}</select></div>
  <div class="field"><label>المزود الاحتياطي</label><select id="epBackup"><option value="">بدون</option>${providerOptions(p.providerBackup)}</select></div>
  <div class="field"><label>الحالة</label><select id="epActive"><option value="true" ${p.active?"selected":""}>فعال</option><option value="false" ${!p.active?"selected":""}>متوقف</option></select></div>
 </div><button class="save" id="epSave">حفظ التغييرات</button>`);
 $("#epSave").onclick=async()=>{
  try{
   const file=$("#epImage").files?.[0]||null,imageUrl=file?await uploadAdminImage(file,"product"):p.imageUrl||null;
   const inputSchema=jsonArrayOrNull($("#epInputSchema").value),providerInputMap=jsonObjectOrNull($("#epProviderInputMap").value);if(inputSchema===null)return toast("JSON حقول بيانات العميل غير صالح");if(providerInputMap===null)return toast("JSON ربط حقول API غير صالح");const patch={name:$("#epName").value,categoryId:$("#epCategory").value,imageUrl,icon:"",description:$("#epDescription").value,price:Number($("#epPrice").value),cost:Number($("#epCost").value),currency:$("#epCurrency").value,inputLabel:$("#epInputLabel").value,inputSchema,providerInputMap,delivery:$("#epDelivery").value,deliveryText:$("#epDeliveryText").value,providerProductId:$("#epProviderProductId").value||null,providerPrimary:$("#epPrimary").value,providerBackup:$("#epBackup").value||null,active:$("#epActive").value==="true",featured:false};
   if(preview){Object.assign(p,patch);p.profit=p.price-p.cost;$("#modal").classList.remove("show");renderProducts();return toast("تم الحفظ في المعاينة")}
   await api(`/api/admin/products/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify(patch)});$("#modal").classList.remove("show");await load();toast("تم حفظ المنتج");
  }catch(e){toast(e.message==="image_too_large"?"الصورة أكبر من 2MB":"تعذر حفظ المنتج")}
 };
}
$("#addProductBtn").onclick=()=>modal(`<h3>إضافة منتج</h3><div class="form-grid">
 <div class="field full"><label>الاسم</label><input id="apName"></div>
 <div class="field"><label>القسم الفرعي</label><select id="apCategory">${categoryOptions()}</select></div>
 <div class="field full"><label>الصورة</label><input id="apImage" type="file" accept="image/jpeg,image/png,image/webp"></div>
 <div class="field full"><label>الوصف — داخل التفاصيل فقط</label><textarea id="apDescription" rows="4"></textarea></div>
 <div class="field"><label>السعر</label><input id="apPrice" type="number" step=".01"></div>
 <div class="field"><label>التكلفة</label><input id="apCost" type="number" step=".01"></div>
 <div class="field"><label>العملة</label><input id="apCurrency" value="USD"></div>
 <div class="field"><label>عنوان بيانات الطلب القديم</label><input id="apInputLabel" value="بيانات الطلب"></div>
 <div class="field full"><label>حقول بيانات العميل — JSON</label><textarea id="apInputSchema" rows="6">[
  {"key":"value","label":"بيانات الطلب","type":"text","required":true,"maxLength":500}
]</textarea><small>مثال ألعاب: playerId، serverId. ضع [] للمنتجات التي لا تحتاج بيانات.</small></div>
 <div class="field full"><label>ربط حقول العميل مع API — JSON</label><textarea id="apProviderInputMap" rows="4">{}</textarea></div>
 <div class="field"><label>طريقة التنفيذ الداخلية</label><select id="apDelivery"><option value="auto">مزود API</option><option value="manual">يدوي</option><option value="inventory">مخزون أكواد</option></select></div>
 <div class="field"><label>نص التسليم الظاهر للعميل</label><input id="apDeliveryText" maxlength="120" value="فوري" placeholder="مثال: فوري / خلال 30 دقيقة / ضمن أوقات العمل"></div>
 <div class="field"><label>Provider Product ID</label><input id="apProviderProductId"></div>
 <div class="field"><label>المزود الأساسي</label><select id="apPrimary">${providerOptions("manual")}</select></div>
 <div class="field"><label>الاحتياطي</label><select id="apBackup"><option value="">بدون</option>${providerOptions()}</select></div>
 </div><button class="save" id="apSave">إضافة المنتج</button>`);
document.addEventListener("click",async e=>{if(e.target.id==="apSave"){
 try{
  const imageUrl=await uploadAdminImage($("#apImage").files?.[0]||null,"product");
  const inputSchema=jsonArrayOrNull($("#apInputSchema").value),providerInputMap=jsonObjectOrNull($("#apProviderInputMap").value);if(inputSchema===null)return toast("JSON حقول بيانات العميل غير صالح");if(providerInputMap===null)return toast("JSON ربط حقول API غير صالح");const item={name:$("#apName").value.trim(),categoryId:$("#apCategory").value,imageUrl,icon:"",description:$("#apDescription").value,price:Number($("#apPrice").value),cost:Number($("#apCost").value),currency:$("#apCurrency").value,inputLabel:$("#apInputLabel").value,inputSchema,providerInputMap,delivery:$("#apDelivery").value,deliveryText:$("#apDeliveryText").value,providerProductId:$("#apProviderProductId").value||null,providerPrimary:$("#apPrimary").value,providerBackup:$("#apBackup").value||null,featured:false,active:true};
  if(!item.name)return toast("اسم المنتج مطلوب");
  if(preview){item.id="preview_"+Date.now();item.profit=item.price-item.cost;mock.products.push(item);data.products=mock.products;$("#modal").classList.remove("show");renderProducts();return toast("تمت الإضافة في المعاينة")}
  await api("/api/admin/products",{method:"POST",body:JSON.stringify(item)});$("#modal").classList.remove("show");await load();toast("تمت إضافة المنتج");
 }catch(e){toast(e.message==="image_too_large"?"الصورة أكبر من 2MB":"تعذر إضافة المنتج")}
}});

$("#addCouponBtn").onclick=()=>modal(`<h3>إضافة كوبون</h3><div class="form-grid"><div class="field"><label>الكود</label><input id="acCode" placeholder="GAME10"></div><div class="field"><label>النوع</label><select id="acType"><option value="percent">نسبة %</option><option value="fixed">مبلغ ثابت</option></select></div><div class="field"><label>القيمة</label><input id="acValue" type="number" step=".01" value="10"></div><div class="field"><label>أقصى خصم (اختياري)</label><input id="acMax" type="number" step=".01" value="5"></div><div class="field"><label>عدد الاستخدامات الإجمالي (اختياري)</label><input id="acUses" type="number" value="100"></div><div class="field"><label>لكل مستخدم</label><input id="acPerUser" type="number" value="1"></div></div><button class="save" id="acSave">حفظ الكوبون</button>`);
document.addEventListener("click",async e=>{if(e.target.id==="acSave"){const c={code:$("#acCode").value,type:$("#acType").value,value:Number($("#acValue").value),maxDiscount:$("#acMax").value===""?null:Number($("#acMax").value),maxUses:$("#acUses").value===""?null:Number($("#acUses").value),maxUsesPerUser:$("#acPerUser").value===""?null:Number($("#acPerUser").value),active:true};if(preview){c.uses=0;mock.coupons.push(c);data.coupons=mock.coupons;$("#modal").classList.remove("show");renderCoupons();return toast("تمت إضافة الكوبون")}try{await api("/api/admin/coupons",{method:"POST",body:JSON.stringify(c)});$("#modal").classList.remove("show");await load();toast("تمت إضافة الكوبون")}catch{toast("تعذر إضافة الكوبون")}}});

function jsonObjectOrNull(text){const t=String(text||"").trim();if(!t)return null;try{const v=JSON.parse(t);return v&&typeof v==="object"&&!Array.isArray(v)?v:null}catch{return null}}
function jsonArrayOrNull(text){const t=String(text||"").trim();if(!t)return null;try{const v=JSON.parse(t);return Array.isArray(v)?v:null}catch{return null}}
$("#addProviderBtn").onclick=()=>modal(`<h3>إضافة مزود API</h3><div class="form-grid">
 <div class="field"><label>ID</label><input id="prId" placeholder="supplier-x"></div><div class="field"><label>الاسم</label><input id="prName" placeholder="Supplier X"></div>
 <div class="field"><label>النوع</label><select id="prType"><option value="http">http</option><option value="manual">manual</option><option value="demo">demo</option><option value="inventory">inventory</option></select></div>
 <div class="field"><label>Timeout ms</label><input id="prTimeout" type="number" value="12000"></div>
 <div class="field"><label>Fallback عند نتيجة غير مؤكدة؟</label><select id="prAmbiguousFallback"><option value="false">لا — الأكثر أمانًا</option><option value="true">نعم — قد يكرر التنفيذ</option></select></div>
 <div class="field"><label>السماح بشبكة خاصة؟</label><select id="prPrivateNetwork"><option value="false">لا — منع SSRF</option><option value="true">نعم — Staging فقط</option></select></div>
 <div class="field"><label>السماح HTTP بدون TLS؟</label><select id="prInsecureHttp"><option value="false">لا — HTTPS فقط</option><option value="true">نعم — Staging فقط</option></select></div>
 <div class="field full"><label>Base URL</label><input id="prBase" placeholder="https://api.supplier.com"></div>
 <div class="field full"><label>Order Path</label><input id="prPath" placeholder="/v1/orders"></div>
 <div class="field full"><label>Status Path</label><input id="prStatusPath" placeholder="/v1/orders/{id}"></div>
 <div class="field"><label>Order Method</label><select id="prOrderMethod"><option>POST</option><option>GET</option><option>PUT</option><option>PATCH</option></select></div>
 <div class="field"><label>Status Method</label><select id="prStatusMethod"><option>GET</option><option>POST</option></select></div>
 <div class="field"><label>Auth Mode</label><select id="prAuthMode"><option value="bearer">Bearer</option><option value="header">Custom Header</option><option value="query">Query API Key</option><option value="none">None</option></select></div>
 <div class="field"><label>Auth Header / Query</label><input id="prAuthName" placeholder="x-api-key"></div>
 <div class="field full"><label>Auth Prefix (اختياري)</label><input id="prAuthPrefix" placeholder="Bearer "></div>
 <div class="field full"><label>اسم متغير سر API في ENV</label><input id="prSecret" placeholder="SUPPLIER_TOKEN"></div>
 <div class="field full"><label>اسم متغير سر Webhook في ENV (اختياري)</label><input id="prWebhookSecret" placeholder="SUPPLIER_WEBHOOK_SECRET"></div>
 <div class="field"><label>Response Order ID Path</label><input id="prRespOrder" placeholder="data.order_id"></div>
 <div class="field"><label>Response Status Path</label><input id="prRespStatus" placeholder="data.status"></div>
 <div class="field"><label>Response Delivery Path</label><input id="prRespDelivery" placeholder="data.code"></div>
 <div class="field full"><label>Response Message Path</label><input id="prRespMessage" placeholder="message"></div>
 <div class="field full"><label>Order Request Fields JSON</label><textarea id="prRequestFields" rows="4" placeholder='{"productId":"service_id","customerData.playerId":"player_id"}'></textarea></div>
 <div class="field full"><label>Order Fixed Payload JSON</label><textarea id="prFixedPayload" rows="3" placeholder='{"currency":"USD"}'></textarea></div>
 <div class="field full"><label>Status Request Fields JSON</label><textarea id="prStatusRequestFields" rows="3" placeholder='{"providerOrderId":"order_id"}'></textarea></div>
 <div class="field full"><label>Status Fixed Payload JSON</label><textarea id="prStatusFixedPayload" rows="3" placeholder='{"action":"status"}'></textarea></div>
 </div><button class="save" id="prSave">إضافة المزود</button>`);
document.addEventListener("click",async e=>{if(e.target.id==="prSave"){const authMode=$("#prAuthMode").value,authName=$("#prAuthName").value.trim();const p={id:$("#prId").value.trim(),name:$("#prName").value.trim(),type:$("#prType").value,timeoutMs:Number($("#prTimeout").value),fallbackOnAmbiguous:$("#prAmbiguousFallback").value==="true",allowPrivateNetwork:$("#prPrivateNetwork").value==="true",allowInsecureHttp:$("#prInsecureHttp").value==="true",baseUrl:$("#prBase").value.trim()||null,orderPath:$("#prPath").value.trim()||null,statusPath:$("#prStatusPath").value.trim()||null,orderMethod:$("#prOrderMethod").value,statusMethod:$("#prStatusMethod").value,secretEnv:$("#prSecret").value.trim()||null,webhookSecretEnv:$("#prWebhookSecret").value.trim()||null,authMode,authHeader:authMode==="header"||authMode==="bearer"?authName||null:null,authQuery:authMode==="query"?authName||"api_key":null,authPrefix:$("#prAuthPrefix").value||null,responseOrderIdPath:$("#prRespOrder").value.trim()||null,responseStatusPath:$("#prRespStatus").value.trim()||null,responseDeliveryPath:$("#prRespDelivery").value.trim()||null,responseMessagePath:$("#prRespMessage").value.trim()||null,requestFields:jsonObjectOrNull($("#prRequestFields").value),fixedPayload:jsonObjectOrNull($("#prFixedPayload").value),statusRequestFields:jsonObjectOrNull($("#prStatusRequestFields").value),statusFixedPayload:jsonObjectOrNull($("#prStatusFixedPayload").value),active:true};if(preview){mock.providers.push(p);data.providers=mock.providers;$("#modal").classList.remove("show");renderProviders();return toast("تمت إضافة المزود في المعاينة")}try{await api("/api/admin/providers",{method:"POST",body:JSON.stringify(p)});$("#modal").classList.remove("show");await load();toast("تمت إضافة المزود")}catch{toast("تعذر إضافة المزود")}}});
function editProvider(id){const p=(data.providers||[]).find(x=>x.id===id);if(!p)return;modal(`<h3>تعديل مزود API</h3><div class="form-grid">
 <div class="field full"><label>الاسم</label><input id="peName" value="${attr(p.name)}"></div><div class="field"><label>النوع</label><select id="peType"><option ${p.type==="http"?"selected":""}>http</option><option ${p.type==="manual"?"selected":""}>manual</option><option ${p.type==="demo"?"selected":""}>demo</option><option ${p.type==="inventory"?"selected":""}>inventory</option></select></div>
 <div class="field"><label>Timeout</label><input id="peTimeout" type="number" value="${p.timeoutMs||12000}"></div><div class="field"><label>Fallback عند نتيجة غير مؤكدة؟</label><select id="peAmbiguousFallback"><option value="false" ${!p.fallbackOnAmbiguous?"selected":""}>لا — الأكثر أمانًا</option><option value="true" ${p.fallbackOnAmbiguous?"selected":""}>نعم — قد يكرر التنفيذ</option></select></div><div class="field"><label>السماح بشبكة خاصة؟</label><select id="pePrivateNetwork"><option value="false" ${!p.allowPrivateNetwork?"selected":""}>لا — منع SSRF</option><option value="true" ${p.allowPrivateNetwork?"selected":""}>نعم — Staging فقط</option></select></div><div class="field"><label>السماح HTTP بدون TLS؟</label><select id="peInsecureHttp"><option value="false" ${!p.allowInsecureHttp?"selected":""}>لا — HTTPS فقط</option><option value="true" ${p.allowInsecureHttp?"selected":""}>نعم — Staging فقط</option></select></div><div class="field full"><label>Base URL</label><input id="peBase" value="${attr(p.baseUrl||"")}"></div><div class="field full"><label>Order Path</label><input id="pePath" value="${attr(p.orderPath||"")}"></div><div class="field full"><label>Status Path</label><input id="peStatusPath" value="${attr(p.statusPath||"")}"></div>
 <div class="field"><label>Order Method</label><select id="peOrderMethod"><option ${p.orderMethod==="POST"||!p.orderMethod?"selected":""}>POST</option><option ${p.orderMethod==="GET"?"selected":""}>GET</option><option ${p.orderMethod==="PUT"?"selected":""}>PUT</option><option ${p.orderMethod==="PATCH"?"selected":""}>PATCH</option></select></div>
 <div class="field"><label>Status Method</label><select id="peStatusMethod"><option ${p.statusMethod==="GET"||!p.statusMethod?"selected":""}>GET</option><option ${p.statusMethod==="POST"?"selected":""}>POST</option></select></div>
 <div class="field"><label>Auth Mode</label><select id="peAuthMode"><option value="bearer" ${(!p.authMode||p.authMode==="bearer")?"selected":""}>Bearer</option><option value="header" ${p.authMode==="header"?"selected":""}>Custom Header</option><option value="query" ${p.authMode==="query"?"selected":""}>Query API Key</option><option value="none" ${p.authMode==="none"?"selected":""}>None</option></select></div>
 <div class="field"><label>Auth Header / Query</label><input id="peAuthName" value="${attr(p.authHeader||p.authQuery||"")}"></div>
 <div class="field full"><label>Auth Prefix</label><input id="peAuthPrefix" value="${attr(p.authPrefix??(p.authMode==="bearer"?"Bearer ":""))}"></div>
 <div class="field full"><label>API Secret ENV</label><input id="peSecret" value="${attr(p.secretEnv||"")}"></div>
 <div class="field full"><label>Webhook Secret ENV</label><input id="peWebhookSecret" value="${attr(p.webhookSecretEnv||"")}"></div>
 <div class="field"><label>Response Order ID Path</label><input id="peRespOrder" value="${attr(p.responseOrderIdPath||"")}"></div><div class="field"><label>Response Status Path</label><input id="peRespStatus" value="${attr(p.responseStatusPath||"")}"></div>
 <div class="field"><label>Response Delivery Path</label><input id="peRespDelivery" value="${attr(p.responseDeliveryPath||"")}"></div>
 <div class="field full"><label>Response Message Path</label><input id="peRespMessage" value="${attr(p.responseMessagePath||"")}"></div>
 <div class="field full"><label>Order Request Fields JSON</label><textarea id="peRequestFields" rows="4">${p.requestFields?esc(JSON.stringify(p.requestFields,null,2)):""}</textarea></div>
 <div class="field full"><label>Order Fixed Payload JSON</label><textarea id="peFixedPayload" rows="3">${p.fixedPayload?esc(JSON.stringify(p.fixedPayload,null,2)):""}</textarea></div>
 <div class="field full"><label>Status Request Fields JSON</label><textarea id="peStatusRequestFields" rows="3">${p.statusRequestFields?esc(JSON.stringify(p.statusRequestFields,null,2)):""}</textarea></div>
 <div class="field full"><label>Status Fixed Payload JSON</label><textarea id="peStatusFixedPayload" rows="3">${p.statusFixedPayload?esc(JSON.stringify(p.statusFixedPayload,null,2)):""}</textarea></div>
 </div><button class="save" id="peSave">حفظ</button>`);
 $("#peSave").onclick=async()=>{const authMode=$("#peAuthMode").value,authName=$("#peAuthName").value.trim();const patch={name:$("#peName").value,type:$("#peType").value,timeoutMs:Number($("#peTimeout").value),fallbackOnAmbiguous:$("#peAmbiguousFallback").value==="true",allowPrivateNetwork:$("#pePrivateNetwork").value==="true",allowInsecureHttp:$("#peInsecureHttp").value==="true",baseUrl:$("#peBase").value||null,orderPath:$("#pePath").value||null,statusPath:$("#peStatusPath").value||null,orderMethod:$("#peOrderMethod").value,statusMethod:$("#peStatusMethod").value,secretEnv:$("#peSecret").value||null,webhookSecretEnv:$("#peWebhookSecret").value||null,authMode,authHeader:authMode==="header"||authMode==="bearer"?authName||null:null,authQuery:authMode==="query"?authName||"api_key":null,authPrefix:$("#peAuthPrefix").value||null,responseOrderIdPath:$("#peRespOrder").value||null,responseStatusPath:$("#peRespStatus").value||null,responseDeliveryPath:$("#peRespDelivery").value||null,responseMessagePath:$("#peRespMessage").value||null,requestFields:jsonObjectOrNull($("#peRequestFields").value),fixedPayload:jsonObjectOrNull($("#peFixedPayload").value),statusRequestFields:jsonObjectOrNull($("#peStatusRequestFields").value),statusFixedPayload:jsonObjectOrNull($("#peStatusFixedPayload").value)};if(preview){Object.assign(p,patch);$("#modal").classList.remove("show");renderProviders();return toast("تم حفظ المزود في المعاينة")}try{await api(`/api/admin/providers/${id}`,{method:"PATCH",body:JSON.stringify(patch)});$("#modal").classList.remove("show");await load();toast("تم حفظ المزود")}catch{toast("تعذر حفظ المزود")}}
}
async function togglePayment(id,active){if(preview){const m=mock.payments.find(x=>x.id===id);if(m)m.active=active;renderPayments();return toast("تم تحديث طريقة الدفع")}try{await api(`/api/admin/payment-methods/${id}`,{method:"PATCH",body:JSON.stringify({active})});await load();toast("تم تحديث طريقة الدفع")}catch{toast("تعذر التحديث")}}

function editPayment(id){
 const m=(data.payments||[]).find(x=>x.id===id);if(!m)return;
 modal(`<h3>تعديل طريقة الدفع</h3><div class="form-grid">
  <div class="field"><label>الاسم</label><input id="payName" value="${attr(m.name||"")}"></div>
  <div class="field full"><label>الصورة</label><input id="payImage" type="file" accept="image/jpeg,image/png,image/webp"></div>
  <div class="field full"><label>الحساب / العنوان</label><input id="payAccount" value="${attr(m.account||"")}"></div>
  <div class="field full"><label>تعليمات العميل</label><textarea id="payInstructions" rows="4">${esc(m.instructions||"")}</textarea></div>
  <div class="field full"><label>Checkout URL Template (اختياري)</label><input id="payCheckout" value="${attr(m.checkoutUrlTemplate||"")}" placeholder="https://pay.example.com/?id={topupId}&amount={amount}"></div>
  <div class="field"><label>أقل مبلغ</label><input id="payMin" type="number" value="${m.minAmount||1}"></div>
  <div class="field"><label>أعلى مبلغ</label><input id="payMax" type="number" value="${m.maxAmount||1000}"></div>
  <div class="field"><label>المرجع مطلوب؟</label><select id="payRef"><option value="true" ${m.requiresReference?"selected":""}>نعم</option><option value="false" ${!m.requiresReference?"selected":""}>لا</option></select></div>
  <div class="field"><label>الترتيب</label><input id="paySort" type="number" value="${m.sort||0}"></div>
 </div><button class="save" id="paySave">حفظ</button>`);
 $("#paySave").onclick=async()=>{
  try{
   const file=$("#payImage").files?.[0]||null,imageUrl=file?await uploadAdminImage(file,"payment"):m.imageUrl||null;
   const patch={name:$("#payName").value,imageUrl,icon:"",account:$("#payAccount").value,instructions:$("#payInstructions").value,checkoutUrlTemplate:$("#payCheckout").value.trim()||null,minAmount:Number($("#payMin").value),maxAmount:Number($("#payMax").value),requiresReference:$("#payRef").value==="true",sort:Number($("#paySort").value)};
   if(preview){Object.assign(m,patch);$("#modal").classList.remove("show");renderPayments();return toast("تم حفظ طريقة الدفع")}
   await api(`/api/admin/payment-methods/${id}`,{method:"PATCH",body:JSON.stringify(patch)});$("#modal").classList.remove("show");await load();toast("تم حفظ طريقة الدفع");
  }catch(e){toast(e.message==="image_too_large"?"الصورة أكبر من 2MB":"تعذر حفظ طريقة الدفع")}
 };
}
$("#addPaymentBtn").onclick=()=>modal(`<h3>إضافة طريقة دفع</h3><div class="form-grid">
  <div class="field"><label>ID</label><input id="newPayId" placeholder="wallet"></div>
  <div class="field"><label>الاسم</label><input id="newPayName" placeholder="محفظة محلية"></div>
  <div class="field full"><label>الصورة</label><input id="newPayImage" type="file" accept="image/jpeg,image/png,image/webp"></div>
  <div class="field"><label>الترتيب</label><input id="newPaySort" type="number" value="10"></div>
  <div class="field full"><label>الحساب / العنوان</label><input id="newPayAccount"></div>
  <div class="field full"><label>التعليمات</label><textarea id="newPayInstructions" rows="4"></textarea></div>
  <div class="field full"><label>Checkout URL Template (اختياري)</label><input id="newPayCheckout" placeholder="https://pay.example.com/?id={topupId}&amount={amount}"></div>
  <div class="field"><label>أقل مبلغ</label><input id="newPayMin" type="number" value="1"></div>
  <div class="field"><label>أعلى مبلغ</label><input id="newPayMax" type="number" value="1000"></div>
 </div><button class="save" id="newPaySave">إضافة</button>`);
document.addEventListener("click",async e=>{
 if(e.target.id!=="newPaySave")return;
 try{
  const imageUrl=await uploadAdminImage($("#newPayImage").files?.[0]||null,"payment");
  const m={id:$("#newPayId").value.trim(),name:$("#newPayName").value.trim(),imageUrl,icon:"",sort:Number($("#newPaySort").value),account:$("#newPayAccount").value,instructions:$("#newPayInstructions").value,checkoutUrlTemplate:$("#newPayCheckout").value.trim()||null,minAmount:Number($("#newPayMin").value),maxAmount:Number($("#newPayMax").value),requiresReference:true,active:true};
  if(!m.id||!m.name)return toast("ID والاسم مطلوبان");
  if(preview){mock.payments.push(m);data.payments=mock.payments;$("#modal").classList.remove("show");renderPayments();return toast("تمت إضافة طريقة الدفع")}
  await api("/api/admin/payment-methods",{method:"POST",body:JSON.stringify(m)});$("#modal").classList.remove("show");await load();toast("تمت إضافة طريقة الدفع");
 }catch(e){toast(e.message==="image_too_large"?"الصورة أكبر من 2MB":"تعذر إضافة طريقة الدفع")}
});

$("#runSyncBtn").onclick=async()=>{
 try{
   const r=await api("/api/admin/sync-worker/run",{method:"POST"});
   data.syncWorker=r.runtime?{...(data.syncWorker||{}),runtime:r.runtime}:data.syncWorker;
   if(preview)data.syncWorker=mock.syncWorker;
   renderOperations();toast(r.skipped?"المزامنة تعمل بالفعل":"تم تشغيل مزامنة الطلبات");
 }catch{toast("تعذر تشغيل المزامنة")}
};
$("#downloadBackupBtn").onclick=async()=>{
 if(preview)return toast("تنزيل النسخة الاحتياطية يعمل على السيرفر الفعلي");
 try{
   const r=await fetch("/api/admin/backup",{headers:{authorization:`Bearer ${adminToken}`}});
   if(r.status===401){showLogin("انتهت جلسة الإدارة.");return}
   if(!r.ok)throw new Error("backup_failed");
   const disposition=r.headers.get("content-disposition")||"",m=disposition.match(/filename="([^"]+)"/),filename=m?.[1]||`game-zone-backup-${Date.now()}.json`;
   if(window.GameZoneAndroid?.saveTextFile){
     const text=await r.text(),result=window.GameZoneAndroid.saveTextFile(filename,text,"application/json");
     if(String(result).startsWith("error")||result==="unsupported_android_version")throw new Error("android_save_failed");
     return toast("تم حفظ النسخة في Downloads/GameZone");
   }
   const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");
   a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
   toast("تم تجهيز النسخة الاحتياطية");
 }catch{toast("تعذر تنزيل النسخة الاحتياطية")}
};
$("#flushStorageBtn").onclick=async()=>{
 try{
   const r=await api("/api/admin/storage/flush",{method:"POST"});
   data.storage=r;renderOperations();toast("تم حفظ حالة التخزين");
 }catch{toast("تعذر حفظ التخزين")}
};
$("#verifyStorageBtn").onclick=async()=>{
 try{
   const r=await api("/api/admin/storage/verify",{method:"POST",body:"{}"});
   if(!r.ok)return toast("فشل تحقق Snapshot");
   await load();toast(`Snapshot سليم — revision ${r.current?.revision??"-"} / history ${Number(r.history?.checked||0)} verified`);
 }catch{toast("تعذر التحقق من Snapshot")}
};
$("#revokeAdminSessionsBtn").onclick=async()=>{
 const typed=prompt("سيتم إبطال جميع جلسات الإدارة الحالية. اكتب REVOKE_ALL_ADMIN_SESSIONS للتأكيد.");
 if(typed!=="REVOKE_ALL_ADMIN_SESSIONS")return toast("تم إلغاء العملية");
 if(preview){localStorage.removeItem("gamezone_admin_token");adminToken="";showLogin("تم إبطال الجلسات في المعاينة.");return}
 try{
   const r=await api("/api/admin/session/revoke-all",{method:"POST",body:JSON.stringify({confirmation:"REVOKE_ALL_ADMIN_SESSIONS"})});
   if(r.ok){localStorage.removeItem("gamezone_admin_token");adminToken="";showLogin("تم إبطال كل جلسات الإدارة. سجل الدخول من جديد.");toast("تم إبطال جميع جلسات الإدارة")}
 }catch{toast("تعذر إبطال جلسات الإدارة")}
};
$("#runMaintenanceBtn").onclick=async()=>{
 if(!confirm("تشغيل تنظيف السجلات القديمة الآن؟"))return;
 try{
   const r=await api("/api/admin/maintenance/run",{method:"POST",body:"{}"});
   data.maintenance={...(data.maintenance||{}),runtime:r.runtime};renderOperations();toast("اكتمل تنظيف السجلات القديمة");
 }catch{toast("تعذر تشغيل التنظيف")}
};
$("#scanIntegrityBtn").onclick=async()=>{
 try{data.integrity=await api("/api/admin/integrity");renderOperations();toast("اكتمل فحص سلامة البيانات")}catch{toast("تعذر فحص سلامة البيانات")}
};
$("#repairIntegrityBtn").onclick=async()=>{
 if(!confirm("تشغيل الإصلاحات الآمنة؟ سيتم مزامنة عدادات الكوبونات وإزالة السجلات اليتيمة غير المالية."))return;
 try{
   const r=await api("/api/admin/integrity/repair-safe",{method:"POST",body:JSON.stringify({confirmation:"REPAIR_SAFE"})});
   data.integrity=r.integrity;renderOperations();toast(`اكتمل الإصلاح الآمن — ${Number(r.result?.count||0)} تغيير`);
 }catch{toast("تعذر تنفيذ الإصلاح الآمن")}
};
$("#reconcileWalletsBtn").onclick=async()=>{
 const typed=prompt("هذه عملية مالية: ستتم إعادة بناء أرصدة المستخدمين من سجل Transactions. اكتب RECONCILE_WALLETS للتأكيد.");
 if(typed!=="RECONCILE_WALLETS")return toast("تم إلغاء مطابقة المحافظ");
 try{
   const r=await api("/api/admin/integrity/reconcile-wallets",{method:"POST",body:JSON.stringify({confirmation:"RECONCILE_WALLETS"})});
   data.integrity=r.integrity;await load();toast(`تمت مطابقة ${Number(r.result?.count||0)} محفظة`);
 }catch{toast("تعذر مطابقة المحافظ")}
};

$("#addInventoryBtn").onclick=()=>{
 const inventoryProducts=(data.products||[]).filter(p=>p.delivery==="inventory");
 const opts=inventoryProducts.map(p=>`<option value="${attr(p.id)}">${esc(p.name)}</option>`).join("");
 modal(`<h3>إضافة أكواد رقمية</h3><div class="form-grid"><div class="field full"><label>المنتج</label><select id="invProduct">${opts||'<option value="gz-demo-code">Game Zone Demo</option>'}</select></div><div class="field full"><label>الأكواد — كود في كل سطر</label><textarea id="invCodes" rows="9" placeholder="CODE-001\nCODE-002\nCODE-003"></textarea></div></div><button class="save" id="invSave">إضافة للمخزون</button>`);
};
document.addEventListener("click",async e=>{if(e.target.id==="invSave"){const productId=$("#invProduct").value,text=$("#invCodes").value;if(!text.trim())return toast("أدخل الأكواد");if(preview){const codes=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);for(const c of codes)mock.inventory.push({id:"inv_"+Date.now()+Math.random(),productId,status:"available",orderNo:null,masked:c.slice(0,3)+"********"+c.slice(-3),encrypted:true,createdAt:new Date().toISOString()});const row=mock.inventorySummary.find(x=>x.productId===productId);if(row){row.available+=codes.length;row.total+=codes.length}data.inventory=mock.inventory;data.inventorySummary=mock.inventorySummary;$("#modal").classList.remove("show");renderInventory();return toast("تمت إضافة الأكواد")};try{const r=await api("/api/admin/inventory/bulk",{method:"POST",body:JSON.stringify({productId,text})});$("#modal").classList.remove("show");await load();toast(`تمت إضافة ${r.added} كود`)}catch{toast("تعذر إضافة الأكواد")}}});

$("#addCategoryBtn").onclick=()=>modal(`<h3>إضافة قسم</h3><div class="form-grid">
 <div class="field"><label>ID</label><input id="catId" placeholder="gift-cards"></div>
 <div class="field"><label>الاسم</label><input id="catName" placeholder="بطاقات الهدايا"></div>
 <div class="field"><label>القسم الأب</label><select id="catParent">${categoryOptions(null,{includeRoot:true})}</select></div>
 <div class="field"><label>الترتيب</label><input id="catSort" type="number" value="10"></div>
 <div class="field full"><label>الصورة</label><input id="catImage" type="file" accept="image/jpeg,image/png,image/webp"></div>
 <div class="field full"><label>الوصف الداخلي</label><input id="catDesc"></div>
 </div><button class="save" id="catSave">إضافة القسم</button>`);
document.addEventListener("click",async e=>{if(e.target.id==="catSave"){
 try{
  const imageUrl=await uploadAdminImage($("#catImage").files?.[0]||null,"category");
  const c={id:$("#catId").value.trim(),name:$("#catName").value.trim(),parentId:$("#catParent").value||null,imageUrl,icon:"",sort:Number($("#catSort").value),description:$("#catDesc").value,active:true};
  if(!c.id||!c.name)return toast("ID والاسم مطلوبان");
  if(preview){mock.categories.push(c);data.categories=mock.categories;$("#modal").classList.remove("show");renderCategories();return toast("تمت إضافة القسم")}
  await api("/api/admin/categories",{method:"POST",body:JSON.stringify(c)});$("#modal").classList.remove("show");await load();toast("تمت إضافة القسم");
 }catch(e){toast(e.message==="image_too_large"?"الصورة أكبر من 2MB":"تعذر إضافة القسم")}
}});

$("#addAnnouncementBtn").onclick=()=>modal(`<h3>إضافة إعلان</h3><div class="form-grid"><div class="field full"><label>العنوان</label><input id="anTitle"></div><div class="field full"><label>النص</label><input id="anBody"></div><div class="field"><label>النوع</label><select id="anType"><option value="info">معلومة</option><option value="offer">عرض</option></select></div><div class="field"><label>الترتيب</label><input id="anSort" type="number" value="1"></div></div><button class="save" id="anSave">إضافة الإعلان</button>`);
document.addEventListener("click",async e=>{if(e.target.id==="anSave"){const a={title:$("#anTitle").value,body:$("#anBody").value,type:$("#anType").value,sort:Number($("#anSort").value),active:true};if(preview){a.id="ann_"+Date.now();mock.announcements.unshift(a);data.announcements=mock.announcements;$("#modal").classList.remove("show");renderAnnouncements();return toast("تمت إضافة الإعلان")}try{await api("/api/admin/announcements",{method:"POST",body:JSON.stringify(a)});$("#modal").classList.remove("show");await load();toast("تمت إضافة الإعلان")}catch{toast("تعذر إضافة الإعلان")}}});

$("#broadcastSend").onclick=async()=>{
 const title=$("#broadcastTitle").value.trim()||"Game Zone",message=$("#broadcastMessage").value.trim(),audience=$("#broadcastAudience").value;
 if(!message)return toast("اكتب الرسالة");
 if(preview){
   const total=128,job={id:"br_"+Date.now(),title,message,audience,total,sent:0,failed:0,processed:0,status:"queued",createdAt:new Date().toISOString()};
   mock.broadcasts.unshift(job);data.broadcasts=mock.broadcasts;$("#broadcastMessage").value="";renderBroadcasts();toast("تمت جدولة البث في المعاينة");
   setTimeout(()=>{job.status="running";job.processed=64;job.sent=63;job.failed=1;renderBroadcasts()},700);
   setTimeout(()=>{job.status="completed";job.processed=128;job.sent=126;job.failed=2;job.finishedAt=new Date().toISOString();renderBroadcasts()},1500);
   return;
 }
 if(!confirm("جدولة هذه الرسالة للإرسال للمستخدمين؟"))return;
 try{
   await api("/api/admin/broadcast",{method:"POST",body:JSON.stringify({title,message,audience,confirmation:"SEND_BROADCAST"})});
   $("#broadcastMessage").value="";await load();toast("تمت جدولة البث وسيتم الإرسال تدريجيًا");
   setTimeout(()=>load().catch(()=>{}),1800);
 }catch{toast("تعذر جدولة البث")}
};


document.addEventListener("click",e=>{
 const b=e.target.closest("[data-action]");
 if(!b)return;
 const action=b.dataset.action,id=b.dataset.id||"";
 if(action==="set-order")return setOrder(id,b.dataset.status);
 if(action==="sync-order")return syncOrder(id);
 if(action==="manual-start")return startManualOrder(id);
 if(action==="order-detail")return orderDetail(id);
 if(action==="user-detail")return userDetail(id);
 if(action==="edit-product")return editProduct(id);
 if(action==="edit-coupon")return editCoupon(id);
 if(action==="topup")return topupAction(id,b.dataset.topupAction);
 if(action==="receipt-topup")return viewTopupReceipt(id);
 if(action==="balance")return balance(id,b.dataset.plus==="1");
 if(action==="test-provider")return testProvider(id);
 if(action==="edit-provider")return editProvider(id);
 if(action==="edit-payment")return editPayment(id);
 if(action==="toggle-payment")return togglePayment(id,b.dataset.active==="1");
 if(action==="edit-category")return editCategory(id);
 if(action==="edit-announcement")return editAnnouncement(id);
 if(action==="reply-ticket")return replyTicket(id);
 if(action==="reveal-inventory")return revealInventory(id);
 if(action==="disable-inventory")return disableInventory(id);
});

$("#exportOrders").onclick=()=>exportCsv("orders");
$("#exportUsers").onclick=()=>exportCsv("users");
$("#exportProfits").onclick=()=>exportCsv("profits");

$("#adminKeyBtn").onclick=()=>{if(preview)return toast("المعاينة لا تحتاج تسجيل دخول");if(confirm("إنهاء جلسة الإدارة الحالية؟")){adminToken="";localStorage.removeItem("gamezone_admin_token");showLogin("تم تسجيل الخروج.")}};
$("#adminLoginBtn").onclick=loginAdmin;$("#adminPassword").addEventListener("keydown",e=>{if(e.key==="Enter")loginAdmin()});
$$("nav button").forEach(b=>b.onclick=()=>{$$("nav button").forEach(x=>x.classList.remove("active"));b.classList.add("active");$$(".page").forEach(p=>p.classList.toggle("active",p.dataset.pageView===b.dataset.page));$("#pageTitle").textContent=b.querySelector("span")?.textContent||"Game Zone"});
$$("[data-refresh]").forEach(b=>b.onclick=load);
const bindFilter=(id,key,render,event="input")=>{const el=$("#"+id);if(el)el.addEventListener(event,()=>{filters[key]=el.value;render()})};
bindFilter("ordersSearch","orders",renderOrders);bindFilter("ordersStatusFilter","orderStatus",renderOrders,"change");
bindFilter("productsSearch","products",renderProducts);bindFilter("productsDeliveryFilter","productDelivery",renderProducts,"change");
bindFilter("topupsSearch","topups",renderTopups);bindFilter("topupsStatusFilter","topupStatus",renderTopups,"change");
bindFilter("usersSearch","users",renderUsers);
bindFilter("supportSearch","support",renderSupport);bindFilter("supportStatusFilter","supportStatus",renderSupport,"change");
if(preview){adminToken="preview";hideLogin();load()}else if(adminToken){hideLogin();load()}else{showLogin()};