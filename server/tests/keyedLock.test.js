const test=require("node:test");
const assert=require("node:assert/strict");
const {withKeyLocks,normalizeKeys,getLockStats,resetLockStatsForTests}=require("../lib/keyedLock");

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test("keyed lock serializes the same financial key",async()=>{
  resetLockStatsForTests();
  const events=[];
  const a=withKeyLocks(["user:1"],async()=>{events.push("a:start");await sleep(35);events.push("a:end")});
  await sleep(5);
  const b=withKeyLocks(["user:1"],async()=>{events.push("b:start");events.push("b:end")});
  await Promise.all([a,b]);
  assert.deepEqual(events,["a:start","a:end","b:start","b:end"]);
  assert.equal(getLockStats().activeKeys,0);
});

test("different keys can execute concurrently",async()=>{
  resetLockStatsForTests();
  let active=0,max=0;
  const run=key=>withKeyLocks([key],async()=>{active++;max=Math.max(max,active);await sleep(25);active--});
  await Promise.all([run("user:1"),run("user:2")]);
  assert.equal(max,2);
});

test("multi-key locks sort keys to avoid lock-order deadlocks",async()=>{
  resetLockStatsForTests();
  assert.deepEqual(normalizeKeys(["order:2","user:1","order:2"]),["order:2","user:1"]);
  const events=[];
  await Promise.all([
    withKeyLocks(["user:1","order:2"],async()=>{events.push("a");await sleep(20)}),
    withKeyLocks(["order:2","user:1"],async()=>{events.push("b")})
  ]);
  assert.deepEqual(events,["a","b"]);
});

test("waiting lock times out instead of hanging forever",async()=>{
  resetLockStatsForTests();
  let releaseFirst;
  const first=withKeyLocks(["user:1"],async()=>new Promise(resolve=>{releaseFirst=resolve}));
  await sleep(5);
  await assert.rejects(
    withKeyLocks(["user:1"],async()=>{}, {timeoutMs:20}),
    e=>e.code==="operation_lock_timeout"
  );
  releaseFirst();
  await first;
  assert.equal(getLockStats().timedOut,1);
});
