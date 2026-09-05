const test=require("node:test");
const assert=require("node:assert/strict");
const {canAutomationAccess}=require("../lib/adminAutomationPolicy");

test("Telegram automation role can access only the Admin routes used by the Bot",()=>{
  for(const [method,path] of [
    ["GET","/api/admin/dashboard"],
    ["GET","/api/admin/orders"],
    ["GET","/api/admin/topups"],
    ["POST","/api/admin/topups/topup_1/approve"],
    ["POST","/api/admin/topups/topup_1/reject"],
    ["GET","/api/admin/provider-logs"],
    ["GET","/api/admin/support-tickets"],
    ["GET","/api/admin/inventory/summary"],
    ["GET","/api/admin/sync-worker"],
    ["POST","/api/admin/sync-worker/run"],
    ["POST","/api/admin/broadcast"]
  ])assert.equal(canAutomationAccess(method,path),true,`${method} ${path}`);
});

test("Telegram automation role cannot mutate owner-only Admin resources",()=>{
  for(const [method,path] of [
    ["POST","/api/admin/products"],
    ["PATCH","/api/admin/providers/provider_1"],
    ["POST","/api/admin/users/123/balance"],
    ["GET","/api/admin/backup"],
    ["GET","/api/admin/storage/history"],
    ["POST","/api/admin/storage/verify"],
    ["GET","/api/admin/storage/financial-mirror"],
    ["GET","/api/admin/storage/financial-journal"],
    ["GET","/api/admin/storage/wallet-authority"],
    ["GET","/api/admin/storage/business-authority"],
    ["GET","/api/admin/inventory/item_1/reveal"],
    ["POST","/api/admin/integrity/reconcile-wallets"],
    ["POST","/api/admin/session/revoke-all"],
    ["PATCH","/api/admin/settings"],
    ["GET","/api/admin/security-events"],
    ["GET","/api/admin/audit"]
  ])assert.equal(canAutomationAccess(method,path),false,`${method} ${path}`);
});

test("automation policy is method-sensitive",()=>{
  assert.equal(canAutomationAccess("POST","/api/admin/dashboard"),false);
  assert.equal(canAutomationAccess("GET","/api/admin/broadcast"),false);
});
