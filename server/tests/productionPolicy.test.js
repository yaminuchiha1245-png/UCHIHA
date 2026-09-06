const test=require("node:test");
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
