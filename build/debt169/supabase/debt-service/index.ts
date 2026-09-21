// UCHIHA Debt Service v1.5.26 — enriched product media + schema-driven orders.
// Custom high-entropy session authentication remains server enforced.
const legacyAllowed = new Set(['activate','status','consent','backup','backups','download',
  'owner_create','owner_list','owner_backups','owner_download','owner_set_active','owner_reset_device','owner_audit']);
const digitalAllowed = new Set([
  'digital_catalog','digital_product','digital_verify_player','digital_purchase','digital_wallet','digital_topup_create',
  'owner_digital_config_get','owner_digital_config_set','owner_digital_provider_test','owner_digital_wallets','owner_digital_wallet_adjust',
  'owner_digital_topups','owner_digital_topup_review','owner_digital_orders','owner_digital_order_update'
]);
const MAX_BODY=6*1024*1024;
const utf8=new TextEncoder();

async function sha256(s:string){
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(s)))]
    .map(v=>v.toString(16).padStart(2,'0')).join('');
}
function secretKey(){
  const keys=Deno.env.get('SUPABASE_SECRET_KEYS');
  return keys?JSON.parse(keys).default:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
}
function dbHeaders(){
  const key=secretKey(); if(!key) throw new Error('CONFIG');
  const h:Record<string,string>={'Content-Type':'application/json','apikey':key};
  if(!key.startsWith('sb_secret_')) h.Authorization='Bearer '+key;
  return h;
}
function response(data:unknown,status=200){
  return new Response(JSON.stringify(data),{status,headers:{
    'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
  }});
}
async function readBody(req:Request){
  if(Number(req.headers.get('content-length')||0)>MAX_BODY)throw new Error('SIZE');
  const reader=req.body?.getReader();if(!reader)throw new Error('BODY');
  const parts:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BODY){await reader.cancel();throw new Error('SIZE');}parts.push(value);}
  const all=new Uint8Array(size);let pos=0;for(const p of parts){all.set(p,pos);pos+=p.length;}
  return JSON.parse(new TextDecoder().decode(all));
}
async function legacyRpc(action:string,args:Record<string,unknown>){
  const res=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/debt_service_dispatch',{
    method:'POST',headers:dbHeaders(),body:JSON.stringify({p_action:action,p_args:args}),signal:AbortSignal.timeout(25000)
  });
  if(!res.ok)throw new Error('DATABASE');
  return await res.json();
}
async function digitalRpc(action:string,actor:string,role:string,args:Record<string,unknown>={}){
  const res=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/debt_digital_dispatch',{
    method:'POST',headers:dbHeaders(),
    body:JSON.stringify({p_action:action,p_actor:actor,p_role:role,p_args:args}),
    signal:AbortSignal.timeout(25000)
  });
  if(!res.ok)throw new Error('DATABASE');
  return await res.json();
}
function cleanObject(v:unknown){
  if(!v||typeof v!=='object'||Array.isArray(v)) return {};
  return v as Record<string,unknown>;
}
function int(v:unknown,min=0,max=2147483647){
  const n=Number(v); if(!Number.isInteger(n)||n<min||n>max) throw new Error('INVALID_REQUEST'); return n;
}
function number(v:unknown,min=0,max=1e9){
  const n=Number(v); if(!Number.isFinite(n)||n<min||n>max) throw new Error('INVALID_REQUEST'); return n;
}
function clampText(v:unknown,max:number){
  return typeof v==='string'?v.slice(0,max):'';
}
function mapStatus(raw:unknown){
  const s=String(raw||'').toLowerCase();
  if(/complete|done|deliver/.test(s)) return 'completed';
  if(/reject|fail|cancel/.test(s)) return 'rejected';
  if(/accept|success|approved|ok/.test(s)) return 'accepted';
  if(/process|running|sending/.test(s)) return 'processing';
  if(/pending|wait|queue/.test(s)) return 'pending';
  return 'unknown';
}
function unwrapProduct(payload:any):any|null{
  if(Array.isArray(payload)) return payload[0]||null;
  const root=payload?.data??payload?.result??payload;
  if(Array.isArray(root)) return root[0]||null;
  if(Array.isArray(root?.products)) return root.products[0]||null;
  if(Array.isArray(root?.items)) return root.items[0]||null;
  if(root&&typeof root==='object'&&(root.id||root.product_id)) return root;
  return null;
}

