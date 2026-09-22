const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const assets=path.resolve(process.argv[2]||'work-v1528/app/src/main/assets');
const source=fs.readFileSync(path.join(assets,'sync-v165.js'),'utf8');

function contextFor(state,customers,transactions,posts){
  const c={console,setTimeout,clearTimeout,setInterval:()=>0,clearInterval:()=>{},Date,Math,crypto:require('crypto').webcrypto};
  c.window=c;c.addEventListener=()=>{};
  c.document={hidden:false,activeElement:null,addEventListener:()=>{}};
  c.state=state;c.sessionAccountId='A1';c.currentAccount=()=>({name:'شريك'});c.render=()=>{};c.saveState=()=>true;
  c.Android={
    cloudStatus:()=>JSON.stringify({signedIn:true,userId:'U1'}),cloudRealtimeStart:()=>{},
    cloudRequest:(method,p,body,id)=>{
      const parsed=body?JSON.parse(body):null,send=x=>setTimeout(()=>c.onCloudNativeResult(id,x),0);
      if(method==='GET'&&p.startsWith('/rest/v1/store_members'))return send({ok:true,data:[{store_id:'S1',user_id:'U1'}]});
      if(method==='GET'&&p.startsWith('/rest/v1/customers'))return send({ok:true,data:customers});
      if(method==='GET'&&p.startsWith('/rest/v1/transactions'))return send({ok:true,data:transactions});
      if(method==='POST'&&p.startsWith('/rest/v1/customers')){posts.push(['customer',parsed]);return send({ok:true,data:[parsed]});}
      if(method==='POST'&&p.startsWith('/rest/v1/transactions')){posts.push(['tx',parsed]);return send({ok:true,data:[parsed]});}
      if(method==='PATCH'&&p.startsWith('/rest/v1/store_members'))return send({ok:true,data:[]});
      return send({ok:true,data:[]});
    }
  };
  vm.createContext(c);vm.runInContext(source,c);return c;
}

async function testCurrencyIsolation(){
  const client={id:'CLOUD-C1',store_id:'S1',source_key:'cloud-client:CLOUD-C1',name:'عميل',phone:'1',location_type:'inside',created_at:'2026-09-20T00:00:00Z'};
  const rows=[
    {id:'T1',store_id:'S1',customer_id:'CLOUD-C1',source_key:'entry:T1',kind:'purchase',description:'USD buy',original_currency:'USD',original_amount:10,usd_amount:10,rate_usd_try:40,paid_from_row_usd:0,remaining_usd:10,recorded_by_name:'شريك',created_at:'2026-09-21T10:00:00Z',is_deleted:false},
    {id:'T2',store_id:'S1',customer_id:'CLOUD-C1',source_key:'entry:T2',kind:'purchase',description:'TRY buy',original_currency:'TRY',original_amount:400,usd_amount:10,rate_usd_try:40,paid_from_row_usd:0,remaining_usd:10,recorded_by_name:'شريك',created_at:'2026-09-21T10:01:00Z',is_deleted:false},
    {id:'T3',store_id:'S1',customer_id:'CLOUD-C1',source_key:'entry:T3',kind:'payment',description:'دفعة',original_currency:'TRY',original_amount:400,usd_amount:10,rate_usd_try:40,paid_from_row_usd:10,remaining_usd:0,recorded_by_name:'شريك',created_at:'2026-09-21T10:02:00Z',is_deleted:false}
  ];
  const state={clients:[{id:'LC1',cloudId:'CLOUD-C1',remoteId:'CLOUD-C1',syncKey:'cloud-client:CLOUD-C1',name:'عميل',phone:'1',area:'inside'}],entries:rows.map((r,i)=>({id:'L'+(i+1),cloudId:r.id,remoteId:r.id,syncKey:r.source_key,clientId:'LC1',type:r.kind==='payment'?'payment':'purchase',date:r.created_at.slice(0,10),createdAt:r.created_at,description:r.description,originalAmount:r.original_amount,originalCurrency:r.original_currency,usdAmount:r.usd_amount,rateUsdTry:40,paidUsd:r.paid_from_row_usd,remainingUsd:r.remaining_usd,allocations:[],createdBy:'شريك'})),cloudSync:{lastSuccess:'x'}};
  const posts=[],c=contextFor(state,[client],rows,posts);await c.DebtCloudSync.run();
  const usd=c.state.entries.find(e=>e.cloudId==='T1'),tr=c.state.entries.find(e=>e.cloudId==='T2'),pay=c.state.entries.find(e=>e.cloudId==='T3');
  assert.equal(usd.remainingUsd,10,'TRY payment must not settle USD debt');
  assert.equal(tr.remainingUsd,0,'TRY payment must settle TRY debt');
  assert.equal(pay.allocations.length,1);assert.equal(pay.allocations[0].entryId,tr.id);
  assert.equal(posts.length,0,'existing cloud rows must not be reposted');
}

async function testRestoredLegacyReconciliation(){
  const customers=[{id:'CLOUD-C2',store_id:'S1',source_key:'cloud-client:CLOUD-C2',name:'قديم',phone:'999',address:'',location_type:'inside',created_at:'2026-09-20T00:00:00Z'}];
  const rows=[{id:'TC2',store_id:'S1',customer_id:'CLOUD-C2',source_key:'cloud-entry:TC2',kind:'purchase',description:'قديم',original_currency:'TRY',original_amount:80,usd_amount:2,rate_usd_try:40,paid_from_row_usd:0,remaining_usd:2,recorded_by_name:'شريك',created_at:'2026-09-21T12:00:00Z',is_deleted:false}];
  const state={
    clients:[{id:'REST-C',restoreLegacy:true,name:'قديم',phone:'999',address:'',area:'inside',createdBy:'شريك'}],
    entries:[{id:'REST-E',restoreLegacy:true,clientId:'REST-C',type:'purchase',date:'2026-09-21',createdAt:'2026-09-21T12:00:00Z',description:'قديم',originalAmount:80,originalCurrency:'TRY',usdAmount:2,rateUsdTry:40,paidUsd:0,remainingUsd:2,allocations:[],createdBy:'شريك'}],
    cloudSync:{lastSuccess:'x'}
  };
  const posts=[],c=contextFor(state,customers,rows,posts);await c.DebtCloudSync.run();
  const lc=c.state.clients[0],le=c.state.entries[0];
  assert.equal(lc.cloudId,'CLOUD-C2');assert.equal(lc.restoreLegacy,undefined);
  assert.equal(le.cloudId,'TC2');assert.equal(le.restoreLegacy,undefined);
  assert.equal(posts.length,0,'old backup rows that match cloud history must not be duplicated');
}

(async()=>{await testCurrencyIsolation();await testRestoredLegacyReconciliation();console.log('PASS v1.5.28 currency isolation + restore reconciliation');})()
  .catch(e=>{console.error(e);process.exitCode=1});
