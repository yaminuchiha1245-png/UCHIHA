const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const db = JSON.parse(fs.readFileSync(path.join(root, "data", "db.json"), "utf8"));

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

check(Array.isArray(db.categories) && db.categories.length > 0, "categories missing");
check(Array.isArray(db.products) && db.products.length > 0, "products missing");
check(Array.isArray(db.providers) && db.providers.length > 0, "providers missing");
check(Array.isArray(db.paymentMethods), "paymentMethods missing");
check(Array.isArray(db.inventoryCodes), "inventoryCodes missing");

const ids = new Set();
for (const p of db.products || []) {
  check(p.id && !ids.has(p.id), `duplicate/missing product id: ${p.id}`);
  ids.add(p.id);
  check(Number.isFinite(Number(p.price)) && Number(p.price) >= 0, `invalid price: ${p.id}`);
  check((db.categories||[]).some(c=>c.id===p.categoryId), `unknown category on ${p.id}`);
}
for (const p of db.products.filter(x=>x.delivery==="inventory")) {
  check(p.providerPrimary==="inventory", `inventory product ${p.id} should use inventory provider`);
}

if (failures.length) {
  console.error("Game Zone smoke check FAILED");
  failures.forEach(x=>console.error("-",x));
  process.exit(1);
}
console.log(`Game Zone smoke check OK: ${db.products.length} products, ${db.categories.length} categories, ${db.providers.length} providers`);
