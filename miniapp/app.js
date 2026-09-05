const API_BASE = /^https?:$/.test(location.protocol) ? "" : null;
const tg = window.Telegram?.WebApp || null;
const state = {
  user:{telegramId:"preview-1001",username:"gamezone_user",firstName:"مستخدم Game Zone",lastName:"",balance:25,currency:"USD"},
  sessionToken:"",
  config:{storeName:"Game Zone",tagline:"متجر المنتجات الرقمية",maintenance:false,showAnnouncements:true,minTopup:1,maxTopup:1000,paymentMethods:[{id:"manual",name:"تحويل يدوي",icon:"",imageUrl:null,instructions:"حوّل المبلغ ثم أدخل رقم العملية وارفع صورة الإيصال.",account:"حساب Game Zone التجريبي",requiresReference:true,minAmount:1,maxAmount:1000}]},
  categories:[],products:[],orders:[],transactions:[],topups:[],supportTickets:[],favorites:[],notifications:[],announcements:[],preview:!API_BASE
};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const fallback={
  categories:[
    {id:"games",name:"شحن الألعاب",icon:"",imageUrl:null,parentId:null,description:"",sort:1},
    {id:"digital-cards",name:"البطاقات الرقمية",icon:"",imageUrl:null,parentId:null,description:"",sort:2},
    {id:"apps",name:"التطبيقات والخدمات",icon:"",imageUrl:null,parentId:null,description:"",sort:3},
    {id:"gift-cards",name:"بطاقات الهدايا",icon:"",imageUrl:null,parentId:null,description:"",sort:4},
    {id:"pubg",name:"PUBG Mobile",icon:"",imageUrl:null,parentId:"games",description:"",sort:1},
    {id:"freefire",name:"Free Fire",icon:"",imageUrl:null,parentId:"games",description:"",sort:2},
    {id:"mobile-legends",name:"Mobile Legends",icon:"",imageUrl:null,parentId:"games",description:"",sort:3},
    {id:"call-of-duty",name:"Call of Duty",icon:"",imageUrl:null,parentId:"games",description:"",sort:4},
    {id:"steam",name:"Steam",icon:"",imageUrl:null,parentId:"digital-cards",description:"",sort:1},
    {id:"playstation",name:"PlayStation",icon:"",imageUrl:null,parentId:"digital-cards",description:"",sort:2},
    {id:"xbox",name:"Xbox",icon:"",imageUrl:null,parentId:"digital-cards",description:"",sort:3},
    {id:"nintendo",name:"Nintendo",icon:"",imageUrl:null,parentId:"digital-cards",description:"",sort:4},
    {id:"netflix",name:"Netflix",icon:"",imageUrl:null,parentId:"apps",description:"",sort:1},
    {id:"spotify",name:"Spotify",icon:"",imageUrl:null,parentId:"apps",description:"",sort:2},
    {id:"telegram",name:"Telegram Premium",icon:"",imageUrl:null,parentId:"apps",description:"",sort:3},
    {id:"youtube",name:"YouTube Premium",icon:"",imageUrl:null,parentId:"apps",description:"",sort:4},
    {id:"amazon",name:"Amazon",icon:"",imageUrl:null,parentId:"gift-cards",description:"",sort:1},
    {id:"google-play",name:"Google Play",icon:"",imageUrl:null,parentId:"gift-cards",description:"",sort:2},
    {id:"itunes",name:"iTunes",icon:"",imageUrl:null,parentId:"gift-cards",description:"",sort:3},
    {id:"razer",name:"Razer Gold",icon:"",imageUrl:null,parentId:"gift-cards",description:"",sort:4}
  ],
  products:[
    {id:"pubg-60",categoryId:"pubg",name:"60 UC",imageUrl:null,description:"شحن مباشر على معرف اللاعب",price:0.99,currency:"USD",inputLabel:"Player ID",inputSchema:[{key:"playerId",label:"Player ID",type:"text",required:true,placeholder:"أدخل معرف اللاعب",maxLength:64}],featured:false,delivery:"auto",deliveryText:"فوري"},
    {id:"pubg-325",categoryId:"pubg",name:"325 UC",imageUrl:null,description:"شحن مباشر على معرف اللاعب",price:4.79,currency:"USD",inputLabel:"Player ID",inputSchema:[{key:"playerId",label:"Player ID",type:"text",required:true,placeholder:"أدخل معرف اللاعب",maxLength:64}],featured:false,delivery:"auto",deliveryText:"فوري"},
    {id:"pubg-660",categoryId:"pubg",name:"660 UC",imageUrl:null,description:"شحن مباشر على معرف اللاعب",price:9.39,currency:"USD",inputLabel:"Player ID",inputSchema:[{key:"playerId",label:"Player ID",type:"text",required:true,placeholder:"أدخل معرف اللاعب",maxLength:64}],featured:false,delivery:"auto",deliveryText:"فوري"},
    {id:"ff-100",categoryId:"freefire",name:"100 Diamonds",imageUrl:null,description:"شحن مباشر",price:1.20,currency:"USD",inputLabel:"Player ID",inputSchema:[{key:"playerId",label:"Player ID",type:"text",required:true,placeholder:"أدخل معرف اللاعب",maxLength:64}],featured:false,delivery:"auto",deliveryText:"فوري"},
    {id:"steam-10",categoryId:"steam",name:"Steam $10",imageUrl:null,description:"بطاقة رقمية",price:10.30,currency:"USD",inputLabel:"المنطقة",inputSchema:[],featured:false,delivery:"inventory",stock:3,deliveryText:"فوري"},
    {id:"psn-10",categoryId:"playstation",name:"PSN $10",imageUrl:null,description:"بطاقة رقمية",price:11,currency:"USD",inputLabel:"المنطقة",inputSchema:[],featured:false,delivery:"inventory",stock:3,deliveryText:"فوري"},
    {id:"netflix-1m",categoryId:"netflix",name:"اشتراك شهر",imageUrl:null,description:"اشتراك رقمي",price:7.90,currency:"USD",inputLabel:"بيانات الحساب",inputSchema:[{key:"email",label:"البريد الإلكتروني",type:"email",required:true,placeholder:"name@example.com",maxLength:160}],featured:false,delivery:"manual",deliveryText:"ضمن أوقات العمل"},
    {id:"telegram-1m",categoryId:"telegram",name:"اشتراك شهر",imageUrl:null,description:"اشتراك رقمي",price:4.99,currency:"USD",inputLabel:"Telegram Username",inputSchema:[{key:"username",label:"Telegram Username",type:"text",required:true,placeholder:"@username",maxLength:64}],featured:false,delivery:"auto",deliveryText:"فوري"}
  ],
  announcements:[{id:"ann1",title:"أهلًا بك في Game Zone",body:"متجر المنتجات الرقمية",type:"info",active:true}]
};
async function api(path,options={}){
  if(!API_BASE)throw new Error("preview");
  const r=await fetch(API_BASE+path,{headers:{"content-type":"application/json",...(state.sessionToken?{authorization:`Bearer ${state.sessionToken}`}:{}) ,...(options.headers||{})},...options});
  const d=await r.json().catch(()=>({}));
  if(r.status===401&&["user_session_revoked","user_session_invalid","user_unauthorized"].includes(d.error)&&state.sessionToken){
    stopLiveRefresh();clearSession();
    setTimeout(()=>{if(window.Telegram?.WebApp?.initData)bootstrap();else showAuthGate()},0);
  }
  if(!r.ok)throw Object.assign(new Error(d.error||"request_failed"),{data:d});return d;
}
function displayCurrencyConfig(){
  const fallback={code:"USD",symbol:"$",rate:1,enabled:true};
  let requested="USD";
  try{requested=String(localStorage.getItem("gamezone_display_currency")||state.user?.currency||"USD").toUpperCase()}catch{}
  const list=Array.isArray(state.config?.currencies)?state.config.currencies:[];
  const found=list.find(c=>String(c.code||"").toUpperCase()===requested&&c.enabled===true);
  if(found){
    const rate=Number(found.rate||1);
    if(Number.isFinite(rate)&&rate>0)return {code:requested,symbol:String(found.symbol||requested),rate};
  }
  return fallback;
}
function baseMoney(v){
  const n=Number(v||0),sign=n<0?"-":"";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}
