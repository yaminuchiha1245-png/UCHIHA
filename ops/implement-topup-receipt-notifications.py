from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)

p=Path('server/server.js')
s=p.read_text()
anchor='''    await persistCritical(db);\n    if(old&&old!==saved.fileName){try{fs.unlinkSync(path.join(RECEIPT_DIR,safeFileName(old)))}catch{}}\n'''
insert='''    await persistCritical(db);\n    notifyAdmins(`${old?"🔁":"🧾"} <b>${old?"تم تحديث إيصال شحن":"تم رفع إيصال شحن"}</b>\\\nID: <code>${tgEsc(t.id)}</code>\\\nالمستخدم: <code>${tgEsc(t.telegramId)}</code>\\\nالمبلغ: <b>$${Number(t.amount||0).toFixed(2)}</b>\\\nالطريقة: <code>${tgEsc(t.method||"manual")}</code>\\\nافتح الشحن المعلق ثم عرض الإيصال للمراجعة.`);\n    if(old&&old!==saved.fileName){try{fs.unlinkSync(path.join(RECEIPT_DIR,safeFileName(old)))}catch{}}\n'''
if 'تم تحديث إيصال شحن' not in s:
    s=replace_once(s,anchor,insert,'receipt upload notification')
p.write_text(s)

p=Path('server/scripts/web-security-audit.js')
s=p.read_text()
anchor='if(!server.includes("topupApprovalEvidenceError")||!adminTopupPolicy.includes("topup_receipt_required"))failures.push("required topup receipt backend policy missing");\n'
check='if(!server.includes("تم رفع إيصال شحن")||!server.includes("تم تحديث إيصال شحن"))failures.push("topup receipt admin notification missing");\n'
if check not in s:
    s=replace_once(s,anchor,anchor+check,'receipt notification security audit')
p.write_text(s)

print('Top-up receipt admin notifications prepared')
