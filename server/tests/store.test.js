const test = require("node:test");
const assert = require("node:assert/strict");

test("JSON store initializes and has required collections", async () => {
  process.env.STORAGE_DRIVER = "json";
  delete require.cache[require.resolve("../store")];
  const store = require("../store");
  await store.initStore();
  const db = store.readDB();
  assert.ok(Array.isArray(db.users));
  assert.ok(Array.isArray(db.products));
  assert.ok(Array.isArray(db.orders));
  assert.ok(Array.isArray(db.inventoryCodes));
  assert.equal(store.getStoreInfo().driver, "json");
  await store.flushStore({throwOnError:true});
  await store.closeStore();
});
