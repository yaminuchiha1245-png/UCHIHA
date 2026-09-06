from pathlib import Path
import json

ROOT=Path('.')

def replace_required(text,old,new,label):
    if old not in text:
        raise SystemExit(f'missing marker: {label}')
    return text.replace(old,new)

# server/server.js
p=ROOT/'server/server.js'
s=p.read_text()
s=replace_required(s,
'const { createActivationRecord, consumeActivation } = require("./lib/appActivation");',
'const { ACTIVATION_MINUTES, normalizeActivationCode, createActivationRecord, consumeActivation } = require("./lib/appActivation");\nconst { isConfiguredPaymentMethod, visibleCategories } = require("./lib/productionPolicy");',
'appActivation import')
s=replace_required(s,
'const app = express();',
'const app = express();\nconst APP_VERSION = "1.0.0";',
'app version')
s=s.replace('version:"1.0.0-rc.20"','version:APP_VERSION')
s=replace_required(s,
'paymentMethods:(db.paymentMethods||[]).filter(x=>x.active).sort((a,b)=>(a.sort||0)-(b.sort||0)).map(publicPaymentMethod)',
'paymentMethods:(db.paymentMethods||[]).filter(isConfiguredPaymentMethod).sort((a,b)=>(a.sort||0)-(b.sort||0)).map(publicPaymentMethod)',
'configured payment methods')
s=replace_required(s,
'res.json(db.categories.filter(c=>c.active).sort((a,b)=>(a.sort||0)-(b.sort||0)).map(publicCategory));',
'res.json(visibleCategories(db).sort((a,b)=>(a.sort||0)-(b.sort||0)).map(publicCategory));',
'visible categories')
s=replace_required(s,
'return res.json({ok:true,activation:{code:activation.code,expiresAt:activation.expiresAt,expiresInSeconds:600}});',
'return res.json({ok:true,activation:{code:activation.code,expiresAt:activation.expiresAt,expiresInSeconds:ACTIVATION_MINUTES*60}});',
'activation TTL response')
s=replace_required(s,
'  const code=String(req.body?.code||"").trim().toUpperCase();\n  if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code))return res.status(400).json({ok:false,error:"activation_invalid"});\n  const db=readDB(),result=consumeActivation(db.devicePairs||[],code);',
'  const code=normalizeActivationCode(req.body?.code);\n  if(!code)return res.status(400).json({ok:false,error:"activation_invalid"});\n  const db=readDB(),result=consumeActivation(db.devicePairs||[],code);',
'activation redeem format')
s=replace_required(s,
'const locksForActivationRedeem=req=>{\n  const code=String(req.body?.code||"").trim().toUpperCase(),db=readDB();',
'const locksForActivationRedeem=req=>{\n  const code=normalizeActivationCode(req.body?.code)||String(req.body?.code||"").trim().toUpperCase(),db=readDB();',
'activation lock normalization')
p.write_text(s)

# migrations.js
p=ROOT/'server/lib/migrations.js'
s=p.read_text()
s=replace_required(s,
'const {sanitizeDeliveryText}=require("./deliveryPromise");\nconst CURRENT_SCHEMA_VERSION=9;',
'const {sanitizeDeliveryText}=require("./deliveryPromise");\nconst {hardenLegacyDemoState}=require("./productionPolicy");\nconst CURRENT_SCHEMA_VERSION=10;',
'migration imports/version')
marker='  const auditRows=db.adminAudit||[];'
insert='''  if(from<10){\n    const hardened=hardenLegacyDemoState(db);\n    for(const change of hardened.changes)changes.push(`production:${change}`);\n  }\n\n'''
s=replace_required(s,marker,insert+marker,'production hardening migration')
p.write_text(s)

# providers/index.js: production runtime must not have a demo adapter.
p=ROOT/'server/providers/index.js'
s=p.read_text()
s=replace_required(s,'const demo = require("./demo");\n','', 'demo provider import')
s=replace_required(s,'const staticProviders = { demo, manual, http };','const staticProviders = { manual, http };','demo provider registry')
p.write_text(s)

# package metadata becomes stable, not RC.
p=ROOT/'server/package.json'
data=json.loads(p.read_text())
data['version']='1.0.0'
p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')

