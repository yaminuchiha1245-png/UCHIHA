const test=require("node:test");
const assert=require("node:assert/strict");
const {
  subjectKey,orderBody,topupBody,rowHmac,businessSummary,
  allowedOrderTransition,allowedTopupTransition,deriveBusinessChanges,
  verifyOrderRow,verifyTopupRow
}=require("../lib/businessAuthority");

const key="business-authority-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const baseDb={
  users:[{telegramId:"100",balance:50,currency:"USD"}],
  orders:[{
    id:"o1",orderNo:"GZ-1",telegramId:"100",productId:"p1",productName:"Game",customerInput:"ID-1",
    basePrice:10,discount:0,finalPrice:10,cost:5,profit:5,currency:"USD",status:"processing",
    providerOrderId:null,providerUsed:null,requiresManualReview:false,couponCode:null,clientRequestId:"r1",createdAt:"2026-01-01"
  }],
  topups:[{
    id:"t1",telegramId:"100",amount:20,currency:"USD",method:"usdt",status:"pending",
    reference:null,clientRequestId:"tr1",createdAt:"2026-01-01"
  }]
};

test("business subject keys are deterministic and pseudonymous",()=>{
  const a=subjectKey("100",key),b=subjectKey("100",key);
  assert.equal(a,b);
  assert.equal(a.length,64);
  assert.notEqual(a,"100");
});

test("order/topup authority HMAC detects tampering",()=>{
  const ob=orderBody(baseDb.orders[0],7,key),oh=rowHmac(ob,key);
  const orderRow={
    order_id:ob.orderId,order_no:ob.orderNo,subject_key:ob.subjectKey,product_id:ob.productId,
    status:ob.status,final_price:ob.finalPrice,currency:ob.currency,provider_order_id:ob.providerOrderId,
    provider_used:ob.providerUsed,requires_manual_review:ob.requiresManualReview,
    immutable_digest:ob.immutableDigest,last_state_revision:ob.lastStateRevision,row_hmac:oh
  };
  assert.equal(verifyOrderRow(orderRow,key).ok,true);
  orderRow.status="completed";
  assert.equal(verifyOrderRow(orderRow,key).reason,"business_authority_order_hmac_mismatch");

  const tb=topupBody(baseDb.topups[0],7,key),th=rowHmac(tb,key);
  const topupRow={
    topup_id:tb.topupId,subject_key:tb.subjectKey,amount:tb.amount,currency:tb.currency,method:tb.method,
    status:tb.status,reference:tb.reference,immutable_digest:tb.immutableDigest,
    last_state_revision:tb.lastStateRevision,row_hmac:th
  };
  assert.equal(verifyTopupRow(topupRow,key).ok,true);
  topupRow.amount=999;
  assert.equal(verifyTopupRow(topupRow,key).reason,"business_authority_topup_hmac_mismatch");
});

test("business authority allows expected order lifecycle but blocks terminal reversal",()=>{
  assert.equal(allowedOrderTransition("processing","pending"),true);
  assert.equal(allowedOrderTransition("pending","completed"),true);
  assert.equal(allowedOrderTransition("completed","refunded"),true);
  assert.equal(allowedOrderTransition("completed","processing"),false);
  assert.equal(allowedOrderTransition("refunded","completed"),false);
});

test("business authority allows only pending topup finalization",()=>{
  assert.equal(allowedTopupTransition("pending","approved"),true);
  assert.equal(allowedTopupTransition("pending","rejected"),true);
  assert.equal(allowedTopupTransition("approved","pending"),false);
  assert.equal(allowedTopupTransition("rejected","approved"),false);
});

test("immutable order fields cannot be rewritten after creation",()=>{
  const after=structuredClone(baseDb);
  after.orders[0].finalPrice=1;
  assert.throws(()=>deriveBusinessChanges(baseDb,after,key),/business_authority_order_immutable_change/);
});

