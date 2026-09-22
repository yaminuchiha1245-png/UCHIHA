const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const assets=path.resolve(process.argv[2]||'work-v1527/app/src/main/assets');

function testStaticSafety(){
  const app110=fs.readFileSync(path.join(assets,'app-v110.js'),'utf8');
  const sync=fs.readFileSync(path.join(assets,'sync-v165.js'),'utf8');
  assert(app110.includes("a.permissions?.[permission]===true"),'partner permissions must default deny');
  assert(app110.includes('source_key:e.syncKey'),'legacy queue must send the stable transaction key');
  assert(sync.includes('if(!legacyEntryIds.has(e.id))return null;'),'heuristic transaction matching is legacy-only');
  assert(sync.includes('return candidates.length===1?candidates[0]:null;'),'legacy customer matching must be unique');
}

async function testGuard(){
  const c={console,setTimeout,clearTimeout,Date,Math,crypto:require('crypto').webcrypto};
  c.window=c;
  vm.createContext(c);
  vm.runInContext(`
    var state={entries:[]};
    var pendingSensitive=null;
    var purchaseDraft={amount:'10',currency:'TRY',description:''};
    var paymentDraft={amount:'5',currency:'TRY',description:'دفعة'};
    var purchaseClientId='C1',paymentClientId='C1';
    function toast(){}
    function saveState(){return true}
    function closeModal(){}
    function commitPurchase(p){state.entries.push({id:'E'+(state.entries.length+1),type:'purchase'});}
    function commitPayment(p){state.entries.push({id:'E'+(state.entries.length+1),type:'payment'});}
    function commitPurchaseSilent(p){state.entries.push({id:'E'+(state.entries.length+1),type:'purchase'});}
    function submitPurchase(){commitPurchase({clientId:'C1',amount:10,currency:'TRY',description:'شراء'},'none');}
    function submitPayment(){commitPayment({clientId:'C1',amount:5,currency:'TRY',description:'دفعة'},'none');}
  `,c);
  vm.runInContext(fs.readFileSync(path.join(assets,'ledger-guard-v177.js'),'utf8'),c);

  vm.runInContext('submitPurchase(); submitPurchase();',c);
  assert.equal(c.state.entries.length,1,'double tap must create one purchase');
  const firstKey=c.state.entries[0].operationKey;
  assert(firstKey,'first purchase has operation key');

  await new Promise(r=>setTimeout(r,950));
  vm.runInContext('submitPurchase();',c);
  assert.equal(c.state.entries.length,2,'a later intentional identical purchase must be preserved');
  assert.notEqual(c.state.entries[1].operationKey,firstKey,'intentional second purchase gets a new identity');

  vm.runInContext(`
    var samePayload={clientId:'C1',amount:7,currency:'TRY',description:'شراء',operationKey:'manual-op-1'};
    commitPurchase(samePayload,'none'); commitPurchase(samePayload,'none');
  `,c);
  assert.equal(c.state.entries.filter(e=>e.operationKey==='manual-op-1').length,1,'same callback/idempotency key must commit once');
}

