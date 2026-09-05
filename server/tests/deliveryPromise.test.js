const test=require("node:test");
const assert=require("node:assert/strict");
const {sanitizeDeliveryText,defaultDeliveryText}=require("../lib/deliveryPromise");

test("customer delivery text never defaults to API terminology",()=>{
  assert.equal(defaultDeliveryText("auto"),"فوري");
  assert.equal(defaultDeliveryText("inventory"),"فوري");
  assert.equal(defaultDeliveryText("manual"),"ضمن أوقات العمل");
  assert.equal(/api/i.test(defaultDeliveryText("auto")),false);
});

test("owner supplied delivery promise is cleaned and bounded",()=>{
  assert.equal(sanitizeDeliveryText("  ضمن أوقات العمل خلال 30 دقيقة  ","auto"),"ضمن أوقات العمل خلال 30 دقيقة");
  assert.equal(sanitizeDeliveryText("", "manual"),"ضمن أوقات العمل");
  assert.ok(sanitizeDeliveryText("x".repeat(200),"auto").length<=120);
});
