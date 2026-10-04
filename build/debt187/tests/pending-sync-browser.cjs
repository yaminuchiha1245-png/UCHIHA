// Regression for v1.5.31 stale legacy pending cleanup. No production data is contacted.
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
    'window.state={clients:[{id:"C1",cloudId:"cust-1",remoteId:"cust-1",syncKey:"cloud-client:cust-1",name:"عميل",phone:"123",address:"",area:"inside",debtLimit:0,maxDays:30,pinned:false}],entries:[{id:"PUR-1",remoteId:"tx-local-1",syncKey:"entry:tx-local-1",clientId:"C1",type:"purchase",date:"2026-10-04",createdAt:"2026-10-04T08:00:00Z",description:"شراء",originalAmount:100,originalCurrency:"TRY",usdAmount:2,tryAmount:100,sypAmount:0,rateUsdTry:50,rateUsdSyp:0,paidUsd:0,remainingUsd:2,allocations:[],createdBy:"عقل",authMethod:"none"}],cloudSync:{},cloud:{pending:[{id:"OLD1",method:"POST",path:"/rest/v1/transactions?on_conflict=id",body:{id:"tx-local-1",source_key:"entry:tx-local-1"}},{id:"OLD2",method:"PATCH",path:"/rest/v1/stores?id=eq.store-1",body:{name:"ماركت النصر"}}],online:false,lastSyncAt:""}};'+
    'window.sessionAccountId="A1";window.currentAccount=()=>({name:"عقل"});window.render=()=>{};window.saveState=()=>true;'+
    'window.flushCloudQueue=async()=>{window.flushedLegacy=(state.cloud.pending||[]).map(x=>x.method+":"+x.path);state.cloud.pending=[];return true;};'+
    '</script><script src="/sync-v165.js"></script></body></html>');
});

(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,executablePath:process.env.SYNC_CHROME||undefined,args:['--no-sandbox']});
  const page=await browser.newPage();
  await page.addInitScript(()=>{
    window.posts=[];
    window.Android={
      cloudStatus:()=>JSON.stringify({signedIn:true,userId:'owner-user'}),
      cloudRealtimeStart:()=>{},
      cloudRequest:(method,p,body,id)=>{
        const send=result=>setTimeout(()=>window.onCloudNativeResult(id,result),0);
        const parsed=body?JSON.parse(body):null;
        if(method==='GET'&&p.startsWith('/rest/v1/store_members'))return send({ok:true,data:[{store_id:'store-1',user_id:'owner-user'}]});
        if(method==='GET'&&p.startsWith('/rest/v1/customers'))return send({ok:true,data:[{id:'cust-1',store_id:'store-1',source_key:'cloud-client:cust-1',name:'عميل',phone:'123',address:null,location_type:'inside',debt_limit_usd:0,due_days:30,pinned:false,created_at:'2026-10-03T00:00:00Z'}]});
        if(method==='GET'&&p.startsWith('/rest/v1/transactions'))return send({ok:true,data:[]});
        if(method==='POST'&&p.startsWith('/rest/v1/transactions')){
          const row={...parsed,id:parsed.id||'tx-cloud-1'};
          window.posts.push(row);return send({ok:true,data:[row]});
        }
        if(method==='PATCH'&&p.startsWith('/rest/v1/store_members'))return send({ok:true,data:[]});
        return send({ok:true,data:[]});
      }
    };
  });
  try{
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.waitForFunction(()=>!!window.DebtCloudSync);
    const out=await page.evaluate(async()=>{
      await DebtCloudSync.run();
      await new Promise(r=>setTimeout(r,20));
      return {
        pending:state.cloud.pending,
        online:state.cloud.online,
        lastSyncAt:state.cloud.lastSyncAt,
        cloudId:state.entries[0].cloudId,
        posted:window.posts.length,
        flushedLegacy:window.flushedLegacy||[]
      };
    });
    assert.equal(out.posted,1,'the additive sync uploads the missing local row exactly once');
    assert.equal(out.cloudId,'tx-local-1','the local row is confirmed by cloud id before cleanup');
    assert.equal(out.pending.length,0,'remaining legacy edit is retried and queue drains');
    assert.deepEqual(out.flushedLegacy,['PATCH:/rest/v1/stores?id=eq.store-1'],'confirmed duplicate POST is removed, non-POST edit is preserved for retry');
    assert.equal(out.online,true,'successful additive sync updates the visible legacy connection status');
    assert(out.lastSyncAt,'visible last-sync timestamp is refreshed');
    console.log('PASS v1.5.31 stale pending cleanup and owner/partner convergence');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
