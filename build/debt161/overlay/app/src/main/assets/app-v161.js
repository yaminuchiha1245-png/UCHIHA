/* UCHIHA Debt Store v1.5.11 — SMM reference visual match. */
(function(){'use strict';
const VERSION='1.5.11';
const oldRender=window.render, oldDrawer=window.drawer, oldBack=window.appBack;
const priorResult=window.onDebtServiceResult;
const pending=new Map();
let seq=0,mode='',path=[],catalog={categories:[],products:[]},query='',selectedProduct=null,loading=false,lastCatalogError='';
let wallet={balance:0,orders:[],shamcash_account:'',support_whatsapp:'963942586044'};
let proofData='',proofName='',adminTab='config',adminData={},busy=false,topupOpen=false;
let smm={root:null,returnPath:[],rootCategories:[],rootProducts:[],platforms:[],platform:null,sectionTrail:[],sections:[],sectionOptions:[],selectedSection:null,products:[],product:null,search:'',expanded:false,error:'',drop:'',dropSearch:''};

const el=id=>document.getElementById(id);
const safe=v=>window.esc?esc(v):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>{const n=Number(v||0);return '$ '+(Number.isFinite(n)?n.toFixed(n<1?3:2):'0.00')};
const latinDigits=v=>String(v??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const enNum=v=>latinDigits(String(v??''));
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
function imgMarkup(item){
  const src=imageOf(item),art=artFallback(item);
  const remote=src?'<div class="digital-card-photo" style="background-image:url(&quot;'+safe(src)+'&quot;)"></div>':'';
  return '<div class="digital-card-fallback">'+art+'</div>'+remote;
}

function isSmmCategory(item){
  const n=nameOf(item).toLowerCase();
  return n.includes('الرشق')||n.includes('رشق')||n.includes('smm')||n.includes('social media');
}
const SMM_APPS=[
  {key:'instagram',name:'Instagram',sx:2,sy:1,rx:/instagram|insta|انستغرام|انستقرام|انستا/i},
  {key:'tiktok',name:'TikTok',sx:1,sy:1,rx:/tiktok|tik tok|تيك\s*توك|تيكتوك/i},
  {key:'youtube',name:'YouTube',sx:0,sy:1,rx:/youtube|youtu\.be|يوتيوب/i},
  {key:'facebook',name:'Facebook',sx:3,sy:0,rx:/facebook|fb\b|فيسبوك|فيس بوك/i},
  {key:'twitter',name:'X',sx:2,sy:0,rx:/twitter|تويتر|\bX\b/i},
  {key:'reddit',name:'Reddit',sx:1,sy:0,rx:/reddit|ريديت/i},
  {key:'telegram',name:'Telegram',sx:0,sy:0,rx:/telegram|تلغرام|تليغرام|تيليجرام|تليجرام/i},
  {key:'discord',name:'Discord',sx:0,sy:3,rx:/discord|ديسكورد/i},
  {key:'spotify',name:'Spotify',sx:3,sy:2,rx:/spotify|سبوتيفاي|سبوتفاي/i},
  {key:'snapchat',name:'Snapchat',sx:2,sy:2,rx:/snapchat|snap chat|سناب\s*شات|سناب/i},
  {key:'linkedin',name:'LinkedIn',sx:1,sy:2,rx:/linkedin|لينكد\s*ان|لينكدإن/i},
  {key:'twitch',name:'Twitch',sx:0,sy:2,rx:/twitch|تويتش/i},
  {key:'kick',name:'Kick',sx:3,sy:1,rx:/\bkick\b|كيك/i},
  {key:'whatsapp',name:'WhatsApp',sx:0,sy:0,rx:/whatsapp|واتساب|واتس اب|واتسآب/i},
  {key:'threads',name:'Threads',sx:2,sy:0,rx:/threads|ثريدز|ثريد/i},
  {key:'pinterest',name:'Pinterest',sx:1,sy:0,rx:/pinterest|بنترست|بينترست/i},
  {key:'soundcloud',name:'SoundCloud',sx:0,sy:1,rx:/soundcloud|ساوند\s*كلاود|ساوندكلاود/i}
];
function smmDetectApp(item){
  const n=nameOf(item);
  return SMM_APPS.find(a=>a.rx.test(n))||null;
}
function smmPlatformMeta(item){
  const key=String(item?.key||'');
  return SMM_APPS.find(a=>a.key===key)||{sx:0,sy:0,name:String(item?.name||'')};
}
function smmBuildApps(categories,products){
  const found=new Map();
  for(const row of [...(categories||[]),...(products||[])]){
    const app=smmDetectApp(row);
    if(app&&!found.has(app.key))found.set(app.key,{key:app.key,name:app.name});
  }
  return SMM_APPS.filter(a=>found.has(a.key)).map(a=>found.get(a.key));
}
function smmRowsForApp(rows,appKey){
  if(!appKey)return[];
  return (rows||[]).filter(x=>smmDetectApp(x)?.key===appKey);
}
function smmLogo(meta,cls=''){
  const m=meta||{};if(!m.key||m.key==='all')return '';
  const icons={
    telegram:'<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#229ED9"/><path d="M14 31.5 49 18c2-.8 3.8 1 3.1 3.3l-6 28c-.5 2.2-2.4 2.9-4.3 1.8l-9.2-6.8-4.5 4.4c-.5.5-.9.9-1.9.9l.7-9.5 17.3-15.6c.8-.7-.2-1.1-1.2-.4L21.6 37.6l-9.1-2.9c-2-.6-2-2 .5-3.2Z" fill="#fff"/></svg>',
    instagram:'<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="ig" x1="8" y1="58" x2="56" y2="6" gradientUnits="userSpaceOnUse"><stop stop-color="#FFD600"/><stop offset=".42" stop-color="#FF2D55"/><stop offset="1" stop-color="#7B2CFF"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#ig)"/><rect x="16" y="16" width="32" height="32" rx="10" fill="none" stroke="#fff" stroke-width="4"/><circle cx="32" cy="32" r="8" fill="none" stroke="#fff" stroke-width="4"/><circle cx="43" cy="21" r="2.7" fill="#fff"/></svg>',
    youtube:'<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#FF0033"/><path d="M50.5 22.5c-.7-2.7-2.8-4.8-5.5-5.5-4.8-1.3-19.2-1.3-24 0-2.7.7-4.8 2.8-5.5 5.5-1.3 4.8-1.3 14.2 0 19 .7 2.7 2.8 4.8 5.5 5.5 4.8 1.3 19.2 1.3 24 0 2.7-.7 4.8-2.8 5.5-5.5 1.3-4.8 1.3-14.2 0-19Z" fill="#fff"/><path d="m28 24 12 8-12 8V24Z" fill="#FF0033"/></svg>',
    facebook:'<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#1877F2"/><path d="M36 52V34h6l1-7h-7v-4c0-2 1-4 4-4h4v-6c-1-.2-3-.5-6-.5-6 0-10 3.5-10 10V27h-6v7h6v18h8Z" fill="#fff"/></svg>',
    twitter:'<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#050505"/><path d="M18 16h9l7.2 9.8L42.5 16H47L36.3 28.6 48 48h-9l-7.7-10.5L22.4 48H18l11.2-13.3L18 16Zm7 4 16 24h3L28 20h-3Z" fill="#fff"/></svg>',
    tiktok:'<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#080808"/><path d="M38 15c1.8 5.4 5.1 8.2 10 9v7c-4.5-.1-7.8-1.4-10-3.2v11.3c0 8-6 12.9-12.5 12.9C18 52 13 46.7 13 40.3c0-7.5 5.9-12.5 13.5-12.5 1 0 2 .1 3 .4v7.3c-1-.4-2-.6-3-.6-3.2 0-5.7 2.2-5.7 5.3 0 2.9 2.2 5.1 5.1 5.1 3.3 0 5.4-2.4 5.4-6V15H38Z" fill="#25F4EE"/><path d="M41 15c1.4 4.2 3.8 6.5 7 7.5V28c-3.8-.2-7-1.7-10-4.3v15.5c0 6.8-4.6 10.8-10.4 11.6 5.9-1.3 9.4-5.7 9.4-11.9V15h4Z" fill="#FE2C55"/><path d="M30 30c-7.1-1.4-13 3.2-13 10 0 5.6 4.1 9.6 9.5 9.9-6 .4-10.8-4-10.8-10 0-7.3 6.3-11.8 14.3-9.9Z" fill="#FE2C55"/></svg>',
    snapchat:'<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#FFFC00"/><path d="M32 15c-7 0-11.5 5.5-11.5 12.6 0 1.5.1 2.8.3 4-1.1 1-2.5 1.7-4 2.2-1.7.5-1.6 2.8.2 3.4 2.4.8 4.3 2.1 5.5 4 .9 1.4 2.1 2 3.7 1.8 1.2-.1 2 .4 2.7 1.4.7 1 1.7 1.6 3.1 1.6s2.4-.6 3.1-1.6c.7-1 1.5-1.5 2.7-1.4 1.6.2 2.8-.4 3.7-1.8 1.2-1.9 3.1-3.2 5.5-4 1.8-.6 1.9-2.9.2-3.4-1.5-.5-2.9-1.2-4-2.2.2-1.2.3-2.5.3-4C43.5 20.5 39 15 32 15Z" fill="#fff" stroke="#111" stroke-width="2"/></svg>',
    discord:'<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#5865F2"/><path d="M22 20c5-3 15-3 20 0 3 4 5 9 6 15-3 4-6 6-10 8l-2.5-3c1.6-.5 3-1.2 4.3-2-4.3 2-11.3 2-15.6 0 1.3.8 2.7 1.5 4.3 2L26 43c-4-2-7-4-10-8 1-6 3-11 6-15Z" fill="#fff"/><circle cx="27" cy="31" r="3" fill="#5865F2"/><circle cx="37" cy="31" r="3" fill="#5865F2"/></svg>',
    spotify:'<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#1ED760"/><circle cx="32" cy="32" r="20" fill="#111"/><path d="M21 27c8-2 18-1 24 2" fill="none" stroke="#1ED760" stroke-width="3.2" stroke-linecap="round"/><path d="M22 33c7-1.7 15-.9 21 1.5" fill="none" stroke="#1ED760" stroke-width="2.8" stroke-linecap="round"/><path d="M23 39c6-1.3 12-.6 17 1.2" fill="none" stroke="#1ED760" stroke-width="2.4" stroke-linecap="round"/></svg>',
    linkedin:'<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#0A66C2"/><circle cx="21" cy="22" r="4" fill="#fff"/><path d="M18 28h6v19h-6V28Zm10 0h6v2.6c1.5-2 3.7-3.2 6.8-3.2 6 0 8.2 3.7 8.2 10.2V47h-6v-8.3c0-4-1.2-6-4.2-6-3.3 0-4.8 2.2-4.8 6.7V47h-6V28Z" fill="#fff"/></svg>',
    twitch:'<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#9146FF"/><path d="M17 17h32v23L39 50h-8l-5 5v-5h-9V17Zm6 6v21h8v5l5-5h7V23H23Z" fill="#fff"/><path d="M31 28v9h4v-9h-4Zm8 0v9h4v-9h-4Z" fill="#9146FF"/></svg>',
    kick:'<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#53FC18"/><path d="M17 17h10v11h4l7-11h11L39 32l11 15H38l-7-10h-4v10H17V17Z" fill="#071109"/></svg>',
    reddit:'<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#FF4500"/><circle cx="32" cy="35" r="17" fill="#fff"/><circle cx="25" cy="34" r="2.4" fill="#FF4500"/><circle cx="39" cy="34" r="2.4" fill="#FF4500"/><path d="M25 40c4 3 10 3 14 0" fill="none" stroke="#FF4500" stroke-width="2.4" stroke-linecap="round"/><path d="m35 18 2-7 8 2" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="47" cy="14" r="3" fill="#fff"/></svg>'
  };
  return '<span class="smm-logo '+cls+'" data-app="'+safe(m.key)+'">'+(icons[m.key]||'')+'</span>';
}
function smmCurrentMeta(){return smmPlatformMeta(smm.platform||{});}
function smmCloseDrop(){smm.drop='';smm.dropSearch='';smmScreen();}
function smmToggleDrop(kind){smm.drop=smm.drop===kind?'':kind;smm.dropSearch='';smmScreen();setTimeout(()=>document.querySelector('.smm-dropdown-search input')?.focus(),0)}
function smmDropFilter(v){smm.dropSearch=String(v||'');smmScreen();setTimeout(()=>{const n=document.querySelector('.smm-dropdown-search input');if(n){n.focus();n.selectionStart=n.selectionEnd=n.value.length}},0)}
function smmLinkFields(p){
  const fields=normalizeFields(p);
  const hasLink=fields.some(f=>/link|url|رابط/i.test(f.key+' '+f.label));
  return hasLink?fields:[...fields,{key:'link',label:'الرابط',required:true,options:[]}];
}
function smmPriceNow(){
  const p=smm.product;if(!p)return 0;
  const q=quantityMeta(p),unit=priceOf(p);
  if(!q.variable)return unit;
  const raw=latinDigits(el('smmQty')?.value||q.min||1);
  const n=Number(raw);
  return Number.isFinite(n)&&n>0?unit*n:unit*(q.min||1);
}
function smmUpdatePrice(){
  const node=el('smmPriceValue');if(node)node.textContent=money(smmPriceNow());
}
window.smmUpdatePrice=smmUpdatePrice;window.smmToggleDrop=smmToggleDrop;window.smmDropFilter=smmDropFilter;window.smmQtySync=function(v){const n=el('smmQty');if(!n)return;const raw=latinDigits(v).replace(/[^0-9.]/g,'');if(n.value!==raw)n.value=raw;smmUpdatePrice();};
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
function smmBottom(){
  const icon=(n)=>{
    const map={
      home:'<svg viewBox="0 0 24 24"><path d="M3 11 12 4l9 7v9h-6v-6H9v6H3z"/></svg>',
      users:'<svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="9" r="2.5"/><path d="M3 20c0-4 2-6 5-6s5 2 5 6M13 15c1-.7 2-.9 3-.9 3 0 5 2 5 5.9"/></svg>',
      barcode:'<svg viewBox="0 0 24 24"><path d="M4 5v14M7 5v14M10 5v14M14 5v14M17 5v14M20 5v14"/></svg>',
      calc:'<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h1M12 11h1M16 11h1M8 15h1M12 15h1M16 15h1"/></svg>'
    };return map[n]||'';
  };
  const item=(v,ic,label,active=false)=>'<button class="smm-ref-nav-item '+(active?'active':'')+'" onclick="'+(active?'void(0)':'DigitalStore.debtNav(\''+v+'\')')+'"><span>'+icon(ic)+'</span><b>'+label+'</b></button>';
  return '<nav class="smm-ref-bottom">'+
    item('home','home','الرئيسية')+
    item('clients','users','العملاء')+
    item('products','barcode','الرشق',true)+
    item('calculator','calc','الحاسبة')+
    item('partners','users','الشركاء')+
  '</nav>';
}
function smmPlatformChips(){
  const rows=smm.platforms||[];
  if(!rows.length)return '<div class="smm-app-empty">لم يتم العثور على تطبيقات رشق ضمن أقسام المزود.</div>';
  const first=rows.slice(0,7),second=rows.slice(7,13),extra=rows.slice(13);
  const appButton=p=>{const m=smmPlatformMeta(p),active=smm.platform&&smm.platform.key===p.key;return '<button class="smm-app '+(active?'active':'')+'" onclick="DigitalStore.smmPlatform(\''+safe(p.key)+'\')" title="'+safe(p.name)+'">'+smmLogo(m)+'</button>'};
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
  const meta=smmCurrentMeta(),needle=smm.dropSearch.trim().toLowerCase();
  const baseSections=smm.sectionOptions?.length?smm.sectionOptions:(smm.sections||[]);
  const sections=needle?baseSections.filter(x=>nameOf(x).toLowerCase().includes(needle)):baseSections;
  const baseProducts=smm.products||[];
  const products=needle?baseProducts.filter(x=>nameOf(x).toLowerCase().includes(needle)):baseProducts;
  const p=smm.product,q=p?quantityMeta(p):null,fields=p?smmLinkFields(p):[{key:'link',label:'الرابط',required:true,options:[]}];
  const selectedSection=smm.selectedSection;

  const sectionRows=sections.map(x=>'<button class="smm-drop-row '+(selectedSection&&Number(selectedSection.id)===Number(x.id)?'selected':'')+'" onclick="DigitalStore.smmSection('+Number(x.id||0)+')">'+
    smmLogo(meta,'small')+'<span>'+safe(nameOf(x))+'</span></button>').join('');
  const sectionDrop=smm.drop==='section'
    ?'<div class="smm-dropdown"><div class="smm-dropdown-search"><i>⌕</i><input value="'+safe(smm.dropSearch)+'" placeholder="بحث" oninput="smmDropFilter(this.value)"></div><div class="smm-drop-list">'+(sectionRows||'<div class="smm-drop-empty">لا توجد أقسام مطابقة</div>')+'</div></div>'
    :'';
  const sectionTrigger='<button class="smm-select-trigger '+(selectedSection?'selected':'')+'" onclick="smmToggleDrop(\'section\')">'+
    '<span class="smm-trigger-main">'+smmLogo(meta,'small')+'<b>'+safe(selectedSection?nameOf(selectedSection):(smm.platform.key==='all'?'اختر التطبيق / نوع الخدمة':'اختر نوع الخدمة كما هو لدى المزود'))+'</b></span><i>⌃</i></button>';

  const serviceRows=products.map(x=>'<button class="smm-drop-row '+(p&&Number(p.id)===Number(x.id)?'selected':'')+'" onclick="DigitalStore.smmService('+Number(x.id||0)+')">'+
    smmLogo(meta,'small')+'<span>'+safe(nameOf(x))+'</span></button>').join('');
  const serviceDrop=smm.drop==='product'
    ?'<div class="smm-dropdown"><div class="smm-dropdown-search"><i>⌕</i><input value="'+safe(smm.dropSearch)+'" placeholder="بحث" oninput="smmDropFilter(this.value)"></div><div class="smm-drop-list">'+(serviceRows||'<div class="smm-drop-empty">لا توجد خدمات مطابقة</div>')+'</div></div>'
    :'';
  const serviceTrigger='<button class="smm-select-trigger '+(p?'selected':'')+'" '+(!products.length?'disabled':'')+' onclick="smmToggleDrop(\'product\')">'+
    '<span class="smm-trigger-main">'+smmLogo(meta,'small')+'<b>'+safe(p?nameOf(p):(products.length?'اختر الخدمة':'اختر القسم أولًا'))+'</b></span><i>⌃</i></button>';

  const fieldsHtml=fields.map((f,i)=>{
    const isLink=/link|url|رابط/i.test(f.key+' '+f.label);
    const label=isLink?'رابط':f.label;
    const placeholder=isLink?'أدخل رابط الحساب أو المنشور':f.label;
    if(f.options.length){
      return '<div class="smm-field"><label>'+safe(label)+(f.required?' *':'')+'</label>'+
        '<select class="smm-select smm-order-field" id="smmF'+i+'" data-key="'+safe(f.key)+'" '+(p?'':'disabled')+'>'+f.options.map(o=>'<option value="'+safe(o.value)+'">'+safe(o.label)+'</option>').join('')+'</select></div>';
    }
    return '<div class="smm-field"><label>'+safe(label)+(f.required?' *':'')+'</label>'+
      '<div class="smm-input-wrap">'+(isLink?'<i>🔗</i>':'')+'<input class="smm-input smm-order-field '+(isLink?'smm-link-input':'')+'" id="smmF'+i+'" data-key="'+safe(f.key)+'" '+(f.required?'required':'')+' placeholder="'+safe(placeholder)+'"></div></div>';
  }).join('');

  let qtyHtml='';
  if(q&&q.variable){
    if(q.options.length){
      qtyHtml='<div class="smm-field"><label>الكمية</label><select class="smm-select smm-qty-select" id="smmQty" onchange="smmUpdatePrice()">'+q.options.map(v=>'<option value="'+enNum(v)+'">'+enNum(v)+'</option>').join('')+'</select><small class="smm-limits">الحد الأدنى: '+enNum(q.min)+' · الحد الأقصى: '+enNum(q.max)+'</small></div>';
    }else{
      qtyHtml='<div class="smm-field"><label>الكمية</label><input class="smm-input smm-qty" id="smmQty" type="text" inputmode="numeric" pattern="[0-9]*" min="'+enNum(q.min)+'" max="'+enNum(q.max)+'" step="'+enNum(q.step)+'" value="'+enNum(q.min)+'" placeholder="'+enNum(q.min)+'" oninput="smmQtySync(this.value)"><small class="smm-limits">الحد الأدنى: '+enNum(q.min)+' · الحد الأقصى: '+enNum(q.max)+'</small></div>';
    }
  }else{
    qtyHtml='<div class="smm-field"><label>الكمية</label><input class="smm-input smm-qty" id="smmQty" type="text" inputmode="numeric" pattern="[0-9]*" value="1" placeholder="1" oninput="smmQtySync(this.value)"><small class="smm-limits">أدخل الكمية بالأرقام الإنجليزية فقط</small></div>';
  }

  const detail=fieldsHtml+qtyHtml+
      '<div class="smm-price-row"><span>ثمن الطلب</span><strong id="smmPriceValue">'+safe(money(q&&q.variable?priceOf(p)*q.min:(p?priceOf(p):0)))+'</strong></div>'+
      '<button class="smm-confirm" '+(p?'':'disabled')+' onclick="DigitalStore.smmBuy()">شراء</button>';

  return '<section class="smm-order-card"><div class="smm-field"><label>القسم</label>'+sectionTrigger+sectionDrop+'</div>'+
    '<div class="smm-field"><label>الخدمة</label>'+serviceTrigger+serviceDrop+'</div>'+detail+'</section>';
}
function smmScreen(){
  const root='<div class="digital-store smm-store smm-ref-shell">'+smmTopbar()+'<div class="digital-wrap smm-ref-wrap">'+
    '<div class="smm-page-head smm-ref-title"><div><h2>قسم الرشق 🚀</h2><small>خدمات السوشيال ميديا بأفضل جودة وأسعار</small></div></div>'+
    smmPlatformChips()+
    '<div class="smm-search smm-ref-search"><input value="'+safe(smm.search)+'" placeholder="بحث" oninput="DigitalStore.smmSearch(this.value)"><i>⌕</i></div>'+
    (smm.error?'<div class="digital-empty"><b>'+safe(smm.error)+'</b><button class="digital-secondary" onclick="DigitalStore.smmRetry()">إعادة المحاولة</button></div>':smmOrderForm())+
    '</div>'+smmBottom()+drawerMarkup()+topupModal()+loadingOverlay()+'</div>';
  el('app').innerHTML=root;
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
function fab(){return '<a class="digital-wa-fab" href="'+safe(waUrl())+'" aria-label="واتساب">◉</a>'}
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
    '</div>'+fab()+bottom()+drawerMarkup()+topupModal()+loadingOverlay()+'</div>';
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
    '</div>'+fab()+bottom()+'</div>';
}
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
    if(isSmmCategory(row)){await this.openSmm(row);return;}
    const next=[...path,row];query='';lastCatalogError='';
    await loadCatalog(id,()=>{path=next});
  },
  async openSmm(row){
    smm={root:row,returnPath:[...path],rootCategories:[],rootProducts:[],platforms:[],platform:null,sectionTrail:[],sections:[],sectionOptions:[],selectedSection:null,products:[],product:null,search:'',expanded:false,error:'',drop:'',dropSearch:''};
    mode='smm';loading=true;smmScreen();
    const r=await smmFetchCatalog(row.id);loading=false;
    if(!r.ok){smm.error=errorText(r.error);smmScreen();return;}
    smm.rootCategories=r.data.categories||[];smm.rootProducts=r.data.products||[];smm.platforms=smmBuildApps(smm.rootCategories,smm.rootProducts);smm.platform={key:'all',name:'الكل',sx:0,sy:0};smm.sections=[...smm.rootCategories];smm.sectionOptions=[...smm.sections];smm.products=[...smm.rootProducts];smmScreen();
  },
  smmMore(){smm.expanded=!smm.expanded;smmScreen()},
  async smmPlatform(key){
    if(loading)return;
    smm.product=null;smm.selectedSection=null;smm.sectionTrail=[];smm.search='';smm.error='';smm.drop='';smm.dropSearch='';
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
    smmScreen();setTimeout(()=>document.querySelector('.smm-dropdown-search input')?.focus(),0);
  },
  async smmSection(id){
    if(!id||loading)return;
    const source=smm.sectionOptions?.length?smm.sectionOptions:smm.sections;
    const row=(source||[]).find(x=>Number(x.id)===Number(id));if(!row)return;
    smm.selectedSection=row;smm.drop='';smm.dropSearch='';smm.product=null;
    loading=true;smmScreen();
    const r=await smmFetchCatalog(row.id);loading=false;
    if(!r.ok){smm.error=errorText(r.error);smmScreen();return;}
    smm.sectionTrail=[row];
    smm.sections=r.data.categories||[];
    if(smm.sections.length)smm.sectionOptions=[...smm.sections];
    smm.products=r.data.products||[];
    smm.search='';smmScreen();
  },
  async smmService(id){
    if(!id||loading){smm.product=null;smm.drop='';smmScreen();return;}
    smm.drop='';smm.dropSearch='';loading=true;smmScreen();
    const r=await call('digital_product',{product_id:Number(id)});loading=false;
    if(!r.ok){smm.error=errorText(r.error);smmScreen();return;}
    smm.product=r.product;smm.error='';smmScreen();
  },
  smmSearch(v){smm.search=String(v||'');smmScreen();const input=document.querySelector('.smm-search input');if(input){input.focus();input.selectionStart=input.selectionEnd=input.value.length}},
  smmNew(){smm.product=null;smm.selectedSection=null;smm.search='';smm.sectionTrail=[];smm.drop='';smm.dropSearch='';if(smm.platform)this.smmPlatform(smm.platform.key);else{smm.sections=[];smm.products=[];smmScreen()}},
  smmRetry(){if(smm.platform)this.smmPlatform(smm.platform.key);else smmScreen()},
  smmExit(){
    const targetPath=[...smm.returnPath],target=Number(targetPath[targetPath.length-1]?.id||0);
    mode='store';path=targetPath;query='';smm.product=null;loading=false;
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
      if(!Number.isFinite(quantity)||quantity<qm.min||quantity>qm.max||(qm.options.length&&!qm.options.includes(quantity))){notify('الكمية خارج الحدود المسموحة',true);return;}
    }
    busy=true;notify('جاري إرسال الطلب...');
    const r=await call('digital_purchase',{product_id:Number(p.id),fields,quantity});
    busy=false;
    if(!r.ok){notify(errorText(r.error),true);return;}
    wallet.balance=Number(r.balance??wallet.balance);
    notify(r.outcome==='failed'?'تم رفض الطلب وإعادة الرصيد':'تم إرسال الطلب بنجاح');
    smm.product=null;await loadWallet().catch(()=>null);smmScreen();
  },
  async balance(){
    if(mode!=='store'&&mode!=='smm'){mode='store';selectedProduct=null}
    topupOpen=true;proofData='';proofName='';render();
    const r=await loadWallet().catch(()=>null);if(r&&topupOpen)render();
  },
  shamcash(){this.balance()},
  closeTopup(){topupOpen=false;proofData='';proofName='';render()},
  closeSub(){topupOpen=false;if(mode!=='smm')mode='store';render()},
  debtNav(v){topupOpen=false;proofData='';proofName='';selectedProduct=null;path=[];query='';mode='';try{nav(v)}catch(_e){render()}},
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
  exit(){topupOpen=false;proofData='';proofName='';selectedProduct=null;path=[];query='';smm.product=null;smm.platform=null;smm.drop='';smm.dropSearch='';mode='';render()}
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
  if(mode==='smm'){DigitalStore.smmExit();return true}
  if(mode==='product'){DigitalStore.closeProduct();return true}
  if(mode==='admin'){DigitalStore.exitAdmin();return true}
  if(mode==='store'){if(path.length){DigitalStore.up();return true}DigitalStore.exit();return true}
  return oldBack?.()||false;
};
window.UCHIHA_DIGITAL_STORE_VERSION=VERSION;
})();