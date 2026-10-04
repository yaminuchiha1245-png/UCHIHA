const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const assets=path.resolve(process.argv[2]||'debt-app/app/src/main/assets');
const syncJs=fs.readFileSync(path.join(assets,'sync-v165.js'),'utf8');

const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type',req.url==='/sync-v165.js'?'text/javascript':'text/html');
  if(req.url==='/sync-v165.js')return res.end(syncJs);
  res.end('<!doctype html><html><body><script src="/sync-v165.js"></script></body></html>');
});

const customer={id:'cust-1',store_id:'store-1',source_key:'client:cust-1',name:'عميل',phone:'123',address:null,location_type:'inside',debt_limit_usd:0,due_days:30,pinned:false,created_at:'2026-10-01T00:00:00.000Z'};
function row(id,key,amount,created='2026-10-01T10:00:00.000Z'){
  return {id,store_id:'store-1',customer_id:'cust-1',source_key:key,kind:'purchase',description:'شراء',
    original_currency:'TRY',original_amount:amount,usd_amount:amount/50,rate_usd_try:50,rate_usd_syp:null,
    paid_from_row_usd:0,remaining_usd:amount/50,recorded_by:'owner-user',recorded_by_name:'عقل',
    auth_method:'none',created_at:created,updated_at:created,is_deleted:false};
}
const canonicalA=row('tx-a','entry:PUR-A',100);
const echoA=row('tx-a-echo','cloud-entry:tx-a-echo',100);
const canonicalB=row('tx-b','entry:PUR-B',200,'2026-10-01T11:00:00.000Z');

function localFromCloud(r,idOverride){
  return {id:idOverride||('L-'+r.id),cloudId:r.id,remoteId:r.id,syncKey:r.source_key,clientId:'C1',type:'purchase',
    date:r.created_at.slice(0,10),createdAt:r.created_at,description:r.description,originalAmount:r.original_amount,
    originalCurrency:r.original_currency,usdAmount:r.usd_amount,tryAmount:r.original_amount,sypAmount:0,
    rateUsdTry:50,rateUsdSyp:0,paidUsd:0,remainingUsd:r.usd_amount,allocations:[],createdBy:r.recorded_by_name,authMethod:'none'};
}
function unsyncedC(){
  return {id:'PUR-LOCAL-C',remoteId:'tx-c',syncKey:'entry:tx-c',clientId:'C1',type:'purchase',date:'2026-10-01',
    createdAt:'2026-10-01T12:00:00.000Z',description:'شراء',originalAmount:300,originalCurrency:'TRY',
    usdAmount:6,tryAmount:300,sypAmount:0,rateUsdTry:50,rateUsdSyp:0,paidUsd:0,remainingUsd:6,
    allocations:[],createdBy:'عقل',authMethod:'none'};
}
function stale(id){
  return {id:'STALE-'+id,cloudId:id,remoteId:id,syncKey:'entry:'+id,clientId:'C1',type:'purchase',date:'2026-09-01',
    createdAt:'2026-09-01T10:00:00.000Z',description:'قديم',originalAmount:999,originalCurrency:'TRY',
    usdAmount:19.98,tryAmount:999,sypAmount:0,rateUsdTry:50,rateUsdSyp:0,paidUsd:0,remainingUsd:19.98,
    allocations:[],createdBy:'عقل',authMethod:'none'};
}

async function runDevice(browser,localEntries,initialRows,userId){
  const page=await browser.newPage();
  await page.addInitScript(({entries,rows,userId,customer})=>{
    window.serverRows=rows;
    window.state={
      clients:[{id:'C1',cloudId:'cust-1',remoteId:'cust-1',syncKey:'client:cust-1',name:'عميل',phone:'123',address:'',area:'inside',debtLimit:0,maxDays:30,pinned:false}],
      entries,cloudSync:{storeId:'store-1',lastSuccess:'2026-10-01T00:00:00Z'},
      cloud:{pending:[],online:true,lastSyncAt:''}
    };
    window.view='home';window.sessionAccountId='ACC1';window.currentAccount=()=>({name:userId==='owner-user'?'عقل':'محمود'});
    window.saveState=()=>true;window.render=()=>{};window.scrollY=0;window.scrollTo=()=>{};window.flushCloudQueue=async()=>true;
    window.Android={
      cloudStatus:()=>JSON.stringify({signedIn:true,userId}),
      cloudRealtimeStart:()=>{},
      cloudRequest:(method,url,body,requestId)=>{
        const send=data=>setTimeout(()=>window.onCloudNativeResult(requestId,data),0);
        const payload=body?JSON.parse(body):null;
        if(method==='GET'&&url.startsWith('/rest/v1/store_members'))return send({ok:true,data:[{store_id:'store-1',user_id:userId,role:userId==='owner-user'?'owner':'partner'}]});
        if(method==='GET'&&url.startsWith('/rest/v1/customers'))return send({ok:true,data:[customer]});
        if(method==='GET'&&url.startsWith('/rest/v1/transactions'))return send({ok:true,data:window.serverRows.filter(x=>!x.is_deleted)});
        if(method==='POST'&&url.startsWith('/rest/v1/customers'))return send({ok:true,data:[payload]});
        if(method==='POST'&&url.startsWith('/rest/v1/transactions')){
          const idx=window.serverRows.findIndex(x=>x.store_id===payload.store_id&&x.source_key===payload.source_key);
          if(idx<0)window.serverRows.push({...payload,is_deleted:false});
          const row=idx>=0?window.serverRows[idx]:window.serverRows[window.serverRows.length-1];
          return send({ok:true,data:[row]});
        }
        if(method==='PATCH')return send({ok:true,data:[]});
        return send({ok:true,data:[]});
      }
    };
  },{entries:localEntries,rows:initialRows,userId,customer});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>!!window.DebtCloudSync);
  const out=await page.evaluate(async()=>{
    await DebtCloudSync.run();
    await new Promise(r=>setTimeout(r,30));
    return {
      entries:state.entries.map(e=>({cloudId:e.cloudId||'',syncKey:e.syncKey,amount:e.originalAmount})).sort((a,b)=>a.syncKey.localeCompare(b.syncKey)),
      serverRows:window.serverRows,
      cloudCount:state.cloudSync.authoritativeCloudCount,
      pendingCount:state.cloudSync.pendingLocalCount,
      echoesIgnored:state.cloudSync.echoesIgnored
    };
  });
  await page.close();return out;
}

(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,executablePath:process.env.SYNC_CHROME||undefined,args:['--no-sandbox']});
  try{
    const initial=[canonicalA,echoA,canonicalB];
    const owner=await runDevice(browser,[localFromCloud(canonicalA),stale('ghost-owner'),unsyncedC()],initial,'owner-user');
    assert.deepEqual(owner.entries.map(x=>x.syncKey),['entry:PUR-A','entry:PUR-B','entry:tx-c'],'owner must converge to cloud + newly uploaded row only');
    assert.equal(owner.echoesIgnored,1,'legacy cloud-entry echo must be ignored');
    assert.equal(owner.pendingCount,0,'new local row must be confirmed by final snapshot');
    assert(!owner.entries.some(x=>x.cloudId==='ghost-owner'),'stale synced owner row must be removed');

    const partner=await runDevice(browser,[localFromCloud(canonicalB),stale('ghost-partner')],owner.serverRows,'partner-user');
    assert.deepEqual(partner.entries,owner.entries,'owner and partner must finish with identical authoritative ledger');
    assert(!partner.entries.some(x=>x.cloudId==='ghost-partner'),'stale synced partner row must be removed');
    console.log('PASS v1.5.32 authoritative owner/partner ledger convergence');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