async function testSync(){
  const posts=[];
  const cloudTx=[{
    id:'11111111-1111-4111-8111-111111111111',store_id:'S1',customer_id:'CLOUD-C1',
    source_key:'entry:11111111-1111-4111-8111-111111111111',kind:'purchase',
    description:'شراء',original_currency:'TRY',original_amount:40,usd_amount:1,
    recorded_by_name:'شريك',created_at:'2026-09-21T10:00:00.000Z',is_deleted:false
  }];
  const c={console,setTimeout,clearTimeout,setInterval:()=>0,clearInterval:()=>{},Date,Math,crypto:require('crypto').webcrypto};
  c.window=c;c.addEventListener=()=>{};
  c.document={hidden:false,activeElement:null,addEventListener:()=>{}};
  c.state={
    clients:[{id:'LC1',cloudId:'CLOUD-C1',remoteId:'CLOUD-C1',syncKey:'cloud-client:CLOUD-C1',name:'عميل',phone:'',address:'',area:'inside'}],
    entries:[
      {id:'L1',remoteId:'11111111-1111-4111-8111-111111111111',syncKey:'entry:11111111-1111-4111-8111-111111111111',clientId:'LC1',type:'purchase',createdAt:'2026-09-21T10:00:00.000Z',date:'2026-09-21',description:'شراء',originalCurrency:'TRY',originalAmount:40,usdAmount:1,rateUsdTry:40,rateUsdSyp:0,createdBy:'شريك'},
      {id:'L2',remoteId:'22222222-2222-4222-8222-222222222222',syncKey:'entry:22222222-2222-4222-8222-222222222222',clientId:'LC1',type:'purchase',createdAt:'2026-09-21T10:00:01.000Z',date:'2026-09-21',description:'شراء',originalCurrency:'TRY',originalAmount:80,usdAmount:2,rateUsdTry:40,rateUsdSyp:0,createdBy:'شريك'},
      {id:'L3',remoteId:'33333333-3333-4333-8333-333333333333',syncKey:'entry:33333333-3333-4333-8333-333333333333',clientId:'LC1',type:'purchase',createdAt:'2026-09-21T10:00:02.000Z',date:'2026-09-21',description:'شراء',originalCurrency:'TRY',originalAmount:80,usdAmount:2,rateUsdTry:40,rateUsdSyp:0,createdBy:'شريك'}
    ],
    cloudSync:{lastSuccess:'2026-09-20T00:00:00Z'}
  };
  c.sessionAccountId='A1';
  c.currentAccount=()=>({name:'شريك'});
  c.render=()=>{};
  c.saveState=()=>true;
  c.Android={
    cloudStatus:()=>JSON.stringify({signedIn:true,userId:'U1'}),
    cloudRealtimeStart:()=>{},
    cloudRequest:(method,p,body,id)=>{
      const parsed=body?JSON.parse(body):null;
      const send=data=>setTimeout(()=>c.window.onCloudNativeResult(id,data),0);
      if(method==='GET'&&p.startsWith('/rest/v1/store_members'))return send({ok:true,data:[{store_id:'S1',user_id:'U1'}]});
      if(method==='GET'&&p.startsWith('/rest/v1/customers'))return send({ok:true,data:[{id:'CLOUD-C1',store_id:'S1',source_key:'cloud-client:CLOUD-C1',name:'عميل',phone:null,address:null,location_type:'inside',created_at:'2026-09-20T00:00:00Z'}]});
      if(method==='GET'&&p.startsWith('/rest/v1/transactions'))return send({ok:true,data:[...cloudTx]});
      if(method==='POST'&&p.startsWith('/rest/v1/transactions')){
        posts.push(parsed); cloudTx.push({...parsed}); return send({ok:true,data:[parsed]});
      }
      if(method==='PATCH'&&p.startsWith('/rest/v1/store_members'))return send({ok:true,data:[]});
      if(method==='POST'&&p.startsWith('/rest/v1/customers'))return send({ok:true,data:[parsed]});
      return send({ok:true,data:[]});
    }
  };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(assets,'sync-v165.js'),'utf8'),c);
  await c.DebtCloudSync.run();

  assert.equal(posts.length,2,'existing queued cloud row must not be posted twice');
  assert.deepEqual(posts.map(x=>x.id).sort(),[
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333'
  ],'sync must reuse the exact stable remote IDs');
  assert.equal(new Set(posts.map(x=>x.source_key)).size,2,'intentional equal-value rows keep separate source keys');
  assert.equal(c.state.entries.length,3,'sync must not delete or merge intentional entries');
}

(async()=>{testStaticSafety();await testGuard();await testSync();console.log('PASS v1.5.27 ledger idempotency + partner sync + partner permissions');})().catch(e=>{console.error(e);process.exitCode=1});