# production-safe seed: no fake provider execution, fake offers, sample coupon, placeholder payment account, or demo inventory.
p=ROOT/'server/data/db.json'
db=json.loads(p.read_text())
for provider in db.get('providers',[]):
    if str(provider.get('id','')).lower()=='demo' or str(provider.get('type','')).lower()=='demo':
        provider['active']=False
for product in db.get('products',[]):
    if str(product.get('providerPrimary','')).lower()=='demo':
        product['providerPrimary']='manual'; product['providerBackup']=None; product['delivery']='manual'; product['deliveryText']='يتم التنفيذ يدويًا بعد مراجعة الطلب'
    if product.get('id') in {'offer-starter','gz-demo-code'} or 'تجريبي' in str(product.get('name','')) or 'تجريبي' in str(product.get('description','')):
        product['active']=False; product['featured']=False
for coupon in db.get('coupons',[]):
    if str(coupon.get('code','')).upper()=='GZ10' and coupon.get('type')=='percent' and float(coupon.get('value',0))==10 and float(coupon.get('maxDiscount',0))==5 and float(coupon.get('maxUses',0))==100:
        coupon['active']=False
for method in db.get('paymentMethods',[]):
    account=str(method.get('account','')).lower()
    if 'not configured' in account or 'يتم تحديد بيانات التحويل' in account:
        method['active']=False
db['inventoryCodes']=[x for x in db.get('inventoryCodes',[]) if not (x.get('status')=='available' and (str(x.get('productId',''))=='gz-demo-code' or str(x.get('value','')).upper().startswith('GZ-DEMO-')))]
db['schemaVersion']=10
p.write_text(json.dumps(db,ensure_ascii=False,indent=2)+'\n')

# migration tests track v10 and verify realization behavior.
p=ROOT/'server/tests/migrations.test.js'
s=p.read_text().replace('assert.equal(result.to,9);','assert.equal(result.to,10);')
append=r'''

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
'''
if 'v10 production migration converts legacy demo execution' not in s:
    s+=append
p.write_text(s)

# focused policy tests
p=ROOT/'server/tests/productionPolicy.test.js'
p.write_text(r'''const test=require("node:test");
const assert=require("node:assert/strict");
const {isConfiguredPaymentMethod,visibleCategories}=require("../lib/productionPolicy");

test("placeholder payment instructions are not exposed as live payment methods",()=>{
  assert.equal(isConfiguredPaymentMethod({active:true,account:"يتم تحديد بيانات التحويل من الإدارة"}),false);
  assert.equal(isConfiguredPaymentMethod({active:true,account:"USDT wallet not configured"}),false);
  assert.equal(isConfiguredPaymentMethod({active:true,account:"SY123456789"}),true);
});

test("customer categories only include branches that contain active products",()=>{
  const db={categories:[{id:"a",active:true},{id:"b",active:true},{id:"child",parentId:"a",active:true}],products:[{id:"p",categoryId:"child",active:true}]};
  assert.deepEqual(visibleCategories(db).map(x=>x.id).sort(),["a","child"]);
});
''')

# static audit catches the exact activation regression and runtime demo exposure.
p=ROOT/'server/scripts/production-realization-audit.js'
p.write_text(r'''const fs=require("fs");
const server=fs.readFileSync(require("path").join(__dirname,"../server.js"),"utf8");
const providers=fs.readFileSync(require("path").join(__dirname,"../providers/index.js"),"utf8");
if(server.includes('expiresInSeconds:600'))throw new Error('stale_activation_ttl');
if(server.includes('/^[A-HJ-NP-Z2-9]{6}$/'))throw new Error('stale_six_character_activation');
if(!server.includes('normalizeActivationCode(req.body?.code)'))throw new Error('activation_route_not_normalized');
if(server.includes('1.0.0-rc.20'))throw new Error('rc_version_exposed');
if(providers.includes('require("./demo")')||providers.includes('{ demo,'))throw new Error('demo_provider_runtime_enabled');
console.log('PRODUCTION_REALIZATION_AUDIT=PASS');
''')

# remove executable demo adapter from production source.
(ROOT/'server/providers/demo.js').unlink(missing_ok=True)

print('GAME_ZONE_PRODUCTION_REALIZATION_V1=APPLIED')
