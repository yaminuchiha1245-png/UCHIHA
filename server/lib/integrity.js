const {verifyAuditChain}=require("./auditChain");
const {sanitizeProductInputSchema,sanitizeProviderInputMap}=require("./productInput");
function money(n){return Number(Number(n||0).toFixed(2));}
function key(v){return String(v??"");}
function isTerminal(status){return ["completed","failed","refunded","cancelled"].includes(status);}

function duplicateIssues(items,keyFn,collection){
  const seen=new Map(),issues=[];
  for(const item of items||[]){
    const value=keyFn(item);
    if(!value)continue;
    seen.set(value,(seen.get(value)||0)+1);
  }
  for(const [value,count] of seen){
    if(count>1)issues.push({
      code:"duplicate_identifier",severity:"critical",collection,ref:value,
      message:`${collection}: duplicate identifier ${value} (${count} records)`
    });
  }
  return issues;
}

function scanDatabaseIntegrity(db,{reviewStaleHours=24}={}){
  const issues=[];
  const add=(code,severity,message,meta={})=>issues.push({code,severity,message,...meta});
  const arrays=["users","orders","transactions","products","categories","topups","coupons","couponUsages","favorites","notifications","supportTickets","orderEvents","inventoryCodes","providers"];
  for(const name of arrays){
    if(!Array.isArray(db?.[name]))add("collection_missing","critical",`Required collection is missing: ${name}`,{collection:name});
  }
  if(issues.some(x=>x.code==="collection_missing")){
    return summarize(issues);
  }

  issues.push(...duplicateIssues(db.users,x=>key(x.telegramId),"users.telegramId"));
  issues.push(...duplicateIssues(db.orders,x=>key(x.orderNo),"orders.orderNo"));
  issues.push(...duplicateIssues(db.transactions,x=>key(x.id),"transactions.id"));
  issues.push(...duplicateIssues(db.topups,x=>key(x.id),"topups.id"));
  issues.push(...duplicateIssues(db.inventoryCodes,x=>key(x.id),"inventoryCodes.id"));

  const users=new Map(db.users.map(x=>[key(x.telegramId),x]));
  const orders=new Map(db.orders.map(x=>[key(x.orderNo),x]));
  const products=new Map(db.products.map(x=>[key(x.id),x]));
  const categories=new Set(db.categories.map(x=>key(x.id)));
  const providers=new Map(db.providers.map(x=>[key(x.id),x]));
  const topups=new Map(db.topups.map(x=>[key(x.id),x]));
  const inventoryById=new Map(db.inventoryCodes.map(x=>[key(x.id),x]));
  const eventCountByOrder=new Map();
  for(const e of db.orderEvents){
    const orderNo=key(e.orderNo);
    eventCountByOrder.set(orderNo,(eventCountByOrder.get(orderNo)||0)+1);
  }

  const txByUser=new Map(),txByRef=new Map();
  for(const t of db.transactions){
    const uid=key(t.telegramId),ref=key(t.reference);
    if(uid){if(!txByUser.has(uid))txByUser.set(uid,[]);txByUser.get(uid).push(t);}
    if(ref){if(!txByRef.has(ref))txByRef.set(ref,[]);txByRef.get(ref).push(t);}
  }

  for(const u of db.users){
    const tid=key(u.telegramId);
    const balance=money(u.balance);
    if(balance<0)add("negative_wallet","critical",`User ${tid} has negative wallet balance`,{telegramId:tid,balance});
    const ledger=money((txByUser.get(tid)||[]).reduce((sum,t)=>sum+Number(t.amount||0),0));
    if(Math.abs(balance-ledger)>0.009){
      add("wallet_ledger_mismatch","critical",`Wallet balance does not match transaction ledger for ${tid}`,{
        telegramId:tid,balance,ledger,difference:money(balance-ledger),repairable:true
      });
    }
  }

  for(const o of db.orders){
    const orderNo=key(o.orderNo),uid=key(o.telegramId);
    const refs=txByRef.get(orderNo)||[];
    const purchases=refs.filter(t=>t.type==="purchase");
    const refunds=refs.filter(t=>t.type==="refund");
    if(purchases.length!==1){
      add("order_purchase_ledger_count","critical",`Order ${orderNo} has ${purchases.length} purchase ledger entries`,{orderNo,count:purchases.length});
    }
    if(refunds.length>1){
      add("duplicate_order_refund","critical",`Order ${orderNo} has duplicate refunds`,{orderNo,count:refunds.length});
    }
    if(["failed","cancelled","refunded"].includes(o.status)&&refunds.length!==1){
      add("terminal_order_refund_missing","critical",`Terminal order ${orderNo} does not have exactly one refund`,{orderNo,status:o.status,refundCount:refunds.length});
    }
    if(o.status==="completed"&&refunds.length){
      add("completed_order_refunded","critical",`Completed order ${orderNo} also has a refund`,{orderNo});
    }
    if(!users.has(uid)&&!uid.startsWith("anon_")){
      add("order_user_missing","warning",`Order ${orderNo} references a missing user`,{orderNo,telegramId:uid});
    }
    if(!products.has(key(o.productId))){
      add("order_product_missing","warning",`Order ${orderNo} references a missing product`,{orderNo,productId:key(o.productId)});
    }
    if(!(eventCountByOrder.get(orderNo)||0))add("order_timeline_missing","warning",`Order ${orderNo} has no timeline events`,{orderNo});
    if(o.requiresManualReview&&isTerminal(o.status)){
      add("resolved_order_still_flagged","warning",`Terminal order ${orderNo} is still marked for review`,{orderNo,repairable:true});
    }
    if(o.requiresManualReview&&!isTerminal(o.status)){
      const ts=new Date(o.updatedAt||o.createdAt||0).getTime();
      if(Number.isFinite(ts)&&Date.now()-ts>Number(reviewStaleHours||24)*3600000){
        add("stale_provider_review","warning",`Provider-review order ${orderNo} is stale`,{orderNo,hours:reviewStaleHours});
      }
    }
    if(o.inventoryCodeId){
      const item=inventoryById.get(key(o.inventoryCodeId));
      if(!item)add("inventory_delivery_missing","critical",`Order ${orderNo} references a missing inventory code`,{orderNo,inventoryCodeId:o.inventoryCodeId});
      else if(key(item.orderNo)!==orderNo)add("inventory_order_mismatch","critical",`Inventory code ${item.id} belongs to a different order`,{orderNo,inventoryCodeId:item.id,itemOrderNo:item.orderNo});
    }
  }

  const paymentRefs=new Map();
  for(const t of db.topups){
    const ref=String(t.reference||"").trim().toLowerCase();
    if(!ref)continue;
    const identity=`${String(t.method||"").toLowerCase()}:${ref}`;
    if(!paymentRefs.has(identity))paymentRefs.set(identity,[]);
    paymentRefs.get(identity).push(t.id);
  }
  for(const [identity,ids] of paymentRefs){
    if(ids.length>1)add("duplicate_payment_reference","critical",`Payment reference is reused by ${ids.length} top-ups`,{referenceIdentity:identity,topupIds:ids});
  }

  for(const t of db.topups){
    const refs=(txByRef.get(key(t.id))||[]).filter(x=>x.type==="topup");
    if(t.status==="approved"&&refs.length!==1){
      add("approved_topup_ledger_count","critical",`Approved top-up ${t.id} has ${refs.length} credit ledger entries`,{topupId:t.id,count:refs.length});
    }
    if(["pending","rejected"].includes(t.status)&&refs.length){
      add("unapproved_topup_credited","critical",`Top-up ${t.id} is ${t.status} but has wallet credit`,{topupId:t.id,status:t.status,count:refs.length});
    }
  }
  for(const t of db.transactions.filter(x=>x.type==="topup")){
    if(!topups.has(key(t.reference)))add("orphan_topup_transaction","warning",`Top-up transaction ${t.id} references a missing top-up`,{transactionId:t.id,reference:t.reference});
  }

  const usagesByCode=new Map();
  for(const usage of db.couponUsages){
    const code=key(usage.code);
    usagesByCode.set(code,(usagesByCode.get(code)||0)+1);
    if(usage.orderNo&&!orders.has(key(usage.orderNo))){
      add("orphan_coupon_usage","warning",`Coupon usage references missing order ${usage.orderNo}`,{code,orderNo:usage.orderNo});
    }
  }
  for(const c of db.coupons){
    const expected=usagesByCode.get(key(c.code))||0,actual=Number(c.uses||0);
    if(expected!==actual)add("coupon_counter_mismatch","warning",`Coupon ${c.code} usage counter is ${actual}; ledger says ${expected}`,{code:c.code,actual,expected,repairable:true});
  }

  for(const item of db.inventoryCodes){
    if(item.status==="delivered"){
      if(!item.orderNo||!orders.has(key(item.orderNo))){
        add("orphan_delivered_inventory","critical",`Delivered inventory ${item.id} has no valid order`,{inventoryId:item.id,orderNo:item.orderNo||null});
      }
    }
  }

  for(const p of db.products){
    if(p.categoryId&&!categories.has(key(p.categoryId))){
      add("product_category_missing","warning",`Product ${p.id} references missing category ${p.categoryId}`,{productId:p.id,categoryId:p.categoryId});
    }
    let inputSchema=[];
    try{
      inputSchema=sanitizeProductInputSchema(p.inputSchema,{fallbackLabel:p.inputLabel||"بيانات الطلب",allowLegacyFallback:p.inputSchema==null});
      sanitizeProviderInputMap(p.providerInputMap,inputSchema);
    }catch(e){
      add("product_input_schema_invalid","warning",`Product ${p.id} has invalid customer input/API mapping: ${e.message}`,{productId:p.id});
    }
    if(p.active&&p.delivery==="auto"){
      const provider=providers.get(key(p.providerPrimary));
      if(!provider||provider.type!=="http"||!provider.active){
        add("auto_product_provider_missing","warning",`Active auto product ${p.id} has no active HTTP provider`,{productId:p.id,providerId:p.providerPrimary||null});
      }
      if(!p.providerProductId)add("auto_product_mapping_missing","warning",`Active auto product ${p.id} has no provider product ID`,{productId:p.id});
      if(provider&&inputSchema.length>1){
        const unmapped=inputSchema.filter((field,index)=>{
          const direct=p.providerInputMap?.[field.key];
          const configured=provider.requestFields?.[`customerData.${field.key}`];
          const legacyFirst=index===0&&provider.requestFields?.customerInput!==null;
          return !direct&&!configured&&!legacyFirst;
        });
        if(unmapped.length)add("auto_product_customer_mapping_missing","warning",`Active auto product ${p.id} has customer fields not mapped to provider API: ${unmapped.map(x=>x.key).join(",")}`,{productId:p.id,fields:unmapped.map(x=>x.key)});
      }
    }
  }

  const auditCheck=verifyAuditChain(db.adminAudit||[]);
  if(!auditCheck.ok)add("admin_audit_chain_broken","critical",`Admin audit hash chain is invalid at ${auditCheck.brokenAt||"unknown"}`,{reason:auditCheck.reason,brokenAt:auditCheck.brokenAt});

  for(const f of db.favorites){
    if(!users.has(key(f.telegramId))||!products.has(key(f.productId))){
      add("orphan_favorite","info","Favorite references a missing user or product",{telegramId:key(f.telegramId),productId:key(f.productId),repairable:true});
    }
  }
  for(const n of db.notifications){
    if(!users.has(key(n.telegramId)))add("orphan_notification","info","Notification references a missing user",{id:n.id,telegramId:key(n.telegramId),repairable:true});
  }
  for(const t of db.supportTickets){
    if(!users.has(key(t.telegramId)))add("orphan_support_ticket","info","Support ticket references a missing user",{id:t.id,telegramId:key(t.telegramId),repairable:true});
  }

  return summarize(issues);
}

