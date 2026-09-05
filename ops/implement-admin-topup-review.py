from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old,new,1)

# Dedicated admin projection: expose the operational facts needed by the panel,
# without coupling the UI to receipt storage filenames.
Path('server/lib/adminTopupView.js').write_text('''function adminTopupView(t={}){\n  return {\n    id:t.id,\n    telegramId:String(t.telegramId||""),\n    amount:Number(t.amount||0),\n    currency:t.currency||"USD",\n    method:t.method||"manual",\n    reference:t.reference||"",\n    requiresReceipt:t.requiresReceipt===true,\n    receiptUploaded:!!t.receiptFileName,\n    receiptUploadedAt:t.receiptUploadedAt||null,\n    status:t.status||"pending",\n    createdAt:t.createdAt||null,\n    updatedAt:t.updatedAt||t.createdAt||null\n  };\n}\nmodule.exports={adminTopupView};\n''')
Path('server/tests/adminTopupView.test.js').write_text('''const test=require("node:test");\nconst assert=require("node:assert/strict");\nconst {adminTopupView}=require("../lib/adminTopupView");\n\ntest("admin top-up view derives uploaded receipt from stored file safely",()=>{\n  const v=adminTopupView({id:"t1",telegramId:"123",amount:20,method:"manual",requiresReceipt:true,receiptFileName:"secret-internal-name.webp",receiptUploadedAt:"2026-09-05T00:00:00Z",status:"pending"});\n  assert.equal(v.requiresReceipt,true);\n  assert.equal(v.receiptUploaded,true);\n  assert.equal(v.receiptUploadedAt,"2026-09-05T00:00:00Z");\n  assert.equal(Object.hasOwn(v,"receiptFileName"),false);\n});\n\ntest("admin top-up view reports missing optional receipt clearly",()=>{\n  const v=adminTopupView({id:"t2",telegramId:"456",amount:5,status:"pending"});\n  assert.equal(v.requiresReceipt,false);\n  assert.equal(v.receiptUploaded,false);\n});\n''')

p=Path('server/server.js')
s=p.read_text()
s=replace_once(s,
'const { sanitizeDecision:sanitizeVerificationDecision, publicVerification } = require("./lib/verificationPolicy");',
'const { sanitizeDecision:sanitizeVerificationDecision, publicVerification } = require("./lib/verificationPolicy");\nconst { adminTopupView } = require("./lib/adminTopupView");',
'admin topup view import')
s=replace_once(s,
'app.get("/api/admin/topups",adminOnly,(req,res)=>res.json(readDB().topups.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))));',
'app.get("/api/admin/topups",adminOnly,(req,res)=>res.json((readDB().topups||[]).slice().sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))).map(adminTopupView)));',
'admin topup list projection')
p.write_text(s)

