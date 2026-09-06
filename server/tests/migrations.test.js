const test=require("node:test");
const assert=require("node:assert/strict");
const {CURRENT_SCHEMA_VERSION,migrateDatabase}=require("../lib/migrations");

test("old database state migrates to the current schema",()=>{
  const db={users:[{telegramId:"1"}],products:[],orders:[],settings:{storeName:"Game Zone"}};
  const r=migrateDatabase(db);
  assert.equal(r.to,CURRENT_SCHEMA_VERSION);
  assert.equal(db.schemaVersion,CURRENT_SCHEMA_VERSION);
  assert.ok(Array.isArray(db.transactions));
  assert.ok(Array.isArray(db.couponUsages));
  assert.equal(db.users[0].balance,0);
  assert.equal(db.users[0].currency,"USD");
  assert.equal(db.settings.allowAccountDeletion,true);
});

test("migration is idempotent for already migrated state",()=>{
  const db={schemaVersion:CURRENT_SCHEMA_VERSION,settings:{},storageMeta:{}};
  const first=migrateDatabase(db);
  const snapshot=JSON.stringify(db);
  const second=migrateDatabase(db);
  assert.equal(JSON.stringify(db),snapshot);
  assert.equal(second.to,CURRENT_SCHEMA_VERSION);
});

test("migration rejects non-object database state",()=>{
  assert.throws(()=>migrateDatabase(null),/invalid_database_state/);
  assert.throws(()=>migrateDatabase([]),/invalid_database_state/);
});


test("migration backfills only fully legacy unhashed audit rows",()=>{
  const db={
    schemaVersion:5,
    settings:{},
    storageMeta:{},
    adminAudit:[
      {id:"a2",action:"two",meta:{},ip:"x",createdAt:"2"},
      {id:"a1",action:"one",meta:{},ip:"x",createdAt:"1"}
    ]
  };
  migrateDatabase(db);
  assert.ok(db.adminAudit.every(x=>x.hash&&x.prevHash));
});

test("migration does not silently repair a tampered existing audit chain",()=>{
  const {backfillAuditChain,verifyAuditChain}=require("../lib/auditChain");
  const db={schemaVersion:CURRENT_SCHEMA_VERSION,settings:{},storageMeta:{},adminAudit:[
    {id:"a2",action:"two",meta:{value:2},ip:"x",createdAt:"2"},
    {id:"a1",action:"one",meta:{value:1},ip:"x",createdAt:"1"}
  ]};
  backfillAuditChain(db.adminAudit);
  db.adminAudit[0].meta.value=999;
  assert.equal(verifyAuditChain(db.adminAudit).ok,false);
  migrateDatabase(db);
  assert.equal(verifyAuditChain(db.adminAudit).ok,false);
});


test("migration upgrades a valid legacy SHA audit chain to configured HMAC",()=>{
  const {backfillAuditChain,verifyAuditChain}=require("../lib/auditChain");
  const before=process.env.AUDIT_HMAC_KEY;
  delete process.env.AUDIT_HMAC_KEY;
  const db={schemaVersion:5,settings:{},storageMeta:{},adminAudit:[
    {id:"a2",action:"two",meta:{value:2},ip:"x",createdAt:"2"},
    {id:"a1",action:"one",meta:{value:1},ip:"x",createdAt:"1"}
  ]};
  backfillAuditChain(db.adminAudit,{secret:""});
  assert.equal(verifyAuditChain(db.adminAudit,{secret:""}).ok,true);

  process.env.AUDIT_HMAC_KEY="audit-hmac-upgrade-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const r=migrateDatabase(db);
  assert.equal(verifyAuditChain(db.adminAudit).ok,true);
  assert.ok(r.changes.some(x=>x.startsWith("auditChainShaToHmac:")));

  if(before===undefined)delete process.env.AUDIT_HMAC_KEY;else process.env.AUDIT_HMAC_KEY=before;
});

test("migration still refuses to rehash a tampered legacy SHA chain when HMAC is configured",()=>{
  const {backfillAuditChain,verifyAuditChain}=require("../lib/auditChain");
  const before=process.env.AUDIT_HMAC_KEY;
  delete process.env.AUDIT_HMAC_KEY;
  const db={schemaVersion:5,settings:{},storageMeta:{},adminAudit:[
    {id:"a2",action:"two",meta:{value:2},ip:"x",createdAt:"2"},
    {id:"a1",action:"one",meta:{value:1},ip:"x",createdAt:"1"}
  ]};
  backfillAuditChain(db.adminAudit,{secret:""});
  db.adminAudit[0].meta.value=999;
  process.env.AUDIT_HMAC_KEY="audit-hmac-upgrade-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  migrateDatabase(db);
  assert.equal(verifyAuditChain(db.adminAudit).ok,false);

  if(before===undefined)delete process.env.AUDIT_HMAC_KEY;else process.env.AUDIT_HMAC_KEY=before;
});

