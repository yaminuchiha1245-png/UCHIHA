const test=require("node:test");
const assert=require("node:assert/strict");
const {canBotReadCustomer}=require("../lib/botUserPolicy");

test("internal Bot can read only the customer views it needs",()=>{
  assert.equal(canBotReadCustomer("GET","/api/me"),true);
  assert.equal(canBotReadCustomer("GET","/api/orders?telegramId=123"),true);
});

test("internal Bot secret cannot impersonate a customer for mutations",()=>{
  for(const [method,path] of [
    ["POST","/api/orders"],
    ["POST","/api/wallet/topup-intents"],
    ["POST","/api/me/delete"],
    ["POST","/api/me/sessions/revoke-all"],
    ["POST","/api/support/tickets"],
    ["POST","/api/favorites/toggle"],
    ["POST","/api/orders/GZ-1/cancel"]
  ])assert.equal(canBotReadCustomer(method,path),false,`${method} ${path}`);
});
