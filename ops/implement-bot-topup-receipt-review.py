from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old,new,1)

p=Path('bot/bot.js')
s=p.read_text()

old='''    for(const t of ts){
      await ctx.reply(` <b>طلب شحن</b>\nID: <code>${t.id}</code>\nالمستخدم: <code>${t.telegramId}</code>\nالمبلغ: <b>$${Number(t.amount).toFixed(2)}</b>`,{
        parse_mode:"HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback(" قبول",`adm_topup_approve:${t.id}`),Markup.button.callback(" رفض",`adm_topup_reject:${t.id}`)]])
      });
    }'''
new='''    for(const t of ts){
      const receiptMissing=t.requiresReceipt===true&&!t.receiptUploaded;
      const receiptLabel=t.requiresReceipt?(t.receiptUploaded?"مطلوب • مرفوع":"مطلوب • غير مرفوع"):(t.receiptUploaded?"اختياري • مرفوع":"اختياري");
      const actions=receiptMissing
        ? [[Markup.button.callback(" رفض",`adm_topup_reject:${t.id}`)]]
        : [[Markup.button.callback(" قبول",`adm_topup_approve:${t.id}`),Markup.button.callback(" رفض",`adm_topup_reject:${t.id}`)]];
      await ctx.reply(` <b>طلب شحن</b>\nID: <code>${t.id}</code>\nالمستخدم: <code>${t.telegramId}</code>\nالمبلغ: <b>$${Number(t.amount).toFixed(2)}</b>\nالإيصال: <b>${receiptLabel}</b>${receiptMissing?"\n⚠️ لا يمكن الاعتماد قبل رفع الإيصال المطلوب.":""}`,{
        parse_mode:"HTML",
        ...Markup.inlineKeyboard(actions)
      });
    }'''
s=replace_once(s,old,new,'admin bot topup list')

old='''  const action=ctx.match[1],topupId=ctx.match[2];
  await ctx.answerCbQuery();
  const label=action==="approve"?"قبول الشحن وإضافة الرصيد":"رفض طلب الشحن";'''
new='''  const action=ctx.match[1],topupId=ctx.match[2];
  await ctx.answerCbQuery();
  if(action==="approve"){
    try{
      const current=(await api("/api/admin/topups",{},true)).find(t=>String(t.id)===String(topupId));
      if(!current)return ctx.reply("طلب الشحن غير موجود أو تمت معالجته.");
      if(current.status!=="pending")return ctx.reply("طلب الشحن لم يعد معلقًا.");
      if(current.requiresReceipt===true&&!current.receiptUploaded)return ctx.reply("⚠️ لا يمكن اعتماد هذا الشحن قبل رفع الإيصال المطلوب من العميل.");
    }catch{return ctx.reply("تعذر التحقق من حالة الإيصال حاليًا. لم يتم تنفيذ أي اعتماد.")}
  }
  const label=action==="approve"?"قبول الشحن وإضافة الرصيد":"رفض طلب الشحن";'''
s=replace_once(s,old,new,'admin bot stale approval guard')

old='''  }catch(e){ctx.reply("تعذر تنفيذ العملية: "+e.message)}
});
bot.action(/^adm_topup_cancel:/'''
new='''  }catch(e){
    if(e.message==="topup_receipt_required")ctx.reply("⚠️ لا يمكن اعتماد الشحن قبل رفع الإيصال المطلوب.");
    else ctx.reply("تعذر تنفيذ العملية: "+e.message);
  }
});
bot.action(/^adm_topup_cancel:/'''
s=replace_once(s,old,new,'admin bot backend receipt error')
p.write_text(s)

p=Path('server/scripts/web-security-audit.js')
s=p.read_text()
anchor='''const adminJs=fs.readFileSync(path.join(root,"admin/admin.js"),"utf8");
'''
new=anchor+'''const botJs=fs.readFileSync(path.join(root,"bot/bot.js"),"utf8");
'''
s=replace_once(s,anchor,new,'bot audit source')
anchor='''if(!adminJs.includes("receiptMissing=t.requiresReceipt&&!t.receiptUploaded")||!adminJs.includes("topup_receipt_required"))failures.push("admin topup receipt review guard missing");
'''
new=anchor+'''if(!botJs.includes("receiptMissing=t.requiresReceipt===true&&!t.receiptUploaded")||!botJs.includes("current.requiresReceipt===true&&!current.receiptUploaded")||!botJs.includes("topup_receipt_required"))failures.push("admin bot topup receipt review guard missing");
'''
s=replace_once(s,anchor,new,'bot receipt review audit')
p.write_text(s)

print('Admin Bot receipt-aware top-up review prepared')
