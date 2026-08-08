import assert from "node:assert/strict";
import test from "node:test";
import { isBlockedCustomerAdminRoute } from "../src/ai-bot-telegram-only-admin-guard.mjs";

const id = "11111111-1111-4111-8111-111111111111";

test("customer operational AI admin APIs are disabled on the website", () => {
  for (const [method, path] of [
    ["PATCH", `/api/platform/ai-bots/${id}`],
    ["GET", `/api/platform/ai-bots/${id}/limits`],
    ["PATCH", `/api/platform/ai-bots/${id}/limits`],
    ["POST", `/api/platform/ai-bots/${id}/models`],
    ["PATCH", `/api/platform/ai-bots/${id}/models/uchiha-v1`],
    ["DELETE", `/api/platform/ai-bots/${id}/models/custom-1234`],
    ["POST", `/api/platform/ai-bots/${id}/users/123456789/pro`],
    ["POST", `/api/platform/ai-bots/${id}/users/123456789/ban`]
  ]) assert.equal(isBlockedCustomerAdminRoute(method, path), true, `${method} ${path} must be Telegram-only`);
});

test("purchase, BotFather token provisioning, reads and platform-owner pricing remain on the website", () => {
  for (const [method, path] of [
    ["POST", "/api/platform/ai-bots/purchase"],
    ["POST", `/api/platform/ai-bots/${id}/token`],
    ["GET", "/api/platform/ai-bots"],
    ["GET", `/api/platform/ai-bots/${id}`],
    ["GET", "/api/platform/admin/ai-product"],
    ["PATCH", "/api/platform/admin/ai-product"]
  ]) assert.equal(isBlockedCustomerAdminRoute(method, path), false, `${method} ${path} must remain available`);
});
