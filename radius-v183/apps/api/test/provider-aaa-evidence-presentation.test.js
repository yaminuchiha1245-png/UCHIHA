import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Test the exact helper shipped inside the Telegram Mini App, without
// creating browser data, credentials or contacting any customer network.
const source=readFileSync(
 new URL("../../provider-v183-runtime/live-radius-readiness.js",import.meta.url),"utf8"
);
const present=runInNewContext(source+"\nv183AaaEvidencePresentation;",{});
const deviceId="dev_authorized_1234567";
const tenantEvents={
 authenticationRequests:200,accepted:194,rejected:6,
 accountingEvents:193,accountingStarts:182
};
const deviceEvents={
 authenticationRequests:2,accepted:0,rejected:2,
 accountingEvents:0,accountingStarts:0
};
const scoped=(events=deviceEvents,overrides={})=>({
 attribution:"unique_registered_endpoint",deviceId,deviceEvents:events,
 tenantEvents,...overrides
});

test("selected router never inherits overall tenant accept/accounting totals",()=>{
 const r=present(scoped(),deviceId);
 assert.equal(r.scoped,true);
 assert.equal(r.events.accepted,0);
 assert.equal(r.authObserved,false);
 assert.equal(r.accountingObserved,false);
 assert.equal(r.code,"no-accepted-auth");
 assert.equal(r.subscriberVerified,false);
 assert.equal(r.internetVerified,false);
});

test("a duplicate router address makes device evidence unavailable, not tenant-wide",()=>{
 const r=present({attribution:"ambiguous_duplicate_registration",
  deviceId,deviceEvents:null,tenantEvents},deviceId);
 assert.equal(r.events,null);
 assert.equal(r.code,"duplicate");
 assert.match(r.message[0],/مخفية/);
 assert.equal(r.authObserved,false);
});

test("a device mismatch cannot borrow another network router report",()=>{
 const r=present(scoped(tenantEvents,{deviceId:"dev_some_other_router"}),deviceId);
 assert.equal(r.events,null);
 assert.equal(r.code,"scope-unverified");
});

test("unscoped tenant evidence is allowed only as explicitly tenant-wide totals",()=>{
 const r=present({attribution:"tenant_only",tenantEvents},"");
 assert.equal(r.code,"tenant-summary");
 assert.equal(r.events.accepted,194);
 assert.equal(r.scoped,false);
 assert.equal(r.authObserved,false);
 assert.equal(r.accountingObserved,false);
 assert.equal(r.internetVerified,false);
});

test("device request cannot downgrade to tenant-only totals if an upstream source fails",()=>{
 const r=present({attribution:"tenant_only",tenantEvents},deviceId);
 assert.equal(r.events,null);
 assert.equal(r.code,"scope-unverified");
});

test("accepted authentication without accounting is a missing accounting warning",()=>{
 const r=present(scoped({accepted:1,accountingStarts:0}),deviceId);
 assert.equal(r.code,"no-accounting");
 assert.equal(r.authObserved,true);
 assert.equal(r.accountingObserved,false);
 assert.equal(r.subscriberVerified,false);
});

test("two independent positive events do not prove one subscriber or Internet",()=>{
 const r=present(scoped({accepted:3,accountingStarts:1}),deviceId);
 assert.equal(r.code,"separate-aaa-events");
 assert.equal(r.authObserved,true);
 assert.equal(r.accountingObserved,true);
 assert.equal(r.subscriberVerified,false);
 assert.equal(r.internetVerified,false);
 assert.match(r.message[0],/مشتركين مختلفين/);
});

test("invalid, missing and nonfinite counts never become proof",()=>{
 for(const events of [
  null,{accepted:"not-a-number",accountingStarts:"Infinite"},
  {accepted:-1,accountingStarts:-4},{}
 ]){
  const r=present(scoped(events),deviceId);
  assert.equal(r.authObserved,false);
  assert.equal(r.accountingObserved,false);
  assert.equal(r.subscriberVerified,false);
 }
});

test("browser dialog explicitly shows no per-router figures when attribution fails",()=>{
 assert.match(source,/const evidence=presentation.events/);
 assert.match(source,/evidence\?\.accepted\?\?'—'/);
 assert.match(source,/presentation\.message/);
});
