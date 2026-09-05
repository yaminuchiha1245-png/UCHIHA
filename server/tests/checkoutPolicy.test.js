const test=require("node:test");
const assert=require("node:assert/strict");
const {buildCheckoutUrl}=require("../lib/checkoutPolicy");

const topup={id:"top 1",amount:10,telegramId:"123",reference:"TX/ABC"};

test("checkout template substitutes URL-encoded top-up values",()=>{
  const u=new URL(buildCheckoutUrl("https://pay.example.test/start?id={topupId}&r={reference}&a={amount}",topup,{requireHttps:true}));
  assert.equal(u.searchParams.get("id"),"top 1");
  assert.equal(u.searchParams.get("r"),"TX/ABC");
  assert.equal(u.searchParams.get("a"),"10");
});

test("production checkout policy rejects insecure and credential-bearing URLs",()=>{
  assert.equal(buildCheckoutUrl("http://pay.example.test/?id={topupId}",topup,{requireHttps:true}),null);
  assert.equal(buildCheckoutUrl("https://user:pass@pay.example.test/",topup,{requireHttps:true}),null);
  assert.equal(buildCheckoutUrl("javascript:alert(1)",topup,{requireHttps:false}),null);
});
