import assert from "node:assert/strict";
import test from "node:test";

import { runMaintenance } from "../src/maintenance.mjs";

test("maintenance uses parameterized retention queries and returns deletion totals", async () => {
  const calls = [];
  const rowCounts = [2, 3, 5, 7, 11, 13, 17];
  const db = {
    async transaction(callback) {
      let index = 0;
      return callback({
        async query(text, values) {
          calls.push({ text, values });
          return { rowCount: rowCounts[index++] };
        }
      });
    }
  };

  const result = await runMaintenance(db, {
    revokedSessionDays: 8,
    idempotencyDays: 31,
    completedJobDays: 32,
    providerSyncDays: 91
  });

  assert.equal(calls.length, 7);
  assert.deepEqual(calls[0].values, [8]);
  assert.deepEqual(calls[2].values, [31]);
  assert.deepEqual(calls[5].values, [32]);
  assert.deepEqual(calls[6].values, [91]);
  assert.equal(calls.every((call) => call.text.includes("$1")), true);
  assert.equal(result.totalDeleted, rowCounts.reduce((sum, count) => sum + count, 0));
  assert.equal(result.deleted.platformSessions, 2);
  assert.equal(result.deleted.providerSyncLogs, 17);
});

test("maintenance refuses unsafe retention values", async () => {
  const db = { transaction() { throw new Error("must not execute"); } };

  await assert.rejects(() => runMaintenance(db, { idempotencyDays: 0 }), /between 1 and 3650/);
  await assert.rejects(() => runMaintenance(db, { providerSyncDays: 5000 }), /between 1 and 3650/);
});
