// No external dependencies, secrets in responses, user JWT assumptions, or request logging.
// Custom high-entropy session authentication is enforced by the server-only RPC.
const allowed = new Set(['activate','status','consent','backup','backups','download',
  'owner_create','owner_list','owner_backups','owner_download','owner_set_active','owner_reset_device','owner_audit']);
const MAX_BODY=6*1024*1024;
const utf8=new TextEncoder();
async function sha256(s:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(s)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
function secretKey(){const keys=Deno.env.get('SUPABASE_SECRET_KEYS');return keys?JSON.parse(keys).default:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');}
function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
async function readBody(req:Request){
  if(Number(req.headers.get('content-length')||0)>MAX_BODY)throw new Error('SIZE');
  const reader=req.body?.getReader();if(!reader)throw new Error('BODY');
  const parts:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BODY){await reader.cancel();throw new Error('SIZE');}parts.push(value);}
  const all=new Uint8Array(size);let pos=0;for(const p of parts){all.set(p,pos);pos+=p.length;}
  return JSON.parse(new TextDecoder().decode(all));
}
async function rpc(action:string,args:Record<string,unknown>){
  const key=secretKey();if(!key)throw new Error('CONFIG');
  const headers:Record<string,string>={'Content-Type':'application/json','apikey':key};
  // Legacy JWT backend keys require Bearer; modern secret keys must stay in apikey.
  if(!key.startsWith('sb_secret_'))headers.Authorization='Bearer '+key;
  const res=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/debt_service_dispatch',{
    method:'POST',headers,body:JSON.stringify({p_action:action,p_args:args}),signal:AbortSignal.timeout(25000)});
  if(!res.ok)throw new Error('DATABASE');return await res.json();
}
Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return response({ok:false,error:'METHOD_NOT_ALLOWED'},405);
  try{
    const body=await readBody(req);
    if(!body||typeof body!=='object'||!allowed.has(body.action))return response({ok:false,error:'INVALID_ACTION'},400);
    const device=body.device_id;
    if(typeof device!=='string'||!/^[-a-zA-Z0-9]{24,80}$/.test(device))return response({ok:false,error:'INVALID_DEVICE'},400);
    const ip=(req.headers.get('x-forwarded-for')||'unknown').split(',').at(-1)!.trim();
    const action=body.action;
    const ipLimit=await rpc('rate_limit',{bucket:await sha256('ip:'+ip+':'+(action==='activate'?'activate':'requests')),limit:action==='activate'?20:200});
    if(!ipLimit.ok)return response({ok:false,error:'RATE_LIMITED'},429);
    const args:Record<string,unknown>={};
    // Explicit allowlist: caller cannot inject role, owner ID, token hashes, or SQL action.
    for(const field of ['enabled','snapshot','app_version','license_id','backup_id','reason','label','phone','max_devices','expires_at','search','offset','active']){
      if(body.args&&Object.hasOwn(body.args,field))args[field]=body.args[field];
    }
    args.device_hash=await sha256(device);
    let newToken='';
    if(action==='activate'){
      const raw=body.args?.code;
      const normalized=typeof raw==='string'?raw.replace(/[\s-]/g,'').toUpperCase():'';
      if(!/^[A-F0-9]{32,64}$/.test(normalized))return response({ok:false,error:'INVALID_CODE'},400);
      const limit=await rpc('rate_limit',{bucket:await sha256('device:'+device),limit:10});
      if(!limit.ok)return response({ok:false,error:'RATE_LIMITED'},429);
      newToken=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
      // Hex activation codes are case-insensitive. Customer codes were always
      // stored from their uppercase form, while the first owner seed predates
      // that convention and was hashed from lowercase text. Try the canonical
      // customer hash first, then the legacy lowercase hash without exposing
      // either hash to the client. The first attempt is read-only on a miss.
      args.code_hash=await sha256(normalized);args.new_token_hash=await sha256(newToken);
      args.device_label=typeof body.args?.device_label==='string'?body.args.device_label.slice(0,80):'Android';
    }else{
      const token=req.headers.get('x-uchiha-session')||'';
      if(!/^[a-f0-9]{64}$/.test(token))return response({ok:false,error:'SESSION_REQUIRED'},401);
      args.token_hash=await sha256(token);
    }
    let out=await rpc(action,args);
    if(action==='activate' && !out.ok && out.error==='INVALID_CODE'){
      const normalized=typeof body.args?.code==='string'?body.args.code.replace(/[\s-]/g,'').toUpperCase():'';
      const legacyHash=await sha256(normalized.toLowerCase());
      if(legacyHash!==args.code_hash){
        args.code_hash=legacyHash;
        out=await rpc(action,args);
      }
    }
    if(out.ok&&newToken)out.session_token=newToken;
    return response(out,out.ok?200:out.error==='SESSION_REQUIRED'?401:out.error==='FORBIDDEN'?403:400);
  }catch(e){return response({ok:false,error:e instanceof Error&&e.message==='SIZE'?'BODY_TOO_LARGE':'SERVICE_UNAVAILABLE'},503);}
});
