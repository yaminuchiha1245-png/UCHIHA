const test=require("node:test");
const assert=require("node:assert/strict");
const {publicCategory,publicAnnouncement,publicFavorite,publicProduct,publicTransaction,publicSupportTicket,publicNotification,publicOrder,publicTopup,canCustomerCancel}=require("../lib/publicViews");

test("customer order view hides provider and profit internals",()=>{
  const db={orderEvents:[
    {orderNo:"GZ-1",status:"processing",note:"supplier secret response",source:"provider",createdAt:"2026-08-30T00:00:00Z"}
  ]};
  const order={
    id:"ord_internal",orderNo:"GZ-1",telegramId:"123",productId:"p1",productName:"Product",customerInput:"player1",
    basePrice:10,discount:1,finalPrice:9,cost:5,profit:4,currency:"USD",status:"processing",
    providerPrimary:"supplier",providerBackup:"backup",providerUsed:"supplier",providerOrderId:"P-SECRET",
    providerMessage:"supplier raw message",clientRequestId:"request-secret",createdAt:"2026-08-30T00:00:00Z",updatedAt:"2026-08-30T00:01:00Z"
  };
  const view=publicOrder(db,order);
  assert.equal(view.orderNo,"GZ-1");
  assert.equal(view.finalPrice,9);
  assert.equal(view.timeline[0].note,"الطلب قيد المعالجة");
  for(const key of ["id","telegramId","cost","profit","providerPrimary","providerBackup","providerUsed","providerOrderId","providerMessage","clientRequestId"]){
    assert.equal(Object.prototype.hasOwnProperty.call(view,key),false,`leaked ${key}`);
  }
});

test("customer top-up view hides internal processing metadata",()=>{
  const view=publicTopup({id:"t1",telegramId:"123",amount:20,currency:"USD",method:"manual",reference:"TX",status:"approved",processedBy:"admin",createdAt:"x",updatedAt:"y"});
  assert.equal(view.id,"t1");
  assert.equal(view.reference,"TX");
  assert.equal("telegramId" in view,false);
  assert.equal("processedBy" in view,false);
});


test("customer cancellation is limited to unfulfilled manual orders",()=>{
  assert.equal(canCustomerCancel({status:"processing",providerPrimary:"manual",providerUsed:"manual",providerOrderId:null}),true);
  assert.equal(canCustomerCancel({status:"processing",providerPrimary:"http-provider",providerUsed:null,providerOrderId:null}),false);
  assert.equal(canCustomerCancel({status:"processing",providerPrimary:"manual",providerUsed:"manual",providerOrderId:null,providerDelivery:{encrypted:true}}),false);
  assert.equal(canCustomerCancel({status:"processing",providerPrimary:"manual",providerUsed:"manual",manualFulfillmentStartedAt:"2026-08-30T00:00:00Z"}),false);
  assert.equal(canCustomerCancel({status:"completed",providerPrimary:"manual",providerUsed:"manual"}),false);
});


test("public product and account history views are whitelisted",()=>{
  const product=publicProduct({inventoryCodes:[]},{id:"p1",categoryId:"c1",name:"P",price:10,cost:4,profit:6,providerPrimary:"secret-provider",providerProductId:"SKU",delivery:"manual",featured:true});
  assert.equal(product.id,"p1");
  assert.equal("cost" in product,false);
  assert.equal("profit" in product,false);
  assert.equal("providerPrimary" in product,false);
  assert.equal("providerProductId" in product,false);

  const txn=publicTransaction({id:"t1",telegramId:"123",type:"refund",amount:5,currency:"USD",reference:"GZ-1",internalNote:"secret",createdAt:"x"});
  assert.equal("telegramId" in txn,false);
  assert.equal("internalNote" in txn,false);

  const ticket=publicSupportTicket({id:"s1",telegramId:"123",subject:"Help",message:"Hi",reply:"Ok",status:"closed",adminNote:"internal",createdAt:"x"});
  assert.equal("telegramId" in ticket,false);
  assert.equal("adminNote" in ticket,false);

  const notification=publicNotification({id:"n1",telegramId:"123",title:"T",body:"B",read:false,internal:"secret",createdAt:"x"});
  assert.equal("telegramId" in notification,false);
  assert.equal("internal" in notification,false);
});


test("public category/announcement/favorite views hide internal fields",()=>{
  const category=publicCategory({id:"c1",name:"Games",icon:"G",description:"D",sort:1,active:true,adminNote:"secret"});
  assert.equal("active" in category,false);
  assert.equal("adminNote" in category,false);

  const announcement=publicAnnouncement({id:"a1",title:"T",body:"B",type:"info",sort:1,active:true,adminOnly:"secret",createdAt:"x"});
  assert.equal("active" in announcement,false);
  assert.equal("adminOnly" in announcement,false);

  const favorite=publicFavorite({telegramId:"123",productId:"p1",createdAt:"x",internal:"secret"});
  assert.deepEqual(favorite,{productId:"p1",createdAt:"x"});
});


test("public product exposes owner delivery promise without supplier internals",()=>{
  const view=publicProduct({inventoryCodes:[]},{id:"p2",categoryId:"c",name:"P",price:1,delivery:"auto",deliveryText:"خلال 5 دقائق",providerPrimary:"supplier-x",providerProductId:"SECRET-SKU"});
  assert.equal(view.deliveryText,"خلال 5 دقائق");
  assert.equal("providerPrimary" in view,false);
  assert.equal("providerProductId" in view,false);
});

test("public order preserves the customer-facing delivery promise",()=>{
  const view=publicOrder({orderEvents:[]},{orderNo:"GZ-2",productId:"p",productName:"P",finalPrice:2,currency:"USD",status:"processing",createdAt:"x",updatedAt:"x",deliveryText:"ضمن أوقات العمل خلال 30 دقيقة"});
  assert.equal(view.deliveryText,"ضمن أوقات العمل خلال 30 دقيقة");
});
