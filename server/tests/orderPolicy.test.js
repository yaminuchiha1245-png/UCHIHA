const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizeOrderInput,normalizeCouponCode,findIdempotentOrder,sameOrderRequest}=require("../lib/orderPolicy");

test("order idempotency is scoped to the same user and request id",()=>{
  const rows=[
    {id:"a",telegramId:"1",clientRequestId:"req-1"},
    {id:"b",telegramId:"2",clientRequestId:"req-1"}
  ];
  assert.equal(findIdempotentOrder(rows,{telegramId:"1",clientRequestId:"req-1"}).id,"a");
  assert.equal(findIdempotentOrder(rows,{telegramId:"3",clientRequestId:"req-1"}),null);
});

test("order idempotency requires identical product input and coupon",()=>{
  const order={productId:"p1",customerInput:" PLAYER-77 ",couponCode:"GZ10"};
  assert.equal(sameOrderRequest(order,{productId:"p1",customerInput:"PLAYER-77",couponCode:"gz10"}),true);
  assert.equal(sameOrderRequest(order,{productId:"p2",customerInput:"PLAYER-77",couponCode:"gz10"}),false);
  assert.equal(sameOrderRequest(order,{productId:"p1",customerInput:"OTHER",couponCode:"gz10"}),false);
  assert.equal(sameOrderRequest(order,{productId:"p1",customerInput:"PLAYER-77",couponCode:"OTHER"}),false);
});

test("order input and coupon normalization are stable",()=>{
  assert.equal(normalizeOrderInput("  abc  "),"abc");
  assert.equal(normalizeCouponCode(" gz10 "),"GZ10");
});

test("order idempotency compares structured customer data canonically",()=>{
  const order={productId:"p1",customerInput:"778899",customerData:{zoneId:"42",playerId:"778899"},couponCode:""};
  assert.equal(sameOrderRequest(order,{productId:"p1",customerData:{playerId:"778899",zoneId:"42"},couponCode:""}),true);
  assert.equal(sameOrderRequest(order,{productId:"p1",customerData:{playerId:"778899",zoneId:"43"},couponCode:""}),false);
});
