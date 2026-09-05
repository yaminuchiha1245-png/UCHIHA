from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)

# Policy + tests
Path("server/lib/verificationPolicy.js").write_text(r'''const STATUSES=new Set(["pending","verified","rejected"]);
function sanitizeDecision(body={}){
  const status=String(body.status||"").trim();
  if(!["verified","rejected"].includes(status))throw new Error("invalid_verification_status");
  let rejectionReason=null;
  if(status==="rejected"){
    rejectionReason=String(body.rejectionReason||"").trim().replace(/\s+/g," ");
    if(rejectionReason.length>500)throw new Error("verification_reason_too_long");
  }
  return {status,rejectionReason:rejectionReason||null};
}
function publicVerification(row,{admin=false}={}){
  if(!row)return {status:"none"};
  const out={id:row.id,status:STATUSES.has(row.status)?row.status:"pending",createdAt:row.createdAt,updatedAt:row.updatedAt||row.createdAt,reviewedAt:row.reviewedAt||null,rejectionReason:row.rejectionReason||null};
  if(admin)out.telegramId=String(row.telegramId||"");
  return out;
}
module.exports={STATUSES,sanitizeDecision,publicVerification};
''')

Path("server/tests/verificationPolicy.test.js").write_text(r'''const test=require("node:test");
const assert=require("node:assert/strict");
const {sanitizeDecision,publicVerification}=require("../lib/verificationPolicy");
test("verification decision only allows reviewed terminal states",()=>{
  assert.deepEqual(sanitizeDecision({status:"verified"}),{status:"verified",rejectionReason:null});
  assert.throws(()=>sanitizeDecision({status:"pending"}),/invalid_verification_status/);
});
test("customer verification view does not expose telegram id",()=>{
  const row={id:"v1",telegramId:"123",status:"pending",createdAt:"2026-01-01T00:00:00Z"};
  assert.equal(publicVerification(row).telegramId,undefined);
  assert.equal(publicVerification(row,{admin:true}).telegramId,"123");
});
''')

# Migration
p=Path("server/lib/migrations.js"); s=p.read_text()
s=replace_once(s,'const CURRENT_SCHEMA_VERSION=8;','const CURRENT_SCHEMA_VERSION=9;','schema version')
s=replace_once(s,'  "deletedAccounts","couponUsages"\n];','  "deletedAccounts","couponUsages","verificationRequests"\n];','verification collection')
p.write_text(s)

# Account deletion cleanup
p=Path("server/lib/accountLifecycle.js"); s=p.read_text()
s=replace_once(s,'    supportTickets:(db.supportTickets||[]).length,\n    devicePairs:(db.devicePairs||[]).length,','    supportTickets:(db.supportTickets||[]).length,\n    verificationRequests:(db.verificationRequests||[]).length,\n    devicePairs:(db.devicePairs||[]).length,','deletion before count')
s=replace_once(s,'  db.supportTickets=(db.supportTickets||[]).filter(x=>String(x.telegramId)!==tid);\n  db.devicePairs=(db.devicePairs||[]).filter(x=>String(x.telegramId)!==tid);','  db.supportTickets=(db.supportTickets||[]).filter(x=>String(x.telegramId)!==tid);\n  db.verificationRequests=(db.verificationRequests||[]).filter(x=>String(x.telegramId)!==tid);\n  db.devicePairs=(db.devicePairs||[]).filter(x=>String(x.telegramId)!==tid);','deletion cleanup')
s=replace_once(s,'    supportTickets:before.supportTickets-db.supportTickets.length,\n    devicePairs:before.devicePairs-db.devicePairs.length,','    supportTickets:before.supportTickets-db.supportTickets.length,\n    verificationRequests:before.verificationRequests-db.verificationRequests.length,\n    devicePairs:before.devicePairs-db.devicePairs.length,','deletion removed count')
p.write_text(s)

