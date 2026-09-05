function adminTopupView(t={}){
  return {
    id:t.id,
    telegramId:String(t.telegramId||""),
    amount:Number(t.amount||0),
    currency:t.currency||"USD",
    method:t.method||"manual",
    reference:t.reference||"",
    requiresReceipt:t.requiresReceipt===true,
    receiptUploaded:!!t.receiptFileName,
    receiptUploadedAt:t.receiptUploadedAt||null,
    status:t.status||"pending",
    createdAt:t.createdAt||null,
    updatedAt:t.updatedAt||t.createdAt||null
  };
}
module.exports={adminTopupView};
