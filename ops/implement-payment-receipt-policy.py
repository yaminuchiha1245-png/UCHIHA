from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)

# Backend receipt policy and API fields.
p=Path('server/server.js')
s=p.read_text()
s=replace_once(s,
'const { topupActionConfirmationError } = require("./lib/adminTopupPolicy");',
'const { topupActionConfirmationError, topupApprovalEvidenceError } = require("./lib/adminTopupPolicy");',
'admin topup policy import')
s=replace_once(s,
'    requiresReference:m.requiresReference!==false,minAmount:Number(m.minAmount||0),maxAmount:Number(m.maxAmount||0),sort:Number(m.sort||0)',
'    requiresReference:m.requiresReference!==false,requiresReceipt:m.requiresReceipt===true,minAmount:Number(m.minAmount||0),maxAmount:Number(m.maxAmount||0),sort:Number(m.sort||0)',
'public payment method receipt field')
s=replace_once(s,
'const m={id:methodId,name,icon,imageUrl,active:b.active!==false,sort,instructions,account,requiresReference:b.requiresReference!==false,minAmount,maxAmount,checkoutUrlTemplate};',
'const m={id:methodId,name,icon,imageUrl,active:b.active!==false,sort,instructions,account,requiresReference:b.requiresReference!==false,requiresReceipt:b.requiresReceipt===true,minAmount,maxAmount,checkoutUrlTemplate};',
'payment method create receipt field')
s=replace_once(s,
'if("active" in b)m.active=!!b.active;if("requiresReference" in b)m.requiresReference=!!b.requiresReference;',
'if("active" in b)m.active=!!b.active;if("requiresReference" in b)m.requiresReference=!!b.requiresReference;if("requiresReceipt" in b)m.requiresReceipt=!!b.requiresReceipt;',
'payment method patch receipt field')
s=replace_once(s,
'const topup={id:id("topup"),telegramId:String(telegramId),amount:value,currency:"USD",method:methodId,reference:normalizedReference,clientRequestId:requestId,status:"pending",createdAt:now(),updatedAt:now()};',
'const topup={id:id("topup"),telegramId:String(telegramId),amount:value,currency:"USD",method:methodId,reference:normalizedReference,requiresReceipt:pm.requiresReceipt===true,clientRequestId:requestId,status:"pending",createdAt:now(),updatedAt:now()};',
'topup snapshots receipt requirement')
s=replace_once(s,
'  const db=readDB(),t=db.topups.find(x=>x.id===req.params.id);if(!t)return res.status(404).json({error:"topup_not_found"});\n  try{',
'  const db=readDB(),t=db.topups.find(x=>x.id===req.params.id);if(!t)return res.status(404).json({error:"topup_not_found"});\n  const evidenceError=action==="approve"?topupApprovalEvidenceError(t):null;if(evidenceError)return res.status(409).json({ok:false,error:evidenceError});\n  try{',
'admin approval receipt enforcement')
p.write_text(s)

# Policy helper + tests.
Path('server/lib/adminTopupPolicy.js').write_text('''function topupActionConfirmationError(action,body={}){\n  if(action==="approve"&&String(body.confirmation||"")!=="APPROVE_TOPUP")return "topup_approval_confirmation_required";\n  if(action==="reject"&&String(body.confirmation||"")!=="REJECT_TOPUP")return "topup_rejection_confirmation_required";\n  return null;\n}\nfunction topupApprovalEvidenceError(topup={}){\n  if(topup.requiresReceipt===true&&!topup.receiptFileName)return "topup_receipt_required";\n  return null;\n}\nmodule.exports={topupActionConfirmationError,topupApprovalEvidenceError};\n''')
p=Path('server/tests/adminTopupPolicy.test.js')
s=p.read_text()
s=replace_once(s,
'const {topupActionConfirmationError}=require("../lib/adminTopupPolicy");',
'const {topupActionConfirmationError,topupApprovalEvidenceError}=require("../lib/adminTopupPolicy");',
'test import')
s += '''\n\ntest("required receipt blocks approval until evidence is uploaded",()=>{\n  assert.equal(topupApprovalEvidenceError({requiresReceipt:true}),"topup_receipt_required");\n  assert.equal(topupApprovalEvidenceError({requiresReceipt:true,receiptFileName:"receipt.webp"}),null);\n  assert.equal(topupApprovalEvidenceError({requiresReceipt:false}),null);\n});\n'''
p.write_text(s)

# Public topup exposes whether the request requires an uploaded receipt.
p=Path('server/lib/publicViews.js')
s=p.read_text()
s=replace_once(s,
'    receiptUploaded:!!t.receiptFileName,\n    receiptUploadedAt:t.receiptUploadedAt||null',
'    requiresReceipt:t.requiresReceipt===true,\n    receiptUploaded:!!t.receiptFileName,\n    receiptUploadedAt:t.receiptUploadedAt||null',
'public topup receipt requirement')
p.write_text(s)