p=Path('admin/admin.js')
s=p.read_text()
s=replace_once(s,
'  topups:[{id:"topup_preview_1",telegramId:"8120730186",amount:20,status:"pending",method:"manual",receiptUploaded:true,receiptUploadedAt:new Date().toISOString(),createdAt:new Date().toISOString()}],',
'  topups:[{id:"topup_preview_1",telegramId:"8120730186",amount:20,status:"pending",method:"manual",requiresReceipt:true,receiptUploaded:true,receiptUploadedAt:new Date().toISOString(),createdAt:new Date().toISOString()}],',
'preview topup receipt requirement')
old=''' $("#topupsTable").innerHTML=`<table><thead><tr><th>ID</th><th>المستخدم</th><th>المبلغ</th><th>الطريقة</th><th>المرجع</th><th>الإيصال</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${ts.map(t=>`<tr><td>${esc(t.id)}</td><td>${esc(t.telegramId)}</td><td>${money(t.amount)}</td><td>${esc(t.method)}</td><td>${esc(t.reference||"-")}</td><td>${t.receiptUploaded?`<button data-action="receipt-topup" data-id="${attr(t.id)}">عرض الإيصال</button>`:"-"}</td><td>${pill(t.status)}</td><td>${t.status==="pending"?`<div class="actions"><button class="primary" data-action="topup" data-id="${attr(t.id)}" data-topup-action="approve">قبول</button><button class="danger" data-action="topup" data-id="${attr(t.id)}" data-topup-action="reject">رفض</button></div>`:"-"}</td></tr>`).join("")||rowEmpty(8)}</tbody></table>`;'''
new=''' $("#topupsTable").innerHTML=`<table><thead><tr><th>ID</th><th>المستخدم</th><th>المبلغ</th><th>الطريقة</th><th>المرجع</th><th>الإيصال</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${ts.map(t=>{const receiptMissing=t.requiresReceipt&&!t.receiptUploaded;return `<tr><td>${esc(t.id)}</td><td>${esc(t.telegramId)}</td><td>${money(t.amount)}</td><td>${esc(t.method)}</td><td>${esc(t.reference||"-")}</td><td><span class="pill ${t.requiresReceipt?"warn":"ok"}">${t.requiresReceipt?"مطلوب":"اختياري"}</span><br>${t.receiptUploaded?`<button data-action="receipt-topup" data-id="${attr(t.id)}">عرض الإيصال</button>`:`<small>${t.requiresReceipt?"لم يُرفع بعد":"غير مرفوع"}</small>`}</td><td>${pill(t.status)}</td><td>${t.status==="pending"?`<div class="actions"><button class="primary" data-action="topup" data-id="${attr(t.id)}" data-topup-action="approve" ${receiptMissing?'disabled title="يجب رفع الإيصال قبل الاعتماد"':''}>قبول</button><button class="danger" data-action="topup" data-id="${attr(t.id)}" data-topup-action="reject">رفض</button></div>`:"-"}</td></tr>`}).join("")||rowEmpty(8)}</tbody></table>`;'''
s=replace_once(s,old,new,'admin topup review table')
old='''async function topupAction(id,action){\n const topup=(data.topups||[]).find(x=>x.id===id);\n if(!confirm(`${action==="approve"?"قبول":"رفض"} طلب الشحن ${id}${topup?` بقيمة ${money(topup.amount)}`:""}؟`))return;'''
new='''async function topupAction(id,action){\n const topup=(data.topups||[]).find(x=>x.id===id);\n if(action==="approve"&&topup?.requiresReceipt&&!topup?.receiptUploaded)return toast("يجب رفع الإيصال قبل اعتماد هذا الشحن");\n if(!confirm(`${action==="approve"?"قبول":"رفض"} طلب الشحن ${id}${topup?` بقيمة ${money(topup.amount)}`:""}؟`))return;'''
s=replace_once(s,old,new,'admin approval precheck')
s=replace_once(s,
' try{await api(`/api/admin/topups/${id}/${action}`,{method:"POST",body:JSON.stringify({confirmation:action==="approve"?"APPROVE_TOPUP":"REJECT_TOPUP"})});await load();toast("تم تنفيذ الإجراء")}catch{toast("تعذر تنفيذ الإجراء")}',
' try{await api(`/api/admin/topups/${id}/${action}`,{method:"POST",body:JSON.stringify({confirmation:action==="approve"?"APPROVE_TOPUP":"REJECT_TOPUP"})});await load();toast("تم تنفيذ الإجراء")}catch(e){if(e.data?.error==="topup_receipt_required")toast("لا يمكن الاعتماد قبل رفع الإيصال المطلوب");else toast("تعذر تنفيذ الإجراء")}',
'admin backend receipt error')
p.write_text(s)

# Keep the security audit aware of the admin review guard and safe projection.
p=Path('server/scripts/web-security-audit.js')
s=p.read_text()
anchor='if(!server.includes("topupApprovalEvidenceError")||!adminTopupPolicy.includes("topup_receipt_required"))failures.push("required topup receipt backend policy missing");\n'
addition=anchor+'const adminTopupView=fs.readFileSync(path.join(root,"server/lib/adminTopupView.js"),"utf8");\nconst adminJs=fs.readFileSync(path.join(root,"admin/admin.js"),"utf8");\nif(!server.includes("map(adminTopupView)")||!adminTopupView.includes("receiptUploaded:!!t.receiptFileName"))failures.push("safe admin topup receipt projection missing");\nif(!adminJs.includes("receiptMissing=t.requiresReceipt&&!t.receiptUploaded")||!adminJs.includes("topup_receipt_required"))failures.push("admin topup receipt review guard missing");\n'
s=replace_once(s,anchor,addition,'admin receipt review audit')
p.write_text(s)

print('Admin top-up receipt review implementation prepared')