function money(v){
  const cfg=displayCurrencyConfig(),raw=Number(v||0)*cfg.rate,sign=raw<0?"-":"",abs=Math.abs(raw);
  const decimals=cfg.code==="SYP"?0:2;
  const value=abs.toLocaleString("en-US",{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
  if(cfg.code==="SYP")return `${sign}${value} ${cfg.symbol}`;
  return `${sign}${cfg.symbol}${value}`;
}
function esc(v){
  return String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
}
function toast(msg){const e=$("#toast");e.textContent=msg;e.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("show"),2500)}
function go(name){
  $$(".screen").forEach(s=>s.classList.toggle("active",s.dataset.screen===name));
  $$(".bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.go===name));
  window.scrollTo({top:0,behavior:"smooth"});
  if(name==="orders")loadOrders();
  if(name==="wallet")loadWallet();
  if(name==="favorites")loadFavorites();
  if(name==="notifications")loadNotifications();
  if(name==="support")loadSupportTickets();
}
$$("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));
const categoryBackBtn=$("#categoryBack");if(categoryBackBtn)categoryBackBtn.onclick=backCategory;
function renderConfig(){
  const tag=$("#tagline");if(tag)tag.textContent=state.config.tagline||"متجر المنتجات الرقمية";
  const mb=$("#maintenanceBanner");
  if(mb){
    if(state.config.maintenance){mb.textContent=state.config.maintenanceMessage||"المتجر تحت الصيانة";mb.classList.remove("hidden")}
    else mb.classList.add("hidden");
  }
}
function renderAnnouncements(){
  const host=$("#announcementHost");if(!host)return;
  if(state.config.showAnnouncements===false){host.innerHTML="";return}
  host.innerHTML=(state.announcements||[]).slice(0,3).map(a=>`<div class="announcement"><div class="ann-icon" aria-hidden="true"></div><div><b>${esc(a.title)}</b><p>${esc(a.body)}</p></div></div>`).join("");
}
function renderUser(){
  const wallet=$("#walletBalance");if(wallet)wallet.textContent=money(state.user.balance);
  const profileName=$("#profileName");if(profileName)profileName.textContent=[state.user.firstName,state.user.lastName].filter(Boolean).join(" ")||"عميل Game Zone";
  const profileId=$("#profileId");if(profileId)profileId.textContent=state.user.username?"@"+state.user.username:`ID: ${state.user.telegramId}`;
}
function isFav(id){return state.favorites.some(p=>p.id===id)}
let currentCategoryId=null;
function catalogImage(item,label,overlay=""){
  const url=item?.imageUrl?esc(item.imageUrl):"";
  return `<div class="catalog-image">${url?`<img src="${url}" alt="">`:`<span>${esc(label)}</span>`}${overlay}</div>`;
}
function categoryCard(c){return `<button class="catalog-card" data-category="${esc(c.id)}">${catalogImage(c,"صورة القسم")}<b>${esc(c.name)}</b></button>`}
function productCard(p){
  const price=`<span class="catalog-price-badge">${money(p.price)}</span>`;
  return `<button class="catalog-card product-catalog-card" data-product="${esc(p.id)}">${catalogImage(p,"صورة المنتج",price)}<b>${esc(p.name)}</b></button>`;
}
function renderProducts(container,list){
  if(!container)return;
  container.innerHTML=(list||[]).map(productCard).join("");
  bindProductActions();
}
function bindProductActions(){
  $$('[data-product]').forEach(b=>b.onclick=()=>openProduct(b.dataset.product));
}
function bindCategoryActions(){
  $$('[data-category]').forEach(b=>b.onclick=()=>openCategory(b.dataset.category));
}
function rootCategories(){return state.categories.filter(c=>!c.parentId).sort((a,b)=>Number(a.sort||0)-Number(b.sort||0))}
function renderHome(list=rootCategories()){
  const host=$("#categories");if(!host)return;
  host.innerHTML=(list||[]).map(categoryCard).join("");
  bindCategoryActions();
}
function openCategory(id){
  const c=state.categories.find(x=>x.id===id);if(!c)return;
  currentCategoryId=id;
  $("#categoryTitle").textContent=c.name;
  const children=state.categories.filter(x=>x.parentId===id).sort((a,b)=>Number(a.sort||0)-Number(b.sort||0));
  const childrenHost=$("#categoryChildren"),productsHost=$("#categoryProducts");
  childrenHost.innerHTML=children.map(categoryCard).join("");
  if(children.length){productsHost.innerHTML="";bindCategoryActions()}
  else renderProducts(productsHost,state.products.filter(p=>p.categoryId===id));
  go("category");
}
function backCategory(){
  const c=state.categories.find(x=>x.id===currentCategoryId);
  if(c?.parentId)return openCategory(c.parentId);
  currentCategoryId=null;go("home");
}
function openSheet(html,mode="default"){
  $("#sheetBody").innerHTML=html;
  $("#sheet").classList.toggle("purchase-dialog",mode==="purchase");
  $("#sheet").classList.add("show");
}
function closeSheet(){$("#sheet").classList.remove("show","purchase-dialog")}
$("#sheetClose").onclick=closeSheet;$("#sheet").onclick=e=>{if(e.target.id==="sheet")closeSheet()};
document.addEventListener("click",e=>{if(e.target.closest("[data-sheet-close]"))closeSheet()});
function productInputSchema(p){
  if(Array.isArray(p.inputSchema))return p.inputSchema;
  if(p.inputRequired===false)return [];
  return [{key:"value",label:p.inputLabel||"بيانات الطلب",type:"text",required:true,placeholder:p.inputLabel||"أدخل البيانات",maxLength:500,options:[]}];
}
function productInputHtml(p){
  return productInputSchema(p).map(f=>{
    const key=esc(f.key),label=esc(f.label||f.key),placeholder=esc(f.placeholder||""),help=f.help?`<small class="input-help">${esc(f.help)}</small>`:"";
    if(f.type==="select")return `<div class="field"><label>${label}${f.required!==false?" *":""}</label><select id="orderField_${key}"><option value="">اختر</option>${(f.options||[]).map(o=>`<option value="${esc(o.value)}">${esc(o.label||o.value)}</option>`).join("")}</select>${help}</div>`;
    const type=["number","email","tel"].includes(f.type)?f.type:"text";
    const min=f.min!=null?` min="${esc(f.min)}"`:"",max=f.max!=null?` max="${esc(f.max)}"`:"",maxlength=f.maxLength?` maxlength="${Number(f.maxLength)}"`:"";
    return `<div class="field"><label>${label}${f.required!==false?" *":""}</label><input id="orderField_${key}" type="${type}" placeholder="${placeholder}"${min}${max}${maxlength}>${help}</div>`;
  }).join("");
}
function collectProductInputs(p){
  const data={};
  for(const f of productInputSchema(p)){
    const el=$("#orderField_"+f.key);if(!el)continue;
    const value=String(el.value||"").trim();
    if(f.required!==false&&!value){toast(`أدخل ${f.label||"بيانات الطلب"}`);el.focus();return null}
    if(value)data[f.key]=value;
  }
  return data;
}
function customerDataLines(p,data){
  const schema=productInputSchema(p);
  if(!schema.length)return `<div class="confirm-line"><span>بيانات الطلب</span><strong>لا يحتاج بيانات إضافية</strong></div>`;
  return schema.map(f=>`<div class="confirm-line"><span>${esc(f.label||f.key)}</span><strong>${esc(data[f.key]||"-")}</strong></div>`).join("");
}
function openProduct(id){
  const p=state.products.find(x=>x.id===id);if(!p)return;
  if(p.delivery==="inventory"&&Number(p.stock||0)<=0)return toast("هذا المنتج غير متوفر في المخزون حاليًا");
  const customerDelivery=String(p.deliveryText||"حسب المنتج").trim()||"حسب المنتج";
  openSheet(`<div class="purchase-header">
      <div class="purchase-thumb">${p.imageUrl?`<img src="${esc(p.imageUrl)}" alt="">`:`<span>صورة المنتج</span>`}</div>
      <div class="purchase-title"><small>المنتج</small><h3>${esc(p.name)}</h3><span class="purchase-delivery">${esc(customerDelivery)}</span></div>
      <strong class="purchase-price">${money(p.price)}</strong>
    </div>
    ${p.description?`<p class="purchase-description">${esc(p.description)}</p>`:""}
    ${productInputHtml(p)}
    <div class="field"><label>كود الخصم (اختياري)</label><input id="couponInput" placeholder="مثال: GZ10"></div>
    <div id="couponPreview" class="coupon-preview">أدخل الكود واضغط تحقق</div>
    <div class="sheet-actions purchase-actions"><button id="detailFavorite">${isFav(p.id)?"إزالة من المفضلة":"إضافة للمفضلة"}</button><button id="couponCheck">تحقق من الخصم</button><button class="confirm" id="reviewOrder">مراجعة وشراء</button></div>`,"purchase");
  $("#detailFavorite").onclick=async()=>{await toggleFavorite(p.id);closeSheet()};
  $("#couponCheck").onclick=()=>previewCoupon(p);
  $("#reviewOrder").onclick=()=>reviewOrder(p);
}
async function previewCoupon(p){
  const code=$("#couponInput").value.trim(),el=$("#couponPreview");
  if(!code){el.textContent="أدخل كود الخصم أولًا";return}
  if(state.preview){
    const valid=code.toUpperCase()==="GZ10",discount=valid?Math.min(p.price*.1,5):0;
    el.classList.toggle("good",valid);el.textContent=valid?`✅ خصم ${money(discount)} — السعر بعد الخصم ${money(p.price-discount)}`:"الكود غير صالح";return;
  }
  try{const r=await api("/api/coupons/preview",{method:"POST",body:JSON.stringify({productId:p.id,couponCode:code})});
    el.classList.toggle("good",r.valid);el.textContent=r.valid?`✅ خصم ${money(r.discount)} — السعر النهائي ${money(r.finalPrice)}`:"الكود غير صالح";
  }catch{el.textContent="تعذر التحقق من الكود"}
}
function reviewOrder(p){
  if(state.config.maintenance)return toast(state.config.maintenanceMessage||"المتجر تحت الصيانة");
  const customerData=collectProductInputs(p);if(customerData===null)return;
  const couponCode=$("#couponInput").value.trim();
  const clientRequestId=`${state.user.telegramId}:${p.id}:${Date.now()}:${Math.random().toString(36).slice(2,10)}`;
  const customerDelivery=String(p.deliveryText||"حسب المنتج").trim()||"حسب المنتج";
  openSheet(`<h3>تأكيد الطلب</h3><p>راجع بيانات الحساب أو المعرف بدقة قبل تأكيد الشراء.</p>
    <div class="order-confirm">
      <div class="confirm-line"><span>المنتج</span><strong>${esc(p.name)}</strong></div>
      ${customerDataLines(p,customerData)}
      <div class="confirm-line"><span>السعر</span><strong class="gold-text">${money(p.price)}</strong></div>
      <div class="confirm-line"><span>التسليم</span><strong>${esc(customerDelivery)}</strong></div>
      <div class="confirm-line"><span>كود الخصم</span><strong>${esc(couponCode||"بدون")}</strong></div>
      <div class="confirm-line"><span>رصيدك</span><strong>${money(state.user.balance)}</strong></div>
    </div>
    <div class="data-warning">تأكد من Player ID / Username / Server ID أو أي بيانات مطلوبة لهذا المنتج قبل التأكيد.</div>
    <div class="sheet-actions"><button id="backProduct">رجوع</button><button class="confirm" id="buyConfirm">تأكيد وشراء</button></div>`,"purchase");
  $("#backProduct").onclick=()=>openProduct(p.id);
  $("#buyConfirm").onclick=()=>purchase(p,customerData,couponCode,clientRequestId);
}
async function purchase(p,customerData,couponCode,clientRequestId){
  if(state.preview){
    let price=p.price;if(couponCode.toUpperCase()==="GZ10")price=Number((price-Math.min(price*.1,5)).toFixed(2));
    if(state.user.balance<price)return toast("الرصيد غير كافٍ");
    state.user.balance=Number((state.user.balance-price).toFixed(2));
    const at=new Date().toISOString();
    const demoCode=p.delivery==="inventory"?"GZ-DEMO-ALPHA-2026":null;
    const o={orderNo:"GZ-"+String(Date.now()).slice(-8),productName:p.name,customerData,deliveryText:p.deliveryText||"حسب المنتج",status:"completed",finalPrice:price,price,createdAt:at,deliveryCode:demoCode,deliveryAvailable:!!demoCode,timeline:[
      {status:"created",note:"تم إنشاء الطلب",createdAt:at},{status:"processing",note:"بدأت المعالجة",createdAt:at},{status:"completed",note:p.delivery==="inventory"?"تم تسليم الكود الرقمي":"اكتمل التنفيذ",createdAt:at}
    ]};
    if(p.delivery==="inventory"&&Number(p.stock||0)>0)p.stock=Number(p.stock)-1;
    state.orders.unshift(o);state.transactions.unshift({type:"purchase",amount:-price,reference:o.orderNo,createdAt:o.createdAt});
    state.notifications.unshift({id:"n"+Date.now(),title:"تم تنفيذ الطلب",body:`${o.orderNo} — ${p.name}`,read:false,createdAt:o.createdAt});
    renderUser();renderHome();openSheet(`<h3>✅ تم الطلب بنجاح</h3><div class="receipt"><h4>${esc(p.name)}</h4><p>رقم الطلب: <code>${esc(o.orderNo)}</code></p><p>الحالة: مكتمل</p><p>المبلغ: <b>${money(price)}</b></p>${o.deliveryCode?`<div class="delivery-code"><span>الكود الرقمي</span><code>${esc(o.deliveryCode)}</code><small>احفظ الكود الآن. تم إرساله أيضًا عبر البوت في التشغيل الحقيقي.</small></div>`:""}</div><button class="cta" data-sheet-close>تم</button>`);return;
  }
  const buyButton=$("#buyConfirm");
  if(buyButton){if(buyButton.disabled)return;buyButton.disabled=true;buyButton.textContent="جارٍ إنشاء الطلب...";}
  try{
    const r=await api("/api/orders",{method:"POST",body:JSON.stringify({productId:p.id,customerData,couponCode,clientRequestId})});
    state.user.balance=Number(r.balance);renderUser();
    if(p.delivery==="inventory"&&Number(p.stock||0)>0){p.stock=Number(p.stock)-1;renderHome();}
    openSheet(`<h3>${r.uncertain?"⏳ الطلب قيد التحقق":"✅ تم إنشاء الطلب"}</h3><div class="receipt"><h4>${esc(r.order.productName)}</h4><p>رقم الطلب: <code>${esc(r.order.orderNo)}</code></p><p>الحالة: ${statusAr(r.order.status)}</p><p>المبلغ: <b>${money(r.order.finalPrice)}</b></p>${r.uncertain?`<div class="data-warning">لم نتأكد من نتيجة المورد، لذلك لم نرسل الطلب لمورد آخر ولم نرجع الرصيد تلقائيًا حتى لا يحدث تنفيذ مكرر. ستراجعه الإدارة.</div>`:""}${r.order.deliveryCode?`<div class="delivery-code"><span>الكود الرقمي</span><code>${esc(r.order.deliveryCode)}</code><small>احفظه الآن. سيصل أيضًا برسالة Telegram.</small></div>`:""}</div><button class="cta" data-sheet-close>تم</button>`);
  }catch(e){
    if(buyButton){buyButton.disabled=false;buyButton.textContent="تأكيد وشراء";}
    if(e.data?.error==="insufficient_balance")toast("الرصيد غير كافٍ. اشحن حسابك أولًا.");
    else if(e.data?.error==="inventory_out_of_stock")toast("نفد مخزون هذا المنتج وتمت إعادة الرصيد تلقائيًا");
    else if(e.data?.error==="invalid_coupon")toast("كود الخصم غير صالح");
    else if(e.data?.error==="coupon_user_limit_reached")toast("استخدمت هذا الكوبون بالحد المسموح لحسابك");
    else if(e.data?.error==="coupon_limit_reached")toast("انتهى عدد استخدامات هذا الكوبون");
    else if(e.data?.error==="idempotency_conflict")toast("تعارض في إعادة إرسال الطلب. أعد فتح المنتج وحاول مرة جديدة.");
    else if(String(e.data?.error||"").startsWith("customer_field_")){
      const field=productInputSchema(p).find(f=>f.key===e.data?.field);toast(`تحقق من ${field?.label||"بيانات الطلب"}`);
    }
    else if(e.data?.error==="provider_failed"){
      if(Number.isFinite(Number(e.data?.balance))){state.user.balance=Number(e.data.balance);renderUser();}
      toast("تعذر تنفيذ الطلب وتمت إعادة الرصيد تلقائيًا");
    }
    else toast("تعذر إنشاء الطلب");
  }
}
async function toggleFavorite(productId){
  const p=state.products.find(x=>x.id===productId);if(!p)return;
  if(state.preview){
    const i=state.favorites.findIndex(x=>x.id===productId);if(i>=0)state.favorites.splice(i,1);else state.favorites.push(p);
    renderHome();if($('[data-screen="category"]').classList.contains("active"))openCategory(p.categoryId);toast(i>=0?"تمت الإزالة من المفضلة":"تمت الإضافة للمفضلة");return;
  }
  try{await api("/api/favorites/toggle",{method:"POST",body:JSON.stringify({productId})});await loadFavorites();renderHome();toast("تم تحديث المفضلة")}catch{toast("تعذر تحديث المفضلة")}
}
async function loadFavorites(){
  if(!state.preview){try{state.favorites=await api("/api/favorites")}catch{}}
  renderProducts($("#favoritesList"),state.favorites);
}
async function loadOrders(){
  if(!state.preview){try{state.orders=await api("/api/orders")}catch{}}
  const host=$("#ordersList");if(!host)return;
  host.innerHTML=state.orders.length?state.orders.map(o=>`<div class="order-card-v3">
    <div class="order-top"><b>${esc(o.productName)}</b><span class="status">${esc(statusAr(o.status))}</span></div>
    <div class="order-fields"><div><small>رقم الطلب</small><strong>${esc(o.orderNo)}</strong></div><div><small>السعر</small><strong>${money(o.finalPrice||o.price)}</strong></div><div><small>التاريخ</small><strong>${new Date(o.createdAt).toLocaleDateString("ar")}</strong></div><div><small>التسليم</small><strong>${esc(o.deliveryText||"حسب المنتج")}</strong></div></div>
    <button class="order-view" data-order-view="${esc(o.orderNo)}">تفاصيل وتتبع الطلب</button></div>`).join(""):`<div class="notice"><div><b>لا توجد طلبات</b><p>طلباتك الجديدة ستظهر هنا مباشرة.</p></div></div>`;
  $$('[data-order-view]').forEach(b=>b.onclick=()=>openOrder(b.dataset.orderView));
}
function openOrder(orderNo){
  const o=state.orders.find(x=>x.orderNo===orderNo);if(!o)return;
  const timeline=(o.timeline||[]).map(e=>`<div class="timeline-item"><b>${esc(statusAr(e.status))}</b><span>${esc(e.note||"")} • ${new Date(e.createdAt).toLocaleString("ar")}</span></div>`).join("")||`<div class="timeline-item"><b>${statusAr(o.status)}</b><span>آخر حالة متاحة</span></div>`;
  const canReveal=o.status==="completed"&&(o.deliveryCode||o.deliveryAvailable);
  openSheet(`<h3>${esc(o.orderNo)}</h3><p>${esc(o.productName)}</p><div class="receipt"><p>الحالة الحالية: <b>${esc(statusAr(o.status))}</b></p><p>المبلغ: <b>${money(o.finalPrice||o.price)}</b></p><p>التسليم: <b>${esc(o.deliveryText||"حسب المنتج")}</b></p>${Number(o.discount||0)>0?`<p>الخصم: <b>${money(o.discount)}</b></p>`:""}</div><div class="order-sheet-actions">${canReveal?`<button class="cta" id="revealDeliveryBtn">عرض التسليم الرقمي</button>`:""}<button class="secondary-btn" id="downloadReceiptBtn">حفظ الإيصال</button>${o.cancelAvailable?`<button class="danger" id="cancelOrderBtn">إلغاء الطلب وإعادة الرصيد</button>`:""}</div><div class="timeline">${timeline}</div>`);
  if(canReveal)$("#revealDeliveryBtn").onclick=()=>revealDelivery(orderNo);
  $("#downloadReceiptBtn").onclick=()=>downloadReceipt(orderNo);
  if(o.cancelAvailable)$("#cancelOrderBtn").onclick=()=>cancelOrder(orderNo);
}
async function downloadReceipt(orderNo){
  const o=state.orders.find(x=>x.orderNo===orderNo);if(!o)return;
  let receipt;
  if(state.preview){
    receipt={receiptVersion:"1",storeName:"Game Zone",generatedAt:new Date().toISOString(),order:{orderNo:o.orderNo,productName:o.productName,customerData:o.customerData||null,finalPrice:o.finalPrice||o.price,currency:"USD",status:o.status,createdAt:o.createdAt}};
  }else{
    try{receipt=await api(`/api/orders/${encodeURIComponent(orderNo)}/receipt`)}catch{return toast("تعذر تجهيز الإيصال")}
  }
  const text=JSON.stringify(receipt,null,2),filename=`game-zone-receipt-${orderNo}.json`;
  try{
    if(window.GameZoneAndroid?.saveTextFile){
      const result=window.GameZoneAndroid.saveTextFile(filename,text,"application/json");
      if(String(result).startsWith("error")||result==="unsupported_android_version")throw new Error("android_save_failed");
      return toast("تم حفظ الإيصال في Downloads/GameZone");
    }
    const blob=new Blob([text],{type:"application/json;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast("تم تجهيز الإيصال");
  }catch{
    openSheet(`<h3>إيصال الطلب</h3><textarea id="receiptText" rows="12" readonly>${esc(text)}</textarea><button class="cta" id="copyReceiptBtn">نسخ الإيصال</button>`);
    $("#copyReceiptBtn").onclick=async()=>{try{await navigator.clipboard.writeText(text);toast("تم نسخ الإيصال")}catch{toast("تعذر النسخ")}};
  }
}
async function cancelOrder(orderNo){
  if(!confirm("هل تريد إلغاء هذا الطلب وإعادة المبلغ إلى رصيدك؟"))return;
  if(state.preview){
    const o=state.orders.find(x=>x.orderNo===orderNo);if(!o)return;
    o.status="cancelled";o.cancelAvailable=false;
    state.user.balance=Number((Number(state.user.balance)+Number(o.finalPrice||o.price||0)).toFixed(2));
    state.transactions.unshift({type:"refund",amount:Number(o.finalPrice||o.price||0),reference:o.orderNo,createdAt:new Date().toISOString()});
    renderUser();loadOrders();closeSheet();return toast("تم إلغاء الطلب التجريبي وإعادة الرصيد");
  }
  try{
    const r=await api(`/api/orders/${encodeURIComponent(orderNo)}/cancel`,{method:"POST",body:"{}"});
    state.user.balance=Number(r.balance??state.user.balance);
    const idx=state.orders.findIndex(x=>x.orderNo===orderNo);if(idx>=0)state.orders[idx]=r.order;
    renderUser();loadOrders();loadWallet();closeSheet();toast("تم إلغاء الطلب وإعادة الرصيد");
  }catch(e){
    if(e.data?.error==="order_cannot_be_cancelled")toast("لا يمكن إلغاء هذا الطلب بعد بدء تنفيذه الخارجي");
    else toast("تعذر إلغاء الطلب");
  }
}
async function revealDelivery(orderNo){
  const o=state.orders.find(x=>x.orderNo===orderNo);
  if(state.preview){
    const code=o?.deliveryCode||"GZ-DEMO-ALPHA-2026";
    return openSheet(`<h3>التسليم الرقمي</h3><div class="delivery-code"><span>الكود الخاص بطلبك</span><code>${esc(code)}</code><small>احتفظ بالكود في مكان آمن.</small></div><button class="cta" id="backToOrder">العودة للطلب</button>`);
  }
  try{
    const r=await api(`/api/orders/${encodeURIComponent(orderNo)}/delivery`);
    openSheet(`<h3>التسليم الرقمي</h3><div class="delivery-code"><span>الكود الخاص بطلبك</span><code>${esc(r.value)}</code><small>عدد مرات العرض: ${r.reveals}. احتفظ بالكود في مكان آمن.</small></div><button class="cta" id="backToOrder">العودة للطلب</button>`);
    $("#backToOrder").onclick=()=>openOrder(orderNo);
  }catch{toast("تعذر عرض الكود الرقمي")}
}
function statusAr(s){return({created:"تم الإنشاء",completed:"مكتمل",processing:"قيد المعالجة",failed:"فشل",pending:"قيد الانتظار",refunded:"تم الاسترجاع",approved:"مقبول",rejected:"مرفوض",open:"مفتوحة",closed:"مغلقة",cancelled:"ملغي"})[s]||s}
async function loadWallet(){
  if(!state.preview){
    try{[state.transactions,state.topups]=await Promise.all([api("/api/wallet/transactions"),api("/api/wallet/topups")])}catch{}
  }
  $("#topupHistory").innerHTML=state.topups.length?state.topups.slice(0,10).map(t=>`<div class="transaction"><div><b>شحن ${money(t.amount)}</b><small>${esc(t.method||"")} ${t.reference?`• ${esc(t.reference)}`:""}${t.receiptUploaded?" • إيصال مرفوع":""} • ${new Date(t.createdAt).toLocaleString("ar")}</small></div><span class="status">${esc(statusAr(t.status))}</span></div>`).join(""):`<div class="notice"><div><b>لا توجد طلبات شحن</b><p>طلبات الشحن الجديدة ستظهر هنا.</p></div></div>`;
  $("#transactions").innerHTML=state.transactions.length?state.transactions.slice(0,15).map(t=>`<div class="transaction"><div><b>${t.type==="purchase"?"شراء":t.type==="refund"?"استرجاع":t.type==="topup"?"شحن":"تعديل رصيد"}</b><small>${esc(t.reference||"")}</small></div><strong>${t.amount>0?"+":""}${money(t.amount).replace("$-","-$")}</strong></div>`).join(""):`<div class="notice"><div><b>لا توجد حركات</b><p>حركات المحفظة ستظهر هنا.</p></div></div>`;
}
async function loadSupportTickets(){
  if(!state.preview){try{state.supportTickets=await api("/api/support/tickets")}catch{}}
  const host=$("#supportHistory");if(!host)return;
  host.innerHTML=state.supportTickets.length?state.supportTickets.map(t=>`<div class="notice"><i></i><div><b>${esc(t.subject||"دعم فني")} — ${esc(statusAr(t.status))}</b><p>${esc(t.message||"")}</p>${t.reply?`<div class="support-reply"><strong>رد Game Zone</strong><span>${esc(t.reply)}</span></div>`:""}<small class="muted">${new Date(t.createdAt).toLocaleString("ar")}</small></div></div>`).join(""):`<div class="notice"><div><b>لا توجد تذاكر</b><p>يمكنك إرسال تذكرة جديدة من النموذج أعلاه.</p></div></div>`;
}
async function loadNotifications(){
  if(!state.preview){try{state.notifications=await api("/api/notifications")}catch{}}
  const list=$("#notificationsList");if(!list)return;
  list.innerHTML=state.notifications.length?state.notifications.map(n=>`<button class="notice ${n.read?"":"unread"}" data-notification-id="${esc(n.id)}"><i></i><div><b>${esc(n.title)}</b><p>${esc(n.body)}</p><small class="muted">${new Date(n.createdAt).toLocaleString("ar")}</small></div></button>`).join(""):`<div class="notice"><div><b>لا توجد إشعارات</b><p>سيظهر هنا كل جديد.</p></div></div>`;
  const unread=state.notifications.filter(n=>!n.read).length,badge=$("#notificationBadge");
  if(badge){badge.textContent=unread>99?"99+":String(unread);badge.classList.toggle("hidden",unread===0)}
  $$("[data-notification-id]").forEach(btn=>btn.onclick=()=>markNotificationRead(btn.dataset.notificationId));
}
async function markNotificationRead(id){
  const n=state.notifications.find(x=>x.id===id);if(!n||n.read)return;
  if(state.preview){n.read=true;return loadNotifications()}
  try{await api(`/api/notifications/${encodeURIComponent(id)}/read`,{method:"POST",body:"{}"});n.read=true;loadNotifications()}catch{}
}
async function markAllNotificationsRead(){
  if(!state.notifications.some(n=>!n.read))return toast("كل الإشعارات مقروءة");
  if(state.preview){state.notifications.forEach(n=>n.read=true);loadNotifications();return toast("تم تعليم الكل كمقروء")}
  try{await api("/api/notifications/read-all",{method:"POST",body:"{}"});state.notifications.forEach(n=>n.read=true);loadNotifications();toast("تم تعليم الكل كمقروء")}catch{toast("تعذر تحديث الإشعارات")}
}
async function fileToDataUrl(file,maxBytes=1024*1024){
  if(!file)return null;
  if(file.size>maxBytes)throw Object.assign(new Error("image_too_large"),{code:"image_too_large"});
  if(!/^image\/(jpeg|png|webp)$/i.test(file.type||""))throw Object.assign(new Error("invalid_image_type"),{code:"invalid_image_type"});
  return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error("image_read_failed"));r.readAsDataURL(file)});
}
function paymentMethodCard(m,selected){
  const image=m.imageUrl?`<img src="${esc(m.imageUrl)}" alt="">`:`<span>صورة طريقة الدفع</span>`;
  return `<button type="button" class="payment-method-card ${selected?"selected":""}" data-payment-method="${esc(m.id)}"><div class="payment-method-image">${image}</div><b>${esc(m.name)}</b></button>`;
}
$("#topupBtn").onclick=()=>{
  if(state.config.maintenance)return toast(state.config.maintenanceMessage||"المتجر تحت الصيانة");
  const methods=(state.config.paymentMethods||[]);
  const safeMethods=methods.length?methods:[{id:"manual",name:"تحويل يدوي",imageUrl:null,requiresReference:false,minAmount:state.config.minTopup||1,maxAmount:state.config.maxTopup||1000}];
  let selectedMethod=safeMethods[0].id;
  openSheet(`<h3>طلب شحن رصيد</h3>
    <div class="field"><label>المبلغ بالدولار (USD)</label><input id="topupAmount" type="number" value="10"><small class="input-help">عملة الشحن الأساسية هي USD. اختيار EUR / TRY / SYP يغيّر العرض داخل المتجر فقط ولا يغيّر مبلغ التحويل المالي.</small></div>
    <div class="field"><label>طريقة الدفع</label><div id="paymentMethodGrid" class="payment-method-grid"></div></div>
    <div id="paymentInfo" class="payment-info"></div>
    <div class="field"><label id="topupRefLabel">رقم العملية / المرجع</label><input id="topupRef" placeholder="مثال: TX123"></div>
    <div class="field"><label>صورة الإيصال</label><input id="topupReceipt" type="file" accept="image/jpeg,image/png,image/webp"></div>
    <div class="sheet-actions"><button data-sheet-close>إلغاء</button><button class="confirm" id="topupConfirm">إنشاء الطلب</button></div>`);
  const renderMethod=()=>{
    const m=safeMethods.find(x=>x.id===selectedMethod)||safeMethods[0];
    $("#paymentMethodGrid").innerHTML=safeMethods.map(x=>paymentMethodCard(x,x.id===selectedMethod)).join("");
    $$('[data-payment-method]').forEach(btn=>btn.onclick=()=>{selectedMethod=btn.dataset.paymentMethod;renderMethod()});
    const min=Number(m.minAmount||state.config.minTopup||1),max=Number(m.maxAmount||state.config.maxTopup||1000);
    $("#topupAmount").min=min;$("#topupAmount").max=max;
    $("#paymentInfo").innerHTML=`<b>${esc(m.name)}</b>${m.account?`<span>بيانات الدفع: ${esc(m.account)}</span>`:""}${m.instructions?`<p>${esc(m.instructions)}</p>`:""}<small>الحد الفعلي: ${baseMoney(min)} — ${baseMoney(max)}</small>`;
    $("#topupRefLabel").textContent=m.requiresReference?"رقم العملية / المرجع (مطلوب)":"رقم العملية / المرجع (اختياري)";
  };
  renderMethod();
  const topupClientRequestId=`topup:${state.user.telegramId}:${Date.now()}:${Math.random().toString(36).slice(2,10)}`;
  $("#topupConfirm").onclick=async()=>{
    const button=$("#topupConfirm");if(button.disabled)return;
    const amount=Number($("#topupAmount").value),method=selectedMethod,reference=$("#topupRef").value.trim(),receiptFile=$("#topupReceipt").files?.[0]||null;
    const m=safeMethods.find(x=>x.id===method)||{};
    const min=Number(m.minAmount||state.config.minTopup||1),max=Number(m.maxAmount||state.config.maxTopup||1000);
    if(!amount||amount<min||amount>max)return toast("المبلغ خارج حدود طريقة الدفع");
    if(m.requiresReference&&!reference)return toast("أدخل رقم العملية أو المرجع");
    let receiptDataUrl=null;
    try{if(receiptFile)receiptDataUrl=await fileToDataUrl(receiptFile)}catch(e){return toast(e.code==="image_too_large"?"صورة الإيصال أكبر من 1MB":"صيغة صورة الإيصال غير مدعومة")}
    button.disabled=true;button.textContent="جارٍ إنشاء طلب الشحن...";
    if(state.preview){
      const at=new Date().toISOString();
      state.user.balance=Number((state.user.balance+amount).toFixed(2));
      state.transactions.unshift({type:"topup",amount,reference:reference||"PREVIEW",createdAt:at});
      state.topups.unshift({id:"topup_preview_"+Date.now(),amount,method,reference:reference||"PREVIEW",receiptUploaded:Boolean(receiptDataUrl),receiptUploadedAt:receiptDataUrl?at:null,status:"approved",createdAt:at});
      renderUser();closeSheet();loadWallet();toast("تمت إضافة رصيد تجريبي");return;
    }
    try{
      const r=await api("/api/wallet/topup-intents",{method:"POST",body:JSON.stringify({amount,method,reference,clientRequestId:topupClientRequestId})});
      if(receiptDataUrl&&r.topup?.id){
        await api(`/api/wallet/topups/${encodeURIComponent(r.topup.id)}/receipt`,{method:"POST",body:JSON.stringify({dataUrl:receiptDataUrl})});
      }
      if(r.checkoutUrl){
        openSheet(`<h3>تم إنشاء طلب الشحن</h3><div class="receipt"><p>رقم الطلب: <code>${esc(r.topup.id)}</code></p><p>المبلغ الفعلي: <b>${baseMoney(r.topup.amount)}</b></p>${displayCurrencyConfig().code!=="USD"?`<p>للعرض في المتجر: <b>${money(r.topup.amount)}</b></p>`:""}${receiptDataUrl?"<p>تم إرفاق صورة الإيصال.</p>":""}<p>أكمل الدفع من الصفحة الخارجية ثم سيُحدّث الرصيد بعد وصول إشعار الدفع.</p></div><button class="cta" id="openCheckoutBtn">فتح صفحة الدفع</button><button class="secondary-btn" id="closeCheckoutSheet">إغلاق</button>`);
        $("#openCheckoutBtn").onclick=()=>{window.location.href=r.checkoutUrl};$("#closeCheckoutSheet").onclick=closeSheet;
      }else{closeSheet();toast(receiptDataUrl?"تم إنشاء طلب الشحن وإرفاق الإيصال":"تم إنشاء طلب الشحن وسيصل للإدارة")}
    }catch(e){
      button.disabled=false;button.textContent="إنشاء الطلب";
      if(e.data?.error==="payment_reference_required")toast("رقم العملية مطلوب لهذه الطريقة");
      else if(e.data?.error==="payment_reference_already_used")toast("رقم العملية مستخدم مسبقًا في طلب شحن آخر");
      else if(e.data?.error==="idempotency_conflict")toast("تعارض في محاولة إعادة إرسال طلب الشحن");
      else if(["invalid_amount","payment_method_amount_out_of_range"].includes(e.data?.error))toast("المبلغ خارج الحدود المسموحة");
      else if(["invalid_image","image_too_large","invalid_image_type"].includes(e.data?.error))toast("تعذر رفع صورة الإيصال");
      else toast("تعذر إنشاء طلب الشحن");
    }
  };
};
$("#supportSend").onclick=async()=>{
  if(state.config.maintenance)return toast(state.config.maintenanceMessage||"المتجر تحت الصيانة");
  const subject=$("#supportSubject").value.trim()||"دعم فني",message=$("#supportMessage").value.trim();
  if(!message)return toast("اكتب تفاصيل المشكلة");
  if(state.preview){state.supportTickets.unshift({id:"ticket_preview_"+Date.now(),subject,message,status:"open",createdAt:new Date().toISOString()});$("#supportMessage").value="";loadSupportTickets();toast("✅ تم إنشاء تذكرة دعم تجريبية");return}
  try{const r=await api("/api/support/tickets",{method:"POST",body:JSON.stringify({subject,message})});$("#supportMessage").value="";await loadSupportTickets();toast("تم إرسال التذكرة: "+r.ticket.id)}catch{toast("تعذر إرسال التذكرة")}
};
$("#searchBtn").onclick=()=>doSearch();$("#searchInput").addEventListener("keydown",e=>{if(e.key==="Enter")doSearch()});
function doSearch(){
  const q=$("#searchInput").value.trim().toLowerCase();
  const roots=rootCategories();
  if(!q){renderHome(roots);return}
  const list=roots.filter(c=>`${c.name}`.toLowerCase().includes(q));
  renderHome(list);
  if(!list.length)toast("لا يوجد قسم مطابق");
}
async function exportMyData(){
  if(state.preview)return openSheet(`<h3>⇩ تصدير بياناتي</h3><p>هذه الميزة تعمل بعد تسجيل الدخول الحقيقي. في وضع المعاينة لا توجد بيانات حساب فعلية.</p>`);
  try{
    const data=await api("/api/me/export");
    const text=JSON.stringify(data,null,2);
    openSheet(`<h3>⇩ نسخة بيانات حسابك</h3><p>يمكنك نسخ البيانات أو تنزيلها من المتصفح.</p><textarea id="exportDataText" rows="12" readonly>${esc(text)}</textarea><div class="sheet-actions"><button id="copyExportData">نسخ</button><button class="confirm" id="downloadExportData">تنزيل JSON</button></div>`);
    $("#copyExportData").onclick=async()=>{try{await navigator.clipboard.writeText(text);toast("تم نسخ البيانات")}catch{$("#exportDataText").select();document.execCommand?.("copy");toast("تم نسخ البيانات")}};
    $("#downloadExportData").onclick=()=>{
      const filename=`game-zone-account-${state.user.telegramId||"data"}.json`;
      try{
        if(window.GameZoneAndroid?.saveTextFile){
          const result=window.GameZoneAndroid.saveTextFile(filename,text,"application/json");
          if(String(result).startsWith("error")||result==="unsupported_android_version")return toast("تعذر الحفظ المباشر؛ استخدم زر النسخ");
          return toast("تم حفظ الملف في Downloads/GameZone");
        }
        const blob=new Blob([text],{type:"application/json;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
        a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }catch{toast("استخدم زر النسخ إذا لم يدعم جهازك التنزيل")}
    };
  }catch{toast("تعذر تصدير البيانات")}
}
function requestAccountDeletion(){
  if(state.preview)return openSheet(`<h3>حذف الحساب</h3><p>لا يوجد حساب حقيقي في وضع المعاينة.</p>`);
  const balance=Number(state.user?.balance||0);
  if(Math.abs(balance)>0.000001){
    openSheet(`<h3>⚠️ لا يمكن حذف الحساب الآن</h3><div class="data-warning">رصيد المحفظة الحالي هو <b>$${balance.toFixed(2)}</b>. لحماية أموالك، يجب أن يصبح الرصيد صفرًا قبل حذف الحساب. استخدم الرصيد أو تواصل مع الدعم إذا كنت تحتاج مساعدة.</div><div class="sheet-actions"><button data-sheet-close>حسنًا</button><button id="deleteSupportBtn">الدعم</button></div>`);
    $("#deleteSupportBtn").onclick=()=>{closeSheet();go("support")};
    return;
  }
  openSheet(`<h3>⚠️ حذف حساب Game Zone</h3><div class="data-warning">سيتم حذف ملف حسابك والمفضلة والإشعارات وتذاكر الدعم، وستُفصل السجلات التشغيلية القديمة عن Telegram ID. لا يمكن التراجع عن العملية.</div><div class="field"><label>اكتب DELETE للتأكيد</label><input id="deleteConfirmation" autocomplete="off" placeholder="DELETE"></div><div class="sheet-actions"><button data-sheet-close>إلغاء</button><button class="danger" id="confirmDeleteAccount">حذف نهائي</button></div>`);
  $("#confirmDeleteAccount").onclick=deleteMyAccount;
}
async function deleteMyAccount(){
  if($("#deleteConfirmation").value.trim()!=="DELETE")return toast("اكتب DELETE للتأكيد");
  if(!confirm("تأكيد حذف حساب Game Zone؟"))return;
  try{
    await api("/api/me/delete",{method:"POST",body:JSON.stringify({confirmation:"DELETE"})});
    clearTimeout(pairTimer);stopLiveRefresh();clearSession();pairState=null;savePairState();closeSheet();
    state.user={telegramId:"",username:"",firstName:"زائر",lastName:"",balance:0,currency:"USD"};
    state.orders=[];state.transactions=[];state.topups=[];state.favorites=[];state.notifications=[];state.supportTickets=[];
    renderUser();showAuthGate();toast("تم حذف الحساب وفصل بياناته");
  }catch(e){
    if(e.data?.error==="account_deletion_disabled")toast("حذف الحساب غير متاح حاليًا");
    else if(e.data?.error==="active_orders_exist")toast("لديك طلب قيد التنفيذ. انتظر انتهاءه قبل حذف الحساب.");
    else if(e.data?.error==="pending_topups_exist")toast("لديك طلب شحن معلق. انتظر معالجته قبل حذف الحساب.");
    else if(e.data?.error==="balance_must_be_zero_before_deletion")toast(`يجب تصفير الرصيد أولًا. رصيدك الحالي $${Number(e.data?.balance||0).toFixed(2)}`);
    else toast("تعذر حذف الحساب");
  }
}
function openLegal(path,title){
  if(state.preview)return openSheet(`<h3>${esc(title)}</h3><p>الصفحة القانونية موجودة في نسخة السيرفر الفعلية على <code>${esc(path)}</code>.</p>`);
  window.location.href=path;
}

let pairState=null;
let pairTimer=null;

function saveSession(token,user){
  state.sessionToken=token||"";
  state.user=user||state.user;
  state.preview=false;
  try{if(token)localStorage.setItem("gamezone_user_session",token)}catch{}
}
function clearSession(){
  state.sessionToken="";
  try{localStorage.removeItem("gamezone_user_session")}catch{}
}
function savePairState(){
  try{pairState?localStorage.setItem("gamezone_pair_state",JSON.stringify(pairState)):localStorage.removeItem("gamezone_pair_state")}catch{}
}
function restorePairState(){
  try{
    const raw=localStorage.getItem("gamezone_pair_state");if(!raw)return null;
    const x=JSON.parse(raw);
    if(!x?.id||!x?.secret||!x?.expiresAt||new Date(x.expiresAt).getTime()<=Date.now()){localStorage.removeItem("gamezone_pair_state");return null}
    return x;
  }catch{return null}
}
function renderPairState(){
  if(!pairState)return;
  $("#pairIdle").classList.add("hidden");$("#pairActive").classList.remove("hidden");
  $("#pairCode").textContent=pairState.code||"------";
  $("#pairStatus").textContent="بانتظار الموافقة من Telegram...";
  $("#pairExpiry").textContent=`ينتهي الرمز: ${new Date(pairState.expiresAt).toLocaleTimeString("ar")}`;
}
function showAuthGate(){
  if(!API_BASE)return;
  $("#authGate")?.classList.remove("hidden");
}
function hideAuthGate(){
  $("#authGate")?.classList.add("hidden");
}
async function startPairing(){
  if(!API_BASE)return;
  try{
    const r=await api("/api/device/pair/start",{method:"POST",body:"{}"});
    pairState={...r.pair,telegramDeepLink:r.telegramDeepLink};
    savePairState();renderPairState();schedulePairPoll();
  }catch{toast("تعذر إنشاء رمز الربط")}
}
function schedulePairPoll(){
  clearTimeout(pairTimer);
  pairTimer=setTimeout(()=>checkPairStatus(false),2000);
}
async function checkPairStatus(manual=true){
  if(!pairState)return;
  try{
    const r=await api("/api/device/pair/status",{method:"POST",body:JSON.stringify({pairId:pairState.id,secret:pairState.secret})});
    if(r.status==="approved"&&r.sessionToken){
      clearTimeout(pairTimer);saveSession(r.sessionToken,r.user);pairState=null;savePairState();hideAuthGate();
      $("#pairStatus").textContent="✅ تم الربط";
      await loadPrivateData();
      renderUser();renderHome();loadOrders();loadWallet();startLiveRefresh();
      toast("✅ تم ربط التطبيق بحساب Telegram");
      return;
    }
    if(r.status==="expired"){
      clearTimeout(pairTimer);$("#pairStatus").textContent="انتهت صلاحية الرمز. أنشئ رمزًا جديدًا.";
      $("#pairIdle").classList.remove("hidden");$("#pairActive").classList.add("hidden");pairState=null;savePairState();return;
    }
    $("#pairStatus").textContent="بانتظار الموافقة من Telegram...";
    schedulePairPoll();
  }catch{
    if(manual)toast("تعذر التحقق الآن");
    schedulePairPoll();
  }
}
async function loadPrivateData(){
  if(!state.sessionToken)return;
  try{state.user=await api("/api/me")}catch{}
  await Promise.all([loadFavorites(),loadNotifications(),loadSupportTickets()]);
}
async function authenticate(){
  if(!API_BASE)return "preview";
  if(tg){
    try{
      tg.ready();tg.expand();tg.setHeaderColor("#06080d");tg.setBackgroundColor("#06080d");
      const raw=tg.initData;
      if(raw){
        const r=await api("/api/auth/telegram",{method:"POST",body:JSON.stringify({initData:raw})});
        saveSession(r.sessionToken,r.user);return "telegram";
      }
    }catch(e){console.log(e)}
  }
  try{
    const saved=localStorage.getItem("gamezone_user_session")||"";
    if(saved){
      state.sessionToken=saved;
      const u=await api("/api/me");
      state.user=u;state.preview=false;return "session";
    }
  }catch{clearSession()}
  return "pair";
}
let liveRefreshTimer=null;
function updateNetworkBanner(){
  const banner=$("#networkBanner");if(!banner)return;
  banner.classList.toggle("hidden",navigator.onLine!==false);
}
function stopLiveRefresh(){if(liveRefreshTimer){clearInterval(liveRefreshTimer);liveRefreshTimer=null}}
function startLiveRefresh(){
  stopLiveRefresh();
  if(state.preview||!state.sessionToken)return;
  liveRefreshTimer=setInterval(async()=>{
    if(document.visibilityState!=="visible"||navigator.onLine===false||!state.sessionToken)return;
    try{
      await Promise.all([loadOrders(),loadNotifications()]);
      const me=await api("/api/me");state.user=me;renderUser();
    }catch{}
  },45000);
}
window.addEventListener("online",()=>{updateNetworkBanner();if(state.sessionToken){loadOrders();loadNotifications();loadWallet()}});
window.addEventListener("offline",updateNetworkBanner);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&state.sessionToken&&!state.preview){loadOrders();loadNotifications()}});
updateNetworkBanner();

async function bootstrap(){
  if(!API_BASE){
    state.categories=fallback.categories;state.products=fallback.products;state.announcements=fallback.announcements;state.preview=true;
    renderConfig();renderAnnouncements();renderUser();renderHome();loadOrders();loadWallet();
    toast("وضع المعاينة: رصيد تجريبي $25 — جرّب GZ10");return;
  }
  try{
    state.config=await api("/api/config");
    state.categories=await api("/api/categories");
    state.products=await api("/api/products");
    state.announcements=await api("/api/announcements");
  }catch(e){
    toast("تعذر الاتصال بخادم Game Zone");return;
  }
  const mode=await authenticate();
  renderConfig();renderAnnouncements();renderHome();
  if(mode==="pair"){
    state.user={telegramId:"",username:"",firstName:"زائر",lastName:"",balance:0,currency:"USD"};
    renderUser();showAuthGate();
    pairState=restorePairState();
    if(pairState){renderPairState();schedulePairPoll()}
    return;
  }
  hideAuthGate();await loadPrivateData();renderUser();loadOrders();loadWallet();startLiveRefresh();
}
$("#readAllNotificationsBtn").onclick=markAllNotificationsRead;
$("#privacyBtn").onclick=()=>openLegal(state.config.privacyPolicyUrl||"/privacy.html","سياسة الخصوصية");
$("#termsBtn").onclick=()=>openLegal(state.config.termsUrl||"/terms.html","الشروط والأحكام");
$("#exportDataBtn").onclick=exportMyData;
$("#revokeUserSessionsBtn").onclick=async()=>{
  if(state.preview)return toast("في التشغيل الحقيقي سيتم إبطال جلسات الأجهزة الأخرى");
  if(!confirm("سيتم إبطال كل جلسات Game Zone الحالية على الأجهزة. سيعاد تسجيل هذا الجهاز بعد إعادة التحميل. متابعة؟"))return;
  try{
    const r=await api("/api/me/sessions/revoke-all",{method:"POST",body:JSON.stringify({confirmation:"REVOKE_ALL_USER_SESSIONS"})});
    if(r.ok){
      stopLiveRefresh();clearSession();pairState=null;savePairState();
      toast("تم إبطال الجلسات. يعاد تسجيل هذا الجهاز...");
      setTimeout(()=>location.reload(),700);
    }
  }catch{toast("تعذر إبطال جلسات الحساب")}
};
$("#deleteAccountBtn").onclick=requestAccountDeletion;
$("#currencySettingsBtn").onclick=()=>openSheet(`<h3>العملة</h3><p>العملة الحالية هي <b>USD</b>. دعم العملات الإضافية يحتاج أسعار صرف وطريقة تسعير مستقلة قبل تفعيله.</p>`);
$("#languageSettingsBtn").onclick=()=>openSheet(`<h3>اللغة</h3><p>الواجهة الحالية عربية. تم تثبيت العربية كلغة أساسية حتى لا تظهر خيارات غير مكتملة للعميل.</p>`);
$("#startPairBtn").onclick=startPairing;
$("#checkPairBtn").onclick=()=>checkPairStatus(true);
$("#openTelegramBtn").onclick=()=>{
  if(pairState?.telegramDeepLink)window.location.href=pairState.telegramDeepLink;
  else toast("لم يتم ضبط BOT_USERNAME على الخادم");
};
$("#logoutBtn").onclick=()=>{
  clearTimeout(pairTimer);stopLiveRefresh();clearSession();pairState=null;savePairState();
  state.user={telegramId:"",username:"",firstName:"زائر",lastName:"",balance:0,currency:"USD"};
  renderUser();showAuthGate();$("#pairIdle").classList.remove("hidden");$("#pairActive").classList.add("hidden");
};
$("#reloadBtn").onclick=bootstrap;
bootstrap();

if("serviceWorker" in navigator && /^https?:$/.test(location.protocol)){
  window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));
}
