const test=require("node:test");
const assert=require("node:assert/strict");
const {loadBotConfig,isPlaceholderUrl}=require("../../bot/config");

const prod=overrides=>({
  NODE_ENV:"production",
  BOT_TOKEN:"dummy-test-token",
  MINI_APP_URL:"https://gamezone.test.invalid",
  API_URL:"http://server:3000",
  INTERNAL_BOT_SECRET:"internal-bot-secret-aaaaaaaa",
  INTERNAL_BOT_ADMIN_SECRET:"bot-admin-secret-bbbbbbbbbbbbbbbb",
  ADMIN_TELEGRAM_IDS:"1001,1002",
  ...overrides
});

test("Bot production config accepts HTTPS Mini App and strong internal credentials",()=>{
  const c=loadBotConfig(prod());
  assert.equal(c.miniAppUrl,"https://gamezone.test.invalid");
  assert.deepEqual(c.adminIds,["1001","1002"]);
  assert.equal(c.apiTimeoutMs,12000);
});

test("Bot production config rejects placeholder or insecure Mini App URLs",()=>{
  assert.equal(isPlaceholderUrl("https://example.com"),true);
  assert.throws(()=>loadBotConfig(prod({MINI_APP_URL:"https://example.com"})),/non-placeholder HTTPS/);
  assert.throws(()=>loadBotConfig(prod({MINI_APP_URL:"http://gamezone.test.invalid"})),/non-placeholder HTTPS/);
});

test("Bot production config requires both internal Bot secrets and Admin IDs",()=>{
  assert.throws(()=>loadBotConfig(prod({INTERNAL_BOT_SECRET:""})),/INTERNAL_BOT_SECRET/);
  assert.throws(()=>loadBotConfig(prod({INTERNAL_BOT_ADMIN_SECRET:""})),/INTERNAL_BOT_ADMIN_SECRET/);
  assert.throws(()=>loadBotConfig(prod({ADMIN_TELEGRAM_IDS:""})),/ADMIN_TELEGRAM_IDS/);
});

test("Bot API timeout is bounded",()=>{
  assert.equal(loadBotConfig({...prod(),BOT_API_TIMEOUT_MS:"10"}).apiTimeoutMs,1000);
  assert.equal(loadBotConfig({...prod(),BOT_API_TIMEOUT_MS:"999999"}).apiTimeoutMs,60000);
});