p=Path("server/tests/accountLifecycle.test.js"); s=p.read_text()
s=replace_once(s,'    supportTickets:[{telegramId:"123",id:"t1"}],\n    devicePairs:[{telegramId:"123",id:"pair1"}],','    supportTickets:[{telegramId:"123",id:"t1"}],\n    verificationRequests:[{telegramId:"123",id:"verify1"}],\n    devicePairs:[{telegramId:"123",id:"pair1"}],','test fixture')
s=replace_once(s,'  assert.equal(db.supportTickets.length,0);\n  assert.equal(db.devicePairs.length,0);','  assert.equal(db.supportTickets.length,0);\n  assert.equal(db.verificationRequests.length,0);\n  assert.equal(db.devicePairs.length,0);','test cleanup assertion')
p.write_text(s)

# Server routes
p=Path("server/server.js"); s=p.read_text()
anchor='const { publicCurrencies, sanitizeAdminCurrencies } = require("./lib/currencyConfig");\n'
s=replace_once(s,anchor,anchor+'const { sanitizeDecision:sanitizeVerificationDecision, publicVerification } = require("./lib/verificationPolicy");\n','server import')
customer_anchor='app.get("/api/support/tickets",userOnly,(req,res)=>{'
customer_block=r'''app.get("/api/verification",userOnly,(req,res)=>{
  const db=readDB(),tid=String(req.authTelegramId||"");
  const row=(db.verificationRequests||[]).filter(x=>String(x.telegramId)===tid).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")))[0]||null;
  res.json(publicVerification(row));
});

app.post("/api/verification",rateLimit("verification_request",3,86400000),userOnly,financialLocks(locksForUser),async(req,res)=>{
  if(String(req.body?.confirmation||"")!=="REQUEST_VERIFICATION")return res.status(400).json({ok:false,error:"verification_confirmation_required"});
  const db=readDB(),tid=String(req.authTelegramId||"");
  const latest=(db.verificationRequests||[]).filter(x=>String(x.telegramId)===tid).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")))[0]||null;
  if(latest?.status==="pending")return res.status(409).json({ok:false,error:"verification_already_pending",verification:publicVerification(latest)});
  if(latest?.status==="verified")return res.status(409).json({ok:false,error:"verification_already_verified",verification:publicVerification(latest)});
  const row={id:id("verify"),telegramId:tid,status:"pending",rejectionReason:null,createdAt:now(),updatedAt:now(),reviewedAt:null};
  db.verificationRequests||=[];db.verificationRequests.unshift(row);
  addNotification(db,tid,"تم استلام طلب التحقق","طلب التحقق قيد المراجعة الآن.","verification",row.id);
  pushAudit(db,req,"verification_request",{verificationId:row.id,telegramId:tid});
  await persistCritical(db);
  notifyAdmins(`🪪 طلب تحقق حساب جديد\nTelegram ID: <code>${tgEsc(tid)}</code>\nالحالة: قيد المراجعة`);
  res.status(201).json({ok:true,verification:publicVerification(row)});
});

'''+customer_anchor
s=replace_once(s,customer_anchor,customer_block,'customer verification routes')
admin_anchor='app.get("/api/admin/support-tickets",adminOnly,(req,res)=>res.json((readDB().supportTickets||[]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))));'
admin_block=r'''app.get("/api/admin/verifications",adminOnly,(req,res)=>{
  const rows=(readDB().verificationRequests||[]).slice().sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  res.json(rows.map(x=>publicVerification(x,{admin:true})));
});
app.patch("/api/admin/verifications/:id",adminOnly,financialLocks(req=>[`verification:${String(req.params?.id||"")}`]),async(req,res)=>{
  const db=readDB(),row=(db.verificationRequests||[]).find(x=>String(x.id)===String(req.params.id));
  if(!row)return res.status(404).json({ok:false,error:"verification_not_found"});
  if(row.status!=="pending")return res.status(409).json({ok:false,error:"verification_already_reviewed",verification:publicVerification(row,{admin:true})});
  let decision;try{decision=sanitizeVerificationDecision(req.body||{});}catch(e){return res.status(400).json({ok:false,error:String(e.message||"invalid_verification_decision")});}
  row.status=decision.status;row.rejectionReason=decision.rejectionReason;row.reviewedAt=now();row.updatedAt=now();
  const verified=row.status==="verified";
  addNotification(db,row.telegramId,verified?"تم توثيق حسابك":"تعذر اعتماد التحقق",verified?"تم اعتماد التحقق بنجاح.":(row.rejectionReason||"يمكنك إرسال طلب جديد بعد مراجعة البيانات."),"verification",row.id);
  pushAudit(db,req,verified?"verification_approve":"verification_reject",{verificationId:row.id,telegramId:String(row.telegramId)});
  await persistCritical(db);
  sendTelegramMessage(row.telegramId,verified?"✅ تم <b>توثيق حساب Game Zone</b> بنجاح.":`⚠️ تعذر اعتماد طلب التحقق في Game Zone.${row.rejectionReason?`\nالسبب: ${tgEsc(row.rejectionReason)}`:""}`);
  res.json({ok:true,verification:publicVerification(row,{admin:true})});
});

'''+admin_anchor
s=replace_once(s,admin_anchor,admin_block,'admin verification routes')
p.write_text(s)

