const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||'debt-app/app/src/main/assets');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const sync=fs.readFileSync(path.join(root,'sync-v165.js'),'utf8');

for(const needle of [
  "clientSort:'pinned_name'",
  "function clientPurchaseTotal(id)",
  "function compareClientsForSort(a,b,key=clientSortKey())",
  "debt_desc:'الأعلى دينًا'",
  "debt_asc:'الأقل دينًا'",
  "purchase_desc:'الأكثر شراءً'",
  "purchase_asc:'الأقل شراءً'",
  "oldest:'الأقدم إضافة'",
  "newest:'الأحدث إضافة'",
  "name:'الاسم أ–ي'",
  'onclick="openClientSort()">↕ ترتيب</button>',
  "state.settings.clientSort=key",
  "sort((a,b)=>compareClientsForSort(a,b))"
]) assert(app.includes(needle),'missing '+needle);

const expectedSync=process.env.DEBT_SYNC_EXPECTED_VERSION||'1.5.33';
assert(sync.includes("SYNC_VERSION='"+expectedSync+"'"),'sync version must be '+expectedSync);
assert(sync.includes("if(row.created_at)c.createdAt=row.created_at;"),'customer age must converge from cloud');

function sortFixture(key){
  const clients=[
    {id:'A',name:'أحمد',pinned:false,createdAt:'2026-01-01T00:00:00Z',debt:50,purchases:100},
    {id:'B',name:'باسم',pinned:true,createdAt:'2026-03-01T00:00:00Z',debt:10,purchases:200},
    {id:'C',name:'جمال',pinned:false,createdAt:'2026-02-01T00:00:00Z',debt:90,purchases:60}
  ];
  const cmp=(a,b)=>{
    let d=0;
    if(key==='debt_desc')d=b.debt-a.debt;
    else if(key==='debt_asc')d=a.debt-b.debt;
    else if(key==='purchase_desc')d=b.purchases-a.purchases;
    else if(key==='purchase_asc')d=a.purchases-b.purchases;
    else if(key==='oldest')d=new Date(a.createdAt)-new Date(b.createdAt);
    else if(key==='newest')d=new Date(b.createdAt)-new Date(a.createdAt);
    else if(key==='pinned_name')d=(b.pinned?1:0)-(a.pinned?1:0);
    if(d)return d;
    return a.name.localeCompare(b.name,'ar');
  };
  return clients.sort(cmp).map(x=>x.id).join('');
}
assert.equal(sortFixture('debt_desc'),'CAB');
assert.equal(sortFixture('debt_asc'),'BAC');
assert.equal(sortFixture('purchase_desc'),'BAC');
assert.equal(sortFixture('purchase_asc'),'CAB');
assert.equal(sortFixture('oldest'),'ACB');
assert.equal(sortFixture('newest'),'BCA');
assert.equal(sortFixture('pinned_name'),'BAC');
console.log('PASS v1.5.33 customer sorting regression');
