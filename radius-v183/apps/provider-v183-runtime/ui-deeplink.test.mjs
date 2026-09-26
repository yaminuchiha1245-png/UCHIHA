import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the shipped runtime's actual route table and handler, not a duplicate.
const runtime=fs.readFileSync(new URL('./runtime.js',import.meta.url),'utf8');
const start=runtime.indexOf(' const miniAppDestinations=Object.freeze({');
const end=runtime.indexOf('\n function uuid(){',start);
assert.ok(start>=0&&end>start,'signed Mini App routing implementation was found');
const routeCode=runtime.slice(start,end);
const deviceId='dev_12345678';

function runRoute(open,{id='',role='owner',canWrite=true,ready=true,devices=[{id:deviceId}]}={}){
 const events={routes:[],clicks:[],selectors:[],toasts:[],add:[]};
 const state={initialLiveReady:ready,me:{role,canWrite},devices};
 const sandbox={requestedOpen:open,requestedDeviceId:id,state,
  navigate:page=>events.routes.push(page),
  toggleAdd:show=>events.add.push(show),
  toast:message=>events.toasts.push(message),
  t:ar=>ar,
  document:{querySelector:selector=>{
   events.selectors.push(selector);
   return {click:()=>events.clicks.push(selector)};
  }}
 };
 vm.runInNewContext(routeCode+'\nopenRequestedMiniAppRoute();',sandbox);
 return events;
}
test('bot dashboard, subscribers and invoices reuse the existing web pages',()=>{
 for(const [open,destination] of [['dashboard','dashboard'],['subscribers','subscribers'],['invoices','billing']]){
  const result=runRoute(open);
  assert.deepEqual(result.routes,[destination]);
  assert.equal(result.clicks.length,0);
 }
 assert.match(runtime,/\['\/invoices\?limit=100',true\]/);
});

test('Telegram Mini App route waits for authenticated live hydration',()=>{
 const result=runRoute('connect-mikrotik',{id:deviceId,ready:false});
 assert.equal(result.routes.length,0);
 assert.equal(result.clicks.length,0);
});

test('existing MikroTik connects through its own tenant-scoped saved record',()=>{
 const result=runRoute('connect-mikrotik',{id:deviceId});
 assert.deepEqual(result.routes,['nas']);
 assert.deepEqual(result.clicks,[`[data-v183-direct-connect="${deviceId}"]`]);
 assert.ok(result.clicks.every(selector=>!selector.includes('data-v183-create')));
});

test('unregistered and malformed MikroTik links never trigger connection or creation',()=>{
 for(const id of ['dev_88888888','wrong-id','dev_12345\"onclick=\"bad']){
  const result=runRoute('connect-mikrotik',{id});
  assert.deepEqual(result.routes,['nas']);
  assert.equal(result.clicks.length,0);
  assert.equal(result.toasts.length,1);
 }
});
test('site-agent deep link uses the existing device, not generic setup',()=>{
 const result=runRoute('site-agent',{id:deviceId});
 assert.deepEqual(result.routes,['nas']);
 assert.deepEqual(result.clicks,[`[data-v183-agent-template][data-v183-device-id="${deviceId}"]`]);
});

test('site-agent rejects another tenant device without opening generic setup',()=>{
 const result=runRoute('site-agent',{id:'dev_98765432'});
 assert.deepEqual(result.routes,['nas']);
 assert.equal(result.clicks.length,0);
 assert.equal(result.toasts.length,1);
});

test('collectors and read-only accounts cannot invoke MikroTik connection actions',()=>{
 for(const permissions of [{role:'collector',canWrite:true},{role:'owner',canWrite:false}]){
  const result=runRoute('connect-mikrotik',{id:deviceId,...permissions});
  assert.equal(result.clicks.length,0);
  assert.equal(result.toasts.length,1);
 }
});

test('Site Agent links respect read-only owner and admin memberships',()=>{
 for(const role of ['owner','admin']){
  for(const id of ['',deviceId]){
   const result=runRoute('site-agent',{id,role,canWrite:false});
   assert.deepEqual(result.routes,[id?'nas':'radius']);
   assert.equal(result.clicks.length,0);
   assert.equal(result.toasts.length,1);
  }
 }
});

test('subscriber addition remains behind the existing tenant permission gate',()=>{
 assert.deepEqual(runRoute('add-subscriber').add,[true]);
 assert.equal(runRoute('add-subscriber',{role:'viewer'}).add.length,0);
 assert.equal(runRoute('add-subscriber',{canWrite:false}).add.length,0);
});

test('unknown route has no navigation or side effects',()=>{
 const result=runRoute('made-up-feature');
 assert.deepEqual(result.routes,[]);
 assert.deepEqual(result.clicks,[]);
});
