const test=require("node:test");
const assert=require("node:assert/strict");
const {
  normalizeRevision,snapshotHash,snapshotHmac,verifySnapshotRecord,nextRevision,
  boundedHistoryLimit,boundedHistoryDays,boundedHistoryIntervalSeconds
}=require("../lib/stateSnapshot");

const db={settings:{storeName:"Game Zone"},users:[],orders:[],transactions:[],products:[],categories:[],topups:[]};

test("state snapshot hash is stable and verifies",()=>{
  const hash=snapshotHash(db);
  assert.equal(hash.length,64);
  assert.equal(verifySnapshotRecord({data:db,dataSha256:hash}).ok,true);
  assert.equal(verifySnapshotRecord({data:{...db,users:[{telegramId:"1"}]},dataSha256:hash}).reason,"state_hash_mismatch");
});

test("state revisions are monotonic safe integers",()=>{
  assert.equal(normalizeRevision("7"),7);
  assert.equal(normalizeRevision(0),1);
  assert.equal(nextRevision(7),8);
  assert.throws(()=>nextRevision(Number.MAX_SAFE_INTEGER),/state_revision_exhausted/);
});

test("state history retention is bounded",()=>{
  assert.equal(boundedHistoryLimit(1),5);
  assert.equal(boundedHistoryLimit(999999),5000);
  assert.equal(boundedHistoryDays(0),1);
  assert.equal(boundedHistoryDays(999999),3650);
  assert.equal(boundedHistoryIntervalSeconds(1),30);
  assert.equal(boundedHistoryIntervalSeconds(999999),86400);
});


test("state snapshot HMAC detects malicious content/hash replacement",()=>{
  const key="state-hmac-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const hash=snapshotHash(db),hmac=snapshotHmac(db,key);
  assert.equal(hmac.length,64);
  assert.equal(verifySnapshotRecord({data:db,dataSha256:hash,dataHmac:hmac,hmacKey:key,requireHmac:true}).ok,true);

  const changed={...db,settings:{...db.settings,storeName:"Altered"}};
  // An attacker that updates the plain hash but does not know the HMAC secret is detected.
  const r=verifySnapshotRecord({data:changed,dataSha256:snapshotHash(changed),dataHmac:hmac,hmacKey:key,requireHmac:true});
  assert.equal(r.ok,false);
  assert.equal(r.reason,"state_hmac_mismatch");
});

test("state HMAC can be safely backfilled during RC9 migration then required",()=>{
  const key="state-hmac-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const legacy=verifySnapshotRecord({data:db,dataSha256:snapshotHash(db),dataHmac:null,hmacKey:key,requireHmac:false});
  assert.equal(legacy.ok,true);
  assert.equal(legacy.hmacMissing,true);
  assert.equal(verifySnapshotRecord({data:db,dataSha256:snapshotHash(db),dataHmac:null,hmacKey:key,requireHmac:true}).reason,"state_hmac_missing");
});
