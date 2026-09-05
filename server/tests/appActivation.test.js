const assert=require("assert");
const {ACTIVATION_MINUTES,normalizeActivationCode,createActivationRecord,consumeActivation}=require("../lib/appActivation");

const at=Date.UTC(2026,8,5,12,0,0);
const rec=createActivationRecord({id:"act_1",telegramId:"123",at});
assert.equal(ACTIVATION_MINUTES,5);
assert.equal(rec.mode,"android_activation");
assert.equal(rec.status,"issued");
assert.equal(new Date(rec.expiresAt).getTime()-at,5*60*1000);
assert.match(rec.code,/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
assert.equal(normalizeActivationCode(rec.code.replace("-","")),rec.code);
let r=consumeActivation([rec],rec.code.replace("-",""),at+4*60*1000);
assert.equal(r.ok,true);assert.equal(rec.status,"consumed");
assert.equal(consumeActivation([rec],rec.code,at+4*60*1000).ok,false,"activation must be one-time");
const expired=createActivationRecord({id:"act_2",telegramId:"123",at});
r=consumeActivation([expired],expired.code,at+5*60*1000);
assert.equal(r.ok,false);assert.equal(r.error,"activation_expired");assert.equal(expired.status,"expired");
console.log("appActivation.test.js PASS");
