/* UCHIHA Debt Store v1.5.0 — polished digital storefront. */
(function(){'use strict';
const VERSION='1.5.0';
const oldRender=window.render, oldDrawer=window.drawer, oldBack=window.appBack;
const priorResult=window.onDebtServiceResult;
const pending=new Map();
let seq=0,mode='',path=[],catalog={categories:[],products:[]},query='',selectedProduct=null,loading=false,lastCatalogError='';
let wallet={balance:0,orders:[],shamcash_account:'',support_whatsapp:'963942586044'};
let proofData='',proofName='',adminTab='config',adminData={},busy=false;

const el=id=>document.getElementById(id);
const safe=v=>window.esc?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>{const n=Number(v||0);return '$ '+(Number.isFinite(n)?n.toFixed(n<1?3:2):'0.00')};
const meta=()=>{try{return JSON.parse(window.Android?.serviceStatus?.()||'{}')}catch(_e){return {}}};
const licensed=()=>{const m=meta();if(m.reauth_required||m.active===false)return false;return !!(m.license_id||m.role||m.active===true||(typeof window.isOwner==='function'&&window.isOwner()))};
const owner=()=>{const m=meta();return m.role==='owner'||(typeof window.isOwner==='function'&&window.isOwner())};
const statusText=s=>{s=String(s||'').toLowerCase();if(/complete|done|deliver/.test(s))return'مكتمل';if(/accept|success|ok/.test(s))return'مقبول';if(/reject|fail|cancel|refund/.test(s))return'مرفوض';if(/process|send|run/.test(s))return'جاري التنفيذ';return'قيد التنفيذ'};
const errorText=e=>({SESSION_REQUIRED:'فعّل التطبيق أولًا.',LICENSE_INACTIVE:'الخدمة موقوفة.',PROVIDER_NOT_CONFIGURED:'لم يتم ربط متجر جاسر كارد بعد.',INVALID_PROVIDER_TOKEN:'توكن جاسر كارد مرفوض من المزود.',PROVIDER_UNAVAILABLE:'تعذر الاتصال بجاسر كارد حاليًا.',SERVICE_UNAVAILABLE:'تعذر الوصول إلى خدمة المتجر الآن.',RATE_LIMITED:'تم إرسال طلبات كثيرة بسرعة. حاول بعد قليل.',DATABASE:'حدث خطأ في قاعدة بيانات المتجر.',INSUFFICIENT_BALANCE:'رصيدك غير كافٍ لإتمام الطلب.',INVALID_PROOF:'صورة إثبات التحويل غير صالحة أو كبيرة.',INVALID_AMOUNT:'المبلغ غير صحيح.',ALREADY_REVIEWED:'تمت مراجعة هذا الطلب مسبقًا.',FORBIDDEN:'هذه الصفحة مخصصة للإدارة.',TIMEOUT:'الاتصال أخذ وقتًا أطول من المتوقع. حاول مجددًا.',NATIVE_REQUIRED:'حدّث التطبيق إلى النسخة الجديدة.'})[e]||'حدث خطأ. حاول مرة أخرى.';

function call(action,args={}){
  return new Promise(resolve=>{
    if(!window.Android?.serviceRequest){resolve({ok:false,error:'NATIVE_REQUIRED'});return;}
    const id='V148-'+Date.now()+'-'+(++seq);
    const slow=new Set(['digital_catalog','digital_product','digital_purchase','owner_digital_config_set','owner_digital_provider_test']);
    const timeoutMs=slow.has(action)?95000:60000;
    const timer=setTimeout(()=>{pending.delete(id);resolve({ok:false,error:'TIMEOUT'});},timeoutMs);
    pending.set(id,{resolve,timer});
    try{Android.serviceRequest(action,JSON.stringify(args),id)}catch(_e){clearTimeout(timer);pending.delete(id);resolve({ok:false,error:'SERVICE_UNAVAILABLE'})}
  });
}
window.onDebtServiceResult=function(id,result){
  const p=pending.get(id);
  if(p){clearTimeout(p.timer);pending.delete(id);p.resolve(result||{ok:false});return;}
  if(typeof priorResult==='function')return priorResult(id,result);
};
function notify(msg,bad=false){if(typeof window.toast==='function')toast(msg,bad);}

function mediaUrl(value){
  if(typeof value!=='string')return'';
  let v=value.trim();if(!v)return'';
  if(/^data:image\//i.test(v)||/^https?:\/\//i.test(v))return v;
  if(/^\/\//.test(v))return'https:'+v;
  if(/^\/(uploads|storage|images|media|assets)\//i.test(v))return'https://js4card.com'+v;
  if(/^(uploads|storage|images|media|assets)\//i.test(v))return'https://js4card.com/'+v;
  if(/\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(v)&&!v.includes(' '))return'https://js4card.com/'+v.replace(/^\/+/, '');
  return'';
}
function imageOf(item){
  const keys=['image_url','imageUrl','image','photo_url','photoUrl','photo','icon_url','iconUrl','icon','thumbnail_url','thumbnailUrl','thumbnail','logo','img','picture','cover','cover_url','banner','banner_url','media_url','file_url','path'];
  for(const key of keys){
    const v=item?.[key];
    const direct=mediaUrl(v);if(direct)return direct;
    if(v&&typeof v==='object'){
      for(const nested of ['url','src','path','file','image','thumb']){
        const u=mediaUrl(v?.[nested]);if(u)return u;
      }
    }
  }
  for(const container of ['media','images','files','assets']){
    const v=item?.[container];
    if(Array.isArray(v)){
      for(const x of v){
        const u=mediaUrl(typeof x==='string'?x:(x?.url||x?.src||x?.path||x?.image));if(u)return u;
      }
    }else if(v&&typeof v==='object'){
      for(const x of Object.values(v)){
        const u=mediaUrl(typeof x==='string'?x:(x?.url||x?.src||x?.path||x?.image));if(u)return u;
      }
    }
  }
  return '';
}
function nameOf(item){return String(item?.name||item?.title||item?.display_name||item?.product_name||item?.label||'بدون اسم').trim()}
function priceOf(item){for(const k of ['price','sell_price','client_price','cost']){const n=Number(item?.[k]);if(Number.isFinite(n)&&n>0)return n}return 0}
function arrays(data){
  let root=data||{};
  if(root&&typeof root==='object'&&!Array.isArray(root)){
    if(root.data&&typeof root.data==='object'&&!Array.isArray(root.data))root=root.data;
    else if(root.result&&typeof root.result==='object'&&!Array.isArray(root.result))root=root.result;
  }
  const categories=Array.isArray(root.categories)?root.categories:Array.isArray(root.category)?root.category:Array.isArray(root.cats)?root.cats:Array.isArray(root.subcategories)?root.subcategories:[];
  const products=Array.isArray(root.products)?root.products:Array.isArray(root.items)?root.items:[];
  return {categories:categories.filter(x=>x&&typeof x==='object'),products:products.filter(x=>x&&typeof x==='object')};
}
function currentTitle(){return path.length?nameOf(path[path.length-1]):'المنتجات الرقمية'}
function filtered(rows){const q=query.trim().toLowerCase();return q?rows.filter(x=>nameOf(x).toLowerCase().includes(q)):rows}
function artFallback(item){
  const n=nameOf(item).toLowerCase();
  let kind='grid';
  if(/free|pubg|call|game|لعب|فري|ببجي/.test(n))kind='game';
  else if(/بطاق|card|visa|sim|اتصال|رصيد/.test(n))kind='card';
  else if(/رقم|phone|sms/.test(n))kind='phone';
  else if(/رشق|social|instagram|facebook|tiktok|youtube/.test(n))kind='social';
  else if(/عملات|crypto|usdt|bitcoin|binance/.test(n))kind='coin';
  else if(/حساب|account/.test(n))kind='user';
  else if(/تصميم|design|canva|capcut|adobe/.test(n))kind='design';
  const paths={
    game:'<path d="M41 46h18l6-10h30l6 10h18c10 0 17 8 15 18l-5 25c-2 9-13 12-20 6L95 82H65L51 95c-7 6-18 3-20-6l-5-25c-2-10 5-18 15-18Z"/><path d="M52 61v14M45 68h14M108 63h.1M119 74h.1"/>',
    card:'<rect x="28" y="42" width="104" height="76" rx="13"/><path d="M28 61h104M45 92h31M98 92h17"/>',
    phone:'<rect x="51" y="24" width="58" height="112" rx="15"/><path d="M69 39h22M74 119h12"/>',
    social:'<circle cx="80" cy="61" r="24"/><path d="M42 123c5-24 20-36 38-36s33 12 38 36M116 42h19M125 33v19"/>',
    coin:'<circle cx="80" cy="80" r="48"/><path d="M91 54H72c-10 0-16 6-16 14s6 13 16 13h16c10 0 16 6 16 14s-6 14-16 14H66M80 43v74"/>',
    user:'<circle cx="80" cy="60" r="24"/><path d="M38 128c5-27 22-42 42-42s37 15 42 42"/>',
    design:'<path d="M44 115 109 50M39 58l17-17 63 63-17 17zM98 35l8-8 27 27-8 8z"/><path d="m34 126 22-5-17-17z"/>',
    grid:'<rect x="33" y="33" width="38" height="38" rx="8"/><rect x="89" y="33" width="38" height="38" rx="8"/><rect x="33" y="89" width="38" height="38" rx="8"/><rect x="89" y="89" width="38" height="38" rx="8"/>'
  };
  return '<svg class="digital-fallback-svg" viewBox="0 0 160 160" aria-hidden="true"><defs><linearGradient id="fg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#5bc0ff"/><stop offset="1" stop-color="#a676ff"/></linearGradient></defs><g fill="none" stroke="url(#fg)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">'+paths[kind]+'</g></svg>';
}
function imgMarkup(item){
  const src=imageOf(item),fallback=artFallback(item);
  if(!src)return '<div class="digital-card-fallback">'+fallback+'</div>';
  return '<img src="'+safe(src)+'" loading="lazy" referrerpolicy="no-referrer" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\'"><div class="digital-card-fallback" style="display:none">'+fallback+'</div>';
}
function waUrl(){const n=String(wallet.support_whatsapp||'963942586044').replace(/\D/g,'');return'https://wa.me/'+n+'?text='+encodeURIComponent('مرحبًا، أحتاج مساعدة بخصوص المنتجات الرقمية في تطبيق الديون.')}
function drawerMarkup(){try{return window.drawer?.()||''}catch(_e){return''}}
function bottom(active='categories'){
  return '<nav class="digital-bottom">'+
    '<button class="'+(active==='home'?'active':'')+'" onclick="DigitalStore.root()"><b>⌂</b><span>الرئيسية</span></button>'+
    '<button class="'+(active==='categories'?'active':'')+'" onclick="DigitalStore.root()"><b>▦</b><span>الأقسام</span></button>'+
    '<button aria-disabled="true"><b>▤</b><span>الطلبات</span></button>'+
    '<button class="'+(active==='account'?'active':'')+'" onclick="DigitalStore.balance()"><b>◎</b><span>حسابي</span></button></nav>';
}
function fab(){return '<a class="digital-wa-fab" href="'+safe(waUrl())+'" aria-label="واتساب">◉</a>'}
function header(){
  return '<header class="digital-header">'+
    '<div class="digital-brand"><div class="digital-logo">U</div><div class="digital-brand-copy"><b>UCHIHA</b><small>المنتجات الرقمية</small></div></div>'+
    '<div class="digital-head-actions">'+
      '<button class="digital-head-btn" onclick="DigitalStore.balance()"><strong>'+safe(money(wallet.balance))+'</strong><span>الرصيد</span></button>'+
      '<button class="digital-head-btn" aria-disabled="true"><b>▤</b><span>الطلبات</span></button>'+
      '<button class="digital-menu-btn" onclick="toggleDrawer()">☰</button>'+
    '</div></header>';
}
function statusStrip(){
  const o=wallet.orders?.[0];if(!o)return'';
  const note=o.owner_note||o.provider_status||'';
  return '<div class="digital-status-strip"><b>#'+safe(String(o.id||'').slice(0,8))+' · '+safe(statusText(o.status||o.provider_status))+'</b><span>'+safe(note)+'</span></div>';
}
function hero(){
  return '<section class="digital-hero"><img class="digital-hero-real" src="digital-hero-v150.webp" alt=""><div class="digital-hero-shade"></div><div class="digital-hero-copy"><b><em>DIGITAL</em><br>WORLD<br>WITH <em>UCHIHA</em></b><span>كل ما تحتاجه في مكان واحد</span></div></section>';
}
function searchBox(){
  return '<div class="digital-search"><i>⌕</i><input id="digitalSearch" value="'+safe(query)+'" placeholder="ابحث عن قسم ..." oninput="DigitalStore.search(this.value)"></div>';
}
function breadcrumbs(){
  if(!path.length)return'';
  return '<div class="digital-breadcrumb"><button class="digital-crumb" onclick="DigitalStore.root()">الرئيسية</button>'+
    path.map((x,i)=>'<button class="digital-crumb" onclick="DigitalStore.jump('+i+')">'+safe(nameOf(x))+'</button>').join('')+'</div>';
}
function grid(){
  if(lastCatalogError){
    return '<div class="digital-grid"><div class="digital-empty"><b>تعذر تحميل الأقسام</b><span style="display:block;margin-top:6px">'+safe(lastCatalogError)+'</span><button class="digital-secondary" style="margin-top:10px" onclick="DigitalStore.retry()">إعادة المحاولة</button></div></div>';
  }
  const cats=filtered(catalog.categories||[]);
  if(cats.length){
    return '<div class="digital-grid">'+cats.map(c=>'<button class="digital-card" onclick="DigitalStore.category('+Number(c.id||0)+')"><div class="digital-card-media">'+imgMarkup(c)+'</div><div class="digital-card-name">'+safe(nameOf(c))+'</div></button>').join('')+'</div>';
  }
  const products=filtered(catalog.products||[]);
  if(products.length){
    return '<div class="digital-grid">'+products.map(p=>'<button class="digital-card" onclick="DigitalStore.product('+Number(p.id||0)+')"><div class="digital-card-media">'+imgMarkup(p)+'</div><div class="digital-card-name">'+safe(nameOf(p))+'</div><div class="digital-card-price">'+safe(money(priceOf(p)))+'</div></button>').join('')+'</div>';
  }
  return '<div class="digital-grid"><div class="digital-empty">لا توجد عناصر في هذا القسم حاليًا.</div></div>';
}
function loadingOverlay(){
  return loading?'<div class="digital-load-overlay" aria-live="polite"><div class="digital-spinner" aria-label="جاري التحميل"></div></div>':'';
}
function storeScreen(){
  const root='<div class="digital-store"><div class="digital-wrap">'+header()+statusStrip()+hero()+searchBox()+
    grid()+
    '</div>'+fab()+bottom('categories')+drawerMarkup()+loadingOverlay()+'</div>';
  el('app').innerHTML=root;
}
async function loadWallet(){
  const r=await call('digital_wallet');
  if(r.ok){wallet={...wallet,...r};wallet.orders=Array.isArray(r.orders)?r.orders:[];if(mode)render();}
  return r;
}
async function loadCatalog(categoryId=0,commit=null){
  if(loading)return false;
  loading=true;lastCatalogError='';storeScreen();
  let r;
  try{r=await call('digital_catalog',{category_id:categoryId});}
  catch(_e){r={ok:false,error:'SERVICE_UNAVAILABLE'};}
  if(!r.ok){
    loading=false;
    lastCatalogError=errorText(r.error);
    storeScreen();
    notify(lastCatalogError,true);
    return false;
  }
  const next=arrays(r.data);
  if(typeof commit==='function')commit();
  catalog=next;lastCatalogError='';loading=false;storeScreen();
  return true;
}
function quantityMeta(p){
  const raw=p?.qty_values||p?.quantity_values||p?.quantities||p?.quantity_options||{};
  let min=1,max=1,step=1,options=[];
  if(Array.isArray(raw))options=raw.map(Number).filter(n=>Number.isInteger(n)&&n>0);
  else if(raw&&typeof raw==='object'){
    min=Number(raw.min||raw.minimum||raw.min_qty||1)||1;max=Number(raw.max||raw.maximum||raw.max_qty||min)||min;step=Number(raw.step||raw.increment||1)||1;
    if(Array.isArray(raw.values))options=raw.values.map(Number).filter(n=>Number.isInteger(n)&&n>0);
    if(Array.isArray(raw.options))options=raw.options.map(x=>Number(x?.value??x)).filter(n=>Number.isInteger(n)&&n>0);
  }
  options=[...new Set(options)].sort((a,b)=>a-b);if(options.length){min=options[0];max=options[options.length-1]}
  const variable=String(p?.product_type||'').toLowerCase()==='amount'||max>min||options.length>1;
  return {variable,min:Math.max(1,min),max:Math.max(Math.max(1,min),max),step:Math.max(1,step),options};
}
function normalizeFields(p){
  let params=p?.params||p?.fields||p?.requirements||p?.inputs||p?.parameters||[];
  if(params&&typeof params==='object'&&!Array.isArray(params)){
    const nested=params.params||params.fields||params.requirements;if(nested)params=nested;
    else params=Object.entries(params).map(([k,v])=>({name:k,label:typeof v==='string'?v:k}));
  }
  if(!Array.isArray(params))params=[params];
  return params.map(x=>{
    if(typeof x==='string')return{key:x,label:x,required:true,options:[]};
    const key=String(x?.name||x?.key||x?.param||x?.field||x?.code||x?.id||'').trim();
    let opts=x?.options||x?.values||x?.choices||[];if(opts&&typeof opts==='object'&&!Array.isArray(opts))opts=Object.entries(opts).map(([v,l])=>({value:v,label:typeof l==='string'?l:v}));if(!Array.isArray(opts))opts=[opts];
    opts=opts.map(o=>typeof o==='object'?{value:String(o.value??o.id??o.code??o.key??''),label:String(o.label??o.name??o.title??o.value??o.id??'')}:{value:String(o),label:String(o)}).filter(o=>o.value);
    return{key,label:String(x?.label||x?.title||x?.display_name||x?.placeholder||x?.description||key),required:![false,0,'0','false','optional'].includes(x?.required),options:opts};
  }).filter(f=>f.key&&!['qty','quantity','orderuuid','productid'].includes(f.key.replace(/[^a-z0-9]/gi,'').toLowerCase()));
}
function productScreen(){
  const p=selectedProduct||{},fields=normalizeFields(p),q=quantityMeta(p);
  const fieldHtml=fields.map((f,i)=>'<div class="digital-field"><label>'+safe(f.label)+(f.required?' *':'')+'</label>'+
    (f.options.length?'<select class="digital-select" id="df'+i+'" data-key="'+safe(f.key)+'">'+f.options.map(o=>'<option value="'+safe(o.value)+'">'+safe(o.label)+'</option>').join('')+'</select>':'<input class="digital-input" id="df'+i+'" data-key="'+safe(f.key)+'" '+(f.required?'required':'')+' placeholder="'+safe(f.label)+'">')+'</div>').join('');
  let qHtml='';
  if(q.variable){
    qHtml='<div class="digital-field"><label>قيمة الشحن / الكمية حسب جاسر كارد</label>'+
      (q.options.length?'<select class="digital-select" id="digitalQty">'+q.options.map(v=>'<option value="'+v+'">'+v+'</option>').join('')+'</select>':'<input class="digital-input" id="digitalQty" type="number" inputmode="numeric" min="'+q.min+'" max="'+q.max+'" step="'+q.step+'" value="'+q.min+'">')+'</div>';
  }
  el('app').innerHTML='<div class="digital-store"><div class="digital-wrap"><div class="digital-page-head"><button class="digital-back" onclick="DigitalStore.closeProduct()">‹</button><h2>تفاصيل المنتج</h2><span class="spacer"></span></div>'+
    '<section class="digital-product-box"><div class="digital-product-top">'+(imageOf(p)?'<img src="'+safe(imageOf(p))+'" alt="">':'<div class="digital-method-icon">U</div>')+'<div class="grow"><h3>'+safe(nameOf(p))+'</h3><div class="digital-price">'+safe(money(priceOf(p)))+'</div></div></div>'+
    qHtml+fieldHtml+'<button class="digital-primary" onclick="DigitalStore.buy()">طلب الآن</button></section>'+
    '</div>'+fab()+bottom('categories')+'</div>';
}
function balanceScreen(){
  el('app').innerHTML='<div class="digital-store"><div class="digital-wrap"><div class="digital-page-head"><button class="digital-back" onclick="DigitalStore.closeSub()">‹</button><h2>شحن الرصيد</h2><span class="spacer"></span></div>'+
    '<div class="digital-method-grid"><button class="digital-method-card" onclick="DigitalStore.shamcash()"><div class="digital-method-icon">شام</div><b>شام كاش</b></button></div>'+
    '</div>'+fab()+bottom('account')+'</div>';
}
function shamcashScreen(){
  const account=wallet.shamcash_account||'';
  let qr='';try{qr=account&&Android?.qrDataUrl?Android.qrDataUrl(account):''}catch(_e){}
  el('app').innerHTML='<div class="digital-store"><div class="digital-wrap"><div class="digital-page-head"><button class="digital-back" onclick="DigitalStore.balance()">‹</button><h2>شام كاش</h2><span class="spacer"></span></div>'+
    '<section class="digital-pay-box"><h3 style="margin:0 0 7px">تحويل إلى حساب شام كاش</h3>'+
    (account?(qr?'<img class="digital-qr" src="'+safe(qr)+'" alt="QR">':'')+'<div class="digital-account">'+safe(account)+'</div>':'<div class="digital-empty">لم تضبط الإدارة حساب شام كاش بعد.</div>')+
    '<div class="digital-field"><label>المبلغ الذي حولته</label><input id="digitalTopupAmount" class="digital-input" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="مثال: 25"></div>'+
    '<button class="digital-secondary" onclick="DigitalStore.pickProof()">إرفاق صورة إثبات التحويل</button>'+
    (proofData?'<img class="digital-proof-preview" src="'+safe(proofData)+'" alt="إثبات التحويل"><small style="display:block;margin-top:5px;color:#93b4a5">'+safe(proofName||'تم اختيار الصورة')+'</small>':'')+
    '<button class="digital-primary" '+(!account?'disabled':'')+' onclick="DigitalStore.submitTopup()">إرسال طلب الشحن</button></section>'+
    '</div>'+fab()+bottom('account')+'</div>';
}
function adminShell(body){
  el('app').innerHTML='<div class="digital-store"><div class="digital-wrap"><div class="digital-page-head"><button class="digital-back" onclick="DigitalStore.exitAdmin()">‹</button><h2>إدارة المتجر الرقمي</h2><span class="spacer"></span></div>'+
    '<div class="digital-admin-tabs">'+[['config','الربط'],['wallets','الأرصدة'],['topups','طلبات الشحن'],['orders','الطلبات']].map(([k,t])=>'<button class="'+(adminTab===k?'active':'')+'" onclick="DigitalStore.adminTab(\''+k+'\')">'+t+'</button>').join('')+'</div>'+body+'</div>'+fab()+'</div>';
}
function renderAdmin(){
  if(adminTab==='config'){
    const c=adminData.config||{};
    const state=c.provider_configured?'<div class="digital-link-state ok">التوكن محفوظ</div>':'<div class="digital-link-state">غير مربوط</div>';
    return adminShell('<section class="digital-admin-box">'+state+'<div class="digital-field"><label>توكن جاسر كارد</label><input id="digitalProviderToken" class="digital-input" type="password" autocomplete="off" placeholder="'+(c.provider_configured?'مربوط حاليًا — اتركه فارغًا للحفاظ عليه':'ألصق التوكن هنا')+'"></div><div class="digital-field"><label>رقم / رمز حساب شام كاش</label><input id="digitalShamAccount" class="digital-input" value="'+safe(c.shamcash_account||'')+'"></div><div class="digital-field"><label>رقم واتساب الدعم</label><input id="digitalSupportWa" class="digital-input" inputmode="tel" value="'+safe(c.support_whatsapp||'963942586044')+'"></div><button id="digitalSaveConfig" class="digital-primary" onclick="DigitalStore.saveConfig()">حفظ واختبار الربط</button><button class="digital-secondary" onclick="DigitalStore.testProvider()">اختبار التوكن المحفوظ</button><small class="digital-help">لا نعرض التوكن بعد حفظه. إذا تركت الحقل فارغًا يبقى التوكن الحالي بدون تغيير.</small></section>');
  }
  if(adminTab==='wallets'){
    const rows=adminData.wallets||[];
    return adminShell('<section class="digital-admin-box">'+(rows.length?rows.map(x=>'<div class="digital-admin-row"><div class="row-top"><div><b>'+safe(x.label)+'</b><small>'+safe(x.phone||'')+'</small></div><span class="money">'+safe(money(x.balance))+'</span></div><div class="digital-admin-actions"><button class="digital-secondary" onclick="DigitalStore.adjustWallet(\''+safe(x.license_id)+'\',\''+safe(x.label)+'\')">تعديل الرصيد</button><button class="digital-secondary" disabled>السجل</button></div></div>').join(''):'<div class="digital-empty">لا يوجد عملاء بعد.</div>')+'</section>');
  }
  if(adminTab==='topups'){
    const rows=adminData.topups||[];
    return adminShell('<section class="digital-admin-box">'+(rows.length?rows.map(x=>'<div class="digital-admin-row"><div class="row-top"><div><b>'+safe(x.label)+' · '+safe(money(x.amount_requested))+'</b><small>'+safe(x.created_at||'')+' · '+safe(x.status)+'</small></div></div>'+(x.proof_data?'<img class="digital-proof-admin" src="'+safe(x.proof_data)+'" alt="إثبات">':'')+(x.status==='pending'?'<div class="digital-field"><label>المبلغ المعتمد للإضافة</label><input id="credit_'+safe(x.id)+'" class="digital-input" type="number" step="0.01" value="'+safe(x.amount_requested)+'"></div><div class="digital-field"><label>ملاحظة الإدارة</label><input id="note_'+safe(x.id)+'" class="digital-input"></div><div class="digital-admin-actions"><button class="digital-primary" onclick="DigitalStore.reviewTopup(\''+safe(x.id)+'\',\'approved\')">قبول وإضافة</button><button class="digital-danger" onclick="DigitalStore.reviewTopup(\''+safe(x.id)+'\',\'rejected\')">رفض</button></div>':'<small>'+safe(x.owner_note||'')+'</small>')+'</div>').join(''):'<div class="digital-empty">لا توجد طلبات شحن.</div>')+'</section>');
  }
  const rows=adminData.orders||[];
  return adminShell('<section class="digital-admin-box">'+(rows.length?rows.map(x=>'<div class="digital-admin-row"><div class="row-top"><div><b>'+safe(x.label)+' · '+safe(x.product_name)+'</b><small>#'+safe(String(x.id).slice(0,8))+' · '+safe(money(x.amount))+' · '+safe(x.provider_status||x.status)+'</small></div></div><div class="digital-field"><label>الحالة</label><select id="os_'+safe(x.id)+'" class="digital-select">'+['pending','processing','accepted','rejected','completed','unknown','refunded'].map(s=>'<option '+(x.status===s?'selected':'')+' value="'+s+'">'+safe(statusText(s))+'</option>').join('')+'</select></div><div class="digital-field"><label>ملاحظة تظهر للعميل</label><input id="on_'+safe(x.id)+'" class="digital-input" value="'+safe(x.owner_note||'')+'"></div><button class="digital-secondary" onclick="DigitalStore.updateOrder(\''+safe(x.id)+'\')">حفظ الحالة والملاحظة</button></div>').join(''):'<div class="digital-empty">لا توجد طلبات.</div>')+'</section>');
}

window.onDigitalProofPicked=function(data,name){proofData=String(data||'');proofName=String(name||'إثبات التحويل');shamcashScreen()};
window.onDigitalProofCancelled=function(){};

window.DigitalStore={
  async open(){
    if(!licensed()){notify('فعّل التطبيق أولًا',true);return;}
    mode='store';path=[];query='';catalog={categories:[],products:[]};lastCatalogError='';drawerOpen=false;loading=false;
    try{storeScreen();}catch(_e){notify('تعذر فتح واجهة المنتجات الرقمية',true);return;}
    const walletTask=loadWallet().catch(()=>null);
    try{await loadCatalog(0);}catch(_e){loading=false;lastCatalogError=errorText('SERVICE_UNAVAILABLE');storeScreen();}
    await walletTask;
  },
  retry(){loadCatalog(Number(path[path.length-1]?.id||0))},
  root(){if(mode!=='store')mode='store';const next=[];query='';lastCatalogError='';loadCatalog(0,()=>{path=next})},
  async category(id){
    const row=(catalog.categories||[]).find(x=>Number(x.id)===Number(id));if(!row||loading)return;
    const next=[...path,row];query='';lastCatalogError='';
    await loadCatalog(id,()=>{path=next});
  },
  jump(i){
    if(loading)return;
    const next=path.slice(0,Math.max(0,Number(i)+1));
    const target=Number(next[next.length-1]?.id||0);query='';
    loadCatalog(target,()=>{path=next});
  },
  up(){
    if(loading)return;
    const next=path.slice(0,-1),target=Number(next[next.length-1]?.id||0);query='';
    loadCatalog(target,()=>{path=next});
  },
  search(v){query=String(v||'');storeScreen();const input=el('digitalSearch');if(input){input.focus();input.selectionStart=input.selectionEnd=input.value.length}},
  async product(id){
    if(loading)return;loading=true;storeScreen();
    const r=await call('digital_product',{product_id:id});
    loading=false;
    if(!r.ok){storeScreen();notify(errorText(r.error),true);return;}
    selectedProduct=r.product;mode='product';productScreen();
  },
  closeProduct(){mode='store';selectedProduct=null;storeScreen()},
  async buy(){if(busy||!selectedProduct)return;const fields={};normalizeFields(selectedProduct).forEach((f,i)=>{const n=el('df'+i);if(n)fields[f.key]=n.value});const qm=quantityMeta(selectedProduct);let quantity=1;if(qm.variable){quantity=Number(el('digitalQty')?.value||qm.min);if(!Number.isFinite(quantity)||quantity<qm.min||quantity>qm.max){notify('اختر قيمة صحيحة حسب جاسر كارد',true);return;}}busy=true;notify('جاري إرسال الطلب...');const r=await call('digital_purchase',{product_id:Number(selectedProduct.id),fields,quantity});busy=false;if(!r.ok){notify(errorText(r.error),true);return;}wallet.balance=Number(r.balance??wallet.balance);notify(r.outcome==='failed'?'تم رفض الطلب وإعادة الرصيد':'تم إرسال الطلب');mode='store';selectedProduct=null;await loadWallet();storeScreen()},
  async balance(){mode='balance';balanceScreen();await loadWallet();if(mode==='balance')balanceScreen()},
  shamcash(){mode='shamcash';proofData='';proofName='';shamcashScreen()},
  closeSub(){mode='store';storeScreen()},
  pickProof(){try{if(Android?.pickDigitalProof)Android.pickDigitalProof();else notify('اختيار الصورة متاح داخل APK',true)}catch(_e){notify('تعذر فتح الصور',true)}},
  async submitTopup(){const amount=Number(el('digitalTopupAmount')?.value||0);if(!(amount>0)){notify('اكتب المبلغ الذي حولته',true);return;}if(!proofData){notify('أرفق صورة إثبات التحويل',true);return;}if(busy)return;busy=true;const r=await call('digital_topup_create',{amount,proof_data:proofData});busy=false;if(!r.ok){notify(errorText(r.error),true);return;}proofData='';proofName='';notify('تم إرسال طلب الشحن للإدارة');await this.balance()},
  async admin(){if(!owner()){notify('هذه الصفحة للإدارة فقط',true);return;}mode='admin';adminTab='config';drawerOpen=false;await this.loadAdmin()},
  async adminTab(tab){adminTab=tab;await this.loadAdmin()},
  async loadAdmin(){let action='owner_digital_config_get';if(adminTab==='wallets')action='owner_digital_wallets';if(adminTab==='topups')action='owner_digital_topups';if(adminTab==='orders')action='owner_digital_orders';const r=await call(action);if(!r.ok){notify(errorText(r.error),true);return;}if(adminTab==='config')adminData.config=r;else adminData[adminTab]=r.items||[];renderAdmin()},
  async saveConfig(){
    if(busy)return;
    const btn=el('digitalSaveConfig');if(btn){btn.disabled=true;btn.textContent='جاري الحفظ والاختبار...'}
    busy=true;
    const r=await call('owner_digital_config_set',{
      provider_token:(el('digitalProviderToken')?.value||'').trim(),
      shamcash_account:el('digitalShamAccount')?.value||'',
      support_whatsapp:el('digitalSupportWa')?.value||''
    });
    busy=false;
    if(!r.ok){if(btn){btn.disabled=false;btn.textContent='حفظ واختبار الربط'}notify(errorText(r.error),true);return;}
    if(r.provider_test===true)notify('تم حفظ التوكن والاتصال بجاسر كارد بنجاح');
    else if(r.provider_configured)notify('تم حفظ التوكن. تعذر اختبار جاسر كارد الآن، وسيعاد الاختبار عند فتح الأقسام.');
    else notify('تم حفظ الإعدادات');
    await this.loadAdmin();
  },
  async testProvider(){
    if(busy)return;busy=true;notify('جاري اختبار الربط...');
    const r=await call('owner_digital_provider_test',{});busy=false;
    if(!r.ok){notify(errorText(r.error),true);return;}
    notify(r.provider_test?'الربط مع جاسر كارد يعمل':'التوكن محفوظ لكن جاسر كارد لم يستجب للاختبار',!r.provider_test);
  },
  async adjustWallet(id,label){const raw=prompt('أدخل المبلغ للتعديل. مثال 10 للإضافة أو -5 للخصم\n'+label,'');if(raw===null)return;const amount=Number(raw);if(!amount){notify('المبلغ غير صحيح',true);return;}const reason=prompt('سبب التعديل','تعديل يدوي من الإدارة')||'تعديل يدوي';const r=await call('owner_digital_wallet_adjust',{license_id:id,amount,reason});if(!r.ok){notify(errorText(r.error),true);return;}notify('تم تحديث الرصيد');await this.loadAdmin()},
  async reviewTopup(id,decision){const amount=Number(el('credit_'+id)?.value||0),note=el('note_'+id)?.value||'';const r=await call('owner_digital_topup_review',{topup_id:id,decision,amount,note});if(!r.ok){notify(errorText(r.error),true);return;}notify(decision==='approved'?'تمت الإضافة إلى رصيد العميل':'تم رفض الطلب');await this.loadAdmin()},
  async updateOrder(id){const status=el('os_'+id)?.value||'pending',note=el('on_'+id)?.value||'';const r=await call('owner_digital_order_update',{order_id:id,status,note});if(!r.ok){notify(errorText(r.error),true);return;}notify('تم حفظ الحالة');await this.loadAdmin()},
  exitAdmin(){mode='';adminTab='config';render()},
  exit(){mode='';render()}
};


const priorCompanyAdmin=window.DebtUI&&typeof window.DebtUI.admin==='function'?window.DebtUI.admin.bind(window.DebtUI):null;
if(priorCompanyAdmin){
  window.DebtUI.admin=async function(...args){
    const out=await priorCompanyAdmin(...args);
    setTimeout(()=>{
      const host=document.querySelector('.debt-service-screen');
      if(host&&!host.querySelector('.digital-admin-launch')){
        const box=document.createElement('section');
        box.className='debt-benefits digital-admin-launch';
        box.innerHTML='<h3>المنتجات الرقمية</h3><p>إدارة جاسر كارد، أرصدة العملاء، طلبات الشحن والطلبات.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn primary full" onclick="window.DigitalStore.open()">فتح المتجر</button><button class="btn full" onclick="window.DigitalStore.admin()">إدارة المتجر</button></div>';
        host.insertBefore(box,host.firstChild);
      }
    },0);
    return out;
  };
}

window.drawer=function(){
  const html=oldDrawer?.()||'';if(!drawerOpen||!html)return html;
  const items='<button class="drawer-item" onclick="window.DigitalStore.open()">🛍️ المنتجات الرقمية</button>'+
    (owner()?'<button class="drawer-item" onclick="DigitalStore.admin()">⚙️ إدارة المتجر الرقمي</button>':'');
  return html.replace('</aside>','<hr>'+items+'</aside>');
};
window.render=function(){
  if(mode==='store'){storeScreen();return}
  if(mode==='product'){productScreen();return}
  if(mode==='balance'){balanceScreen();return}
  if(mode==='shamcash'){shamcashScreen();return}
  if(mode==='admin'){renderAdmin();return}
  return oldRender?.();
};
window.appBack=function(){
  if(mode==='product'){DigitalStore.closeProduct();return true}
  if(mode==='shamcash'){DigitalStore.balance();return true}
  if(mode==='balance'){mode='store';storeScreen();return true}
  if(mode==='admin'){DigitalStore.exitAdmin();return true}
  if(mode==='store'){if(path.length){DigitalStore.up();return true}mode='';render();return true}
  return oldBack?.()||false;
};
window.UCHIHA_DIGITAL_STORE_VERSION=VERSION;
})();