function providerProducts(payload:any):any[]{
  if(Array.isArray(payload))return payload.filter(x=>x&&typeof x==='object');
  const root=payload?.data??payload?.result??payload;
  if(Array.isArray(root))return root.filter((x:any)=>x&&typeof x==='object');
  if(Array.isArray(root?.products))return root.products.filter((x:any)=>x&&typeof x==='object');
  if(Array.isArray(root?.items))return root.items.filter((x:any)=>x&&typeof x==='object');
  return [];
}
function providerProductId(row:any){
  const n=Number(row?.id??row?.product_id??row?.productId??0);
  return Number.isInteger(n)&&n>0?n:0;
}
async function enrichCatalogProducts(payload:any,token:string){
  const root=payload?.data??payload?.result??payload;
  if(!root||typeof root!=='object')return payload;
  const key=Array.isArray(root.products)?'products':Array.isArray(root.items)?'items':'';
  if(!key)return payload;
  const rows=(root as any)[key] as any[];
  const ids=[...new Set(rows.map(providerProductId).filter(Boolean))].slice(0,300);
  if(!ids.length)return payload;
  const details=new Map<number,any>();
  for(let i=0;i<ids.length;i+=50){
    const chunk=ids.slice(i,i+50);
    const r=await providerJson('products',token,{params:{products_id:chunk.join(',')},timeout:35000});
    if(!r.ok)continue;
    for(const item of providerProducts(r.payload)){
      const id=providerProductId(item);if(id)details.set(id,item);
    }
  }
  (root as any)[key]=rows.map(item=>{
    const id=providerProductId(item),detail=details.get(id);
    return detail?{...item,...detail}:item;
  });
  return payload;
}
function productPrice(p:any){
  for(const k of ['price','sell_price','client_price','cost']){const n=Number(p?.[k]);if(Number.isFinite(n)&&n>0)return n;}
  return 0;
}
function boolish(v:unknown){
  if(v===true||v===1)return true;
  return ['1','true','yes','on','enabled'].includes(String(v??'').trim().toLowerCase());
}
function decodeUtf8Base64(value:string){
  try{
    const bytes=Uint8Array.from(atob(value.replace(/\s+/g,'')),c=>c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }catch{return '';}
}
function structuredValue(value:any){
  if(Array.isArray(value)||(value&&typeof value==='object'))return value;
  if(typeof value!=='string')return value;
  const raw=value.trim();if(!raw)return [];
  for(const candidate of [raw,decodeUtf8Base64(raw)]){
    const text=String(candidate||'').trim();
    if(!text||(!text.startsWith('[')&&!text.startsWith('{')))continue;
    try{return JSON.parse(text);}catch{/* legacy text is handled below */}
  }
  return raw;
}
function fieldSlug(value:unknown){
  return String(value??'').trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu,'_').replace(/^_+|_+$/g,'').slice(0,70)||'field';
}
function fieldOptions(value:any){
  const parsed=structuredValue(value);
  let rows:any[]=[];
  if(Array.isArray(parsed))rows=parsed;
  else if(parsed&&typeof parsed==='object')rows=Object.entries(parsed).map(([key,label])=>({value:key,label}));
  else if(typeof parsed==='string')rows=parsed.split(',').map(x=>x.trim()).filter(Boolean);
  const options=rows.map((row:any)=>{
    if(row&&typeof row==='object'){
      const value=String(row.value??row.id??row.code??row.key??row.name??'').trim();
      const label=String(row.label??row.title??row.name??row.value??row.id??value).trim();
      return {value:value.slice(0,300),label:label.slice(0,180)};
    }
    const text=String(row??'').trim();return {value:text.slice(0,300),label:text.slice(0,180)};
  }).filter(x=>x.value);
  return [...new Map<string,{value:string,label:string}>(options.map(x=>[x.value,x] as [string,{value:string,label:string}])).values()].slice(0,300);
}
type ProductField={key:string,label:string,type:string,required:boolean,options:{value:string,label:string}[],min_length:number,max_length:number,placeholder:string};
function productFields(p:any):ProductField[]{
  const sourceKeys=['input_schema','custom_fields','params','fields','requirements','inputs','parameters'];
  let source='',raw:any=[];
  for(const key of sourceKeys){
    if(p?.[key]!==undefined&&p?.[key]!==null&&String(p[key]).trim()!==''){source=key;raw=structuredValue(p[key]);break;}
  }
  if(raw&&typeof raw==='object'&&!Array.isArray(raw)&&(raw as any).properties&&typeof (raw as any).properties==='object'){
    const required=new Set(Array.isArray((raw as any).required)?(raw as any).required.map(String):[]);
    raw=Object.entries((raw as any).properties).map(([key,value])=>value&&typeof value==='object'?{...(value as any),name:key,required:(value as any).required??required.has(key)}:{name:key,label:key,required:required.has(key)});
  }else if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
    const nested=(raw as any).fields??(raw as any).params??(raw as any).inputs??(raw as any).requirements;
    if(nested!==undefined)raw=structuredValue(nested);
    else raw=Object.entries(raw).map(([key,value])=>value&&typeof value==='object'?{...(value as any),name:(value as any).name??key}:{name:key,label:String(value??key)});
  }
  if(typeof raw==='string')raw=raw.split(',').map(x=>x.trim()).filter(Boolean);
  if(!Array.isArray(raw))raw=raw?[raw]:[];
  const exactStringSources=new Set(['params','requirements','inputs','parameters']);
  const fields=raw.map((item:any):ProductField|null=>{
    const object=item&&typeof item==='object'?item:null;
    const text=object?'':String(item??'').trim();
    const label=String(object?.label??object?.title??object?.display_name??object?.placeholder??object?.description??object?.name??object?.key??text).trim();
    if(!label||/^\s*(qty|quantity|الكمية)\s*$/iu.test(label))return null;
    const explicit=String(object?.name??object?.key??object?.param??object?.field??object?.code??object?.id??'').trim();
    let key=explicit;
    if(!key&&text&&exactStringSources.has(source)&&/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(text))key=text;
    if(!key)key='custom_'+fieldSlug(label);
    key=key.slice(0,120);
    if(!/^[\p{L}\p{N}_.-]{1,120}$/u.test(key))key='custom_'+fieldSlug(label);
    const compact=key.replace(/[^a-z0-9]/gi,'').toLowerCase();
    if(['qty','quantity','orderuuid','productid'].includes(compact))return null;
    const declared=String(object?.type??object?.input_type??'text').toLowerCase();
    const options=fieldOptions(object?.options??object?.values??object?.choices??[]);
    const type=options.length||declared==='select'?'select':['number','numeric','tel','email','password','textarea'].includes(declared)?declared:'text';
    const requiredValue=object?.required;
    const required=requiredValue===undefined?true:!([false,0,'0','false','optional','no'].includes(requiredValue));
    const minLength=Math.max(0,Math.min(500,Number(object?.min_length??object?.minLength??0)||0));
    const maxLength=Math.max(minLength||1,Math.min(500,Number(object?.max_length??object?.maxLength??500)||500));
    return {key,label:label.slice(0,180),type,required,options,min_length:minLength,max_length:maxLength,placeholder:String(object?.placeholder??label).slice(0,180)};
  }).filter((x:ProductField|null):x is ProductField=>!!x);
  return [...new Map<string,ProductField>(fields.map((x:ProductField)=>[x.key,x] as [string,ProductField])).values()].slice(0,40);
}
function numberList(value:any){
  const parsed=structuredValue(value);
  let rows:any[]=[];
  if(Array.isArray(parsed))rows=parsed;
  else if(parsed&&typeof parsed==='object')rows=Array.isArray(parsed.values)?parsed.values:Array.isArray(parsed.options)?parsed.options:Object.keys(parsed).filter(key=>/^\d+$/.test(key));
  else if(typeof parsed==='string')rows=parsed.split(',');
  return [...new Set(rows.map((x:any)=>Number(x?.value??x?.qty??x)).filter((n:number)=>Number.isInteger(n)&&n>0&&n<=1000000))].sort((a,b)=>a-b);
}
function qtyRule(p:any){
  const raw=structuredValue(p?.qty_values??p?.quantity_values??p?.quantities??p?.quantity_options??{});
  let min=1,max=1,step=1,options:number[]=[];
  if(Array.isArray(raw)||typeof raw==='string') options=numberList(raw);
  else if(raw&&typeof raw==='object'){
    min=Number(raw.min??raw.minimum??raw.min_qty??p?.min??p?.minimum??p?.min_qty??1)||1;
    max=Number(raw.max??raw.maximum??raw.max_qty??p?.max??p?.maximum??p?.max_qty??min)||min;
    step=Number(raw.step??raw.increment??1)||1;
    options=numberList(raw);
  }
  if(!raw||typeof raw!=='object'||Array.isArray(raw)){
    min=Number(p?.min??p?.minimum??p?.min_qty??min)||min;
    max=Number(p?.max??p?.maximum??p?.max_qty??max)||max;
    step=Number(p?.step??p?.increment??step)||step;
  }
  options=[...new Set(options)].sort((a,b)=>a-b);
  if(options.length){min=options[0];max=options[options.length-1];}
  const productType=String(p?.product_type??p?.type??'').trim().toLowerCase();
  const allowQuantity=boolish(p?.allow_quantity??p?.allowQuantity??p?.allowquantity??p?.quantity_enabled);
  let kind:'fixed'|'amount'|'packages'|'quantity'='fixed';
  if(productType==='amount')kind='amount';
  else if(productType==='specificpackage'&&options.length)kind='packages';
  else if(allowQuantity)kind='quantity';
  else if(options.length>1)kind='packages';
  else if(max>min)kind='amount';
  min=Math.max(1,Math.trunc(min));
  max=Math.max(min,Math.min(1000000,Math.trunc(max)));
  step=Math.max(1,Math.trunc(step));
  if(kind==='quantity'&&max===min)max=1000000;
  return {variable:kind!=='fixed',kind,min,max,step,options,allow_quantity:allowQuantity,product_type:String(p?.product_type??p?.type??'')};
}
function playerVerification(p:any,fields:ProductField[]){
  const text=[p?.name,p?.title,p?.product_name,p?.category_name,p?.category,p?.parent_name].map(x=>String(x??'')).join(' ');
  const game=/pubg|pubgm|pubg\s*mobile|ببجي|بوبجي/iu.test(text)?'PUBG Mobile':/free\s*fire|freefire|free_fire|فري\s*فاير|فرى\s*فاير/iu.test(text)?'Free Fire':'';
  const idField=fields.find(field=>{
    const value=(field.key+' '+field.label).toLowerCase();
    if(/email|e-mail|mail|بريد|ايميل|إيميل|password|كلمة\s*السر/iu.test(value))return false;
    return /player\s*id|playerid|player_id|\buid\b|user\s*id|account\s*id|(^|\s|_)id($|\s|_)|ايدي|آيدي|اي\s*دي|أيدي|معرف|رقم\s*اللاعب|رقم\s*الحساب|كود\s*اللاعب|كود\s*الحساب/iu.test(value);
  });
  return {enabled:!!(game&&idField),required:false,game,field_key:idField?.key||''};
}
function purchaseSchema(p:any){
  const fields=productFields(p),quantity=qtyRule(p);
  const automaticRaw=p?.automatic??p?.is_automatic??p?.auto_delivery??p?.delivery_type;
  const automatic=automaticRaw===undefined||automaticRaw===null?null:boolish(automaticRaw)||/auto|instant|فوري|تلقائي/iu.test(String(automaticRaw));
  return {fields,quantity,verification:playerVerification(p,fields),automatic};
}
function cleanPurchaseFields(product:any,input:Record<string,unknown>){
  const defs=productFields(product),out:Record<string,string>={};
  for(const def of defs){
    const raw=input[def.key];
    const value=raw===null||raw===undefined?'':String(raw).trim();
    if(def.required&&!value)throw new Error('MISSING_FIELDS');
    if(!value)continue;
    if(value.length<def.min_length||value.length>def.max_length)throw new Error('INVALID_FIELDS');
    if(def.options.length&&!def.options.some(option=>option.value===value))throw new Error('INVALID_FIELDS');
    out[def.key]=value;
  }
  // v1.5.18 added a fallback link field for SMM rows whose provider schema omitted it.
  // Keep that narrowly-scoped compatibility while all schema-defined fields stay allow-listed.
  if(!defs.some(def=>/^(link|url)$/i.test(def.key))){
    for(const key of ['link','url']){
      const value=input[key]===null||input[key]===undefined?'':String(input[key]).trim();
      if(value&&value.length<=500){out[key]=value;break;}
    }
  }
  if(!defs.length){
    for(const [key,raw] of Object.entries(input)){
      if(!/^custom_[\p{L}\p{N}_.-]{1,110}$/u.test(key))continue;
      const value=raw===null||raw===undefined?'':String(raw).trim();if(value&&value.length<=500)out[key]=value;
    }
  }
  return out;
}
async function verifyPlayer(productId:number,userId:string){
  const form=new URLSearchParams({product_id:String(productId),user_id:userId});
  try{
    const result=await fetch('https://js4card.com/ajax/player-id-check',{
      method:'POST',headers:{'Accept':'application/json','Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'},
      body:form.toString(),signal:AbortSignal.timeout(22000)
    });
    const text=await result.text();let payload:any={};try{payload=JSON.parse(text);}catch{return {ok:false,error:'PROVIDER_UNAVAILABLE'};}
    const flag=String(payload?.valid??'').toLowerCase();
    const valid=payload?.success===true&&(payload?.valid===true||payload?.valid===1||['true','1','valid'].includes(flag)||!!payload?.player_name);
    return {ok:true,valid,player_name:valid?clampText(payload?.player_name||'تم العثور على اللاعب',120):''};
  }catch{return {ok:false,error:'PROVIDER_UNAVAILABLE'};}
}
async function providerJson(path:string,token:string,opts:{method?:string,params?:Record<string,string>,timeout?:number}={}){
  const base='https://api.js4card.com/client/api';
  const url=new URL(base+'/'+path.replace(/^\//,''));
  for(const [k,v] of Object.entries(opts.params||{})) url.searchParams.set(k,v);
  const method=opts.method||'GET';
  const tries=method==='GET'?3:1;
  let lastStatus=0,lastText='';
  for(let attempt=0;attempt<tries;attempt++){
    try{
      const r=await fetch(url,{method,headers:{'api-token':token,'Accept':'application/json','Content-Type':'application/json'},
        signal:AbortSignal.timeout(opts.timeout||60000)});
      lastStatus=r.status; lastText=await r.text();
      let payload:any={}; try{payload=lastText?JSON.parse(lastText):{};}catch{payload={message:lastText.slice(0,1000)}}
      if(r.ok) return {ok:true,status:r.status,payload};
      if((r.status===429||r.status>=500)&&attempt<tries-1){await new Promise(x=>setTimeout(x,1200*(attempt+1)));continue;}
      return {ok:false,status:r.status,payload};
    }catch(e){
      if(attempt<tries-1){await new Promise(x=>setTimeout(x,1200*(attempt+1)));continue;}
      return {ok:false,status:lastStatus||0,payload:{message:e instanceof Error?e.message:'network'}};
    }
  }
  return {ok:false,status:lastStatus,payload:{message:lastText.slice(0,500)}};
}

function normalizeProviderToken(v:unknown){
  let s=String(v??'').trim();
  s=s.replace(/^["']|["']$/g,'').trim();
  s=s.replace(/^api[-_ ]?token\s*[:=]\s*/i,'').trim();
  s=s.replace(/^bearer\s+/i,'').trim();
  s=s.replace(/\s+/g,'');
  return s.slice(0,500);
}
async function testProviderToken(token:string){
  const checks=[
    ['content/0',{timeout:26000}],
    ['profile',{timeout:22000}]
  ] as const;
  let authRejected=false, lastStatus=0;
  for(const [path,opts] of checks){
    const r=await providerJson(path,token,opts);
    lastStatus=r.status||lastStatus;
    if(r.ok)return {ok:true,path,status:r.status};
    if(r.status===401||r.status===403)authRejected=true;
  }
  return {ok:false,error:authRejected?'INVALID_PROVIDER_TOKEN':'PROVIDER_UNAVAILABLE',status:lastStatus};
}

async function providerToken(actor:string,role:string){
  const r=await digitalRpc('internal_provider_token',actor,role,{});
  if(!r.ok) return r;
  return {ok:true,token:String(r.provider_token||''),config:r};
}
function providerOrderId(payload:any){
  const root=payload?.data??payload?.result??payload;
  return String(root?.id??root?.order_id??root?.orderId??payload?.id??payload?.order_id??'');
}
function providerUuid(payload:any){
  const root=payload?.data??payload?.result??payload;
  return String(root?.uuid??root?.order_uuid??root?.orderUuid??payload?.uuid??payload?._request_uuid??'');
}
function providerStatus(payload:any){
  const root=payload?.data??payload?.result??payload;
  return String(root?.status??root?.state??payload?.status??payload?.state??'UNKNOWN');
}

async function syncActiveOrders(actor:string,role:string){
  const cfg=await providerToken(actor,role); if(!cfg.ok||!cfg.token) return;
  const active=await digitalRpc('internal_active_orders',actor,role,{});
  const rows=Array.isArray(active.items)?active.items:[];
  const ids=rows.map((x:any)=>String(x.provider_order_id||'')).filter(Boolean);
  if(!ids.length) return;
  const checked=await providerJson('check',cfg.token,{params:{orders:JSON.stringify(ids)},timeout:30000});
  if(!checked.ok) return;
  const root=checked.payload?.data??checked.payload?.result??checked.payload;
  const list=Array.isArray(root)?root:Array.isArray(root?.orders)?root.orders:[];
  for(const row of rows){
    const hit=list.find((x:any)=>String(x?.id??x?.order_id??x?.orderId??'')===String(row.provider_order_id));
    if(!hit) continue;
    const pstat=String(hit?.status??hit?.state??'UNKNOWN');
    await digitalRpc('internal_order_provider_update',actor,role,{
      order_id:row.id,provider_status:pstat,status:mapStatus(pstat),provider_response:hit
    });
  }
}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return response({ok:false,error:'METHOD_NOT_ALLOWED'},405);
  try{
    const body=await readBody(req);
    if(!body||typeof body!=='object')return response({ok:false,error:'INVALID_ACTION'},400);
    const action=body.action;
    if(typeof action!=='string'||(!legacyAllowed.has(action)&&!digitalAllowed.has(action)))
      return response({ok:false,error:'INVALID_ACTION'},400);
    const device=body.device_id;
    if(typeof device!=='string'||!/^[-a-zA-Z0-9]{24,80}$/.test(device))
      return response({ok:false,error:'INVALID_DEVICE'},400);

    const ip=(req.headers.get('x-forwarded-for')||'unknown').split(',').at(-1)!.trim();
    const ipLimit=await legacyRpc('rate_limit',{bucket:await sha256('ip:'+ip+':'+(action==='activate'?'activate':'requests')),limit:action==='activate'?20:200});
    if(!ipLimit.ok)return response({ok:false,error:'RATE_LIMITED'},429);

    if(action==='activate'){
      const raw=body.args?.code;
      const normalized=typeof raw==='string'?raw.replace(/[\s-]/g,'').toUpperCase():'';
      if(!/^[A-F0-9]{32,64}$/.test(normalized))return response({ok:false,error:'INVALID_CODE'},400);
      const limit=await legacyRpc('rate_limit',{bucket:await sha256('device:'+device),limit:10});
      if(!limit.ok)return response({ok:false,error:'RATE_LIMITED'},429);
      const newToken=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
      const args:any={
        device_hash:await sha256(device),
        code_hash:await sha256(normalized),
        new_token_hash:await sha256(newToken),
        device_label:typeof body.args?.device_label==='string'?body.args.device_label.slice(0,80):'Android'
      };
      let out=await legacyRpc('activate',args);
      if(!out.ok&&out.error==='INVALID_CODE'){
        const legacyHash=await sha256(normalized.toLowerCase());
        if(legacyHash!==args.code_hash){args.code_hash=legacyHash;out=await legacyRpc('activate',args);}
      }
      if(out.ok)out.session_token=newToken;
      return response(out,out.ok?200:400);
    }

    const token=req.headers.get('x-uchiha-session')||'';
    if(!/^[a-f0-9]{64}$/.test(token))return response({ok:false,error:'SESSION_REQUIRED'},401);
    const authArgs={token_hash:await sha256(token),device_hash:await sha256(device)};
    const auth=await legacyRpc('status',authArgs);
    if(!auth.ok)return response(auth,401);
    if(!auth.active)return response({ok:false,error:'LICENSE_INACTIVE'},400);
    const actor=String(auth.license_id||''), role=String(auth.role||'customer');

    if(legacyAllowed.has(action)){
      const args:Record<string,unknown>={...authArgs};
      for(const field of ['enabled','snapshot','app_version','license_id','backup_id','reason','label','phone','max_devices','expires_at','search','offset','active']){
        if(body.args&&Object.hasOwn(body.args,field))args[field]=body.args[field];
      }
      const out=await legacyRpc(action,args);
      return response(out,out.ok?200:out.error==='SESSION_REQUIRED'?401:out.error==='FORBIDDEN'?403:400);
    }

    const input=cleanObject(body.args);

    if(action==='digital_catalog'){
      const categoryId=int(input.category_id??0,0,1000000000);
      const cfg=await providerToken(actor,role); if(!cfg.ok)return response(cfg,400);
      const p=await providerJson('content/'+categoryId,cfg.token,{timeout:35000});
      if(!p.ok)return response({ok:false,error:p.status===401||p.status===403?'INVALID_PROVIDER_TOKEN':'PROVIDER_UNAVAILABLE'},400);
      const enriched=await enrichCatalogProducts(p.payload,cfg.token);
      return response({ok:true,data:enriched});
    }

    if(action==='digital_product'){
      const productId=int(input.product_id,1,1000000000);
      const cfg=await providerToken(actor,role); if(!cfg.ok)return response(cfg,400);
      const p=await providerJson('products',cfg.token,{params:{products_id:String(productId)},timeout:35000});
      if(!p.ok)return response({ok:false,error:p.status===401||p.status===403?'INVALID_PROVIDER_TOKEN':'PROVIDER_UNAVAILABLE'},400);
      const prod=unwrapProduct(p.payload); if(!prod)return response({ok:false,error:'NOT_FOUND'},404);
      return response({ok:true,product:prod,order_schema:purchaseSchema(prod)});
    }

    if(action==='digital_verify_player'){
      const productId=int(input.product_id,1,1000000000);
      const fieldKey=clampText(input.field_key,120);
      const userId=clampText(input.user_id,40).replace(/\s+/g,'');
      if(!/^[A-Za-z0-9_.-]{3,40}$/.test(userId))return response({ok:false,error:'INVALID_PLAYER_ID'},400);
      const cfg=await providerToken(actor,role); if(!cfg.ok)return response(cfg,400);
      const found=await providerJson('products',cfg.token,{params:{products_id:String(productId)},timeout:35000});
      if(!found.ok)return response({ok:false,error:found.status===401||found.status===403?'INVALID_PROVIDER_TOKEN':'PROVIDER_UNAVAILABLE'},400);
      const product=unwrapProduct(found.payload);if(!product)return response({ok:false,error:'NOT_FOUND'},404);
      const rule=playerVerification(product,productFields(product));
      if(!rule.enabled||fieldKey!==rule.field_key)return response({ok:false,error:'VERIFICATION_NOT_SUPPORTED'},400);
      const verified=await verifyPlayer(productId,userId);
      return response(verified,verified.ok?200:400);
    }

    if(action==='digital_wallet'){
      const out=await digitalRpc('digital_wallet',actor,role,{});
      return response(out,out.ok?200:400);
    }

    if(action==='digital_topup_create'){
      const amount=number(input.amount,0.0001,1000000);
      const proof=clampText(input.proof_data,3500000);
      const out=await digitalRpc(action,actor,role,{amount,proof_data:proof});
      return response(out,out.ok?200:400);
    }

    if(action==='digital_purchase'){
      const productId=int(input.product_id,1,1000000000);
      const requestedQty=int(input.quantity??1,1,1000000);
      const inputFields=cleanObject(input.fields);
      const cfg=await providerToken(actor,role); if(!cfg.ok)return response(cfg,400);
      const found=await providerJson('products',cfg.token,{params:{products_id:String(productId)},timeout:35000});
      if(!found.ok)return response({ok:false,error:found.status===401||found.status===403?'INVALID_PROVIDER_TOKEN':'PROVIDER_UNAVAILABLE'},400);
      const product=unwrapProduct(found.payload); if(!product)return response({ok:false,error:'NOT_FOUND'},404);
      const fields=cleanPurchaseFields(product,inputFields);
      const rule=qtyRule(product);
      let qty=1;
      if(rule.variable){
        qty=requestedQty;
        if(qty<rule.min||qty>rule.max||(rule.options.length&&!rule.options.includes(qty))||(!rule.options.length&&((qty-rule.min)%rule.step!==0)))
          return response({ok:false,error:'INVALID_AMOUNT'},400);
      }
      const unit=productPrice(product); if(!(unit>0))return response({ok:false,error:'INVALID_AMOUNT'},400);
      const amount=Math.round((rule.variable?unit*qty:unit)*10000)/10000;
      const begin=await digitalRpc('internal_purchase_begin',actor,role,{
        product_id:productId,product_name:String(product.name||product.title||('Product '+productId)).slice(0,250),
        amount,quantity:qty,fields
      });
      if(!begin.ok)return response(begin,400);

      const params:Record<string,string>={qty:String(qty),order_uuid:String(begin.request_uuid)};
      for(const [k,v] of Object.entries(fields)){
        if(!/^[\p{L}\p{N}_.-]{1,120}$/u.test(k))continue;
        if(v===null||v===undefined)continue;
        const s=String(v); if(s.length<=500)params[k]=s;
      }
      const sent=await providerJson('newOrder/'+productId+'/params',cfg.token,{method:'POST',params,timeout:40000});
      const pstat=providerStatus(sent.payload);
      const mapped=mapStatus(pstat);
      const definiteFailure=!sent.ok&&sent.status>=400&&sent.status<500&&![408,425,429].includes(sent.status);
      const finish=await digitalRpc('internal_purchase_finish',actor,role,{
        order_id:begin.order_id,refund:definiteFailure,
        provider_status:pstat,status:definiteFailure?'rejected':mapped,
        provider_order_id:providerOrderId(sent.payload),provider_uuid:providerUuid(sent.payload),
        provider_response:sent.payload
      });
      if(definiteFailure)return response({ok:true,outcome:'failed',status:'refunded',balance:finish.balance,order_id:begin.order_id});
      return response({ok:true,outcome:sent.ok?'submitted':'unknown',status:mapped,balance:finish.balance,order_id:begin.order_id});
    }

    if(action==='owner_digital_config_get'){
      const out=await digitalRpc(action,actor,role,{});
      return response(out,out.ok?200:403);
    }

    if(action==='owner_digital_config_set'){
      if(role!=='owner')return response({ok:false,error:'FORBIDDEN'},403);
      const providerTokenInput=normalizeProviderToken(input.provider_token);
      const out=await digitalRpc(action,actor,role,{
        provider_token:providerTokenInput,
        shamcash_account:clampText(input.shamcash_account,300),
        support_whatsapp:clampText(input.support_whatsapp,24)
      });
      if(!out.ok)return response(out,400);
      let test:any={ok:null};
      if(providerTokenInput){
        test=await testProviderToken(providerTokenInput);
      }else if(out.provider_configured){
        const cfg=await providerToken(actor,role);
        if(cfg.ok&&cfg.token)test=await testProviderToken(cfg.token);
      }
      return response({...out,provider_test:test.ok===true,provider_test_error:test.ok===true?null:(test.error||null),provider_http_status:test.status||0},200);
    }

    if(action==='owner_digital_provider_test'){
      if(role!=='owner')return response({ok:false,error:'FORBIDDEN'},403);
      const cfg=await providerToken(actor,role);
      if(!cfg.ok||!cfg.token)return response({ok:false,error:'PROVIDER_NOT_CONFIGURED'},400);
      const test=await testProviderToken(cfg.token);
      return response({ok:true,provider_test:test.ok===true,provider_test_error:test.ok===true?null:test.error,provider_http_status:test.status||0},200);
    }

    if(action==='owner_digital_wallet_adjust'){
      const out=await digitalRpc(action,actor,role,{
        license_id:clampText(input.license_id,60),amount:number(input.amount,-1000000,1000000),
        reason:clampText(input.reason,300)
      });
      return response(out,out.ok?200:400);
    }
    if(action==='owner_digital_topup_review'){
      const out=await digitalRpc(action,actor,role,{
        topup_id:clampText(input.topup_id,60),decision:clampText(input.decision,20),
        amount:number(input.amount??0,0,1000000),note:clampText(input.note,500)
      });
      return response(out,out.ok?200:400);
    }
    if(action==='owner_digital_order_update'){
      const out=await digitalRpc(action,actor,role,{
        order_id:clampText(input.order_id,60),status:clampText(input.status,30),note:clampText(input.note,500)
      });
      return response(out,out.ok?200:400);
    }
    if(['owner_digital_wallets','owner_digital_topups','owner_digital_orders'].includes(action)){
      const out=await digitalRpc(action,actor,role,{});
      return response(out,out.ok?200:403);
    }

    return response({ok:false,error:'INVALID_ACTION'},400);
  }catch(e){
    const msg=e instanceof Error?e.message:'SERVICE_UNAVAILABLE';
    const clientErrors=new Set(['INVALID_REQUEST','MISSING_FIELDS','INVALID_FIELDS']);
    return response({ok:false,error:msg==='SIZE'?'BODY_TOO_LARGE':clientErrors.has(msg)?msg:'SERVICE_UNAVAILABLE'},clientErrors.has(msg)?400:503);
  }
});