test("provider identity can be assigned once but not replaced",()=>{
  const withProvider=structuredClone(baseDb);
  withProvider.orders[0].providerOrderId="P-1";
  withProvider.orders[0].providerUsed="supplier-a";
  const changes=deriveBusinessChanges(baseDb,withProvider,key);
  assert.equal(changes.orders.length,1);

  const changedProvider=structuredClone(withProvider);
  changedProvider.orders[0].providerOrderId="P-2";
  assert.throws(()=>deriveBusinessChanges(withProvider,changedProvider,key),/business_authority_provider_order_id_change/);
});

test("topup payment reference may be filled once and then becomes immutable",()=>{
  const paid=structuredClone(baseDb);
  paid.topups[0].reference="TX-1";
  paid.topups[0].status="approved";
  assert.equal(deriveBusinessChanges(baseDb,paid,key).topups.length,1);

  const changed=structuredClone(paid);
  changed.topups[0].reference="TX-2";
  assert.throws(()=>deriveBusinessChanges(paid,changed,key),/business_authority_topup_reference_change/);
});

test("normal operation cannot delete orders or topups",()=>{
  const noOrder=structuredClone(baseDb);noOrder.orders=[];
  assert.throws(()=>deriveBusinessChanges(baseDb,noOrder,key),/business_authority_order_deletion_forbidden/);
  const noTopup=structuredClone(baseDb);noTopup.topups=[];
  assert.throws(()=>deriveBusinessChanges(baseDb,noTopup,key),/business_authority_topup_deletion_forbidden/);
});

test("new records must begin in canonical initial states",()=>{
  const before={...structuredClone(baseDb),orders:[],topups:[]};
  const after=structuredClone(baseDb);
  assert.equal(deriveBusinessChanges(before,after,key).orders[0].kind,"create");
  assert.equal(deriveBusinessChanges(before,after,key).topups[0].kind,"create");

  const badOrder=structuredClone(after);badOrder.orders[0].status="completed";
  assert.throws(()=>deriveBusinessChanges(before,badOrder,key),/business_authority_new_order_status_invalid/);
  const badTopup=structuredClone(after);badTopup.topups[0].status="approved";
  assert.throws(()=>deriveBusinessChanges(before,badTopup,key),/business_authority_new_topup_status_invalid/);
});

test("business authority summary is deterministic",()=>{
  const a=businessSummary(baseDb,5,key),b=businessSummary(structuredClone(baseDb),5,key);
  assert.deepEqual(a,b);
  assert.equal(a.orderCount,1);
  assert.equal(a.topupCount,1);
  assert.equal(a.orderDigest.length,64);
  assert.equal(a.topupDigest.length,64);
});


test("account anonymization can rotate pseudonymous subjects without rewriting financial identity",()=>{
  const after=structuredClone(baseDb);
  after.orders[0].telegramId="deleted_anon_1";
  after.orders[0].customerInput="[deleted]";
  after.orders[0].deletedAccount=true;
  after.topups[0].telegramId="deleted_anon_1";
  after.topups[0].deletedAccount=true;
  const changes=deriveBusinessChanges(baseDb,after,key);
  assert.equal(changes.orders.length,1);
  assert.equal(changes.topups.length,1);
  assert.notEqual(subjectKey(baseDb.orders[0].telegramId,key),subjectKey(after.orders[0].telegramId,key));
});

test("business subject changes are rejected outside account-deletion lifecycle",()=>{
  const after=structuredClone(baseDb);
  after.orders[0].telegramId="attacker";
  assert.throws(()=>deriveBusinessChanges(baseDb,after,key),/business_authority_order_subject_change/);
  const afterTopup=structuredClone(baseDb);
  afterTopup.topups[0].telegramId="attacker";
  assert.throws(()=>deriveBusinessChanges(baseDb,afterTopup,key),/business_authority_topup_subject_change/);
});