# Mini App dedicated status
p=Path("miniapp/v21.js"); s=p.read_text()
start=s.index('  function kycTicket(){')
end=s.index('\n  function renderPairUpgrade(){',start)
new=r'''  function kycStatus(){
    const row=kycCache;
    if(!row||row.status==="none")return {key:"none",label:"غير موثق",request:null};
    if(row.status==="verified")return {key:"verified",label:"موثق",request:row};
    if(row.status==="rejected")return {key:"rejected",label:"مرفوض",request:row};
    return {key:"pending",label:"قيد المراجعة",request:row};
  }
  function refreshKycBadge(){
    const pill=$q("#gz21KycStatus");if(!pill)return;
    const st=kycStatus();pill.className=`gz21-status-pill ${st.key}`;pill.textContent=st.label;
  }
  async function loadKycStatus(){
    const s=safeState();
    if(!s||s.preview||!s.sessionToken){kycCache={status:"none"};refreshKycBadge();return kycCache}
    try{kycCache=await api("/api/verification")}catch{kycCache={status:"none"}}
    refreshKycBadge();return kycCache;
  }
  function kycSheetBody(st){
    if(st.key==="verified")return `<h3>تحقق KYC</h3><div class="gz21-kyc-box"><h4>✅ الحساب موثق</h4><p>تم اعتماد التحقق من إدارة Game Zone.</p></div><button data-sheet-close class="gz21-sheet-action">تم</button>`;
    if(st.key==="pending")return `<h3>تحقق KYC</h3><div class="gz21-kyc-box"><h4>⏳ الطلب قيد المراجعة</h4><p>تم إنشاء طلب التحقق. إذا احتاجت الإدارة مطابقة إضافية فستتم عبر قناة أو مزود تحقق رسمي.</p></div><div class="gz21-privacy-note">لا تدخل رقم وثيقة أو كلمة مرور داخل هذه الصفحة.</div><button data-sheet-close class="gz21-sheet-action">إغلاق</button>`;
    const reason=st.request?.rejectionReason?`<p>السبب: ${String(st.request.rejectionReason).replace(/[<>]/g,"")}</p>`:"";
    const rejected=st.key==="rejected"?`<div class="gz21-kyc-box"><h4>تعذر اعتماد الطلب السابق</h4>${reason}<p>يمكنك إرسال طلب جديد للمراجعة.</p></div>`:"";
    return `<h3>تحقق KYC</h3>${rejected}<div class="gz21-kyc-box"><h4>طلب توثيق الحساب</h4><p>أرسل طلب التحقق من هنا. عند الحاجة لمطابقة إضافية ستظهر لك تعليمات القناة الرسمية.</p></div><button id="gz21SubmitKyc" class="gz21-sheet-action">إرسال طلب التحقق</button>`;
  }
  async function openKyc(){
    const s=safeState();if(!s)return;
    if(s.preview)return openSheet(`<h3>تحقق KYC</h3><p>يظهر التحقق الحقيقي بعد ربط حساب Telegram.</p>`);
    await loadKycStatus();const st=kycStatus();openSheet(kycSheetBody(st));
    const submit=$q("#gz21SubmitKyc");if(!submit)return;
    submit.onclick=async()=>{
      submit.disabled=true;submit.textContent="جارٍ الإرسال...";
      try{const r=await api("/api/verification",{method:"POST",body:JSON.stringify({confirmation:"REQUEST_VERIFICATION"})});kycCache=r.verification||{status:"pending"};refreshKycBadge();closeSheet();safeToast("تم إرسال طلب التحقق للمراجعة")}
      catch{submit.disabled=false;submit.textContent="إرسال طلب التحقق";safeToast("تعذر إرسال طلب التحقق")}
    };
  }
  function installKyc(){
    const settings=$q('.screen[data-screen="account"] .settings');if(!settings||$q("#gz21KycBtn"))return;
    const button=document.createElement("button");button.id="gz21KycBtn";button.className="gz21-kyc-row";
    button.innerHTML=`تحقق KYC <span id="gz21KycStatus" class="gz21-status-pill">...</span>`;
    const anchor=$q("#privacyBtn");settings.insertBefore(button,anchor||settings.firstChild);
    button.onclick=openKyc;loadKycStatus().catch(()=>{});
  }
'''
s=s[:start]+new+s[end:]
s=s.replace('refreshBalanceChip();renderPaymentCards();refreshKycBadge();safeToast("تم ربط حساب Telegram بنجاح");','refreshBalanceChip();renderPaymentCards();loadKycStatus().catch(()=>{});safeToast("تم ربط حساب Telegram بنجاح");',1)
p.write_text(s)

