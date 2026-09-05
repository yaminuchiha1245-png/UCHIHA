from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old,new,1)

p=Path('bot/bot.js')
s=p.read_text()

# Replace only the loop inside the adm_topups handler, regardless of whitespace or
# the exact formatting of the existing Telegram message.
section_start=s.index('bot.action("adm_topups"')
loop_start=s.index('    for(const t of ts){',section_start)
section_end=s.index('  }catch{ctx.reply("تعذر تحميل طلبات الشحن.")}',loop_start)
loop_end=s.rfind('    }',loop_start,section_end)+len('    }')
new_loop='''    for(const t of ts){
      const receiptMissing=t.requiresReceipt===true&&!t.receiptUploaded;
      const receiptLabel=t.requiresReceipt?(t.receiptUploaded?"مطلوب • مرفوع":"مطلوب • غير مرفوع"):(t.receiptUploaded?"اختياري • مرفوع":"اختياري");
      const actions=receiptMissing
        ? [[Markup.button.callback(" رفض",`adm_topup_reject:${t.id}`)]]
        : [[Markup.button.callback(" قبول",`adm_topup_approve:${t.id}`),Markup.button.callback(" رفض",`adm_topup_reject:${t.id}`)]];
      await ctx.reply(` <b>طلب شحن</b>\nID: <code>${t.id}</code>\nالمستخدم: <code>${t.telegramId}</code>\nالمبلغ: <b>$${Number(t.amount).toFixed(2)}</b>\nالإيصال: <b>${receiptLabel}</b>${receiptMissing?"\\n⚠️ لا يمكن الاعتماد قبل رفع الإيصال المطلوب.":""}`,{
        parse_mode:"HTML",
        ...Markup.inlineKeyboard(actions)
      });
    }'''
s=s[:loop_start]+new_loop+s[loop_end:]

# Re-check the current top-up immediately before presenting an approval
# confirmation so an old Telegram button cannot bypass the latest receipt state.
confirm_start=s.index('bot.action(/^adm_topup_(approve|reject):(.+)$/')
confirm_end=s.index('bot.action(/^adm_topup_do_(approve|reject):(.+)$/',confirm_start)
confirm_section=s[confirm_start:confirm_end]
needle='  await ctx.answerCbQuery();\n'
if needle not in confirm_section:
    raise SystemExit('missing scoped anchor: admin bot confirmation answer')
guard='''  await ctx.answerCbQuery();
  if(action==="approve"){
    try{
      const current=(await api("/api/admin/topups",{},true)).find(t=>String(t.id)===String(topupId));
      if(!current)return ctx.reply("طلب الشحن غير موجود أو تمت معالجته.");
      if(current.status!=="pending")return ctx.reply("طلب الشحن لم يعد معلقًا.");
      if(current.requiresReceipt===true&&!current.receiptUploaded)return ctx.reply("⚠️ لا يمكن اعتماد هذا الشحن قبل رفع الإيصال المطلوب من العميل.");
    }catch{return ctx.reply("تعذر التحقق من حالة الإيصال حاليًا. لم يتم تنفيذ أي اعتماد.")}
  }
'''
confirm_section=confirm_section.replace(needle,guard,1)
s=s[:confirm_start]+confirm_section+s[confirm_end:]

# Give a clear message if the backend independently rejects approval because the
# receipt requirement changed after the Telegram confirmation was opened.
do_start=s.index('bot.action(/^adm_topup_do_(approve|reject):(.+)$/')
do_end=s.index('bot.action(/^adm_topup_cancel:/',do_start)
do_section=s[do_start:do_end]
old_catch='  }catch(e){ctx.reply("تعذر تنفيذ العملية: "+e.message)}\n});\n'
new_catch='''  }catch(e){
    if(e.message==="topup_receipt_required")ctx.reply("⚠️ لا يمكن اعتماد الشحن قبل رفع الإيصال المطلوب.");
    else ctx.reply("تعذر تنفيذ العملية: "+e.message);
  }
});
'''
if old_catch not in do_section:
    raise SystemExit('missing scoped anchor: admin bot execution catch')
do_section=do_section.replace(old_catch,new_catch,1)
s=s[:do_start]+do_section+s[do_end:]
p.write_text(s)

p=Path('server/scripts/web-security-audit.js')
s=p.read_text()
anchor='const adminJs=fs.readFileSync(path.join(root,"admin/admin.js"),"utf8");\n'
if 'const botJs=fs.readFileSync(path.join(root,"bot/bot.js"),"utf8");' not in s:
    s=replace_once(s,anchor,anchor+'const botJs=fs.readFileSync(path.join(root,"bot/bot.js"),"utf8");\n','bot audit source')
anchor='if(!adminJs.includes("receiptMissing=t.requiresReceipt&&!t.receiptUploaded")||!adminJs.includes("topup_receipt_required"))failures.push("admin topup receipt review guard missing");\n'
check='if(!botJs.includes("receiptMissing=t.requiresReceipt===true&&!t.receiptUploaded")||!botJs.includes("current.requiresReceipt===true&&!current.receiptUploaded")||!botJs.includes("topup_receipt_required"))failures.push("admin bot topup receipt review guard missing");\n'
if check not in s:
    s=replace_once(s,anchor,anchor+check,'bot receipt review audit')
p.write_text(s)

print('Admin Bot receipt-aware top-up review prepared')