function summarize(issues){
  const counts={critical:0,warning:0,info:0};
  for(const i of issues)counts[i.severity]=(counts[i.severity]||0)+1;
  return {
    ok:counts.critical===0,
    scannedAt:new Date().toISOString(),
    counts,
    total:issues.length,
    issues
  };
}

function repairSafeIntegrity(db){
  const changes=[];
  db.couponUsages ||= [];
  const usages=new Map();
  for(const u of db.couponUsages)usages.set(key(u.code),(usages.get(key(u.code))||0)+1);
  for(const c of db.coupons||[]){
    const expected=usages.get(key(c.code))||0;
    if(Number(c.uses||0)!==expected){
      changes.push({type:"coupon_counter",code:c.code,before:Number(c.uses||0),after:expected});
      c.uses=expected;
    }
  }

  const userIds=new Set((db.users||[]).map(x=>key(x.telegramId)));
  const productIds=new Set((db.products||[]).map(x=>key(x.id)));
  const prune=(collection,predicate,type)=>{
    const before=(db[collection]||[]).length;
    db[collection]=(db[collection]||[]).filter(predicate);
    const removed=before-db[collection].length;
    if(removed)changes.push({type,removed});
  };
  prune("favorites",x=>userIds.has(key(x.telegramId))&&productIds.has(key(x.productId)),"orphan_favorites");
  prune("notifications",x=>userIds.has(key(x.telegramId)),"orphan_notifications");
  prune("supportTickets",x=>userIds.has(key(x.telegramId)),"orphan_support_tickets");

  for(const o of db.orders||[]){
    if(o.requiresManualReview&&isTerminal(o.status)){
      o.requiresManualReview=false;o.reviewResolvedAt=o.reviewResolvedAt||new Date().toISOString();
      changes.push({type:"clear_terminal_review_flag",orderNo:o.orderNo});
    }
  }
  return {changes,count:changes.length};
}

function reconcileWalletBalances(db){
  const txByUser=new Map();
  for(const t of db.transactions||[]){
    const tid=key(t.telegramId);
    if(!tid||tid.startsWith("anon_"))continue;
    txByUser.set(tid,money((txByUser.get(tid)||0)+Number(t.amount||0)));
  }
  const changes=[];
  for(const u of db.users||[]){
    const tid=key(u.telegramId),expected=money(txByUser.get(tid)||0),before=money(u.balance);
    if(Math.abs(before-expected)>0.009){
      u.balance=expected;u.updatedAt=new Date().toISOString();
      changes.push({telegramId:tid,before,after:expected});
    }
  }
  return {changes,count:changes.length};
}

module.exports={scanDatabaseIntegrity,repairSafeIntegrity,reconcileWalletBalances};
