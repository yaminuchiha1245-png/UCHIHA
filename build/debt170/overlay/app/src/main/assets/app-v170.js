/* UCHIHA Debt Store v1.5.20 — instant product dialog and provider-style loader. */
(function(){'use strict';
const VERSION='1.5.20';
const oldRender=window.render, oldDrawer=window.drawer, oldBack=window.appBack;
const priorResult=window.onDebtServiceResult;
const pending=new Map();
let seq=0,mode='',path=[],catalog={categories:[],products:[]},query='',selectedProduct=null,selectedSchema=null,loading=false,lastCatalogError='';
let wallet={balance:0,orders:[],shamcash_account:'',support_whatsapp:'963942586044'};
let proofData='',proofName='',adminTab='config',adminData={},busy=false,topupOpen=false;
let orderDraft={quantity:1,fields:{},verifiedValue:'',playerName:''};
let productRequestSeq=0,productPending=false;
let smm={root:null,returnPath:[],rootCategories:[],rootProducts:[],platforms:[],platform:null,sectionTrail:[],sections:[],sectionOptions:[],selectedSection:null,products:[],product:null,unitPrice:0,search:'',expanded:false,error:'',drop:'',dropSearch:''};

const el=id=>document.getElementById(id);
const safe=v=>window.esc?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>{const n=Number(v||0);return '$ '+(Number.isFinite(n)?n.toFixed(n<1?3:2):'0.00')};
const latinDigits=v=>String(v??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const enNum=v=>latinDigits(String(v??''));
const meta=()=>{try{return JSON.parse(window.Android?.serviceStatus?.()||'{}')}catch(_e){return {}}};
const licensed=()=>{const m=meta();if(m.reauth_required||m.active===false)return false;return !!(m.license_id||m.role||m.active===true||(typeof window.isOwner==='function'&&window.isOwner()))};
const owner=()=>{const m=meta();return m.role==='owner'||(typeof window.isOwner==='function'&&window.isOwner())};
const statusText=s=>{s=String(s||'').toLowerCase();if(/complete|done|deliver/.test(s))return'مكتمل';if(/accept|success|ok/.test(s))return'مقبول';if(/reject|fail|cancel|refund/.test(s))return'مرفوض';if(/process|send|run/.test(s))return'جاري التنفيذ';return'قيد التنفيذ'};
const errorText=e=>({SESSION_REQUIRED:'فعّل التطبيق أولًا.',LICENSE_INACTIVE:'الخدمة موقوفة.',PROVIDER_NOT_CONFIGURED:'لم يتم ربط متجر جاسر كارد بعد.',INVALID_PROVIDER_TOKEN:'توكن جاسر كارد مرفوض من المزود.',PROVIDER_UNAVAILABLE:'تعذر الاتصال بجاسر كارد حاليًا.',SERVICE_UNAVAILABLE:'تعذر الوصول إلى خدمة المتجر الآن.',RATE_LIMITED:'تم إرسال طلبات كثيرة بسرعة. حاول بعد قليل.',DATABASE:'حدث خطأ في قاعدة بيانات المتجر.',INSUFFICIENT_BALANCE:'رصيدك غير كافٍ لإتمام الطلب.',INVALID_PROOF:'صورة إثبات التحويل غير صالحة أو كبيرة.',INVALID_AMOUNT:'الكمية أو المبلغ غير صحيح.',MISSING_FIELDS:'أكمل بيانات الطلب المطلوبة.',INVALID_FIELDS:'إحدى بيانات الطلب غير صحيحة.',INVALID_PLAYER_ID:'رقم اللاعب غير صحيح.',VERIFICATION_NOT_SUPPORTED:'التحقق غير متاح لهذا المنتج.',ALREADY_REVIEWED:'تمت مراجعة هذا الطلب مسبقًا.',FORBIDDEN:'هذه الصفحة مخصصة للإدارة.',TIMEOUT:'الاتصال أخذ وقتًا أطول من المتوقع. حاول مجددًا.',NATIVE_REQUIRED:'حدّث التطبيق إلى النسخة الجديدة.'})[e]||'حدث خطأ. حاول مرة أخرى.';

function call(action,args={}){
  return new Promise(resolve=>{
    if(!window.Android?.serviceRequest){resolve({ok:false,error:'NATIVE_REQUIRED'});return;}
    const id='V148-'+Date.now()+'-'+(++seq);
    const slow=new Set(['digital_catalog','digital_product','digital_verify_player','digital_purchase','owner_digital_config_set','owner_digital_provider_test']);
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
  if(/^cat_[^/]+\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(v))return'https://js4card.com/uploads/categories/'+v;
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
  let kind='grid',accentA='#58b8ff',accentB='#9568ff';
  if(/free|pubg|call|game|لعب|فري|ببجي|سوني|playstation/.test(n)){kind='game';accentA='#5ac8ff';accentB='#865dff'}
  else if(/مشاهد|netflix|youtube|watch|iptv|tv/.test(n)){kind='watch';accentA='#ff5a8e';accentB='#8b6bff'}
  else if(/بطاق|card|visa|sim|اتصال|رصيد/.test(n)){kind='card';accentA='#55d9ff';accentB='#5378ff'}
  else if(/رقم|phone|sms/.test(n)){kind='phone';accentA='#ff71bf';accentB='#6a7dff'}
  else if(/رشق|social|instagram|facebook|tiktok|youtube/.test(n)){kind='social';accentA='#6aa8ff';accentB='#9e66ff'}
  else if(/عملات|crypto|usdt|bitcoin|binance/.test(n)){kind='coin';accentA='#ffc84a';accentB='#ff8b52'}
  else if(/حساب|account/.test(n)){kind='user';accentA='#76a8ff';accentB='#876cff'}
  else if(/تصميم|design|canva|capcut|adobe/.test(n)){kind='design';accentA='#58cfff';accentB='#b16cff'}
  else if(/بلس|plus|premium/.test(n)){kind='plus';accentA='#72e2ff';accentB='#996dff'}
  else if(/ذكاء|ai|gpt|gemini/.test(n)){kind='ai';accentA='#55d7ff';accentB='#a56aff'}
  const paths={
    game:'<path d="M38 60h22l7-12h26l7 12h22c11 0 18 9 16 20l-5 26c-2 10-14 14-22 7l-17-15H66l-17 15c-8 7-20 3-22-7l-5-26c-2-11 5-20 16-20Z"/><path d="M51 72v17M42.5 80.5h17M108 74h.1M120 87h.1"/>',
    watch:'<rect x="25" y="35" width="110" height="90" rx="18"/><path d="m67 60 38 20-38 20z"/><path d="M50 137h60"/>',
    card:'<rect x="24" y="43" width="112" height="74" rx="15"/><path d="M24 63h112M44 91h34M101 91h18"/><circle cx="113" cy="92" r="8"/>',
    phone:'<rect x="52" y="22" width="56" height="116" rx="16"/><path d="M70 39h20M73 121h14"/><circle cx="80" cy="82" r="17"/>',
    social:'<circle cx="70" cy="62" r="24"/><path d="M31 128c5-27 21-41 39-41s34 14 39 41M116 39h20M126 29v20"/><circle cx="124" cy="103" r="13"/>',
    coin:'<circle cx="80" cy="80" r="49"/><path d="M92 52H71c-11 0-18 7-18 15s7 14 18 14h18c11 0 18 7 18 15s-7 15-18 15H66M80 42v76"/>',
    user:'<circle cx="80" cy="58" r="25"/><path d="M37 130c5-29 22-44 43-44s38 15 43 44"/><path d="M119 49h18M128 40v18"/>',
    design:'<path d="M39 118 108 49M36 60l18-18 64 64-18 18zM98 35l9-9 27 27-9 9z"/><path d="m30 130 27-7-20-20z"/>',
    plus:'<circle cx="80" cy="80" r="48"/><path d="M80 52v56M52 80h56"/><path d="m116 36 4 10 10 4-10 4-4 10-4-10-10-4 10-4z"/>',
    ai:'<path d="M52 48h56v64H52z"/><circle cx="67" cy="68" r="6"/><circle cx="93" cy="68" r="6"/><path d="M65 91h30M80 32v16M80 112v16M36 80h16M108 80h16"/><path d="M31 54h12M117 54h12M31 106h12M117 106h12"/>',
    grid:'<rect x="30" y="30" width="42" height="42" rx="10"/><rect x="88" y="30" width="42" height="42" rx="10"/><rect x="30" y="88" width="42" height="42" rx="10"/><rect x="88" y="88" width="42" height="42" rx="10"/>'
  };
  const svg='<svg class="digital-fallback-svg" viewBox="0 0 160 160" aria-hidden="true"><defs><linearGradient id="fg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="'+accentA+'"/><stop offset="1" stop-color="'+accentB+'"/></linearGradient><radialGradient id="glow"><stop stop-color="'+accentA+'" stop-opacity=".22"/><stop offset="1" stop-color="'+accentA+'" stop-opacity="0"/></radialGradient></defs><circle cx="80" cy="74" r="63" fill="url(#glow)"/><g fill="none" stroke="url(#fg)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">'+paths[kind]+'</g></svg>';
  return '<div class="digital-card-art-bg"></div>'+svg;
}
function imgMarkup(item,fallbackItem=null){
  const src=imageOf(item)||imageOf(fallbackItem),art=artFallback(item||fallbackItem||{});
  const remote=src?'<img class="digital-card-photo" src="'+safe(src)+'" alt="" loading="lazy" decoding="async" onload="this.classList.add(\'is-loaded\')" onerror="this.remove()">':'';
  return '<div class="digital-card-fallback">'+art+'</div>'+remote;
}
function nearestPathImage(){
  for(let i=path.length-1;i>=0;i--){if(imageOf(path[i]))return path[i]}
  return null;
}

function isSmmCategory(item){
  const n=nameOf(item).toLowerCase();
  return n.includes('الرشق')||n.includes('رشق')||n.includes('smm')||n.includes('social media');
}
const SMM_APPS=[
  {key:'instagram',name:'Instagram',rx:/instagram|insta|انستغرام|انستقرام|انستا/i},
  {key:'tiktok',name:'TikTok',rx:/tiktok|tik tok|تيك\s*توك|تيكتوك/i},
  {key:'youtube',name:'YouTube',rx:/youtube|youtu\.be|يوتيوب/i},
  {key:'facebook',name:'Facebook',rx:/facebook|fb\b|فيسبوك|فيس بوك/i},
  {key:'twitter',name:'X',rx:/twitter|تويتر|\bX\b/i},
  {key:'reddit',name:'Reddit',rx:/reddit|ريديت/i},
  {key:'telegram',name:'Telegram',rx:/telegram|تلغرام|تليغرام|تيليجرام|تليجرام/i},
  {key:'discord',name:'Discord',rx:/discord|ديسكورد/i},
  {key:'spotify',name:'Spotify',rx:/spotify|سبوتيفاي|سبوتفاي/i},
  {key:'snapchat',name:'Snapchat',rx:/snapchat|snap chat|سناب\s*شات|سناب/i},
  {key:'linkedin',name:'LinkedIn',rx:/linkedin|لينكد\s*ان|لينكدإن/i},
  {key:'twitch',name:'Twitch',rx:/twitch|تويتش/i},
  {key:'kick',name:'Kick',rx:/\bkick\b|كيك/i},
  {key:'whatsapp',name:'WhatsApp',rx:/whatsapp|واتساب|واتس اب|واتسآب/i},
  {key:'quora',name:'Quora',rx:/quora|كورا/i},
  {key:'soundcloud',name:'SoundCloud',rx:/soundcloud|ساوند\s*كلاود|ساوندكلاود/i},
  {key:'tumblr',name:'Tumblr',rx:/tumblr|تمبلر|تومبلر/i},
  {key:'threads',name:'Threads',rx:/threads|ثريدز|ثريد/i},
  {key:'cloudsync',name:'Cloud Sync',rx:/cloud\s*sync|sync\s*cloud|مزامنة\s*سحاب|سحابي/i}
];
function smmDetectApp(item){
  const n=nameOf(item);
  return SMM_APPS.find(a=>a.rx.test(n))||null;
}
function smmPlatformMeta(item){
  const key=String(item?.key||'');
  return SMM_APPS.find(a=>a.key===key)||{name:String(item?.name||'')};
}
function smmBuildApps(_categories,_products){
  return SMM_APPS.map(a=>({key:a.key,name:a.name}));
}
function smmRowsForApp(rows,appKey){
  if(!appKey)return[];
  return (rows||[]).filter(x=>smmDetectApp(x)?.key===appKey);
}
function smmLogo(meta,cls=''){
  const m=meta||{};if(!SMM_APPS.some(a=>a.key===m.key))return '';
  return '<span class="smm-logo '+cls+'" data-app="'+safe(m.key)+'"><img src="smm-brands/'+safe(m.key)+'.svg" alt="" draggable="false"></span>';
}
function smmCurrentMeta(){return smmPlatformMeta(smm.platform||{});}
function smmCloseDrop(){smm.drop='';smm.dropSearch='';smmScreen();}
function smmToggleDrop(kind){smm.drop=smm.drop===kind?'':kind;smm.dropSearch='';smmScreen();setTimeout(()=>document.querySelector('.smm-dropdown-search input')?.focus(),0)}
function smmFilterRows(){
  const terms=[smm.search,smm.dropSearch].map(v=>String(v||'').trim().toLowerCase()).filter(Boolean);
  document.querySelectorAll('.smm-dropdown .smm-drop-row').forEach(row=>{
    const label=String(row.textContent||'').toLowerCase();
    row.hidden=!terms.every(q=>label.includes(q));
  });
  document.querySelectorAll('.smm-dropdown').forEach(drop=>{
    const empty=drop.querySelector('.smm-drop-empty');
    if(empty)empty.hidden=!!drop.querySelector('.smm-drop-row:not([hidden])');
  });
}
function smmDropFilter(v){smm.dropSearch=String(v||'');smmFilterRows();}
function smmLinkFields(p){
  const fields=normalizeFields(p);
  const hasLink=fields.some(f=>/link|url|رابط/i.test(f.key+' '+f.label));
  return hasLink?fields:[...fields,{key:'link',label:'الرابط',required:true,options:[]}];
}
function smmPriceNow(){
  const p=smm.product;if(!p)return 0;
  const q=quantityMeta(p),unit=Number(smm.unitPrice)>0?Number(smm.unitPrice):priceOf(p);
  if(!q.variable)return unit;
  const raw=latinDigits(el('smmQty')?.value||q.min||1);
  const n=Number(raw);
  return Number.isFinite(n)&&n>0?unit*n:unit*(q.min||1);
}
function smmUpdatePrice(){
  const node=el('smmPriceValue');if(node)node.textContent=money(smmPriceNow());
}
window.smmUpdatePrice=smmUpdatePrice;window.smmToggleDrop=smmToggleDrop;window.smmDropFilter=smmDropFilter;window.smmQtySync=function(v){const n=el('smmQty');if(!n)return;const raw=latinDigits(v).replace(/[^0-9]/g,'');if(n.value!==raw)n.value=raw;smmUpdatePrice();};
function smmTopbar(){
  const pending=(wallet.orders||[]).filter(o=>['pending','processing','in_progress','waiting'].includes(String(o.status||o.provider_status||'').toLowerCase())).length;
  return '<header class="smm-ref-topbar">'+
    '<div class="smm-ref-brand"><button class="smm-ref-menu" onclick="toggleDrawer()" aria-label="القائمة"><span></span><span></span><span></span></button><div class="smm-ref-wordmark"><b>ديون</b><i></i></div></div>'+
    '<div class="smm-ref-actions">'+
      '<button class="smm-ref-notify" aria-disabled="true"><span>♟</span>'+(pending?'<em>'+pending+'</em>':'')+'</button>'+
      '<button class="smm-ref-wallet" onclick="DigitalStore.balance()"><span>▣</span><b>'+safe(money(wallet.balance))+'</b></button>'+
      '<button class="smm-ref-profile" aria-disabled="true">●</button>'+
    '</div></header>';
}
function smmPlatformChips(){
  const rows=smm.platforms||[];
  if(!rows.length)return '<div class="smm-app-empty">لم يتم العثور على تطبيقات رشق ضمن أقسام المزود.</div>';
  const first=rows.slice(0,7),second=rows.slice(7,13),extra=rows.slice(13);
  const appButton=p=>{const m=smmPlatformMeta(p),active=smm.platform&&smm.platform.key===p.key;return '<button class="smm-app '+(active?'active':'')+'" onclick="DigitalStore.smmPlatform(\''+safe(p.key)+'\')" title="'+safe(p.name)+'" aria-label="'+safe(p.name)+'" aria-pressed="'+!!active+'">'+smmLogo(m)+'</button>'};
  let html='<section class="smm-app-panel"><div class="smm-platforms smm-platforms-ref">';
  html+='<button class="smm-all '+(smm.platform?.key==='all'?'active':'')+'" onclick="DigitalStore.smmPlatform(\'all\')">الكل</button>';
  html+=first.map(appButton).join('');
  html+='<button class="smm-more smm-more-ref" onclick="DigitalStore.smmMore()">'+(smm.expanded?'عرض أقل':'عرض المزيد '+(extra.length?('+'+extra.length):'+6'))+'</button>';
  html+=second.map(appButton).join('');
  if(smm.expanded)html+=extra.map(appButton).join('');
  return html+'</div></section>';
}
function smmOrderForm(){
  if(!smm.platform){smm.platform={key:'all',name:'الكل'};smm.sections=[...(smm.rootCategories||[])];smm.sectionOptions=[...smm.sections];smm.products=[...(smm.rootProducts||[])];}
  const meta=smmCurrentMeta();
  const baseSections=smm.sectionOptions?.length?smm.sectionOptions:(smm.sections||[]);
  const sections=baseSections;
  const baseProducts=smm.products||[];
  const products=baseProducts;
  const p=smm.product,q=p?quantityMeta(p):null,fields=p?smmLinkFields(p):[{key:'link',label:'الرابط',required:true,options:[]}];
  const selectedSection=smm.selectedSection;

  const sectionRows=sections.map(x=>'<button class="smm-drop-row '+(selectedSection&&Number(selectedSection.id)===Number(x.id)?'selected':'')+'" onclick="DigitalStore.smmSection('+Number(x.id||0)+')">'+
    smmLogo(smmDetectApp(x)||meta,'small')+'<span>'+safe(nameOf(x))+'</span></button>').join('');
  const sectionDrop=smm.drop==='section'
    ?'<div class="smm-dropdown"><div class="smm-dropdown-search"><i>⌕</i><input value="'+safe(smm.dropSearch)+'" placeholder="بحث" oninput="smmDropFilter(this.value)"></div><div class="smm-drop-list">'+(sectionRows+'<div class="smm-drop-empty" hidden>لا توجد أقسام مطابقة</div>')+'</div></div>'
    :'';
  const sectionTrigger='<button class="smm-select-trigger '+(selectedSection?'selected':'')+'" onclick="smmToggleDrop(\'section\')">'+
    '<span class="smm-trigger-main">'+smmLogo(meta,'small')+'<b>'+safe(selectedSection?nameOf(selectedSection):(smm.platform.key==='all'?'اختر التطبيق / نوع الخدمة':'اختر نوع الخدمة كما هو لدى المزود'))+'</b></span><i>⌃</i></button>';

  const serviceRows=products.map(x=>'<button class="smm-drop-row '+(p&&Number(p.id)===Number(x.id)?'selected':'')+'" onclick="DigitalStore.smmService('+Number(x.id||0)+')">'+
    smmLogo(smmDetectApp(x)||meta,'small')+'<span>'+safe(nameOf(x))+'</span></button>').join('');
  const serviceDrop=smm.drop==='product'
    ?'<div class="smm-dropdown"><div class="smm-dropdown-search"><i>⌕</i><input value="'+safe(smm.dropSearch)+'" placeholder="بحث" oninput="smmDropFilter(this.value)"></div><div class="smm-drop-list">'+(serviceRows+'<div class="smm-drop-empty" hidden>لا توجد خدمات مطابقة</div>')+'</div></div>'
    :'';
  const serviceTrigger='<button class="smm-select-trigger '+(p?'selected':'')+'" '+(!products.length?'disabled':'')+' onclick="smmToggleDrop(\'product\')">'+
    '<span class="smm-trigger-main">'+smmLogo(meta,'small')+'<b>'+safe(p?nameOf(p):(products.length?'اختر الخدمة':'اختر القسم أولًا'))+'</b></span><i>⌃</i></button>';

  const fieldsHtml=fields.map((f,i)=>{
    const isLink=/link|url|رابط/i.test(f.key+' '+f.label);
    const label=isLink?'رابط':f.label;
    const placeholder=isLink?'أدخل رابط الحساب أو المنشور':f.label;
    if(f.options.length){
      return '<div class="smm-field" data-smm-key="field-'+safe(f.key)+'"><label>'+safe(label)+(f.required?' *':'')+'</label>'+
        '<select class="smm-select smm-order-field" id="smmF'+i+'" data-key="'+safe(f.key)+'" '+(p?'':'disabled')+'>'+f.options.map(o=>'<option value="'+safe(o.value)+'">'+safe(o.label)+'</option>').join('')+'</select></div>';
    }
    return '<div class="smm-field" data-smm-key="field-'+safe(f.key)+'"><label>'+safe(label)+(f.required?' *':'')+'</label>'+
      '<div class="smm-input-wrap">'+(isLink?'<i>🔗</i>':'')+'<input class="smm-input smm-order-field '+(isLink?'smm-link-input':'')+'" id="smmF'+i+'" data-key="'+safe(f.key)+'" '+(f.required?'required':'')+' placeholder="'+safe(placeholder)+'"></div></div>';
  }).join('');

  let qtyHtml='';
  if(q&&q.variable){
    if(q.options.length){
      qtyHtml='<div class="smm-field" data-smm-key="quantity"><label>الكمية</label><select class="smm-select smm-qty-select" id="smmQty" onchange="smmUpdatePrice()">'+q.options.map(v=>'<option value="'+enNum(v)+'">'+enNum(v)+'</option>').join('')+'</select><small class="smm-limits">الحد الأدنى: '+enNum(q.min)+' · الحد الأقصى: '+enNum(q.max)+'</small></div>';
    }else{
      qtyHtml='<div class="smm-field" data-smm-key="quantity"><label>الكمية</label><input class="smm-input smm-qty" id="smmQty" type="text" inputmode="numeric" pattern="[0-9]*" min="'+enNum(q.min)+'" max="'+enNum(q.max)+'" step="'+enNum(q.step)+'" value="'+enNum(q.min)+'" placeholder="'+enNum(q.min)+'" oninput="smmQtySync(this.value)"><small class="smm-limits">الحد الأدنى: '+enNum(q.min)+' · الحد الأقصى: '+enNum(q.max)+'</small></div>';
    }
  }else{
    qtyHtml='<div class="smm-field" data-smm-key="quantity"><label>الكمية</label><input class="smm-input smm-qty" id="smmQty" type="text" inputmode="numeric" pattern="[0-9]*" value="1" placeholder="1" oninput="smmQtySync(this.value)"><small class="smm-limits">أدخل الكمية بالأرقام الإنجليزية فقط</small></div>';
  }

  const detail=fieldsHtml+qtyHtml+
      '<div class="smm-price-row"><span>ثمن الطلب</span><strong id="smmPriceValue">'+safe(money(q&&q.variable?priceOf(p)*q.min:(p?priceOf(p):0)))+'</strong></div>'+
      '<button class="smm-confirm" '+(p?'':'disabled')+' onclick="DigitalStore.smmBuy()">شراء</button>';

  return '<section class="smm-order-card"><div class="smm-field" data-smm-key="section"><label>القسم</label>'+sectionTrigger+sectionDrop+'</div>'+
    '<div class="smm-field" data-smm-key="service"><label>الخدمة</label>'+serviceTrigger+serviceDrop+'</div>'+detail+'</section>';
}
// Patch existing nodes in place. A delayed native reply must not detach the
// focused input (Android WebView closes the keyboard when that happens).
function smmNodeKey(n){
  if(n.nodeType!==1)return '#'+n.nodeType;
  return n.tagName+':'+(n.getAttribute('data-smm-key')||n.id||n.getAttribute('data-app')||n.classList[0]||'');
}
function smmPatch(current,next){
  if(current.nodeType!==1){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return;}
  const input=current.matches('input,textarea,select');
  const value=input?current.value:null;
  for(const attr of [...current.attributes])if(!next.hasAttribute(attr.name))current.removeAttribute(attr.name);
  for(const attr of [...next.attributes])if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
  let cursor=current.firstChild;
  for(const desired of [...next.childNodes]){
    const key=smmNodeKey(desired);
    let match=cursor;
    while(match&&smmNodeKey(match)!==key)match=match.nextSibling;
    if(!match){current.insertBefore(desired.cloneNode(true),cursor);continue;}
    if(match!==cursor)current.insertBefore(match,cursor);
    smmPatch(match,desired);cursor=match.nextSibling;
  }
  while(cursor){const nextNode=cursor.nextSibling;cursor.remove();cursor=nextNode;}
  if(input&&current.value!==value){
    if(current.tagName!=='SELECT'||[...current.options].some(o=>o.value===value))current.value=value;
  }
}
let smmRenderedProduct=null;
function smmCommit(root){
  const host=el('app'),current=host.firstElementChild;
  const template=document.createElement('template');template.innerHTML=root;
  const next=template.content.firstElementChild;
  if(current?.classList.contains('smm-store'))smmPatch(current,next);
  else{host.replaceChildren(next);smmRenderedProduct=null;}
  const productId=smm.product?.id??null;
  if(productId!==smmRenderedProduct&&smm.product){
    const q=quantityMeta(smm.product),node=el('smmQty');
    if(node){const v=Number(node.value);if(!Number.isInteger(v)||v<q.min||v>q.max||(q.options.length&&!q.options.includes(v)))node.value=String(q.min);}
  }
  smmRenderedProduct=productId;smmUpdatePrice();smmFilterRows();
}
function smmScreen(){
  const root='<div class="digital-store smm-store smm-ref-shell">'+smmTopbar()+'<div class="digital-wrap smm-ref-wrap">'+
    '<div class="smm-page-head smm-ref-title"><div><h2>قسم الرشق 🚀</h2><small>خدمات السوشيال ميديا بأفضل جودة وأسعار</small></div></div>'+
    smmPlatformChips()+
    '<div class="smm-search smm-ref-search"><input id="smmSearch" value="'+safe(smm.search)+'" placeholder="بحث" oninput="DigitalStore.smmSearch(this.value)"><i>⌕</i></div>'+
    (smm.error?'<div class="digital-empty"><b>'+safe(smm.error)+'</b><button class="digital-secondary" onclick="DigitalStore.smmRetry()">إعادة المحاولة</button></div>':'')+
    '<div class="smm-catalog-stage">'+smmOrderForm()+loadingOverlay()+'</div>'+
    '</div>'+bottom()+drawerMarkup()+topupModal()+'</div>';
  smmCommit(root);
}
async function smmFetchCatalog(categoryId){
  const r=await call('digital_catalog',{category_id:Number(categoryId||0)});
  return r.ok?{ok:true,data:arrays(r.data)}:r;
}
function waUrl(){const n=String(wallet.support_whatsapp||'963942586044').replace(/\D/g,'');return'https://wa.me/'+n+'?text='+encodeURIComponent('مرحبًا، أحتاج مساعدة بخصوص المنتجات الرقمية في تطبيق الديون.')}
function drawerMarkup(){try{return window.drawer?.()||''}catch(_e){return''}}
function bottom(){
  let html='';
  try{html=typeof window.bottomNav==='function'?window.bottomNav():''}catch(_e){}
  if(html){
    return html.replace(/onclick="nav\('([^']+)'\)"/g,'onclick="DigitalStore.debtNav(\'$1\')"');
  }
  const items=[['home','⌂','الرئيسية'],['clients','👥','العملاء'],['products','▦','الباركود'],['calculator','⌗','الحاسبة'],['partners','🤝','الشركاء']];
  return '<div class="bottom-nav bottom-nav-v130">'+items.map(([v,i,t])=>'<button onclick="DigitalStore.debtNav(\''+v+'\')"><b>'+i+'</b><span>'+t+'</span></button>').join('')+'</div>';
}
function fab(){return '<a class="digital-wa-fab" href="'+safe(waUrl())+'" aria-label="التواصل عبر واتساب" title="واتساب"><img src="smm-brands/whatsapp.svg" alt="" draggable="false"></a>'}
function header(){
  return '<header class="digital-header">'+
    '<div class="digital-brand"><button class="digital-exit-btn" onclick="DigitalStore.exit()" aria-label="العودة للديون">‹</button><div class="digital-logo">U</div><div class="digital-brand-copy"><b>UCHIHA</b><small>المنتجات الرقمية</small></div></div>'+
    '<div class="digital-head-actions">'+
      '<button class="digital-head-btn digital-balance-btn" onclick="DigitalStore.balance()"><strong>'+safe(money(wallet.balance))+'</strong><span>إضافة رصيد</span></button>'+
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
  return '<section class="digital-hero"><img class="digital-hero-real" src="digital-hero-v158.webp" alt=""><div class="digital-hero-shade"></div><div class="digital-hero-copy"><b><em>DIGITAL</em><br>WORLD<br>WITH <em>UCHIHA</em></b><span>كل ما تحتاجه في مكان واحد</span></div></section>';
}
function topupModal(){
  if(!topupOpen)return'';
  const account=wallet.shamcash_account||'';
  let qr='';try{qr=account&&Android?.qrDataUrl?Android.qrDataUrl(account):''}catch(_e){}
  return '<div class="digital-modal-backdrop" onclick="DigitalStore.closeTopup(event)"><section class="digital-topup-modal" onclick="event.stopPropagation()">'+
    '<div class="digital-modal-head"><div><small>إضافة رصيد</small><h2>شام كاش</h2></div><button onclick="DigitalStore.closeTopup()">×</button></div>'+
    '<div class="digital-pay-note">تحويل إلى حساب شام كاش</div>'+
    (account?(qr?'<img class="digital-qr" src="'+safe(qr)+'" alt="QR">':'')+'<div class="digital-account">'+safe(account)+'</div>':'<div class="digital-empty">لم تضبط الإدارة حساب شام كاش بعد.</div>')+
    '<div class="digital-field"><label>المبلغ الذي حولته</label><input id="digitalTopupAmount" class="digital-input" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="مثال: 25"></div>'+
    '<button class="digital-secondary" onclick="DigitalStore.pickProof()">إرفاق صورة إثبات التحويل</button>'+
    (proofData?'<div class="digital-proof-wrap"><img class="digital-proof-preview" src="'+safe(proofData)+'" alt="إثبات التحويل"><small>'+safe(proofName||'تم اختيار الصورة')+'</small></div>':'')+
    '<button class="digital-primary" '+(!account?'disabled':'')+' onclick="DigitalStore.submitTopup()">إرسال طلب الشحن</button>'+
    '</section></div>';
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
    return '<div class="digital-grid">'+products.map(p=>'<button class="digital-card" data-product-id="'+Number(p.id||0)+'" onclick="DigitalStore.product('+Number(p.id||0)+')"><div class="digital-card-media">'+imgMarkup(p)+'</div><div class="digital-card-name">'+safe(nameOf(p))+'</div><div class="digital-card-price">'+safe(money(priceOf(p)))+'</div></button>').join('')+'</div>';
  }
  return '<div class="digital-grid"><div class="digital-empty">لا توجد عناصر في هذا القسم حاليًا.</div></div>';
}
function loadingOverlay(){
  return loading?'<div class="digital-load-overlay" role="status" aria-live="polite" aria-label="جاري التحميل"><div class="digital-provider-loader"><span aria-hidden="true"></span><img src="loading-wallet-v170.png" alt="" draggable="false"></div></div>':'';
}
function storeScreen(){
  const root='<div class="digital-store"><div class="digital-wrap">'+header()+statusStrip()+hero()+searchBox()+
    '<div class="digital-catalog-stage">'+grid()+loadingOverlay()+'</div>'+
    '</div>'+fab()+bottom()+drawerMarkup()+topupModal()+productDialog()+'</div>';
  el('app').innerHTML=root;
}
function updateWalletDom(){
  const balance=el('app')?.querySelector('.digital-balance-btn strong');if(balance)balance.textContent=money(wallet.balance);
  const support=el('app')?.querySelector('.digital-wa-fab');if(support)support.href=waUrl();
  const wrap=el('app')?.querySelector('.digital-store:not(.smm-store) .digital-wrap'),current=wrap?.querySelector('.digital-status-strip'),markup=statusStrip();
  if(current&&!markup)current.remove();
  else if(markup){const template=document.createElement('template');template.innerHTML=markup;const next=template.content.firstElementChild;if(current)current.replaceWith(next);else wrap?.querySelector('.digital-header')?.after(next);}
}
async function loadWallet(){
  const r=await call('digital_wallet');
  if(r.ok){wallet={...wallet,...r};wallet.orders=Array.isArray(r.orders)?r.orders:[];if(mode==='store')updateWalletDom();else if(mode)render();}
  return r;
}
async function loadCatalog(categoryId=0,commit=null){
  if(loading)return false;
  productRequestSeq++;productPending=false;selectedProduct=null;selectedSchema=null;closeProductDialog();
  loading=true;lastCatalogError='';catalog={categories:[],products:[]};storeScreen();
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
function decodeProductBase64(value){
  try{const bytes=Uint8Array.from(atob(String(value||'').replace(/\s+/g,'')),c=>c.charCodeAt(0));return new TextDecoder().decode(bytes)}catch(_e){return''}
}
function structuredProductValue(value){
  if(Array.isArray(value)||(value&&typeof value==='object'))return value;
  if(typeof value!=='string')return value;
  const raw=value.trim();if(!raw)return[];
  for(const candidate of [raw,decodeProductBase64(raw)]){
    const text=String(candidate||'').trim();if(!text||(!text.startsWith('[')&&!text.startsWith('{')))continue;
    try{return JSON.parse(text)}catch(_e){}
  }
  return raw;
}
function fieldSlug(value){return String(value??'').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'_').replace(/^_+|_+$/g,'').slice(0,70)||'field'}
function normalizedOptions(value){
  const parsed=structuredProductValue(value);let rows=[];
  if(Array.isArray(parsed))rows=parsed;
  else if(parsed&&typeof parsed==='object')rows=Object.entries(parsed).map(([key,label])=>({value:key,label}));
  else if(typeof parsed==='string')rows=parsed.split(',').map(x=>x.trim()).filter(Boolean);
  const options=rows.map(row=>{
    if(row&&typeof row==='object')return{value:String(row.value??row.id??row.code??row.key??row.name??'').slice(0,300),label:String(row.label??row.title??row.name??row.value??row.id??'').slice(0,180)};
    return{value:String(row),label:String(row)};
  }).filter(x=>x.value);
  return [...new Map(options.map(x=>[x.value,x])).values()];
}
function numericOptions(value){
  const parsed=structuredProductValue(value);let rows=[];
  if(Array.isArray(parsed))rows=parsed;
  else if(parsed&&typeof parsed==='object')rows=Array.isArray(parsed.values)?parsed.values:Array.isArray(parsed.options)?parsed.options:Object.keys(parsed).filter(key=>/^\d+$/.test(key));
  else if(typeof parsed==='string')rows=parsed.split(',');
  return [...new Set(rows.map(x=>Number(x?.value??x?.qty??x)).filter(n=>Number.isInteger(n)&&n>0&&n<=1000000))].sort((a,b)=>a-b);
}
function truthyProduct(value){return value===true||value===1||['1','true','yes','on','enabled'].includes(String(value??'').trim().toLowerCase())}
function quantityMeta(p){
  if(p===selectedProduct&&selectedSchema?.quantity){
    const q=selectedSchema.quantity;
    return{variable:!!q.variable,kind:String(q.kind||'fixed'),min:Number(q.min||1),max:Number(q.max||q.min||1),step:Number(q.step||1),options:numericOptions(q.options||[])};
  }
  const raw=structuredProductValue(p?.qty_values??p?.quantity_values??p?.quantities??p?.quantity_options??{});
  let min=1,max=1,step=1,options=[];
  if(Array.isArray(raw)||typeof raw==='string')options=numericOptions(raw);
  else if(raw&&typeof raw==='object'){
    min=Number(raw.min??raw.minimum??raw.min_qty??p?.min??p?.minimum??p?.min_qty??1)||1;
    max=Number(raw.max??raw.maximum??raw.max_qty??p?.max??p?.maximum??p?.max_qty??min)||min;
    step=Number(raw.step??raw.increment??1)||1;options=numericOptions(raw);
  }
  if(!raw||typeof raw!=='object'||Array.isArray(raw)){min=Number(p?.min??p?.minimum??p?.min_qty??min)||min;max=Number(p?.max??p?.maximum??p?.max_qty??max)||max;step=Number(p?.step??p?.increment??step)||step}
  if(options.length){min=options[0];max=options[options.length-1]}
  const type=String(p?.product_type??p?.type??'').trim().toLowerCase(),allow=truthyProduct(p?.allow_quantity??p?.allowQuantity??p?.allowquantity??p?.quantity_enabled);
  let kind='fixed';if(type==='amount')kind='amount';else if(type==='specificpackage'&&options.length)kind='packages';else if(allow)kind='quantity';else if(options.length>1)kind='packages';else if(max>min)kind='amount';
  min=Math.max(1,Math.trunc(min));max=Math.max(min,Math.min(1000000,Math.trunc(max)));step=Math.max(1,Math.trunc(step));if(kind==='quantity'&&max===min)max=1000000;
  return{variable:kind!=='fixed',kind,min,max,step,options};
}
function normalizeFields(p){
  if(p===selectedProduct&&Array.isArray(selectedSchema?.fields))return selectedSchema.fields.map(x=>({...x,options:normalizedOptions(x.options||[])}));
  const sourceKeys=['input_schema','custom_fields','params','fields','requirements','inputs','parameters'];let source='',params=[];
  for(const key of sourceKeys){if(p?.[key]!==undefined&&p?.[key]!==null&&String(p[key]).trim()!==''){source=key;params=structuredProductValue(p[key]);break}}
  if(params&&typeof params==='object'&&!Array.isArray(params)&&params.properties&&typeof params.properties==='object'){
    const required=new Set(Array.isArray(params.required)?params.required.map(String):[]);
    params=Object.entries(params.properties).map(([key,value])=>value&&typeof value==='object'?{...value,name:key,required:value.required??required.has(key)}:{name:key,label:key,required:required.has(key)});
  }else if(params&&typeof params==='object'&&!Array.isArray(params)){
    const nested=params.fields??params.params??params.inputs??params.requirements;
    if(nested!==undefined)params=structuredProductValue(nested);else params=Object.entries(params).map(([key,value])=>value&&typeof value==='object'?{...value,name:value.name??key}:{name:key,label:String(value??key)});
  }
  if(typeof params==='string')params=params.split(',').map(x=>x.trim()).filter(Boolean);if(!Array.isArray(params))params=params?[params]:[];
  const exactSources=new Set(['params','requirements','inputs','parameters']);
  const fields=params.map(item=>{
    const obj=item&&typeof item==='object'?item:null,text=obj?'':String(item??'').trim();
    const label=String(obj?.label??obj?.title??obj?.display_name??obj?.placeholder??obj?.description??obj?.name??obj?.key??text).trim();if(!label||/^\s*(qty|quantity|الكمية)\s*$/iu.test(label))return null;
    let key=String(obj?.name??obj?.key??obj?.param??obj?.field??obj?.code??obj?.id??'').trim();if(!key&&text&&exactSources.has(source)&&/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(text))key=text;if(!key)key='custom_'+fieldSlug(label);
    const options=normalizedOptions(obj?.options??obj?.values??obj?.choices??[]),declared=String(obj?.type??obj?.input_type??'text').toLowerCase();
    const type=options.length||declared==='select'?'select':['number','numeric','tel','email','password','textarea'].includes(declared)?declared:'text';
    const required=obj?.required===undefined?true:![false,0,'0','false','optional','no'].includes(obj.required);
    return{key:key.slice(0,120),label:label.slice(0,180),placeholder:String(obj?.placeholder??label).slice(0,180),required,options,type,min_length:Math.max(0,Number(obj?.min_length??obj?.minLength??0)||0),max_length:Math.min(500,Number(obj?.max_length??obj?.maxLength??500)||500)};
  }).filter(Boolean).filter(f=>!['qty','quantity','orderuuid','productid'].includes(f.key.replace(/[^a-z0-9]/gi,'').toLowerCase()));
  return [...new Map(fields.map(x=>[x.key,x])).values()];
}
function plainProductText(value){return String(value??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()}
function isDeliveryStatusText(text){return /(?:تلقائي|أوتوماتيك|فوري|يدوي|حسب\s+حالة\s+المزود|automatic|instant|manual|24\s*(?:ساعة|hour))/iu.test(String(text||''))}
function productSubtitle(p){for(const key of ['package_name','quantity_label','short_description','description','desc']){const text=plainProductText(p?.[key]);if(text&&!isDeliveryStatusText(text))return text.slice(0,90)}return''}
function deliveryNote(p){
  const operational=['short_description','description','desc','delivery_type','delivery'].map(key=>plainProductText(p?.[key])).filter(Boolean).join(' ');
  if(selectedSchema?.automatic===true||/(?:تلقائي|أوتوماتيك|فوري|automatic|instant|24\s*(?:ساعة|hour))/iu.test(operational))return 'هذا المنتج يعمل بشكل تلقائي 24 ساعة';
  if(selectedSchema?.automatic===false||/(?:يدوي|manual)/iu.test(operational))return 'يتم تنفيذ هذا المنتج يدويًا حسب حالة المزود';
  return 'يتم تنفيذ الطلب حسب حالة المزود';
}
function orderQuantityValid(q,value){return Number.isInteger(value)&&value>=q.min&&value<=q.max&&(!q.options.length||q.options.includes(value))&&(q.options.length||(value-q.min)%q.step===0)}
function orderQuantity(){const q=quantityMeta(selectedProduct||{});if(!q.variable)return 1;const value=Number(latinDigits(orderDraft.quantity));return orderQuantityValid(q,value)?value:q.min}
function orderTotal(){const unit=priceOf(selectedProduct||{}),q=quantityMeta(selectedProduct||{});return q.variable?unit*orderQuantity():unit}
function quantityControl(q){
  if(!q.variable)return'';
  const value=orderQuantity();
  if(q.options.length)return '<div class="digital-order-control"><select id="digitalQty" aria-label="الكمية" onchange="DigitalStore.quantityChanged(this.value)">'+q.options.map(v=>'<option value="'+v+'" '+(v===value?'selected':'')+'>'+v+'</option>').join('')+'</select></div>';
  return '<div class="digital-order-control"><input id="digitalQty" type="text" inputmode="numeric" autocomplete="off" aria-label="الكمية" placeholder="الكمية" value="'+safe(String(orderDraft.quantity||q.min))+'" oninput="DigitalStore.quantityChanged(this.value)"><small>الحد الأدنى '+q.min+' · الحد الأقصى '+q.max+'</small></div>';
}
function orderFieldMarkup(field,index){
  const value=String(orderDraft.fields[field.key]??'');
  if(field.options?.length)return '<div class="digital-order-control"><select id="orderField'+index+'" aria-label="'+safe(field.label)+'" onchange="DigitalStore.orderFieldChanged('+index+')"><option value="">'+safe('اختر '+field.label)+'</option>'+field.options.map(option=>'<option value="'+safe(option.value)+'" '+(option.value===value?'selected':'')+'>'+safe(option.label)+'</option>').join('')+'</select></div>';
  if(field.type==='textarea')return '<div class="digital-order-control"><textarea id="orderField'+index+'" aria-label="'+safe(field.label)+'" placeholder="'+safe(field.placeholder||field.label)+'" maxlength="'+Number(field.max_length||500)+'" oninput="DigitalStore.orderFieldChanged('+index+')">'+safe(value)+'</textarea></div>';
  const htmlType=['email','password'].includes(field.type)?field.type:'text',inputMode=['number','numeric'].includes(field.type)?'numeric':field.type==='tel'?'tel':'text';
  return '<div class="digital-order-control"><input id="orderField'+index+'" type="'+htmlType+'" inputmode="'+inputMode+'" autocomplete="off" aria-label="'+safe(field.label)+'" placeholder="'+safe(field.placeholder||field.label)+'" maxlength="'+Number(field.max_length||500)+'" value="'+safe(value)+'" oninput="DigitalStore.orderFieldChanged('+index+')"></div>';
}
function verificationMarkup(){
  const verification=selectedSchema?.verification;if(!verification?.enabled)return'';
  return '<div class="digital-player-verify"><button id="digitalVerifyButton" type="button" onclick="DigitalStore.verifyPlayer()"><span id="digitalVerifiedName">'+safe(orderDraft.playerName||'التحقق من الاسم')+'</span><b aria-hidden="true">↻</b></button><small id="digitalVerifyStatus" aria-live="polite"></small></div>';
}
function orderHeadline(p,q){const subtitle=productSubtitle(p);if(subtitle)return subtitle;if(q.variable)return 'الكمية '+orderQuantity();return nameOf(p)}
function productDialog(){
  if(!selectedProduct)return'';
  const p=selectedProduct,fields=normalizeFields(p),q=quantityMeta(p),src=imageOf(p),note=deliveryNote(p);
  return '<div class="digital-order-backdrop" role="presentation" onclick="DigitalStore.closeProduct(event)"><section class="digital-order-modal" role="dialog" aria-modal="true" aria-labelledby="digitalOrderTitle" onclick="event.stopPropagation()">'+
    '<div class="digital-order-summary"><span class="digital-order-cost" id="digitalOrderPrice">'+safe(money(orderTotal()))+'</span><strong id="digitalOrderHeadline"><i aria-hidden="true">◆</i>'+safe(orderHeadline(p,q))+'</strong></div>'+
    '<div class="digital-order-product">'+(src?'<img src="'+safe(src)+'" alt="">':'<div class="digital-order-fallback">U</div>')+'<div><h2 id="digitalOrderTitle">'+safe(nameOf(p))+'</h2>'+(productSubtitle(p)?'<p>'+safe(productSubtitle(p))+'</p>':'')+'</div></div>'+
    '<div class="digital-order-fields">'+quantityControl(q)+fields.map(orderFieldMarkup).join('')+verificationMarkup()+'<div id="digitalOrderError" class="digital-order-error" role="alert"></div></div>'+
    '<div class="digital-order-actions"><button id="digitalBuyButton" class="digital-order-buy" onclick="DigitalStore.buy()">شراء</button><button class="digital-order-cancel" onclick="DigitalStore.closeProduct()">إلغاء</button></div>'+
    '<p class="digital-order-note"><i></i>'+safe(note)+'</p></section></div>';
}
function productScreen(){
  const store=document.querySelector('.digital-store');if(!store){storeScreen();return;}
  store.querySelector('.digital-order-backdrop')?.remove();
  const template=document.createElement('template');template.innerHTML=productDialog();
  const dialog=template.content.firstElementChild;if(dialog)store.append(dialog);
}
function closeProductDialog(){document.querySelector('.digital-order-backdrop')?.remove()}
function balanceScreen(){topupOpen=true;mode='store';storeScreen()}
function shamcashScreen(){topupOpen=true;mode='store';storeScreen()}
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

window.onDigitalProofPicked=function(data,name){proofData=String(data||'');proofName=String(name||'إثبات التحويل');topupOpen=true;if(mode!=='smm')mode='store';render()};
window.onDigitalProofCancelled=function(){};

window.DigitalStore={
  async open(){
    if(!licensed()){notify('فعّل التطبيق أولًا',true);return;}
    productRequestSeq++;productPending=false;mode='store';path=[];query='';catalog={categories:[],products:[]};lastCatalogError='';drawerOpen=false;loading=false;selectedProduct=null;selectedSchema=null;orderDraft={quantity:1,fields:{},verifiedValue:'',playerName:''};
    try{storeScreen();}catch(_e){notify('تعذر فتح واجهة المنتجات الرقمية',true);return;}
    const walletTask=loadWallet().catch(()=>null);
    try{await loadCatalog(0);}catch(_e){loading=false;lastCatalogError=errorText('SERVICE_UNAVAILABLE');storeScreen();}
    await walletTask;
  },
  retry(){loadCatalog(Number(path[path.length-1]?.id||0))},
  root(){if(mode!=='store')mode='store';const next=[];query='';lastCatalogError='';loadCatalog(0,()=>{path=next})},
  async category(id){
    const row=(catalog.categories||[]).find(x=>Number(x.id)===Number(id));if(!row||loading)return;
    if(isSmmCategory(row)){await this.openSmm(row);return;}
    const next=[...path,row];query='';lastCatalogError='';
    await loadCatalog(id,()=>{path=next});
  },
  async openSmm(row){
    smm={root:row,returnPath:[...path],rootCategories:[],rootProducts:[],platforms:[],platform:null,sectionTrail:[],sections:[],sectionOptions:[],selectedSection:null,products:[],product:null,search:'',expanded:false,error:'',drop:'',dropSearch:''};
    mode='smm';loading=true;smmScreen();
    const requestState=smm;
    const r=await smmFetchCatalog(row.id);if(mode!=='smm'||smm!==requestState)return;loading=false;
    if(!r.ok){smm.error=errorText(r.error);smmScreen();return;}
    smm.rootCategories=r.data.categories||[];smm.rootProducts=r.data.products||[];smm.platforms=smmBuildApps(smm.rootCategories,smm.rootProducts);smm.platform={key:'all',name:'الكل'};smm.sections=[...smm.rootCategories];smm.sectionOptions=[...smm.sections];smm.products=[...smm.rootProducts];smmScreen();
  },
  smmMore(){smm.expanded=!smm.expanded;smmScreen()},
  async smmPlatform(key){
    if(loading)return;
    smm.product=null;smm.unitPrice=0;smm.selectedSection=null;smm.sectionTrail=[];smm.search='';smm.error='';smm.drop='';smm.dropSearch='';
    if(String(key)==='all'){
      smm.platform={key:'all',name:'الكل'};
      smm.sections=[...(smm.rootCategories||[])];smm.sectionOptions=[...smm.sections];smm.products=[...(smm.rootProducts||[])];smmScreen();return;
    }
    const app=(smm.platforms||[]).find(x=>x.key===String(key));if(!app)return;
    smm.platform=app;
    smm.sections=smmRowsForApp(smm.rootCategories,app.key);
    smm.sectionOptions=[...smm.sections];
    smm.products=smmRowsForApp(smm.rootProducts,app.key);
    smm.drop=smm.sections.length?'section':'';smm.dropSearch='';
    smmScreen();
  },
  async smmSection(id){
    if(!id||loading)return;
    const source=smm.sectionOptions?.length?smm.sectionOptions:smm.sections;
    const row=(source||[]).find(x=>Number(x.id)===Number(id));if(!row)return;
    smm.selectedSection=row;smm.drop='';smm.dropSearch='';smm.product=null;smm.unitPrice=0;
    loading=true;smmScreen();
    const requestState=smm;
    const r=await smmFetchCatalog(row.id);if(mode!=='smm'||smm!==requestState)return;loading=false;
    if(!r.ok){smm.error=errorText(r.error);smmScreen();return;}
    smm.sectionTrail=[row];
    smm.sections=(r.data.categories||[]).filter(x=>smm.platform?.key==='all'||!smmDetectApp(x)||smmDetectApp(x).key===smm.platform?.key);
    if(smm.sections.length)smm.sectionOptions=[...smm.sections];
    smm.products=(r.data.products||[]).filter(x=>smm.platform?.key==='all'||!smmDetectApp(x)||smmDetectApp(x).key===smm.platform?.key);
    smm.search='';smmScreen();
  },
  async smmService(id){
    if(!id||loading||!smm.products.some(x=>Number(x.id)===Number(id)))return;
    smm.drop='';smm.dropSearch='';smmScreen();
    const requestState=smm;
    const listed=smm.products.find(x=>Number(x.id)===Number(id))||{};
    const r=await call('digital_product',{product_id:Number(id)});if(mode!=='smm'||smm!==requestState)return;
    if(!r.ok){smm.error=errorText(r.error);smmScreen();return;}
    const resolvedPrice=priceOf(r.product)||priceOf(listed);
    smm.product={...listed,...(r.product||{})};if(resolvedPrice>0)smm.product.price=resolvedPrice;
    smm.unitPrice=resolvedPrice;smm.error='';smmScreen();
  },
  smmSearch(v){smm.search=String(v||'');smmFilterRows();},
  smmNew(){smm.product=null;smm.unitPrice=0;smm.selectedSection=null;smm.search='';smm.sectionTrail=[];smm.drop='';smm.dropSearch='';if(smm.platform)this.smmPlatform(smm.platform.key);else{smm.sections=[];smm.products=[];smmScreen()}},
  smmRetry(){if(smm.selectedSection)this.smmSection(smm.selectedSection.id);else if(smm.root)this.openSmm(smm.root)},
  smmExit(){
    const targetPath=[...smm.returnPath],target=Number(targetPath[targetPath.length-1]?.id||0);
    mode='store';path=targetPath;query='';smm.product=null;smm.unitPrice=0;loading=false;
    loadCatalog(target);
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
  search(v){
    query=String(v||'');const needle=query.trim().toLowerCase();
    document.querySelectorAll('.digital-catalog-stage .digital-card').forEach(card=>{const name=card.querySelector('.digital-card-name')?.textContent?.toLowerCase()||'';card.hidden=!!needle&&!name.includes(needle)});
  },
  async product(id){
    if(loading)return;
    const request=++productRequestSeq,expectedCatalog=catalog;productPending=true;
    const r=await call('digital_product',{product_id:id});
    if(request!==productRequestSeq||mode!=='store'||catalog!==expectedCatalog)return;productPending=false;
    if(!r.ok){notify(errorText(r.error),true);return;}
    selectedProduct=r.product;selectedSchema=r.order_schema||null;mode='store';
    const q=quantityMeta(selectedProduct);orderDraft={quantity:q.variable?q.min:1,fields:{},verifiedValue:'',playerName:''};
    productScreen();setTimeout(()=>document.querySelector('.digital-order-fields input,.digital-order-fields select')?.focus(),40);
  },
  closeProduct(event){if(event&&event.target!==event.currentTarget)return;productRequestSeq++;productPending=false;selectedProduct=null;selectedSchema=null;orderDraft={quantity:1,fields:{},verifiedValue:'',playerName:''};mode='store';closeProductDialog()},
  quantityChanged(value){
    if(!selectedProduct)return;const q=quantityMeta(selectedProduct),node=el('digitalQty');
    let clean=latinDigits(value).replace(/[^0-9]/g,'');if(q.options.length)clean=String(value||'');
    if(node&&!q.options.length&&node.value!==clean)node.value=clean;orderDraft.quantity=clean;
    const n=Number(clean),valid=orderQuantityValid(q,n),price=el('digitalOrderPrice'),error=el('digitalOrderError'),buy=el('digitalBuyButton'),headline=el('digitalOrderHeadline');
    if(price)price.textContent=valid?money(priceOf(selectedProduct)*n):'—';if(error)error.textContent=valid?'':'الكمية خارج الحدود المسموحة';if(buy)buy.disabled=!valid||busy;
    if(headline)headline.textContent='◆ '+(valid?orderHeadline(selectedProduct,q):'أدخل كمية صحيحة');
  },
  orderFieldChanged(index){
    if(!selectedProduct)return;const fields=normalizeFields(selectedProduct),field=fields[Number(index)],node=el('orderField'+Number(index));if(!field||!node)return;
    let value=String(node.value||'');if(['number','numeric'].includes(field.type)){value=latinDigits(value).replace(/[^0-9]/g,'');if(node.value!==value)node.value=value}orderDraft.fields[field.key]=value;
    if(selectedSchema?.verification?.field_key===field.key&&value!==orderDraft.verifiedValue){orderDraft.verifiedValue='';orderDraft.playerName='';const name=el('digitalVerifiedName'),status=el('digitalVerifyStatus');if(name)name.textContent='التحقق من الاسم';if(status){status.textContent='';status.className=''}}
  },
  async verifyPlayer(){
    if(busy||!selectedProduct||!selectedSchema?.verification?.enabled)return;
    const fields=normalizeFields(selectedProduct),key=selectedSchema.verification.field_key,index=fields.findIndex(field=>field.key===key),node=el('orderField'+index),button=el('digitalVerifyButton'),status=el('digitalVerifyStatus'),name=el('digitalVerifiedName');
    const userId=latinDigits(String(node?.value||'')).replace(/\s+/g,'');if(!/^[A-Za-z0-9_.-]{3,40}$/.test(userId)){if(status){status.textContent='اكتب رقم اللاعب الصحيح أولًا';status.className='bad'}node?.focus();return}
    if(node&&node.value!==userId)node.value=userId;orderDraft.fields[key]=userId;if(button){button.disabled=true;button.classList.add('loading')}if(status){status.textContent='جاري التحقق...';status.className=''}
    const productId=Number(selectedProduct.id),r=await call('digital_verify_player',{product_id:productId,field_key:key,user_id:userId});
    if(!selectedProduct||Number(selectedProduct.id)!==productId)return;if(button){button.disabled=false;button.classList.remove('loading')}
    if(!r.ok){orderDraft.verifiedValue='';orderDraft.playerName='';if(name)name.textContent='التحقق من الاسم';if(status){status.textContent=errorText(r.error);status.className='bad'}return}
    if(!r.valid){orderDraft.verifiedValue='';orderDraft.playerName='';if(name)name.textContent='التحقق من الاسم';if(status){status.textContent='لم يتم العثور على اسم مطابق';status.className='bad'}return}
    orderDraft.verifiedValue=userId;orderDraft.playerName=String(r.player_name||'تم العثور على اللاعب');if(name)name.textContent=orderDraft.playerName;if(status){status.textContent='تم التحقق بنجاح';status.className='ok'}
  },
  async buy(){
    if(busy||!selectedProduct)return;const fields={},defs=normalizeFields(selectedProduct),error=el('digitalOrderError');
    for(let i=0;i<defs.length;i++){
      const def=defs[i],node=el('orderField'+i);let value=String(node?.value??orderDraft.fields[def.key]??'').trim();if(['number','numeric'].includes(def.type))value=latinDigits(value).replace(/[^0-9]/g,'');
      if(def.required&&!value){if(error)error.textContent='أكمل '+def.label;node?.focus();return}
      if(value&&(value.length<Number(def.min_length||0)||value.length>Number(def.max_length||500)||((def.options||[]).length&&!def.options.some(option=>option.value===value)))){if(error)error.textContent='تحقق من '+def.label;node?.focus();return}
      if(value)fields[def.key]=value;
    }
    const qm=quantityMeta(selectedProduct);let quantity=1;if(qm.variable){quantity=Number(latinDigits(el('digitalQty')?.value??orderDraft.quantity));if(!orderQuantityValid(qm,quantity)){if(error)error.textContent='الكمية خارج الحدود المسموحة';el('digitalQty')?.focus();return}}
    const button=el('digitalBuyButton');busy=true;if(error)error.textContent='';if(button){button.disabled=true;button.textContent='جاري الشراء...'}
    const productId=Number(selectedProduct.id),r=await call('digital_purchase',{product_id:productId,fields,quantity});busy=false;
    if(!selectedProduct||Number(selectedProduct.id)!==productId)return;
    if(!r.ok){if(error)error.textContent=errorText(r.error);if(button){button.disabled=false;button.textContent='شراء'}return}
    wallet.balance=Number(r.balance??wallet.balance);notify(r.outcome==='failed'?'تم رفض الطلب وإعادة الرصيد':'تم إرسال الطلب بنجاح');selectedProduct=null;selectedSchema=null;orderDraft={quantity:1,fields:{},verifiedValue:'',playerName:''};mode='store';await loadWallet().catch(()=>null);storeScreen();
  },
  async smmBuy(){
    const p=smm.product;if(!p||busy)return;
    const fields={},defs=smmLinkFields(p);
    for(let i=0;i<defs.length;i++){
      const n=el('smmF'+i),v=String(n?.value||'').trim();
      if(defs[i].required&&!v){notify('أكمل '+defs[i].label,true);n?.focus();return;}
      if(v)fields[defs[i].key]=v;
    }
    const qm=quantityMeta(p);let quantity=1;
    if(qm.variable){
      quantity=Number(el('smmQty')?.value||qm.min);
      if(!Number.isInteger(quantity)||quantity<qm.min||quantity>qm.max||((quantity-qm.min)%qm.step!==0)||(qm.options.length&&!qm.options.includes(quantity))){notify('الكمية خارج الحدود المسموحة',true);return;}
    }
    busy=true;notify('جاري إرسال الطلب...');
    const r=await call('digital_purchase',{product_id:Number(p.id),fields,quantity});
    busy=false;
    if(!r.ok){notify(errorText(r.error),true);return;}
    wallet.balance=Number(r.balance??wallet.balance);
    notify(r.outcome==='failed'?'تم رفض الطلب وإعادة الرصيد':'تم إرسال الطلب بنجاح');
    smm.product=null;smm.unitPrice=0;await loadWallet().catch(()=>null);smmScreen();
  },
  async balance(){
    productRequestSeq++;productPending=false;closeProductDialog();
    if(mode!=='store'&&mode!=='smm'){mode='store';selectedProduct=null}
    topupOpen=true;proofData='';proofName='';render();
    const r=await loadWallet().catch(()=>null);if(r&&topupOpen)render();
  },
  shamcash(){this.balance()},
  closeTopup(){topupOpen=false;proofData='';proofName='';render()},
  closeSub(){topupOpen=false;if(mode!=='smm')mode='store';render()},
  debtNav(v){productRequestSeq++;productPending=false;topupOpen=false;proofData='';proofName='';selectedProduct=null;selectedSchema=null;orderDraft={quantity:1,fields:{},verifiedValue:'',playerName:''};path=[];query='';mode='';try{nav(v)}catch(_e){render()}},
  pickProof(){try{if(Android?.pickDigitalProof)Android.pickDigitalProof();else notify('اختيار الصورة متاح داخل APK',true)}catch(_e){notify('تعذر فتح الصور',true)}},
  async submitTopup(){const amount=Number(el('digitalTopupAmount')?.value||0);if(!(amount>0)){notify('اكتب المبلغ الذي حولته',true);return;}if(!proofData){notify('أرفق صورة إثبات التحويل',true);return;}if(busy)return;busy=true;const keepMode=mode;const r=await call('digital_topup_create',{amount,proof_data:proofData});busy=false;if(!r.ok){notify(errorText(r.error),true);return;}proofData='';proofName='';topupOpen=false;notify('تم إرسال طلب الشحن للإدارة');await loadWallet();mode=keepMode==='smm'?'smm':'store';render()},
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
  exit(){productRequestSeq++;productPending=false;topupOpen=false;proofData='';proofName='';selectedProduct=null;selectedSchema=null;orderDraft={quantity:1,fields:{},verifiedValue:'',playerName:''};path=[];query='';smm.product=null;smm.unitPrice=0;smm.platform=null;smm.drop='';smm.dropSearch='';mode='';render()}
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
  if(mode==='smm'){smmScreen();return}
  if(mode==='product'){productScreen();return}
  if(mode==='admin'){renderAdmin();return}
  return oldRender?.();
};
window.appBack=function(){
  if(topupOpen){topupOpen=false;proofData='';proofName='';render();return true}
  if(productPending){productRequestSeq++;productPending=false;return true}
  if(selectedProduct){DigitalStore.closeProduct();return true}
  if(mode==='smm'){DigitalStore.smmExit();return true}
  if(mode==='product'){DigitalStore.closeProduct();return true}
  if(mode==='admin'){DigitalStore.exitAdmin();return true}
  if(mode==='store'){if(path.length){DigitalStore.up();return true}DigitalStore.exit();return true}
  return oldBack?.()||false;
};
window.UCHIHA_DIGITAL_STORE_VERSION=VERSION;
})();
