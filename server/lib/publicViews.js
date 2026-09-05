const {sanitizeDeliveryText}=require("./deliveryPromise");

function publicCategory(c){
  return {
    id:c.id,
    name:c.name,
    icon:c.icon||"",
    imageUrl:c.imageUrl||null,
    parentId:c.parentId||null,
    description:c.description||"",
    sort:Number(c.sort||0)
  };
}

function publicAnnouncement(a){
  return {
    id:a.id,
    title:a.title||"",
    body:a.body||"",
    type:a.type||"info",
    sort:Number(a.sort||0),
    createdAt:a.createdAt||null
  };
}

function publicFavorite(f){
  return {productId:f.productId,createdAt:f.createdAt||null};
}

function publicProduct(db,p){
  const view={
    id:p.id,
    categoryId:p.categoryId,
    name:p.name,
    icon:p.icon||"",
    imageUrl:p.imageUrl||null,
    description:p.description||"",
    price:Number(p.price||0),
    currency:p.currency||"USD",
    inputLabel:p.inputLabel||"بيانات الطلب",
    inputSchema:Array.isArray(p.inputSchema)?p.inputSchema.map(f=>({
      key:f.key,label:f.label,type:f.type||"text",required:f.required!==false,placeholder:f.placeholder||"",help:f.help||"",
      minLength:Number(f.minLength||0),maxLength:Number(f.maxLength||500),min:f.min==null?null:Number(f.min),max:f.max==null?null:Number(f.max),
      options:Array.isArray(f.options)?f.options.map(o=>({value:o.value,label:o.label})):[]
    })):[{key:"value",label:p.inputLabel||"بيانات الطلب",type:"text",required:p.inputRequired!==false,placeholder:"",help:"",minLength:1,maxLength:500,min:null,max:null,options:[]}],
    delivery:p.delivery||"manual",
    deliveryText:sanitizeDeliveryText(p.deliveryText,p.delivery),
    featured:!!p.featured
  };
  if(view.delivery==="inventory"){
    view.stock=(db.inventoryCodes||[]).filter(x=>x.productId===p.id&&x.status==="available").length;
  }
  return view;
}

function publicTransaction(t){
  return {
    id:t.id,
    type:t.type,
    amount:Number(t.amount||0),
    currency:t.currency||"USD",
    reference:t.reference||"",
    createdAt:t.createdAt
  };
}

function publicSupportTicket(t){
  return {
    id:t.id,
    subject:t.subject||"دعم فني",
    message:t.message||"",
    reply:t.reply||"",
    status:t.status||"open",
    createdAt:t.createdAt,
    updatedAt:t.updatedAt||t.createdAt
  };
}

function publicNotification(n){
  return {
    id:n.id,
    title:n.title||"",
    body:n.body||"",
    type:n.type||"info",
    ref:n.ref||null,
    read:!!n.read,
    createdAt:n.createdAt
  };
}

function publicOrderEvent(e){
  const notes={
    created:"تم إنشاء الطلب",
    pending:"الطلب قيد الانتظار",
    processing:"الطلب قيد المعالجة",
    completed:"اكتمل الطلب",
    failed:"تعذر تنفيذ الطلب",
    refunded:"تم استرجاع الرصيد",
    cancelled:"تم إلغاء الطلب"
  };
  return {status:e.status,note:notes[e.status]||"تم تحديث حالة الطلب",createdAt:e.createdAt};
}

function canCustomerCancel(o){
  return ["pending","processing"].includes(o.status)
    && !o.providerOrderId
    && !o.inventoryCodeId
    && !o.providerDelivery
    && !o.manualFulfillmentStartedAt
    && (o.providerUsed==="manual" || o.providerPrimary==="manual");
}

function publicOrder(db,o,{deliveryCode=null}={}){
  const timeline=(db.orderEvents||[])
    .filter(e=>e.orderNo===o.orderNo)
    .sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||"")))
    .map(publicOrderEvent);
  return {
    orderNo:o.orderNo,
    productId:o.productId,
    productName:o.productName,
    customerInput:o.customerInput,
    customerData:o.customerData&&typeof o.customerData==="object"&&!Array.isArray(o.customerData)?{...o.customerData}:null,
    basePrice:Number(o.basePrice??o.finalPrice??0),
    discount:Number(o.discount||0),
    finalPrice:Number(o.finalPrice||0),
    currency:o.currency||"USD",
    status:o.status,
    couponCode:o.couponCode||null,
    createdAt:o.createdAt,
    updatedAt:o.updatedAt,
    deliveryText:sanitizeDeliveryText(o.deliveryText,"manual"),
    deliveryAvailable:o.status==="completed"&&!!(o.inventoryCodeId||o.providerDelivery),
    cancelAvailable:canCustomerCancel(o),
    timeline,
    ...(deliveryCode?{deliveryCode}:{})
  };
}

function publicTopup(t){
  return {
    id:t.id,
    amount:Number(t.amount||0),
    currency:t.currency||"USD",
    method:t.method,
    reference:t.reference||"",
    status:t.status,
    createdAt:t.createdAt,
    updatedAt:t.updatedAt||t.createdAt,
    receiptUploaded:!!t.receiptFileName,
    receiptUploadedAt:t.receiptUploadedAt||null
  };
}

module.exports={publicCategory,publicAnnouncement,publicFavorite,publicProduct,publicTransaction,publicSupportTicket,publicNotification,publicOrderEvent,publicOrder,publicTopup,canCustomerCancel};
