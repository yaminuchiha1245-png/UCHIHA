const fs=require("fs");
const path=require("path");
const root=path.join(__dirname,"..","..");
const failures=[];
const files=[
  "miniapp/index.html","miniapp/app.js","miniapp/v21.js",
  "admin/index.html","admin/admin.js","miniapp/privacy.html",
  "miniapp/terms.html","miniapp/account-deletion.html"
];
for(const rel of files){
  const text=fs.readFileSync(path.join(root,rel),"utf8");
  const checks=[
    [/on(?:click|error|load|mouseover|focus)\s*=\s*["']/i,"inline HTML event handler"],
    [/javascript\s*:/i,"javascript: URL"],
    [/<script(?![^>]*src=)[^>]*>/i,"inline <script> block"],
    [/\sstyle\s*=\s*["']/i,"inline style attribute"],
    [/<style[^>]*>/i,"inline <style> block"]
  ];
  for(const [re,label] of checks)if(re.test(text))failures.push(`${rel}: ${label}`);
}
const mini=fs.readFileSync(path.join(root,"miniapp/app.js"),"utf8")+"\n"+fs.readFileSync(path.join(root,"miniapp/v21.js"),"utf8");
const sw=fs.readFileSync(path.join(root,"miniapp/sw.js"),"utf8");
const server=fs.readFileSync(path.join(root,"server/server.js"),"utf8");
const adminTopupPolicy=fs.readFileSync(path.join(root,"server/lib/adminTopupPolicy.js"),"utf8");
const index=fs.readFileSync(path.join(root,"miniapp/index.html"),"utf8");
if(/device\/pair\/status\?.*secret/i.test(mini))failures.push("pairing secret present in URL");
if(!/device\/pair\/status["`][\s\S]{0,140}method:["']POST["']/i.test(mini))failures.push("pairing status POST validation missing");
if(!index.includes('v21.js?v=210')||!index.includes('v21.css?v=210'))failures.push("v2.1 assets not loaded by storefront");
if(!mini.includes('gamezone1store_bot'))failures.push("production bot username missing from pairing UX");
if(!mini.includes('gz21-balance-chip'))failures.push("real balance chip upgrade missing");
if(!mini.includes("function baseMoney")||!mini.includes("عملة الشحن الأساسية هي USD"))failures.push("display/base currency separation missing");
if(!mini.includes("refreshDisplayCurrencyViews"))failures.push("currency selection does not refresh visible monetary views");
if(!mini.includes("topupDisplayPreviewText")||!mini.includes("topupAmountPreview"))failures.push("topup base/display currency preview missing");
if(!mini.includes("topupReceiptLabel")||!mini.includes("m.requiresReceipt&&!receiptFile"))failures.push("required topup receipt client policy missing");
if(!server.includes("topupApprovalEvidenceError")||!adminTopupPolicy.includes("topup_receipt_required"))failures.push("required topup receipt backend policy missing");
if(!server.includes("تم رفع إيصال شحن")||!server.includes("تم تحديث إيصال شحن"))failures.push("topup receipt admin notification missing");
const adminTopupView=fs.readFileSync(path.join(root,"server/lib/adminTopupView.js"),"utf8");
const adminJs=fs.readFileSync(path.join(root,"admin/admin.js"),"utf8");
const botJs=fs.readFileSync(path.join(root,"bot/bot.js"),"utf8");
if(!server.includes("map(adminTopupView)")||!adminTopupView.includes("receiptUploaded:!!t.receiptFileName"))failures.push("safe admin topup receipt projection missing");
if(!adminJs.includes("receiptMissing=t.requiresReceipt&&!t.receiptUploaded")||!adminJs.includes("topup_receipt_required"))failures.push("admin topup receipt review guard missing");
if(!botJs.includes("receiptMissing=t.requiresReceipt===true&&!t.receiptUploaded")||!botJs.includes("current.requiresReceipt===true&&!current.receiptUploaded")||!botJs.includes("topup_receipt_required"))failures.push("admin bot topup receipt review guard missing");
if(!botJs.includes("async function apiBinary")||!botJs.includes("adm_topup_receipt")||!botJs.includes("receipt_type_not_allowed"))failures.push("protected admin bot receipt viewer missing");
if(!botJs.includes("p.deliveryText")||botJs.includes("p.delivery===\"auto\"?\"تلقائي\""))failures.push("telegram product delivery promise parity missing");
if(!mini.includes("function clientProductInputError")||!mini.includes("customerData")||!mini.includes("البريد الإلكتروني غير صحيح")||!mini.includes("رقم الهاتف غير صحيح"))failures.push("client product input validation missing");
if(!mini.includes("/api/verification"))failures.push("dedicated verification API missing from Mini App");
if(!server.includes('app.get("/api/verification"')||!server.includes('app.post("/api/verification"'))failures.push("customer verification routes missing");
if(!server.includes('app.get("/api/admin/verifications"')||!server.includes('app.patch("/api/admin/verifications/:id"'))failures.push("admin verification routes missing");
if(/gz21Kyc(?:Name|Country|Dob|Doc)/.test(mini))failures.push("legacy identity-data KYC form still present");
if(/document(Number|No)|passport(Number|No)/i.test(mini))failures.push("verification flow must not collect full document numbers");
if(/x-payment-webhook-secret"\]\|\|req\.query\.secret/.test(server))failures.push("payment webhook accepts query secret");
if(/x-provider-webhook-secret"\]\|\|req\.query\.secret/.test(server))failures.push("provider webhook accepts query secret");
if(!/Cache-Control","no-store"/.test(server))failures.push("API no-store header missing");
if(!/Content-Security-Policy/.test(server))failures.push("CSP header missing");
if(/style-src[^;]*'unsafe-inline'/.test(server))failures.push("CSP permits unsafe-inline styles");
if(!sw.includes('url.pathname.startsWith("/api/")')||!sw.includes('url.pathname.startsWith("/admin")'))failures.push("Service Worker must bypass API/Admin");
if(!sw.includes("STATIC_SET.has(url.pathname)"))failures.push("Service Worker cache allowlist missing");
if(failures.length){console.error("Web/security audit FAILED");for(const x of failures)console.error("-",x);process.exit(1)}
console.log("Web/security audit OK");
