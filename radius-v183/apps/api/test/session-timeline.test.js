import test from "node:test";
import assert from "node:assert/strict";
import { devSession, headers, setup } from "./helpers.js";
import { OperationalService } from "../src/operational-service.js";

test("the real SQLite session history has 24 UTC hour bins and 7 UTC day bins", async t => {
  const { app, db, close } = await setup();
  t.after(close);
  const login = await devSession(app);
  for (const [period, bins] of [["day",24],["week",7]]) {
    const result = await app.inject({method:"GET",url:"/api/v1/reports/sessions-timeline?period="+period,headers:headers(login.token)});
    assert.equal(result.statusCode,200,result.body);
    const data=result.json().data;
    assert.equal(data.period,period);
    assert.equal(data.timeZone,"UTC");
    assert.equal(data.metric,"session_starts");
    assert.equal(data.buckets.length,bins);
    assert.equal(data.totalStarts,data.buckets.reduce((s,b)=>s+b.starts,0));
    assert.ok(data.buckets.every(b=>/^\d{4}-\d\d-\d\dT/.test(b.at)&&b.starts>=0&&Number.isInteger(b.starts)));
  }
  const invalid=await app.inject({method:"GET",url:"/api/v1/reports/sessions-timeline?period=year",headers:headers(login.token)});
  assert.equal(invalid.statusCode,400);
});

test("the PostgreSQL timeline query aggregates TIMESTAMPTZ explicitly in UTC", async () => {
  const reads=[];
  const db={driver:"postgres",all:async (sql,params)=>{
    reads.push({sql,params});return [{bucket:new Date().toISOString().slice(0,13),started:3}];
  }};
  const service=new OperationalService({db,config:{}});
  const context={permissions:new Set(["reports:read"]),tenantId:"test_tenant"};
  // Exercise this method's permission guard with a known authorized role.
  context.role="owner";
  context.membership={role:"owner",status:"active"};
  const actual=await service.sessionsTimeline(context,"day");
  assert.equal(actual.buckets.length,24);
  assert.match(reads[0].sql,/to_char\(started_at AT TIME ZONE 'UTC'/);
  assert.doesNotMatch(reads[0].sql,/substr\(started_at/);
  assert.equal(reads[0].params[0],"test_tenant");
});
