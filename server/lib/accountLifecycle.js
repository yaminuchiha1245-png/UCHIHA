const {backfillAuditChain}=require("./auditChain");
function anonymizeAndDeleteAccount(db, telegramId, { anonymousId, deletedAt, deletionId } = {}) {
  const tid=String(telegramId||"");
  if(!tid)throw new Error("telegram_id_required");
  const idx=(db.users||[]).findIndex(x=>String(x.telegramId)===tid);
  if(idx<0)throw new Error("user_not_found");
  if(!anonymousId||!deletedAt||!deletionId)throw new Error("deletion_metadata_required");

  const user=db.users[idx];
  db.users.splice(idx,1);

  let orderCount=0,transactionCount=0,topupCount=0;
  for(const o of db.orders||[]){
    if(String(o.telegramId)===tid){
      o.telegramId=anonymousId;
      if(o.customerInput)o.customerInput="[deleted]";
      if(o.customerData&&typeof o.customerData==="object"&&!Array.isArray(o.customerData))o.customerData=Object.fromEntries(Object.keys(o.customerData).map(k=>[k,"[deleted]"]));
      o.deletedAccount=true;
      orderCount++;
    }
  }
  for(const t of db.transactions||[]){
    if(String(t.telegramId)===tid){t.telegramId=anonymousId;transactionCount++;}
  }
  for(const t of db.topups||[]){
    if(String(t.telegramId)===tid){t.telegramId=anonymousId;t.deletedAccount=true;topupCount++;}
  }

  const before={
    favorites:(db.favorites||[]).length,
    notifications:(db.notifications||[]).length,
    supportTickets:(db.supportTickets||[]).length,
    verificationRequests:(db.verificationRequests||[]).length,
    devicePairs:(db.devicePairs||[]).length,
    couponUsages:(db.couponUsages||[]).length
  };
  db.favorites=(db.favorites||[]).filter(x=>String(x.telegramId)!==tid);
  db.notifications=(db.notifications||[]).filter(x=>String(x.telegramId)!==tid);
  db.supportTickets=(db.supportTickets||[]).filter(x=>String(x.telegramId)!==tid);
  db.verificationRequests=(db.verificationRequests||[]).filter(x=>String(x.telegramId)!==tid);
  db.devicePairs=(db.devicePairs||[]).filter(x=>String(x.telegramId)!==tid);

  const removedCouponCounts=new Map();
  db.couponUsages=(db.couponUsages||[]).filter(x=>{
    const match=String(x.telegramId)===tid;
    if(match)removedCouponCounts.set(String(x.code),(removedCouponCounts.get(String(x.code))||0)+1);
    return !match;
  });
  for(const c of db.coupons||[]){
    const removedUses=removedCouponCounts.get(String(c.code))||0;
    if(removedUses)c.uses=Math.max(0,Number(c.uses||0)-removedUses);
  }

  // Preserve operational audit history while removing the direct Telegram identifier.
  let auditChanged=false;
  for(const a of db.adminAudit||[]){
    if(a.meta&&String(a.meta.telegramId||"")===tid){a.meta.telegramId=anonymousId;auditChanged=true;}
  }
  if(auditChanged)backfillAuditChain(db.adminAudit);

  const removed={
    favorites:before.favorites-db.favorites.length,
    notifications:before.notifications-db.notifications.length,
    supportTickets:before.supportTickets-db.supportTickets.length,
    verificationRequests:before.verificationRequests-db.verificationRequests.length,
    devicePairs:before.devicePairs-db.devicePairs.length,
    couponUsages:before.couponUsages-db.couponUsages.length
  };

  db.deletedAccounts ||= [];
  db.deletedAccounts.unshift({
    id:deletionId,
    anonymousId,
    deletedAt,
    hadUsername:!!user.username,
    orderCount
  });
  db.deletedAccounts=db.deletedAccounts.slice(0,1000);

  return { user, anonymousId, deletedAt, orderCount, transactionCount, topupCount, removed };
}

module.exports={anonymizeAndDeleteAccount};