# Admin page
p=Path("admin/index.html"); s=p.read_text()
nav='      <button data-page="users"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 4-7 8-7s7 2 8 7"/></svg> <span>المستخدمون</span></button>'
s=replace_once(s,nav,nav+'\n      <button data-page="verification"><svg viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/><path d="m8.5 12 2 2 5-5"/></svg> <span>تحقق KYC</span></button>','admin nav')
section='    <section class="page" data-page-view="profits">'
s=replace_once(s,section,'    <section class="page" data-page-view="verification">\n      <div class="panel"><div class="panel-head"><h2>طلبات تحقق KYC</h2><button data-refresh>تحديث</button></div><div id="verificationTable" class="table-wrap"></div></div>\n    </section>\n\n'+section,'admin section')
p.write_text(s)

p=Path("admin/admin.js"); s=p.read_text()
mock=' support:[{id:"ticket_1",telegramId:"8120730186",subject:"مشكلة في طلب",message:"أحتاج متابعة الطلب.",status:"open",createdAt:new Date().toISOString()}],'
s=replace_once(s,mock,' verification:[{id:"verify_preview_1",telegramId:"8120730186",status:"pending",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),reviewedAt:null,rejectionReason:null}],\n'+mock,'admin mock')
# preview API route
s=replace_once(s,'if(path.includes("payment-methods"))return mock.payments;if(path.includes("announcements"))return mock.announcements;if(path.includes("support-tickets"))return mock.support;','if(path.includes("payment-methods"))return mock.payments;if(path.includes("announcements"))return mock.announcements;if(path.includes("verifications"))return mock.verification;if(path.includes("support-tickets"))return mock.support;','admin preview API')
old='const [dashboard,categories,products,orders,topups,users,profits,coupons,providers,providerLogs,payments,announcements,support,broadcasts,settings,audit,inventorySummary,inventory,security,syncWorker,maintenance,integrity,schema,locks,adminSession,backups,storage,financialMirror,financialJournal,walletAuthority,businessAuthority,storageHistory,readiness]=await Promise.all(['
new='const [dashboard,categories,products,orders,topups,users,profits,coupons,providers,providerLogs,payments,announcements,verification,support,broadcasts,settings,audit,inventorySummary,inventory,security,syncWorker,maintenance,integrity,schema,locks,adminSession,backups,storage,financialMirror,financialJournal,walletAuthority,businessAuthority,storageHistory,readiness]=await Promise.all(['
s=replace_once(s,old,new,'admin load destructure')
s=replace_once(s,'api("/api/admin/announcements"),api("/api/admin/support-tickets"),api("/api/admin/broadcasts")','api("/api/admin/announcements"),api("/api/admin/verifications"),api("/api/admin/support-tickets"),api("/api/admin/broadcasts")','admin load endpoints')
s=replace_once(s,'data={dashboard,categories,products,orders,topups,users,profits,coupons,providers,providerLogs,payments,announcements,support,broadcasts,settings,audit,inventorySummary,inventory,security,syncWorker,maintenance,integrity,schema,locks,adminSession,backups,storage,financialMirror,financialJournal,walletAuthority,businessAuthority,storageHistory,readiness};','data={dashboard,categories,products,orders,topups,users,profits,coupons,providers,providerLogs,payments,announcements,verification,support,broadcasts,settings,audit,inventorySummary,inventory,security,syncWorker,maintenance,integrity,schema,locks,adminSession,backups,storage,financialMirror,financialJournal,walletAuthority,businessAuthority,storageHistory,readiness};','admin data')
s=replace_once(s,'renderTopups();renderUsers();renderProfits();','renderTopups();renderUsers();renderVerification();renderProfits();','admin renderAll')
render_anchor='function renderSettings(){'
render_block=r'''function renderVerification(){
 const rows=data.verification||[],el=$("#verificationTable");if(!el)return;
 el.innerHTML=`<table><thead><tr><th>Telegram ID</th><th>الحالة</th><th>تاريخ الطلب</th><th>تاريخ المراجعة</th><th>إجراء</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.telegramId)}</td><td>${pill(x.status)}</td><td>${x.createdAt?new Date(x.createdAt).toLocaleString("ar"):"-"}</td><td>${x.reviewedAt?new Date(x.reviewedAt).toLocaleString("ar"):"-"}</td><td>${x.status==="pending"?`<button data-verification-action="verified" data-verification-id="${attr(x.id)}">اعتماد</button> <button class="danger" data-verification-action="rejected" data-verification-id="${attr(x.id)}">رفض</button>`:(x.rejectionReason?esc(x.rejectionReason):"تمت المراجعة")}</td></tr>`).join("")||rowEmpty(5)}</tbody></table>`;
 $$('[data-verification-action]').forEach(btn=>btn.onclick=()=>reviewVerification(btn.dataset.verificationId,btn.dataset.verificationAction));
}
async function reviewVerification(id,status){
 const row=(data.verification||[]).find(x=>String(x.id)===String(id));if(!row)return;
 let rejectionReason=null;
 if(status==="verified"&&!confirm(`اعتماد توثيق المستخدم ${row.telegramId}؟ تأكد من اكتمال المطابقة عبر القناة الرسمية أولًا.`))return;
 if(status==="rejected"){rejectionReason=prompt("سبب الرفض (اختياري، سيظهر للمستخدم):","");if(rejectionReason===null)return;}
 if(preview){row.status=status;row.rejectionReason=rejectionReason||null;row.reviewedAt=new Date().toISOString();renderVerification();return toast(status==="verified"?"تم اعتماد التحقق":"تم رفض التحقق")}
 try{await api(`/api/admin/verifications/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({status,rejectionReason})});await load();toast(status==="verified"?"تم اعتماد التحقق":"تم رفض التحقق")}catch{toast("تعذر تحديث حالة التحقق")}
}

'''+render_anchor
s=replace_once(s,render_anchor,render_block,'admin render verification')
p.write_text(s)

print("Account verification implementation prepared")
