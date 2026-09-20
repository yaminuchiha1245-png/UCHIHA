/* UCHIHA Debt Store v1.5.15 — additive two-way ledger sync, no destructive replacement. */
(function(){'use strict';
const SYNC_VERSION='1.5.15';
const pending=new Map();
let seq=0,running=false,rerun=false,timer=null,applying=false,initialised=false;
const priorNative=window.onCloudNativeResult;
const priorRealtime=window.onCloudRealtimeEvent;

function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function txt(v){return String(v??'').trim();}
function norm(v){return txt(v).toLowerCase().replace(/\s+/g,' ');}
function phone(v){return txt(v).replace(/\D+/g,'');}
function kindLocalToCloud(t){return t==='opening'?'opening_balance':t==='payment'?'payment':'purchase';}
function kindCloudToLocal(t){return t==='opening_balance'?'opening':t==='payment'?'payment':'purchase';}
function sameNum(a,b){return Math.abs(n(a)-n(b))<0.0001;}
function ts(v){const x=Date.parse(v||'');return Number.isFinite(x)?x:0;}
function sourceKey(prefix,id){return prefix+':'+txt(id||('legacy-'+Date.now()+'-'+Math.random().toString(36).slice(2)));}
function clientHash(c){return JSON.stringify([txt(c.name),txt(c.phone),txt(c.address),txt(c.area),n(c.debtLimit),n(c.maxDays),!!c.pinned]);}
function hasTypingFocus(){const a=document.activeElement;return !!a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);}

function nativeStatus(){
  try{return JSON.parse(window.Android?.cloudStatus?.()||'{}');}catch(_e){return {};}
}
function cloud(method,path,body){
  return new Promise(resolve=>{
    if(!window.Android?.cloudRequest){resolve({ok:false,error:'NATIVE_REQUIRED'});return;}
    const id='S'+Date.now()+'-'+(++seq);
    const timeout=setTimeout(()=>{pending.delete(id);resolve({ok:false,error:'TIMEOUT'});},30000);
    pending.set(id,{resolve,timeout});
    try{Android.cloudRequest(method,path,body==null?'':JSON.stringify(body),id);}
    catch(_e){clearTimeout(timeout);pending.delete(id);resolve({ok:false,error:'BRIDGE_FAILED'});}
  });
}
window.onCloudNativeResult=function(id,result){
  const p=pending.get(id);
  if(p){clearTimeout(p.timeout);pending.delete(id);p.resolve(result||{ok:false});return;}
  if(typeof priorNative==='function')try{priorNative(id,result);}catch(_e){}
};

async function getAll(path, pageSize=500){
  const out=[];
  for(let offset=0;offset<100000;offset+=pageSize){
    const sep=path.includes('?')?'&':'?';
    const r=await cloud('GET',path+sep+'limit='+pageSize+'&offset='+offset,null);
    if(!r.ok)throw new Error('GET_'+(r.status||r.error||'FAILED'));
    const rows=Array.isArray(r.data)?r.data:[];
    out.push(...rows);
    if(rows.length<pageSize)break;
  }
  return out;
}
function firstRow(result){
  if(Array.isArray(result?.data))return result.data[0]||null;
  return result?.data&&typeof result.data==='object'?result.data:null;
}
function localClientByCloudId(id){return (state.clients||[]).find(c=>c.cloudId===id)||null;}
function findLocalClientForCloud(row, used){
  let c=localClientByCloudId(row.id);
  if(c&&!used.has(c.id))return c;
  if(row.source_key){
    c=(state.clients||[]).find(x=>x.syncKey===row.source_key&&!used.has(x.id));
    if(c)return c;
  }
  const rp=phone(row.phone);
  if(rp){
    c=(state.clients||[]).find(x=>phone(x.phone)===rp&&!used.has(x.id));
    if(c)return c;
  }
  const rn=norm(row.name),ra=norm(row.address);
  return (state.clients||[]).find(x=>norm(x.name)===rn&&(!ra||!norm(x.address)||norm(x.address)===ra)&&!used.has(x.id))||null;
}
function cloudCustomerPayload(storeId,userId,c){
  return {
    store_id:storeId,
    source_key:c.syncKey||sourceKey('client',c.id),
    name:txt(c.name)||'عميل',
    phone:txt(c.phone)||null,
    address:txt(c.address)||null,
    location_type:c.area==='outside'?'outside':'inside',
    debt_limit_usd:n(c.debtLimit)||null,
    due_days:Math.max(0,Math.round(n(c.maxDays)))||30,
    pinned:!!c.pinned,
    created_by:userId||null,
    created_by_name:txt(c.createdBy||currentAccount()?.name)||null,
    is_deleted:false
  };
}
function txFingerprintLocal(e,clientCloudId){
  return [clientCloudId,kindLocalToCloud(e.type),txt(e.originalCurrency).toUpperCase(),n(e.originalAmount).toFixed(4),norm(e.description),norm(e.createdBy)].join('|');
}
function txFingerprintCloud(r){
  return [r.customer_id,txt(r.kind),txt(r.original_currency).toUpperCase(),n(r.original_amount).toFixed(4),norm(r.description),norm(r.recorded_by_name)].join('|');
}
function bestCloudTx(e,clientCloudId,rows,used){
  if(e.cloudId){
    const direct=rows.find(r=>r.id===e.cloudId&&!used.has(r.id));if(direct)return direct;
  }
  if(e.syncKey){
    const direct=rows.find(r=>r.source_key===e.syncKey&&!used.has(r.id));if(direct)return direct;
  }
  const fp=txFingerprintLocal(e,clientCloudId);
  const candidates=rows.filter(r=>!used.has(r.id)&&txFingerprintCloud(r)===fp);
  if(!candidates.length)return null;
  const lt=ts(e.createdAt||e.date);
  candidates.sort((a,b)=>Math.abs(ts(a.created_at)-lt)-Math.abs(ts(b.created_at)-lt));
  if(!lt)return candidates[0];
  const d=Math.abs(ts(candidates[0].created_at)-lt);
  return d<=86400000?candidates[0]:null;
}
function txPayload(storeId,userId,e,customerCloudId){
  const rateTry=n(e.rateUsdTry),rateSyp=n(e.rateUsdSyp),usd=n(e.usdAmount);
  let rateToUsd=null;
  if(e.originalCurrency==='TRY'&&rateTry>0)rateToUsd=1/rateTry;
  else if(e.originalCurrency==='SYP'&&rateSyp>0)rateToUsd=1/rateSyp;
  else if(e.originalCurrency==='USD')rateToUsd=1;
  return {
    store_id:storeId,
    customer_id:customerCloudId,
    source_key:e.syncKey||sourceKey('entry',e.id),
    kind:kindLocalToCloud(e.type),
    description:txt(e.description)||null,
    original_currency:txt(e.originalCurrency||'USD').toUpperCase(),
    original_amount:n(e.originalAmount),
    usd_amount:usd,
    rate_to_usd:rateToUsd,
    paid_from_row_usd:e.type==='payment'?usd:n(e.paidUsd),
    remaining_usd:e.type==='payment'?0:n(e.remainingUsd),
    recorded_by:userId||null,
    recorded_by_name:txt(e.createdBy||currentAccount()?.name)||null,
    rate_usd_try:rateTry||null,
    rate_usd_syp:rateSyp||null,
    auth_method:txt(e.authMethod)||null,
    created_at:e.createdAt||new Date().toISOString(),
    updated_at:new Date().toISOString(),
    is_deleted:false
  };
}
function cloudRowToLocal(row,localClientId){
  const usd=n(row.usd_amount),rt=n(row.rate_usd_try),rs=n(row.rate_usd_syp);
  return {
    id:'CLD-'+String(row.id).replace(/-/g,'').slice(0,20).toUpperCase(),
    cloudId:row.id,
    syncKey:row.source_key||('cloud-entry:'+row.id),
    clientId:localClientId,
    type:kindCloudToLocal(row.kind),
    date:txt(row.created_at).slice(0,10),
    createdAt:row.created_at||new Date().toISOString(),
    description:row.description|| (row.kind==='payment'?'دفعة':'شراء'),
    originalAmount:n(row.original_amount),
    originalCurrency:txt(row.original_currency||'USD').toUpperCase(),
    usdAmount:usd,
    tryAmount:rt>0?usd*rt:(row.original_currency==='TRY'?n(row.original_amount):0),
    sypAmount:rs>0?usd*rs:(row.original_currency==='SYP'?n(row.original_amount):0),
    rateUsdTry:rt,
    rateUsdSyp:rs,
    paidUsd:row.kind==='payment'?usd:n(row.paid_from_row_usd),
    remainingUsd:row.kind==='payment'?0:n(row.remaining_usd),
    allocations:[],
    createdBy:row.recorded_by_name||'شريك',
    authMethod:row.auth_method||'cloud'
  };
}
function rebuildLedger(){
  const all=state.entries||[];
  for(const e of all){
    if(e.type==='purchase'||e.type==='opening'){
      e.paidUsd=0;e.remainingUsd=n(e.usdAmount);e.allocations=[];delete e.settledAt;
    }else if(e.type==='payment'){e.paidUsd=n(e.usdAmount);e.remainingUsd=0;e.allocations=[];}
  }
  const byClient=new Map();
  for(const e of all){
    if(!byClient.has(e.clientId))byClient.set(e.clientId,[]);
    byClient.get(e.clientId).push(e);
  }
  for(const rows of byClient.values()){
    rows.sort((a,b)=>(ts(a.createdAt||a.date)-ts(b.createdAt||b.date))||String(a.id).localeCompare(String(b.id)));
    const open=[];
    for(const e of rows){
      if(e.type==='purchase'||e.type==='opening'){open.push(e);continue;}
      if(e.type!=='payment')continue;
      let left=n(e.usdAmount);
      for(const d of open){
        if(left<=0.005)break;
        const remain=n(d.remainingUsd);if(remain<=0.005)continue;
        const take=Math.min(left,remain);
        d.paidUsd=n(d.paidUsd)+take;
        d.remainingUsd=Math.max(0,remain-take);
        if(d.remainingUsd<=0.005){d.remainingUsd=0;d.settledAt=e.createdAt||new Date().toISOString();}
        e.allocations.push({entryId:d.id,usd:take});
        left-=take;
      }
    }
  }
}
function safePersist(){
  applying=true;
  try{
    if(!state.cloudSync)state.cloudSync={};
    state.cloudSync.version=SYNC_VERSION;
    state.cloudSync.lastSuccess=new Date().toISOString();
    state.cloudSync.lastError='';
    saveState();
  }finally{applying=false;}
}
function maybeRender(){
  if(hasTypingFocus())return;
  try{if(sessionAccountId&&typeof render==='function')render();}catch(_e){}
}

async function resolveMembership(status){
  const userId=txt(status.userId);if(!userId)return null;
  const rows=await getAll('/rest/v1/store_members?select=*&user_id=eq.'+encodeURIComponent(userId),200);
  if(!rows.length)return null;
  const preferred=txt(state.cloudSync?.storeId||state.cloud?.storeId);
  const row=rows.find(x=>x.store_id===preferred)||rows[0];
  return {userId,member:row,storeId:row.store_id};
}
async function syncCustomers(storeId,userId,cloudRows){
  const usedLocal=new Set();
  for(const row of cloudRows){
    let c=findLocalClientForCloud(row,usedLocal);
    if(!c){
      c={
        id:'CLD-'+String(row.id).replace(/-/g,'').slice(0,20).toUpperCase(),
        cloudId:row.id,
        syncKey:row.source_key||('cloud-client:'+row.id),
        name:row.name||'عميل',
        phone:row.phone||'',
        address:row.address||'',
        area:row.location_type==='outside'?'outside':'inside',
        debtLimit:n(row.debt_limit_usd),
        maxDays:n(row.due_days)||30,
        notes:'',
        pinned:!!row.pinned,
        createdAt:row.created_at||new Date().toISOString(),
        createdBy:row.created_by_name||'شريك'
      };
      state.clients.push(c);
    }else{
      c.cloudId=row.id;
      c.syncKey=row.source_key||c.syncKey||('cloud-client:'+row.id);
      c.pinned=!!c.pinned||!!row.pinned;
      if(!txt(c.phone)&&row.phone)c.phone=row.phone;
      if(!txt(c.address)&&row.address)c.address=row.address;
    }
    usedLocal.add(c.id);
  }

  for(const c of state.clients||[]){
    if(c.cloudId)continue;
    const payload=cloudCustomerPayload(storeId,userId,c);
    c.syncKey=payload.source_key;
    const r=await cloud('POST','/rest/v1/customers?on_conflict=store_id,source_key',payload);
    if(r.ok){
      const row=firstRow(r);if(row){c.cloudId=row.id;c.syncKey=row.source_key||c.syncKey;}
    }
  }
  const map=new Map();
  for(const c of state.clients||[])if(c.cloudId)map.set(c.cloudId,c.id);
  return map;
}
async function syncTransactions(storeId,userId,cloudRows,clientMap){
  const usedCloud=new Set();
  for(const e of state.entries||[]){
    const c=(state.clients||[]).find(x=>x.id===e.clientId);
    if(!c?.cloudId)continue;
    const row=bestCloudTx(e,c.cloudId,cloudRows,usedCloud);
    if(row){
      usedCloud.add(row.id);e.cloudId=row.id;e.syncKey=row.source_key||e.syncKey||('cloud-entry:'+row.id);
    }
  }

  for(const row of cloudRows){
    if(usedCloud.has(row.id))continue;
    const localClientId=clientMap.get(row.customer_id);
    if(!localClientId)continue;
    const existing=(state.entries||[]).find(e=>e.cloudId===row.id);
    if(existing){usedCloud.add(row.id);continue;}
    state.entries.push(cloudRowToLocal(row,localClientId));
    usedCloud.add(row.id);
  }

  for(const e of state.entries||[]){
    if(e.cloudId)continue;
    const c=(state.clients||[]).find(x=>x.id===e.clientId);
    if(!c?.cloudId)continue;
    const payload=txPayload(storeId,userId,e,c.cloudId);
    e.syncKey=payload.source_key;
    const r=await cloud('POST','/rest/v1/transactions?on_conflict=store_id,source_key',payload);
    if(r.ok){
      const row=firstRow(r);if(row){e.cloudId=row.id;e.syncKey=row.source_key||e.syncKey;}
    }
  }
}
async function touchMember(storeId,userId){
  const body={last_seen_at:new Date().toISOString(),app_version:SYNC_VERSION};
  await cloud('PATCH','/rest/v1/store_members?store_id=eq.'+encodeURIComponent(storeId)+'&user_id=eq.'+encodeURIComponent(userId),body);
}
async function run(){
  if(running){rerun=true;return;}
  const status=nativeStatus();
  if(!status.signedIn||!status.userId)return;
  running=true;rerun=false;
  try{
    if(!state.cloudSync)state.cloudSync={};
    const membership=await resolveMembership(status);
    if(!membership)return;
    const {storeId,userId}=membership;
    state.cloudSync.storeId=storeId;state.cloudSync.userId=userId;state.cloudSync.linked=true;
    const [customers,transactions]=await Promise.all([
      getAll('/rest/v1/customers?select=*&store_id=eq.'+encodeURIComponent(storeId)+'&is_deleted=eq.false&order=created_at.asc',500),
      getAll('/rest/v1/transactions?select=*&store_id=eq.'+encodeURIComponent(storeId)+'&is_deleted=eq.false&order=created_at.asc',500)
    ]);
    const clientMap=await syncCustomers(storeId,userId,customers);
    await syncTransactions(storeId,userId,transactions,clientMap);
    rebuildLedger();
    await touchMember(storeId,userId);
    safePersist();
    try{Android.cloudRealtimeStart(storeId);}catch(_e){}
    maybeRender();
  }catch(e){
    try{
      if(!state.cloudSync)state.cloudSync={};
      state.cloudSync.lastError=String(e&&e.message||e);
      applying=true;saveState();
    }catch(_e){}finally{applying=false;}
  }finally{
    running=false;
    if(rerun)schedule(1000);
  }
}
function schedule(delay=700){
  clearTimeout(timer);
  timer=setTimeout(run,Math.max(100,delay));
}
window.DebtCloudSync={run:()=>run(),schedule};

window.onCloudRealtimeEvent=function(type,payload){
  if(typeof priorRealtime==='function')try{priorRealtime(type,payload);}catch(_e){}
  if(type==='postgres_changes'||type==='system'||type==='phx_reply'||type==='error')schedule(type==='postgres_changes'?250:1500);
};

const originalSave=saveState;
saveState=function(){
  const result=originalSave.apply(this,arguments);
  if(!applying&&initialised)schedule(900);
  return result;
};
initialised=true;
window.addEventListener('online',()=>schedule(300));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule(300);});
setInterval(()=>{if(!document.hidden)schedule(0);},180000);
setTimeout(()=>schedule(0),1800);
})();