test("RC16 migration backfills product input schemas and provider maps",()=>{
  const db={schemaVersion:6,settings:{},storageMeta:{},adminAudit:[],users:[],orders:[],transactions:[],categories:[],topups:[],coupons:[],couponUsages:[],favorites:[],notifications:[],paymentMethods:[],announcements:[],broadcasts:[],supportTickets:[],orderEvents:[],inventoryCodes:[],securityEvents:[],devicePairs:[],deletedAccounts:[],providers:[],providerLogs:[],products:[
    {id:"auto1",delivery:"auto",inputLabel:"Player ID"},
    {id:"inv1",delivery:"inventory",inputLabel:"ملاحظة"}
  ]};
  const result=migrateDatabase(db);
  assert.equal(result.to,10);
  assert.equal(db.products[0].inputSchema[0].label,"Player ID");
  assert.equal(db.products[0].inputSchema[0].key,"value");
  assert.deepEqual(db.products[0].providerInputMap,{});
  assert.deepEqual(db.products[1].inputSchema,[]);
});


test("RC20 migration backfills customer-facing delivery promises",()=>{
  const db={schemaVersion:7,settings:{},storageMeta:{},adminAudit:[],users:[],orders:[{id:"o1",orderNo:"GZ-1",productId:"p1",currency:"USD",status:"processing"}],transactions:[],categories:[],topups:[],coupons:[],couponUsages:[],favorites:[],notifications:[],paymentMethods:[],announcements:[],broadcasts:[],supportTickets:[],orderEvents:[],inventoryCodes:[],securityEvents:[],devicePairs:[],deletedAccounts:[],providers:[],providerLogs:[],products:[{id:"p1",delivery:"auto",inputSchema:[],providerInputMap:{}}]};
  const result=migrateDatabase(db);
  assert.equal(result.to,10);
  assert.equal(db.products[0].deliveryText,"فوري");
  assert.equal(db.orders[0].deliveryText,"فوري");
});


test("v10 production migration converts legacy demo execution to real manual fulfillment",()=>{
  const db={schemaVersion:9,settings:{},storageMeta:{},adminAudit:[],users:[],categories:[{id:"games",active:true}],orders:[],transactions:[],topups:[],couponUsages:[],favorites:[],notifications:[],announcements:[],broadcasts:[],supportTickets:[],orderEvents:[],securityEvents:[],devicePairs:[],deletedAccounts:[],verificationRequests:[],providerLogs:[],
    providers:[{id:"demo",type:"demo",active:true},{id:"manual",type:"manual",active:true}],
    products:[{id:"pubg",categoryId:"games",active:true,delivery:"auto",providerPrimary:"demo",providerBackup:"manual",inputSchema:[],providerInputMap:{}},{id:"gz-demo-code",categoryId:"games",active:true,delivery:"inventory",providerPrimary:"inventory",inputSchema:[],providerInputMap:{},description:"منتج تجريبي"}],
    coupons:[{code:"GZ10",type:"percent",value:10,maxDiscount:5,maxUses:100,active:true}],
    paymentMethods:[{id:"manual",active:true,account:"يتم تحديد بيانات التحويل من الإدارة"}],
    inventoryCodes:[{id:"x",productId:"gz-demo-code",value:"GZ-DEMO-X",status:"available"}]};
  const result=migrateDatabase(db);
  assert.equal(result.to,10);
  assert.equal(db.providers.find(x=>x.id==="demo").active,false);
  const product=db.products.find(x=>x.id==="pubg");
  assert.equal(product.active,true);assert.equal(product.delivery,"manual");assert.equal(product.providerPrimary,"manual");assert.equal(product.providerBackup,null);
  assert.equal(db.products.find(x=>x.id==="gz-demo-code").active,false);
  assert.equal(db.coupons[0].active,false);
  assert.equal(db.paymentMethods[0].active,false);
  assert.equal(db.inventoryCodes.length,0);
});
