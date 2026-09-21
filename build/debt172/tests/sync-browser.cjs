// Browser-only partner sync regression. No production data is contacted.
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const assets=path.resolve(process.argv[2]||'debt-app/app/src/main/assets');
const server=http.createServer((req,res)=>{
  if(req.url==='/sync-v165.js'){
    res.setHeader('Content-Type','text/javascript');
    return res.end(fs.readFileSync(path.join(assets,'sync-v165.js')));
  }
  res.setHeader('Content-Type','text/html');
  res.end('<!doctype html><html><body><script>'+
    'window.state={clients:[{id:"C1",cloudId:"cust-1",remoteId:"cust-1",name:"عميل",phone:"123",address:"",area:"inside",debtLimit:0,maxDays:30,pinned:false}],entries:[],cloudSync:{}};'+
    'window.sessionAccountId="A1";window.currentAccount=()=>({name:"شريك"});window.render=()=>{};window.saveState=()=>true;'+
    '</script><script src="/sync-v165.js"></script></body></html>');
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,executablePath:process.env.SYNC_CHROME||undefined,args:['--no-sandbox']});
  const page=await browser.newPage();
  await page.addInitScript(()=>{
    window.cloudTx=[{
      id:'old-cloud',store_id:'store-1',customer_id:'cust-1',source_key:'cloud-entry:old-cloud',
      kind:'purchase',description:'نفس العملية',original_currency:'USD',original_amount:10,usd_amount:10,
      recorded_by_name:'شريك',created_at:'2026-09-21T10:00:00.000Z',is_deleted:false
    }];
    window.posts=[];
    window.Android={
      cloudStatus:()=>JSON.stringify({signedIn:true,userId:'user-1'}),
      cloudRealtimeStart:()=>{},
      cloudRequest:(method,p,body,id)=>{
        const send=(result)=>setTimeout(()=>window.onCloudNativeResult(id,result),0);
        const parsed=body?JSON.parse(body):null;
        if(method==='GET'&&p.startsWith('/rest/v1/store_members'))return send({ok:true,data:[{store_id:'store-1',user_id:'user-1'}]});
        if(method==='GET'&&p.startsWith('/rest/v1/customers'))return send({ok:true,data:[{id:'cust-1',store_id:'store-1',source_key:'cloud-client:cust-1',name:'عميل',phone:'123',address:null,location_type:'inside',debt_limit_usd:0,due_days:30,pinned:false,created_at:'2026-09-20T00:00:00Z'}]});
        if(method==='GET'&&p.startsWith('/rest/v1/transactions'))return send({ok:true,data:[...window.cloudTx]});
        if(method==='POST'&&p.startsWith('/rest/v1/transactions')){
          const row={...parsed,id:'posted-'+(window.posts.length+1)};
          window.posts.push(row);window.cloudTx.push(row);return send({ok:true,data:[row]});
        }
        if(method==='POST'&&p.startsWith('/rest/v1/customers'))return send({ok:true,data:[parsed]});
        if(method==='PATCH'&&p.startsWith('/rest/v1/store_members'))return send({ok:true,data:[]});
        return send({ok:true,data:[]});
      }
    };
  });
  try{
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.waitForFunction(()=>!!window.DebtCloudSync);
    const result=await page.evaluate(async()=>{
      const base={clientId:'C1',date:'2026-09-21',createdAt:'2026-09-21T10:00:00.000Z',description:'نفس العملية',originalAmount:10,originalCurrency:'USD',usdAmount:10,tryAmount:0,sypAmount:0,rateUsdTry:0,rateUsdSyp:0,paidUsd:0,remainingUsd:10,allocations:[],createdBy:'شريك',authMethod:'none'};
      state.entries.push({...base,id:'PUR-A',type:'purchase'});
      state.entries.push({...base,id:'PUR-B',type:'purchase'});
      state.entries.push({...base,id:'PAY-A',type:'payment',description:'دفعة',usdAmount:20,originalAmount:20,paidUsd:20,remainingUsd:0});
      saveState();
      const keys=state.entries.map(e=>e.syncKey);
      await DebtCloudSync.run();
      return {
        keys,
        posts:window.posts.map(x=>({kind:x.kind,source_key:x.source_key,amount:x.usd_amount})),
        entries:state.entries.map(e=>({id:e.id,type:e.type,cloudId:e.cloudId,remoteId:e.remoteId,syncKey:e.syncKey,paidUsd:e.paidUsd,remainingUsd:e.remainingUsd,allocations:e.allocations}))
      };
    });
    assert.equal(new Set(result.keys).size,3,'every newly-created local entry gets its own identity before upload');
    assert.equal(result.posts.length,3,'equal-value new purchases are not merged with existing cloud content');
    assert.equal(result.posts.filter(x=>x.kind==='purchase').length,2,'both purchases sync');
    assert.equal(result.posts.filter(x=>x.kind==='payment').length,1,'payments sync independently from purchases');
    assert(result.entries.every(e=>e.cloudId&&e.remoteId),'cloud and legacy remote IDs are both retained');
    const purchases=result.entries.filter(e=>e.type==='purchase');
    assert.equal(purchases.reduce((s,e)=>s+Number(e.remainingUsd||0),0),10,'payment is reapplied deterministically across the full ledger without deleting unrelated debt');
    const payment=result.entries.find(e=>e.type==='payment');
    assert.equal(payment.allocations.length,2,'one payment is allocated across the oldest two debt rows');
    console.log('PASS partner sync identity/payment regression');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
