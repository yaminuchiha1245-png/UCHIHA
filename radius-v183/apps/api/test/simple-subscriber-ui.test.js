import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const helper = fs.readFileSync(path.join(root,"apps/provider-v183-runtime/simple-subscriber.js"),"utf8");
const runtime = fs.readFileSync(path.join(root,"apps/provider-v183-runtime/runtime.js"),"utf8");
const bundle = fs.readFileSync(path.join(root,"scripts/build-provider-v183.mjs"),"utf8");
const css = fs.readFileSync(path.join(root,"apps/provider-v183-runtime/ui-simplify.css"),"utf8");
const api = fs.readFileSync(path.join(root,"apps/api/src/app.js"),"utf8");
const { v183BuildSubscriberExtras: build, v183InstallSubscriberFields: install } =
  vm.runInNewContext(helper + "\n;({v183BuildSubscriberExtras,v183InstallSubscriberFields})");

function draft(fields, tenantCurrency = "USD") {
  const data = { get: key => Object.hasOwn(fields,key) ? fields[key] : null };
  return build(data,tenantCurrency,(_ar,en)=>en);
}

test("existing plan subscriber receives a validated phone without invented prices",()=>{
  const result=draft({ phone:"0955123456" });
  assert.equal(result.phone,"0955123456");
  assert.equal(result.accessProfile,undefined);
});

test("custom subscriber has distinct Mbps, decimal quotes and daily MB units",()=>{
  const row=draft({phone:"+90 555 222 3344",speedDownMbps:"25",speedUpMbps:"5",
    dailyQuotaAmount:"800",dailyQuotaUnit:"MB",priceCurrency:"SYP",
    priceSYP:"130000",priceUSD:"12.50",priceTRY:"450.00"},"SYP");
  assert.equal(row.accessProfile.speedDownMbps,25);
  assert.equal(row.accessProfile.speedUpMbps,5);
  assert.equal(row.accessProfile.dailyQuota.unit,"MB");
  assert.equal(row.accessProfile.dailyQuota.amount,800);
  assert.equal(row.accessProfile.priceCurrency,"SYP");
  assert.equal(row.accessProfile.prices.USD,"12.50");
  assert.equal(row.accessProfile.prices.TRY,"450.00");
  assert.equal(row.accessProfile.automaticExchange,undefined);
});

test("a blank quota means no daily usage limit; upload inherits the plan",()=>{
  const row=draft({phone:"0955123456",speedDownMbps:"30",priceCurrency:"TRY",
    priceTRY:"400",priceUSD:"20"},"USD");
  assert.equal(row.accessProfile.dailyQuota,null);
  assert.equal(row.accessProfile.speedUpMbps,undefined);
});

test("different billing currency requires an independently entered network quote",()=>{
  assert.throws(()=>draft({phone:"0955123456",speedDownMbps:"10",
    priceCurrency:"TRY",priceTRY:"400"},"SYP"),/independent price.*SYP/);
  assert.throws(()=>draft({phone:"0955123456",speedDownMbps:"10",
    priceCurrency:"TRY",priceSYP:"100000"},"SYP"),/selected currency/);
});

test("reject invalid phone, speed, quotas, selected currency and decimal precision",()=>{
  assert.throws(()=>draft({phone:"123"}),/valid subscriber phone/);
  assert.throws(()=>draft({phone:"0955123456",speedDownMbps:"0",priceUSD:"12"}),/Download speed/);
  assert.throws(()=>draft({phone:"0955123456",speedDownMbps:"10",dailyQuotaAmount:"1.5",
    priceUSD:"12"}),/Daily usage quota/);
  assert.throws(()=>draft({phone:"0955123456",speedDownMbps:"10",priceUSD:"12.345"}),/at most two decimals/);
  assert.throws(()=>draft({phone:"0955123456",speedDownMbps:"10",
    priceCurrency:"EUR",priceUSD:"12"}),/selected currency/);
});

test("the authenticated form defaults to tenant currency and cannot inject twice",()=>{
  let content="",inserts=0,already=false;
  const label={insertAdjacentHTML(_position,html){content=html;inserts++;already=true}};
  const form={querySelector:()=>already ? {} : null,
    elements:{name:{closest:()=>label}}};
  install(form,"SYP",(_ar,en)=>en);
  install(form,"SYP",(_ar,en)=>en);
  assert.equal(inserts,1);
  assert.match(content,/<option value="SYP" selected>/);
  for(const field of ["phone","speedDownMbps","speedUpMbps","dailyQuotaAmount",
    "dailyQuotaUnit","priceCurrency","priceUSD","priceSYP","priceTRY"])
    assert.ok(content.includes('name="'+field+'"'),"missing "+field);
  assert.match(content,/type="tel"/);
  assert.match(content,/required/);
  assert.match(content,/without automatic FX/);
});

test("the runtime calls the new form only after authenticating the tenant",()=>{
  assert.ok(runtime.includes("await loadLiveData();v183InstallSubscriberFields("));
  assert.ok(runtime.includes("const extras=v183BuildSubscriberExtras("));
  assert.ok(runtime.includes("planId,...extras"));
  assert.ok(runtime.includes("verify RADIUS before activating service"));
  assert.ok(bundle.includes('const simpleSubscriber = fs.readFileSync('));
  assert.ok(bundle.includes('simpleSubscriber}'));
  assert.ok(css.includes(".v183-basic-subscriber-fields"));
  assert.ok(api.includes("accessProfile: accessProfileSchema.optional()"));
});
