/* Deterministic regression: no navigation jumps on idle, realtime change once. */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const assets=path.resolve(process.argv[2]||'debt-app/app/src/main/assets');
const timers=new Set();
const realSetTimeout=setTimeout;
const postCalls=[],fetches=[],cloudTx=[];
const customer={
  id:'c-remote-1',store_id:'store-1',source_key:'cloud-client:c-remote-1',
  name:'Test Customer',phone:'123456',address:null,location_type:'inside',
  created_at:'2026-09-21T10:00:00Z',pinned:false
};
let rendered=0,socketStarted=0,scrollRestored=0,modalOpen=false,focused=false;
const context={
  console,JSON,Date,Math,Map,Set,crypto:require('node:crypto').webcrypto,
  setTimeout:(callback,ms,...args)=>{
    if(ms>=1000)return {ignored:true}; // Disable timers unrelated to this explicit test.
    const t=realSetTimeout(callback,ms,...args);timers.add(t);return t;
  },
  clearTimeout:id=>{clearTimeout(id);timers.delete(id)},
  setInterval:()=>0,
  clearInterval:()=>{},
  document:{
    hidden:false,
    get activeElement(){return focused?{tagName:'INPUT'}:null;},
    querySelector:()=>modalOpen?{}:null,
    addEventListener:()=>{}
  },
  state:{
    clients:[{id:'LC1',cloudId:customer.id,remoteId:customer.id,syncKey:customer.source_key,
      name:customer.name,phone:customer.phone,address:'',area:'inside',pinned:false,debtLimit:0,maxDays:30}],
    entries:[],cloudSync:{lastSuccess:'2026-09-21T00:00:00Z'}
  },
  view:'home',sessionAccountId:'local-user',
  currentAccount:()=>({name:'Partner'}),
  saveState:()=>true,
  render:()=>{rendered++;},
  scrollY:45,scrollTo:()=>{scrollRestored++},
  addEventListener:()=>{},
};
context.window=context;
context.Android={
  cloudStatus:()=>JSON.stringify({signedIn:true,userId:'user-1'}),
  cloudRealtimeStart:()=>{socketStarted++;},
  cloudRequest:(method,url,body,requestId)=>{
    fetches.push(method+' '+url);
    const payload=body?JSON.parse(body):null;
    if(method==='POST')postCalls.push({url,payload});
    let data=[];
    if(method==='GET'&&url.startsWith('/rest/v1/store_members'))
      data=[{store_id:'store-1',user_id:'user-1',role:'partner'}];
    else if(method==='GET'&&url.startsWith('/rest/v1/customers'))data=[customer];
    else if(method==='GET'&&url.startsWith('/rest/v1/transactions'))data=cloudTx.map(x=>({...x}));
    realSetTimeout(()=>context.window.onCloudNativeResult(requestId,{ok:true,data}),0);
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(assets,'sync-v165.js'),'utf8'),context);
const tx=id=>({
  id,store_id:'store-1',source_key:'cloud-entry:'+id,customer_id:customer.id,
  kind:'purchase',original_currency:'USD',original_amount:10,usd_amount:10,
  description:'Purchase',recorded_by_name:'Partner',created_at:'2026-09-21T10:00:00.000Z',is_deleted:false
});
(async()=>{
  await context.DebtCloudSync.run();
  const firstRender=rendered;
  const firstFetches=fetches.length;
  await context.DebtCloudSync.run();
  assert.equal(rendered,firstRender,'no re-render on unchanged cloud pull');
  assert.equal(socketStarted,1,'socket must start only once for a store');
  assert.equal(fetches.filter(x=>x.startsWith('PATCH ')).length,1,'presence not rewritten on every sync');
  assert(fetches.length>firstFetches,'explicit sync still pulls for new partner data');

  cloudTx.push(tx('t2'));
  context.onCloudRealtimeEvent('change','{}');
  await new Promise(r=>realSetTimeout(r,680));
  assert.equal(context.state.entries.length,1,'native change event triggers additive sync');
  assert.equal(rendered,firstRender+1,'new partner entry causes exactly one UI refresh');
  assert(scrollRestored>0,'refresh preserves scroll position');

  const afterChange=fetches.length;
  context.onCloudRealtimeEvent('error','socket closed');
  await new Promise(r=>realSetTimeout(r,550));
  assert.equal(fetches.length,afterChange,'socket status errors must not trigger a sync loop');

  cloudTx.push(tx('t3'));modalOpen=true;
  await context.DebtCloudSync.run();
  assert.equal(rendered,firstRender+1,'open dialog is not detached by background sync');
  assert.equal(context.state.entries.length,2,'sync continues while modal is visible');
  modalOpen=false;
  cloudTx.push(tx('t4'));focused=true;
  await context.DebtCloudSync.run();
  assert.equal(rendered,firstRender+1,'typing field is not detached by background sync');
  assert.equal(postCalls.length,0,'repeated pull must not create duplicate cloud rows');
  assert.equal(socketStarted,1,'background sync never restarts healthy socket');

  for(const t of timers)clearTimeout(t);
  console.log('PASS v1.5.29: idle no-render, one realtime update, focus/modal safe, socket reuse, presence throttle');
})().catch(e=>{for(const t of timers)clearTimeout(t);console.error(e);process.exitCode=1});
