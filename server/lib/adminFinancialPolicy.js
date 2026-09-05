function money(n){return Number(Number(n||0).toFixed(2));}
function findAdminAdjustment(transactions,{telegramId,clientRequestId}={}){
  const requestId=String(clientRequestId||"").trim();
  if(!requestId)return null;
  return (transactions||[]).find(t=>
    String(t.telegramId)===String(telegramId) &&
    String(t.adminRequestId||"")===requestId &&
    ["admin_credit","admin_debit"].includes(t.type)
  )||null;
}
function sameAdminAdjustment(tx,{amount}={}){
  return !!tx&&money(tx.amount)===money(amount);
}
module.exports={findAdminAdjustment,sameAdminAdjustment};
