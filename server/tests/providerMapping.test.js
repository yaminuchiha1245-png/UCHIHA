const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCreatePayload, buildStatusPayload, addQuery, normalizeCreateResponse, normalizeStatusResponse, getPath } = require("../providers/http");

test("HTTP provider maps custom request fields", () => {
  const body = buildCreatePayload(
    { orderNo:"GZ-123", customerInput:"778899" },
    { id:"pubg-60", providerProductId:"svc_22" },
    {
      requestFields:{
        clientOrderId:"client_ref",
        productId:"service_id",
        quantity:"qty",
        customerInput:"player_id"
      },
      fixedPayload:{ region:"global" }
    }
  );
  assert.deepEqual(body, {
    region:"global", client_ref:"GZ-123", service_id:"svc_22", qty:1, player_id:"778899"
  });
});

test("HTTP provider reads nested response paths", () => {
  const data={data:{order:{id:"X-99"},state:"done",code:"DELIVERY-123"},meta:{message:"ok"}};
  const result=normalizeCreateResponse(data,{
    responseOrderIdPath:"data.order.id",
    responseStatusPath:"data.state",
    responseMessagePath:"meta.message",
    responseDeliveryPath:"data.code"
  });
  assert.equal(result.providerOrderId,"X-99");
  assert.equal(result.status,"done");
  assert.equal(result.message,"ok");
  assert.equal(result.deliveryValue,"DELIVERY-123");
  assert.equal(getPath(data,"data.order.id"),"X-99");
});

test("status response mapping uses configured paths", () => {
  const result=normalizeStatusResponse({result:{status:"completed",note:"delivered",code:"CODE-777"}},{
    responseStatusPath:"result.status",
    responseMessagePath:"result.note",
    responseDeliveryPath:"result.code"
  });
  assert.equal(result.status,"completed");
  assert.equal(result.message,"delivered");
  assert.equal(result.deliveryValue,"CODE-777");
});


test("status request mapping supports POST fields and GET query", () => {
  const order={orderNo:"GZ-ABC",providerOrderId:"P-123",productId:"p1"};
  const payload=buildStatusPayload(order,{
    statusRequestFields:{providerOrderId:"order_id",clientOrderId:"client_ref"},
    statusFixedPayload:{action:"status"}
  },"POST");
  assert.deepEqual(payload,{action:"status",order_id:"P-123",client_ref:"GZ-ABC"});

  const url=addQuery("https://api.example.test/status",{order_id:"P-123",meta:{a:1}});
  const parsed=new URL(url);
  assert.equal(parsed.searchParams.get("order_id"),"P-123");
  assert.equal(parsed.searchParams.get("meta"),'{"a":1}');
});

test("HTTP provider maps multiple customer fields from product mapping", () => {
  const body = buildCreatePayload(
    {orderNo:"GZ-MULTI",customerInput:"778899",customerData:{playerId:"778899",zoneId:"42"}},
    {id:"pubg",providerProductId:"svc_pubg",providerInputMap:{playerId:"player_id",zoneId:"account.zone_id"}},
    {requestFields:{clientOrderId:"client_ref",productId:"service_id",quantity:null,customerInput:null}}
  );
  assert.deepEqual(body,{client_ref:"GZ-MULTI",service_id:"svc_pubg",account:{zone_id:"42"},player_id:"778899"});
});

test("HTTP provider request fields can reference customerData logical keys", () => {
  const body = buildCreatePayload(
    {orderNo:"GZ-DATA",customerInput:"user@example.com",customerData:{email:"user@example.com"}},
    {id:"subscription",providerProductId:"sub_1"},
    {requestFields:{productId:"service", "customerData.email":"account_email"}}
  );
  assert.equal(body.service,"sub_1");
  assert.equal(body.account_email,"user@example.com");
});