# Customer top-up UI enforces receipt requirements before creating the request.
p=Path('miniapp/app.js')
s=p.read_text()
s=replace_once(s,
'const safeMethods=methods.length?methods:[{id:"manual",name:"تحويل يدوي",imageUrl:null,requiresReference:false,minAmount:state.config.minTopup||1,maxAmount:state.config.maxTopup||1000}];',
'const safeMethods=methods.length?methods:[{id:"manual",name:"تحويل يدوي",imageUrl:null,requiresReference:false,requiresReceipt:false,minAmount:state.config.minTopup||1,maxAmount:state.config.maxTopup||1000}];',
'fallback receipt policy')
s=replace_once(s,
'<div class="field"><label>صورة الإيصال</label><input id="topupReceipt" type="file" accept="image/jpeg,image/png,image/webp"></div>',
'<div class="field"><label id="topupReceiptLabel">صورة الإيصال (اختياري)</label><input id="topupReceipt" type="file" accept="image/jpeg,image/png,image/webp"></div>',
'topup receipt label')
s=replace_once(s,
'    $("#topupRefLabel").textContent=m.requiresReference?"رقم العملية / المرجع (مطلوب)":"رقم العملية / المرجع (اختياري)";\n    renderTopupAmountPreview();',
'    $("#topupRefLabel").textContent=m.requiresReference?"رقم العملية / المرجع (مطلوب)":"رقم العملية / المرجع (اختياري)";\n    $("#topupReceiptLabel").textContent=m.requiresReceipt?"صورة الإيصال (مطلوب)":"صورة الإيصال (اختياري)";\n    renderTopupAmountPreview();',
'topup receipt dynamic label')
s=replace_once(s,
'    if(m.requiresReference&&!reference)return toast("أدخل رقم العملية أو المرجع");\n    let receiptDataUrl=null;',
'    if(m.requiresReference&&!reference)return toast("أدخل رقم العملية أو المرجع");\n    if(m.requiresReceipt&&!receiptFile)return toast("ارفع صورة الإيصال لهذه الطريقة");\n    let receiptDataUrl=null;',
'topup client receipt enforcement')
p.write_text(s)

# Admin payment method controls.
p=Path('admin/admin.js')
s=p.read_text()
s=replace_once(s,
'<th>الحدود</th><th>المرجع</th><th>الحالة</th><th>إجراء</th>',
'<th>الحدود</th><th>المرجع</th><th>الإيصال</th><th>الحالة</th><th>إجراء</th>',
'payments table receipt header')
s=replace_once(s,
'<td>${m.requiresReference?"مطلوب":"اختياري"}</td><td>${m.active?',
'<td>${m.requiresReference?"مطلوب":"اختياري"}</td><td>${m.requiresReceipt?"مطلوب":"اختياري"}</td><td>${m.active?',
'payments table receipt value')
s=replace_once(s,'rowEmpty(8)','rowEmpty(9)','payments empty colspan')
s=replace_once(s,
'  <div class="field"><label>المرجع مطلوب؟</label><select id="payRef"><option value="true" ${m.requiresReference?"selected":""}>نعم</option><option value="false" ${!m.requiresReference?"selected":""}>لا</option></select></div>\n  <div class="field"><label>الترتيب</label>',
'  <div class="field"><label>المرجع مطلوب؟</label><select id="payRef"><option value="true" ${m.requiresReference?"selected":""}>نعم</option><option value="false" ${!m.requiresReference?"selected":""}>لا</option></select></div>\n  <div class="field"><label>الإيصال مطلوب؟</label><select id="payReceipt"><option value="true" ${m.requiresReceipt?"selected":""}>نعم</option><option value="false" ${!m.requiresReceipt?"selected":""}>لا</option></select></div>\n  <div class="field"><label>الترتيب</label>',
'edit payment receipt control')
s=replace_once(s,
'requiresReference:$("#payRef").value==="true",sort:Number($("#paySort").value)',
'requiresReference:$("#payRef").value==="true",requiresReceipt:$("#payReceipt").value==="true",sort:Number($("#paySort").value)',
'edit payment receipt patch')
s=replace_once(s,
'  <div class="field"><label>أعلى مبلغ</label><input id="newPayMax" type="number" value="1000"></div>\n </div><button class="save" id="newPaySave">إضافة</button>`);',
'  <div class="field"><label>أعلى مبلغ</label><input id="newPayMax" type="number" value="1000"></div>\n  <div class="field"><label>المرجع مطلوب؟</label><select id="newPayRef"><option value="true" selected>نعم</option><option value="false">لا</option></select></div>\n  <div class="field"><label>الإيصال مطلوب؟</label><select id="newPayReceipt"><option value="false" selected>لا</option><option value="true">نعم</option></select></div>\n </div><button class="save" id="newPaySave">إضافة</button>`);',
'new payment receipt controls')
s=replace_once(s,
'minAmount:Number($("#newPayMin").value),maxAmount:Number($("#newPayMax").value),requiresReference:true,active:true',
'minAmount:Number($("#newPayMin").value),maxAmount:Number($("#newPayMax").value),requiresReference:$("#newPayRef").value==="true",requiresReceipt:$("#newPayReceipt").value==="true",active:true',
'new payment receipt values')
p.write_text(s)

# Guard the feature in the existing web/security audit.
p=Path('server/scripts/web-security-audit.js')
s=p.read_text()
anchor='if(!mini.includes("topupDisplayPreviewText")||!mini.includes("topupAmountPreview"))failures.push("topup base/display currency preview missing");\n'
addition=anchor+'if(!mini.includes("topupReceiptLabel")||!mini.includes("m.requiresReceipt&&!receiptFile"))failures.push("required topup receipt client policy missing");\nif(!server.includes("topupApprovalEvidenceError")||!server.includes("topup_receipt_required"))failures.push("required topup receipt backend policy missing");\n'
s=replace_once(s,anchor,addition,'receipt policy audit')
p.write_text(s)

print('Payment receipt policy implementation prepared')
