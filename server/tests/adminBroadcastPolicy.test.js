const test=require("node:test");
const assert=require("node:assert/strict");
const {broadcastConfirmationError}=require("../lib/adminBroadcastPolicy");

test("broadcast creation requires an explicit backend confirmation",()=>{
  assert.equal(broadcastConfirmationError({}),"broadcast_confirmation_required");
  assert.equal(broadcastConfirmationError({confirmation:"SEND_BROADCAST"}),null);
});
