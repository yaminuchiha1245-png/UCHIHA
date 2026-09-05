const test=require("node:test");
const assert=require("node:assert/strict");
const {defaults,sanitizeAdminCurrencies,publicCurrencies}=require("../lib/currencyConfig");

test("currency defaults keep USD as the financial base",()=>{
  const list=defaults();
  assert.equal(list[0].code,"USD");
  assert.equal(list[0].enabled,true);
  assert.equal(list[0].rate,1);
  assert.equal(list.filter(x=>x.enabled).length,1);
});
test("admin can enable a supported display currency with an explicit rate",()=>{
  const list=sanitizeAdminCurrencies([{code:"EUR",enabled:true,rate:.92}]);
  assert.equal(list.find(x=>x.code==="USD").enabled,true);
  assert.equal(list.find(x=>x.code==="EUR").enabled,true);
  assert.equal(list.find(x=>x.code==="EUR").rate,.92);
});
test("enabled display currencies reject missing or unsafe rates",()=>{
  assert.throws(()=>sanitizeAdminCurrencies([{code:"TRY",enabled:true,rate:0}]),/invalid_currency_rate_TRY/);
  assert.throws(()=>sanitizeAdminCurrencies([{code:"TRY",enabled:true,rate:"x"}]),/invalid_currency_rate_TRY/);
});
test("public currency config fails closed to USD defaults",()=>{
  const list=publicCurrencies([{code:"BAD",enabled:true,rate:10}]);
  assert.equal(list.find(x=>x.code==="USD").enabled,true);
  assert.equal(list.some(x=>x.code==="BAD"),false);
});
