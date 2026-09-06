function text(v){return String(v??"").trim();}

function isPlaceholderPaymentAccount(value){
  const x=text(value).toLowerCase();
  if(!x)return false;
  return x.includes("not configured")
    || x.includes("not set")
    || x.includes("placeholder")
    || x.includes("يتم تحديد بيانات التحويل")
    || x.includes("يحدد من الإدارة")
    || x.includes("غير مضبوط")
    || x.includes("غير مهيأ");
}

function isConfiguredPaymentMethod(method){
  if(!method||method.active!==true)return false;
  return !isPlaceholderPaymentAccount(method.account);
}

function visibleCategories(db){
  const categories=Array.isArray(db?.categories)?db.categories:[];
  const products=Array.isArray(db?.products)?db.products:[];
  const activeCategories=categories.filter(c=>c&&c.active===true);
  const byId=new Map(activeCategories.map(c=>[String(c.id),c]));
  const visible=new Set();
  for(const product of products){
    if(!product||product.active!==true)continue;
    let id=String(product.categoryId||"");
    const seen=new Set();
    while(id&&byId.has(id)&&!seen.has(id)){
      seen.add(id);visible.add(id);
      id=String(byId.get(id)?.parentId||"");
    }
  }
  return activeCategories.filter(c=>visible.has(String(c.id)));
}

function hardenLegacyDemoState(db){
  const changes=[];
  db.providers=Array.isArray(db.providers)?db.providers:[];
  db.products=Array.isArray(db.products)?db.products:[];
  db.coupons=Array.isArray(db.coupons)?db.coupons:[];
  db.paymentMethods=Array.isArray(db.paymentMethods)?db.paymentMethods:[];
  db.inventoryCodes=Array.isArray(db.inventoryCodes)?db.inventoryCodes:[];

  for(const provider of db.providers){
    const isDemo=String(provider?.id||"").toLowerCase()==="demo"||String(provider?.type||"").toLowerCase()==="demo";
    if(isDemo&&provider.active!==false){provider.active=false;changes.push(`provider:${provider.id||"demo"}:disabled`);}
  }

  for(const product of db.products){
    const id=String(product?.id||"");
    const obviousDemo=id==="gz-demo-code"||id==="offer-starter"||/\bDEMO\b/i.test(String(product?.name||""))||String(product?.name||"").includes("تجريبي")||String(product?.description||"").includes("تجريبي");
    if(String(product?.providerPrimary||"").toLowerCase()==="demo"){
      product.providerPrimary="manual";
      product.providerBackup=null;
      product.delivery="manual";
      product.deliveryText="يتم التنفيذ يدويًا بعد مراجعة الطلب";
      changes.push(`product:${id}:demo_to_manual`);
    }
    if(obviousDemo&&product.active!==false){product.active=false;product.featured=false;changes.push(`product:${id}:disabled_demo`);}
  }

  const sampleCoupon=db.coupons.find(c=>String(c?.code||"").toUpperCase()==="GZ10");
  if(sampleCoupon&&sampleCoupon.active===true&&String(sampleCoupon.type||"")==="percent"&&Number(sampleCoupon.value)===10&&Number(sampleCoupon.maxDiscount||0)===5&&Number(sampleCoupon.maxUses||0)===100){
    sampleCoupon.active=false;changes.push("coupon:GZ10:disabled_seed");
  }

  for(const method of db.paymentMethods){
    if(method?.active===true&&isPlaceholderPaymentAccount(method.account)){
      method.active=false;changes.push(`payment:${method.id||"unknown"}:disabled_placeholder`);
    }
  }

  const before=db.inventoryCodes.length;
  db.inventoryCodes=db.inventoryCodes.filter(row=>{
    const demoValue=/^GZ-DEMO-/i.test(String(row?.value||""));
    const demoProduct=String(row?.productId||"")==="gz-demo-code";
    return !(row?.status==="available"&&(demoValue||demoProduct));
  });
  if(db.inventoryCodes.length!==before)changes.push(`inventory:removed_available_demo:${before-db.inventoryCodes.length}`);

  return {changed:changes.length>0,changes,db};
}

module.exports={isPlaceholderPaymentAccount,isConfiguredPaymentMethod,visibleCategories,hardenLegacyDemoState};
