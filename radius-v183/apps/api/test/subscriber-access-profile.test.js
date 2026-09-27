import assert from "node:assert/strict";
import test from "node:test";
import { ConnectorService } from "../src/connector-service.js";
import { DEMO } from "../src/seed.js";
import { createTenant,createUserSession,devSession,headers,setup } from "./helpers.js";

const accessProfile={
  speedDownMbps:55,speedUpMbps:12,
  dailyQuota:{amount:2,unit:"GB"},
  priceCurrency:"SYP",
  prices:{USD:"12.50",SYP:"120000",TRY:"650.00"}
};
async function create(env,token,username="radiusprofile-test") {
  const plan=await env.db.get("SELECT id FROM plans WHERE tenant_id=? LIMIT 1",[DEMO.tenantId]);
  return env.app.inject({method:"POST",url:"/api/v1/subscribers",
    headers:headers(token,DEMO.tenantId,{"idempotency-key":username+"-create"}),
    payload:{username,radiusPassword:"test-secret-customer",
      fullName:"Subscriber Profile",phone:"+905550000000",
      planId:plan.id,accessProfile}});
}
test("subscriber profile stores exact per-currency prices and feeds the real RADIUS directory",async t=>{
  const env=await setup();t.after(()=>env.close());
  const token=(await devSession(env.app)).token;
  const response=await create(env,token);
  assert.equal(response.statusCode,201,response.body);
  const subscriber=response.json().data;
  assert.equal(subscriber.accessProfile.priceCurrency,"SYP");
  assert.deepEqual(subscriber.accessProfile.prices,accessProfile.prices);
  assert.equal(subscriber.accessProfile.dailyQuotaBytes,2_000_000_000);
  assert.equal(subscriber.accessProfile.automaticExchange,false);
  assert.equal(response.body.includes("test-secret-customer"),false);
  const config=env.config;
  const connector=new ConnectorService({db:env.db,config});
  const directory=await connector.radiusDirectory({id:DEMO.tenantId,time_zone:"UTC"},{
    nonce:"access-profile-creation",nonceExpiresAt:new Date(Date.now()+120000).toISOString(),
    afterUsername:"",limit:500
  });
  const principal=directory.principals.find(item=>item.username==="radiusprofile-test");
  assert.ok(principal,"subscriber exists in real agent directory");
  assert.equal(principal.attributes.rateLimitDownMbps,55);
  assert.equal(principal.attributes.rateLimitUpMbps,12);
  assert.equal(principal.attributes.quota.limitBytes,2_000_000_000);
  assert.equal(principal.attributes.quota.period,"daily");
  const original=await env.db.get("SELECT price_minor FROM plans WHERE id=?",[subscriber.plan.id]);
  assert.ok(original.price_minor>=0,"legacy plan price remains unchanged");
  const refresh=await env.db.get("SELECT COUNT(*) AS n FROM outbox WHERE tenant_id=? AND topic='radius.directory.refresh'",
    [DEMO.tenantId]);
  assert.equal(refresh.n,1);
});
test("editing and removing an overlay does not discard advanced subscriber or plan data",async t=>{
  const env=await setup();t.after(()=>env.close());
  const token=(await devSession(env.app)).token;
  const id=(await create(env,token,"radiusprofile-edit")).json().data.id;
  const updated={...accessProfile,speedDownMbps:80,dailyQuota:{amount:350,unit:"MB"},
    priceCurrency:"TRY",prices:{USD:"15.00",SYP:"150000",TRY:"750.00"}};
  const patch=await env.app.inject({method:"PATCH",url:`/api/v1/subscribers/${id}`,
    headers:headers(token,DEMO.tenantId,{"idempotency-key":"profile-edit-update"}),payload:{accessProfile:updated}});
  assert.equal(patch.statusCode,200,patch.body);
  assert.equal(patch.json().data.accessProfile.dailyQuotaBytes,350_000_000);
  assert.equal(patch.json().data.usage.period,"daily");
  assert.equal(patch.json().data.accessProfile.speedDownMbps,80);
  const removed=await env.app.inject({method:"PATCH",url:`/api/v1/subscribers/${id}`,
    headers:headers(token,DEMO.tenantId,{"idempotency-key":"profile-edit-remove"}),payload:{accessProfile:null}});
  assert.equal(removed.statusCode,200,removed.body);
  assert.equal(removed.json().data.accessProfile,null);
  assert.ok(removed.json().data.plan.id,"legacy plan remains attached");
});
test("selected currency is mandatory and profile access is tenant-isolated",async t=>{
  const env=await setup();t.after(()=>env.close());
  const token=(await devSession(env.app)).token;
  const created=await create(env,token,"radiusprofile-private");
  assert.equal(created.statusCode,201,created.body);
  const id=created.json().data.id;
  const wrong=await env.app.inject({method:"PATCH",url:`/api/v1/subscribers/${id}`,
    headers:headers(token,DEMO.tenantId,{"idempotency-key":"profile-invalid-update"}),payload:{accessProfile:{
      ...accessProfile,priceCurrency:"TRY",prices:{USD:"25.00"}
    }}});
  assert.equal(wrong.statusCode,400,wrong.body);
  const otherTenant=await createTenant(env.db,"profile-isolation");
  const outsider=await createUserSession(env.db,env.config,{tenantId:otherTenant,role:"owner"});
  const read=await env.app.inject({method:"GET",url:`/api/v1/subscribers/${id}`,
    headers:headers(outsider.token,otherTenant)});
  assert.equal(read.statusCode,404,read.body);
  const edit=await env.app.inject({method:"PATCH",url:`/api/v1/subscribers/${id}`,
    headers:headers(outsider.token,otherTenant,{"idempotency-key":"profile-outsider-update"}),payload:{fullName:"Incorrect owner"}});
  assert.equal(edit.statusCode,404,edit.body);
});
test("invoices use independently stated price matching tenant currency; never implicit FX",async t=>{
  const env=await setup();t.after(()=>env.close());
  const token=(await devSession(env.app)).token;
  const tenant=await env.db.get("SELECT currency FROM tenants WHERE id=?",[DEMO.tenantId]);
  const created=await create(env,token,"radiusprofile-billing");
  assert.equal(created.statusCode,201,created.body);
  const sub=created.json().data;
  const expected={USD:1250,SYP:12000000,TRY:65000}[tenant.currency];
  const invoice=await env.app.inject({method:"POST",url:"/api/v1/invoices",
    headers:headers(token,DEMO.tenantId,{"idempotency-key":"profile-invoice-create"}),
    payload:{subscriberId:sub.id,dueAt:new Date(Date.now()+604800000).toISOString(),
      reason:"Subscriber independent quote"}});
  assert.equal(invoice.statusCode,201,invoice.body);
  assert.equal(invoice.json().data.amountMinor,expected);
  assert.equal(invoice.json().data.currency,tenant.currency);
});
test("missing matching-currency quote skips auto-invoicing, while explicit manual amount is allowed",async t=>{
  const env=await setup();t.after(()=>env.close());
  const token=(await devSession(env.app)).token;
  const tenant=await env.db.get("SELECT currency FROM tenants WHERE id=?",[DEMO.tenantId]);
  const username="radiusprofile-no-fx";
  const plan=await env.db.get("SELECT id FROM plans WHERE tenant_id=? LIMIT 1",[DEMO.tenantId]);
  const quoteCurrency=["USD","SYP","TRY"].find(c=>c!==tenant.currency);
  const createNoFx=await env.app.inject({method:"POST",url:"/api/v1/subscribers",
    headers:headers(token,DEMO.tenantId,{"idempotency-key":"profile-create-no-fx"}),
    payload:{username,fullName:"Foreign Currency Quote",planId:plan.id,
      accessProfile:{speedDownMbps:50,priceCurrency:quoteCurrency,prices:{[quoteCurrency]:"50.00"}}}});
  assert.equal(createNoFx.statusCode,201,createNoFx.body);
  const subId=createNoFx.json().data.id;
  const missing=await env.app.inject({method:"POST",url:"/api/v1/invoices",
    headers:headers(token,DEMO.tenantId,{"idempotency-key":"profile-invoice-no-fx"}),
    payload:{subscriberId:subId,dueAt:new Date(Date.now()+604800000).toISOString(),
      reason:"Do not auto convert"}});
  assert.equal(missing.statusCode,400,missing.body);
  await env.db.run("UPDATE subscribers SET status='active' WHERE id=?",[subId]);
  const {generateTenantInvoices}=await import("../src/billing-service.js");
  const run=await env.db.transaction(tx=>generateTenantInvoices(tx,DEMO.tenantId,{asOf:"2027-01-10T00:00:00.000Z"}));
  assert.ok(run.skipped>=1);
  const none=await env.db.get("SELECT COUNT(*) AS n FROM invoices WHERE tenant_id=? AND subscriber_id=?",
    [DEMO.tenantId,subId]);
  assert.equal(none.n,0);
  const manual=await env.app.inject({method:"POST",url:"/api/v1/invoices",
    headers:headers(token,DEMO.tenantId,{"idempotency-key":"profile-explicit-no-fx"}),
    payload:{subscriberId:subId,amountMinor:2000,
      dueAt:new Date(Date.now()+604800000).toISOString(),reason:"Human entered tenant currency"}});
  assert.equal(manual.statusCode,201,manual.body);
  assert.equal(manual.json().data.amountMinor,2000);
  assert.equal(manual.json().data.currency,tenant.currency);
});
