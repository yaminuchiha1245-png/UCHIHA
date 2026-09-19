// Browser regression tests only. These fixtures never ship in the APK and
// never send purchases or alter production data.
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const assets=path.resolve(process.argv[2]||'debt-app/app/src/main/assets');
const output=path.resolve(process.env.SMM_TEST_OUTPUT||'smm-test-output');fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{
 const p=path.resolve(assets,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
 if(!p.startsWith(assets+path.sep)){res.writeHead(403);return res.end();}
 try{res.setHeader('Content-Type',p.endsWith('.svg')?'image/svg+xml':p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(p));}
 catch{res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.SMM_CHROME||undefined,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
   window.fixtureRequests=[];window.fixtureDelay=0;
   window.Android={serviceStatus:()=>JSON.stringify({active:true,role:'user',license_id:'browser-fixture'}),
     serviceRequest:(action,args,id)=>{
       args=JSON.parse(args);window.fixtureRequests.push({action,args,id});
       let r={ok:false,error:'SESSION_REQUIRED'};
       if(action==='digital_catalog')r={ok:true,data:Number(args.category_id)===100?
         {categories:[{id:10,name:'Instagram • قسم ثانٍ'},{id:11,name:'Instagram • قسم أول'},{id:20,name:'Telegram • قسم'}],products:[]}:
         {categories:[],products:[{id:101,name:'Instagram • خدمة ثانياً'},{id:102,name:'Instagram • خدمة أولاً'},{id:201,name:'Telegram • أخرى'}]}};
       if(action==='digital_product')r={ok:true,product:{id:args.product_id,name:'Instagram • خدمة ثانياً',price:.002,product_type:'amount',qty_values:{min:100,max:10000,step:100},params:[{name:'link',label:'الرابط',required:true}]}};
       if(action==='digital_wallet')r={ok:true,balance:0,orders:[]};
       if(action==='digital_purchase')throw Error('Purchase forbidden in browser tests');
       setTimeout(()=>window.onDebtServiceResult(id,r),window.fixtureDelay);
     }};
 });
 try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForTimeout(150);
 await page.evaluate(()=>DigitalStore.openSmm({id:100,name:'الرشق'}));
 assert.equal(await page.locator('.smm-app').count(),13);
 assert.equal(await page.locator('#smmF0').count(),1);assert.equal(await page.locator('#smmQty').count(),1);
 assert.equal(await page.locator('.smm-confirm').isDisabled(),true);
 assert.equal(await page.evaluate(()=>document.querySelector('.bottom-nav').innerHTML.replaceAll(/DigitalStore.debtNav/g,'nav')===(()=>{const t=document.createElement('template');t.innerHTML=bottomNav();return t.content.firstChild.innerHTML})()),true,'same home navigation');
 const coords=await page.locator('.smm-platforms-ref > button').evaluateAll(nodes=>nodes.map(n=>({name:n.title||n.textContent,y:n.getBoundingClientRect().top,x:n.getBoundingClientRect().left,w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));
 assert.equal(new Set(coords.map(c=>Math.round(c.y))).size,2,'two rows');
 assert(Math.abs(coords[1].w/coords[1].h-162/110)<.025,'reference button ratio');
 assert(coords.find(c=>c.name==='Telegram').x<coords.find(c=>c.name==='Instagram').x);
 assert.equal(await page.locator('.smm-logo img').evaluateAll(nodes=>nodes.every(n=>n.complete&&n.naturalWidth>0)),true,'all assets loaded');
 for(const [selector,value,expected] of [['#smmSearch','Instagram','Instagram'],['#smmF0','https://instagram.com/example','https://instagram.com/example'],['#smmQty','١٢۳abc.٤','1234']]){
   const input=page.locator(selector);await input.focus();await page.evaluate(sel=>{window.retainedInput=document.querySelector(sel)},selector);
   await input.fill(value);await page.evaluate(()=>render());
   assert.equal(await input.inputValue(),expected);
   assert.equal(await page.evaluate(()=>retainedInput.isConnected&&document.activeElement===retainedInput),true,'focus/identity retained '+selector);
 }
 await page.locator('#smmSearch').fill('');
 await page.getByRole('button',{name:'عرض المزيد +6',exact:true}).click();assert.equal(await page.locator('.smm-app').count(),19);
 await page.getByRole('button',{name:'عرض أقل',exact:true}).click();assert.equal(await page.locator('.smm-app').count(),13);
 assert.equal(await page.locator('#smmF0').inputValue(),'https://instagram.com/example');
 await page.getByRole('button',{name:'Instagram',exact:true}).click();
 assert.deepEqual(await page.locator('.smm-drop-row').allTextContents(),['Instagram • قسم ثانٍ','Instagram • قسم أول']);
 const appStyles=await page.locator('.smm-app.active').evaluate(n=>({transform:getComputedStyle(n).transform,shadow:getComputedStyle(n).boxShadow}));
 assert.deepEqual(appStyles,{transform:'none',shadow:'none'});
 await page.locator('.smm-dropdown-search input').fill('أول');
 assert.equal(await page.locator('.smm-drop-row:visible').count(),1);
 await page.locator('.smm-dropdown-search input').fill('غير موجود');assert.equal(await page.locator('.smm-drop-row:visible').count(),0);assert.equal(await page.locator('.smm-drop-empty:visible').count(),1);
 await page.locator('.smm-dropdown-search input').fill('');assert.equal(await page.locator('.smm-drop-row:visible').count(),2);
 await page.getByRole('button',{name:'Instagram • قسم ثانٍ',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.digital-load-overlay'));
 await page.locator('[data-smm-key="service"] .smm-select-trigger').click();
 assert.deepEqual(await page.locator('.smm-drop-row').allTextContents(),['Instagram • خدمة ثانياً','Instagram • خدمة أولاً']);
 await page.getByRole('button',{name:'Instagram • خدمة ثانياً',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.digital-load-overlay'));
 assert.equal(await page.locator('#smmQty').inputValue(),'1234');
 await page.locator('#smmQty').fill('500');assert.equal(await page.locator('#smmPriceValue').textContent(),'$ 1.00');
 assert.equal(await page.locator('#smmF0').inputValue(),'https://instagram.com/example');
 await page.locator('#smmF0').focus();await page.evaluate(()=>{window.retainedInput=document.querySelector('#smmF0');for(let i=0;i<10;i++)render()});
 assert.equal(await page.evaluate(()=>retainedInput.isConnected&&document.activeElement===retainedInput),true);
 await page.getByRole('button',{name:'Telegram',exact:true}).click();assert.deepEqual(await page.locator('.smm-drop-row').allTextContents(),['Telegram • قسم']);
 // Late provider replies cannot bring the SMM screen back after navigation.
 await page.evaluate(()=>{window.fixtureDelay=150;DigitalStore.smmSection(20);DigitalStore.debtNav('clients')});await page.waitForTimeout(250);
 assert.equal(await page.locator('.smm-store').count(),0);
 await page.evaluate(()=>{window.fixtureDelay=0;return DigitalStore.openSmm({id:100,name:'الرشق'})});
 for(const width of [360,390,768]){
   await page.setViewportSize({width,height:844});await page.screenshot({path:path.join(output,'smm-'+width+'.png'),fullPage:true});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow '+width);
 }
 await page.setViewportSize({width:1536,height:900});
 // Inspect at the reference's full width without changing production layout.
 await page.addStyleTag({content:'.smm-ref-wrap{max-width:none!important;padding:0!important}.smm-app-panel{margin:0!important}'});
 await page.locator('.smm-app-panel').screenshot({path:path.join(output,'smm-selector-reference.png')});
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({pass:true,checks:['two rows and reference proportions','19 independent local logos','shared home bottom navigation','stable focused input nodes across background render','English digits only','drafts preserved across selection','app isolation and exact provider ordering','dropdown search hide/unhide','live quantity price','late reply ignored after exit','360/390/768 no horizontal overflow'],limitation:'Browser UI fixtures only; no production purchase and no Android-device update test.'},null,2));
 console.log('PASS: SMM browser regressions; screenshots saved to '+output);
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
