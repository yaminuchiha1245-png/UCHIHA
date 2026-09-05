const test=require("node:test");
const assert=require("node:assert/strict");
const {appendAuditEntry,backfillAuditChain,verifyAuditChain}=require("../lib/auditChain");

test("audit chain links newest entries to prior hashes",()=>{
  const rows=[];
  appendAuditEntry(rows,{id:"a1",action:"one",meta:{x:1},ip:"1.1.1.1",createdAt:"2026-01-01T00:00:00Z"});
  appendAuditEntry(rows,{id:"a2",action:"two",meta:{x:2},ip:"1.1.1.1",createdAt:"2026-01-01T00:00:01Z"});
  assert.equal(rows[0].prevHash,rows[1].hash);
  assert.equal(verifyAuditChain(rows).ok,true);
});

test("audit chain detects tampering",()=>{
  const rows=[];
  appendAuditEntry(rows,{id:"a1",action:"one",meta:{amount:5},ip:"x",createdAt:"x"});
  appendAuditEntry(rows,{id:"a2",action:"two",meta:{amount:7},ip:"x",createdAt:"y"});
  rows[1].meta.amount=500;
  const r=verifyAuditChain(rows);
  assert.equal(r.ok,false);
  assert.equal(r.reason,"hash_mismatch");
});

test("legacy audit rows can be backfilled deterministically",()=>{
  const rows=[
    {id:"new",action:"new",meta:{},ip:"x",createdAt:"2"},
    {id:"old",action:"old",meta:{},ip:"x",createdAt:"1"}
  ];
  const r=backfillAuditChain(rows);
  assert.equal(r.changed,true);
  assert.equal(verifyAuditChain(rows).ok,true);
});


test("audit HMAC chain cannot be verified with a different secret",()=>{
  const before=process.env.AUDIT_HMAC_KEY;
  process.env.AUDIT_HMAC_KEY="audit-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const rows=[];
  appendAuditEntry(rows,{id:"a1",action:"one",meta:{},ip:"x",createdAt:"1"});
  assert.equal(verifyAuditChain(rows).ok,true);
  process.env.AUDIT_HMAC_KEY="audit-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  assert.equal(verifyAuditChain(rows).ok,false);
  if(before===undefined)delete process.env.AUDIT_HMAC_KEY;else process.env.AUDIT_HMAC_KEY=before;
});
