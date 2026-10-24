'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const assets=path.resolve(process.argv[2]||'debt-app/app/src/main/assets');
const output=process.env.LEDGER_TEST_OUTPUT||'/tmp/ledger-tests';
fs.mkdirSync(output,{recursive:true});
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const file=path.resolve(assets,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(assets+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
});
let browser,page;
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({executablePath:process.env.SYNC_CHROME,headless:true,args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:2});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'load'});
 await page.waitForFunction(()=>window.__UCHIHA_BOOT_READY===true);
 await page.evaluate(()=>{
  state=baseState();state.setupDone=true;state.rates.usdTry=40;state.rates.manual=true;state.settings.autoRates=false;state.settings.lockMinutes=0;
  state.accounts=[{id:'owner',name:'مالك الاختبار',role:'owner',pinHash:'test'}];state.activeAccountId='owner';state.clients=[{id:'client',name:'عميل الاختبار',area:'inside'}];
  const rows=[['purchase',40,'USD','2026-08-31T10:00:00Z'],['payment',40,'USD','2026-09-01T10:00:00Z'],['purchase',480,'TRY','2026-09-02T10:00:00Z'],['payment',480,'TRY','2026-09-03T10:00:00Z'],['purchase',6189,'TRY','2026-10-18T10:00:00Z'],['payment',6188,'TRY','2026-10-19T10:00:00Z'],['payment',1,'TRY','2026-10-19T10:01:00Z'],['payment',6100,'TRY','2026-10-19T10:02:00Z'],['purchase',180,'TRY','2026-10-21T10:00:00Z'],['purchase',55,'TRY','2026-10-22T10:00:00Z'],['purchase',165,'TRY','2026-10-23T10:00:00Z']];
  state.entries=rows.map(([type,amount,cur,createdAt],i)=>({id:'test-'+i,clientId:'client',type,originalAmount:amount,originalCurrency:cur,usdAmount:cur==='USD'?amount:round2(amount/40),createdAt,date:createdAt.slice(0,10),description:type==='payment'?'دفعة':'شراء'}));
  sessionAccountId='owner';selectedClientId='client';view='client';
  window.Android={exportCsv:csv=>window.__testCsv=csv,exportPdf:json=>window.__testPdf=JSON.parse(json)};
  render();
 });
 await page.locator('.ledger-review-v195').waitFor({state:'visible'});
 assert.match(await page.locator('table.mobile-ledger tbody tr').last().innerText(),/₺400/);
 const result=await page.evaluate(()=>({due:clientCurrencyDebtV121('client'),credit:clientCurrencyCreditV194('client'),width:innerWidth,bodyWidth:document.documentElement.scrollWidth}));
 assert.deepEqual(result.due,{USD:0,TRY:400});assert.deepEqual(result.credit,{USD:0,TRY:0});assert(result.bodyWidth<=result.width+1,'ledger must fit the mobile viewport');
 await page.screenshot({path:path.join(output,'client-credit-mobile.png'),fullPage:true});
 await page.getByRole('button',{name:'CSV',exact:true}).click();
 const csv=await page.evaluate(()=>window.__testCsv);assert.equal(csv.split('\n').length,12);assert.match(csv,/₺400/);
 await page.getByRole('button',{name:'PDF',exact:true}).click();
 await page.locator('#pdfTryDivisor').fill('40');
 await page.getByRole('button',{name:'تصدير PDF',exact:true}).click();
 const pdf=await page.evaluate(()=>window.__testPdf);assert.equal(pdf.summary.reviewAmountTry,6100);assert.equal(pdf.summary.reviewPaymentCount,1);assert.equal(pdf.summary.totalDueUsd,'10');assert.match(pdf.rows.at(-1).balance,/₺400/);
 await page.getByPlaceholder('بحث داخل السجل').fill('23/10/2026');
 assert.equal(await page.locator('table.mobile-ledger tbody tr').count(),1);assert.match(await page.locator('table.mobile-ledger tbody tr').last().innerText(),/₺400/);
 await page.getByPlaceholder('بحث داخل السجل').fill('');
 await page.getByPlaceholder('بحث داخل السجل').evaluate(input=>input.blur());
 const guard=await page.evaluate(()=>{const before=state.entries.length;commitPayment({clientId:'client',amount:401,currency:'TRY'});return state.entries.length===before;});assert(guard,'payment above the 400 TRY debt must be blocked');
 await page.evaluate(()=>{state.entries=state.entries.filter(e=>!(e.type==='payment'&&e.originalAmount===6100));clientLedgerQuery='';render();});
 assert.match(await page.locator('table.mobile-ledger tbody tr').last().innerText(),/₺400/);assert.equal(await page.locator('.ledger-review-v195').count(),0);
 assert.equal(await page.evaluate(()=>clientCurrencyDebtV121('client').TRY),400);
 await page.screenshot({path:path.join(output,'client-debt-mobile.png'),fullPage:true});

 // A connected store must wait for an authoritative receipt before applying a payment.
 await page.evaluate(()=>{
  state.settings.requireBiometricPayment=false;
  state.cloudSync={linked:true,storeId:'10000000-0000-4000-8000-000000000001'};
  state.clients[0].cloudId='20000000-0000-4000-8000-000000000001';
  Android.cloudStatus=()=>JSON.stringify({signedIn:true,userId:'30000000-0000-4000-8000-000000000001'});
  DebtCloudSync.flushForPayment=async()=>true;
  window.__testPaymentRequests=[];
  window.cloudRequest=(method,path,p)=>{window.__testPaymentRequests.push({method,path,p});return new Promise(resolve=>window.__testPaymentResolve=resolve);};
  startPayment('client');
 });
 await page.locator('#paymentCurrency').selectOption('TRY');
 await page.locator('#paymentAmount').fill('300');
 await page.getByRole('button',{name:'تسجيل الدفعة بالبصمة',exact:true}).click();
 await page.waitForFunction(()=>window.__testPaymentRequests.length===1);
 assert.equal(await page.evaluate(()=>clientCurrencyDebtV121('client').TRY),400);
 await page.waitForTimeout(950);
 await page.getByRole('button',{name:'تسجيل الدفعة بالبصمة',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.__testPaymentRequests.length),1);
 await page.evaluate(()=>{const p=window.__testPaymentRequests[0].p;window.__testPaymentResolve({ok:true,data:{id:p.p_operation_id,store_id:p.p_store,customer_id:p.p_customer,source_key:p.p_source_key,kind:'payment',original_currency:p.p_currency,original_amount:p.p_amount,usd_amount:p.p_amount/40,rate_usd_try:40,created_at:'2026-10-24T16:00:00Z',recorded_by_name:'CI owner',auth_method:'none'}});});
 await page.waitForFunction(()=>clientCurrencyDebtV121('client').TRY===100);
 assert.match(await page.locator('table.mobile-ledger tbody tr').last().innerText(),/₺100/);
 assert.equal(await page.evaluate(()=>window.__testPaymentRequests[0].path),'/rest/v1/rpc/debt_record_payment_v195');
 assert.deepEqual(errors,[],'the real page must not raise browser errors');
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,...result,csvRows:csv.split('\n').length,reviewAmount:pdf.summary.reviewAmountTry,browserErrors:errors},null,2));
 console.log('PASS mobile strict balance, review, exports, pending receipt and duplicate submission guards');
})().catch(async e=>{console.error(e);if(page)await page.screenshot({path:path.join(output,'failed.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(e),stack:e.stack},null,2));process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
