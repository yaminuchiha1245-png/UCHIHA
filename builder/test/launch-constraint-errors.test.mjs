import test from "node:test";
import assert from "node:assert/strict";
import { installLaunchConstraintErrors } from "../src/launch-constraint-errors.mjs";

function fakeApp() {
  let hook;
  return {
    addHook(name, handler) {
      assert.equal(name, "onError");
      hook = handler;
    },
    get hook() {
      return hook;
    }
  };
}

test("subscription SQL constraint races become safe 409 conflicts", async () => {
  const app = fakeApp();
  installLaunchConstraintErrors(app);
  const error = new Error("internal postgres detail");
  error.code = "23514";
  error.details = "sensitive";
  await app.hook({ raw: { url: "/api/subscription-renewals/tenant/requests" } }, {}, error);
  assert.equal(error.statusCode, 409);
  assert.equal(error.code, "subscription_state_conflict");
  assert.match(error.message, /تغيّرت حالة الاشتراك/);
  assert.equal(error.details, undefined);
  assert.equal(error.databaseCode, "23514");
});

test("non-subscription 23514 errors are left untouched", async () => {
  const app = fakeApp();
  installLaunchConstraintErrors(app);
  const error = new Error("other constraint");
  error.code = "23514";
  await app.hook({ raw: { url: "/api/storefront/demo/orders" } }, {}, error);
  assert.equal(error.statusCode, undefined);
  assert.equal(error.code, "23514");
  assert.equal(error.message, "other constraint");
});

test("subscription errors other than 23514 are left untouched", async () => {
  const app = fakeApp();
  installLaunchConstraintErrors(app);
  const error = new Error("duplicate");
  error.code = "23505";
  await app.hook({ raw: { url: "/api/platform/subscription-requests/id/review" } }, {}, error);
  assert.equal(error.statusCode, undefined);
  assert.equal(error.code, "23505");
});
