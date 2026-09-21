// Browser-only fixtures. No production wallet, provider, or purchase is contacted.
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const assets=path.resolve(process.argv[2]||'debt-app/app/src/main/assets');
const output=path.resolve(process.env.ORDER_TEST_OUTPUT||'order-test-output');fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{
  const requested=req.url.split('?')[0]==='/'?'/index.html':decodeURIComponent(req.url.split('?')[0]);
  const file=path.resolve(assets,'.'+requested);
  if(!file.startsWith(assets+path.sep)){res.writeHead(403);return res.end();}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');res.end(fs.readFileSync(file));}
  catch{res.writeHead(404);res.end();}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,executablePath:process.env.ORDER_CHROME||undefined,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.fixtureRequests=[];
    const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nVQAAAAASUVORK5CYII=';
    const products=[
      {id:1,name:'فري فاير روبوت 1',description:'هذا المنتج يعمل بشكل تلقائي 24 ساعة',image_url:image,price:.955,automatic:true},
      {id:2,name:'شحن رصيد مرن',price:.002,product_type:'amount',min:100,max:1000},
      {id:3,name:'باقات جواهر محددة',price:.008,product_type:'specificPackage',qty_values:[110,231,583]},
      {id:4,name:'بطاقة رقمية',price:1.25,allow_quantity:1,max:25},
      {id:5,name:'منتج بحقول قديمة',price:2}
    ];
    const schema={
      1:{fields:[{key:'custom_الايدي',label:'الآيدي',placeholder:'الآيدي',type:'numeric',required:true,options:[],min_length:3,max_length:40}],quantity:{variable:false,kind:'fixed',min:1,max:1,step:1,options:[]},verification:{enabled:true,required:false,game:'Free Fire',field_key:'custom_الايدي'},automatic:true},
      2:{fields:[{key:'custom_account',label:'رقم الحساب',type:'numeric',required:true,options:[],min_length:2,max_length:30}],quantity:{variable:true,kind:'amount',min:100,max:1000,step:100,options:[]},verification:{enabled:false},automatic:null},
      3:{fields:[],quantity:{variable:true,kind:'packages',min:110,max:583,step:1,options:[110,231,583]},verification:{enabled:false},automatic:true},
      4:{fields:[{key:'email',label:'البريد الإلكتروني',type:'email',required:true,options:[],min_length:3,max_length:100}],quantity:{variable:true,kind:'quantity',min:1,max:25,step:1,options:[]},verification:{enabled:false},automatic:false}
    };
    const oldFields=btoa(unescape(encodeURIComponent(JSON.stringify([{label:'السيرفر',type:'select',options:['أوروبا','آسيا']},{label:'اسم المستخدم',type:'text'}]))));
    products[4].custom_fields=oldFields;
    window.Android={
      serviceStatus:()=>JSON.stringify({active:true,role:'user',license_id:'browser-fixture'}),
      serviceRequest:(action,args,id)=>{
        args=JSON.parse(args);window.fixtureRequests.push({action,args,id});let result={ok:false,error:'INVALID_ACTION'};
        if(action==='digital_catalog')result={ok:true,data:{categories:[],products}};
        if(action==='digital_wallet')result={ok:true,balance:12.5,orders:[],support_whatsapp:'963942586044'};
        if(action==='digital_product')result={ok:true,product:products.find(product=>product.id===Number(args.product_id)),order_schema:schema[args.product_id]||null};
        if(action==='digital_verify_player')result={ok:true,valid:true,player_name:'UCHIHA Player'};
        if(action==='digital_purchase')result={ok:true,outcome:'submitted',balance:11.545,order_id:'fixture-order'};
        const delay=action==='digital_product'?180:action==='digital_catalog'?100:10;
        setTimeout(()=>window.onDebtServiceResult(id,result),delay);
      }
    };
  });
  try{
    await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForTimeout(120);
    await page.evaluate(()=>DigitalStore.open());await page.waitForFunction(()=>document.querySelectorAll('.digital-card').length===5);

    await page.evaluate(()=>DigitalStore.root());
    await page.waitForSelector('.digital-catalog-stage > .digital-load-overlay .digital-provider-loader');
    assert.equal(await page.locator('.digital-grid .digital-card').count(),0,'old product cards are removed before a new catalog response');
    assert.equal(await page.locator('.bottom-nav').count(),1,'bottom navigation stays mounted during catalog loading');
    assert.equal(await page.locator('.digital-provider-loader img').getAttribute('src'),'loading-wallet-v170.png','red wallet loader uses the new transparent asset');
    assert.equal(await page.locator('.digital-load-overlay').evaluate(node=>getComputedStyle(node).backgroundColor),'rgba(0, 0, 0, 0)','loader has no background layer');
    assert.equal(await page.locator('.digital-load-overlay').evaluate(node=>getComputedStyle(node).pointerEvents),'none','loader does not block fixed navigation');
    const loaderCenter=await page.locator('.digital-provider-loader').evaluate(node=>{const r=node.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,w:innerWidth,h:innerHeight}});
    assert(Math.abs(loaderCenter.x-loaderCenter.w/2)<2,'loader is centered horizontally in the viewport');
    assert(Math.abs(loaderCenter.y-loaderCenter.h/2)<2,'loader is centered vertically in the viewport');
    await page.waitForFunction(()=>document.querySelectorAll('.digital-card').length===5);
    await page.waitForFunction(()=>document.querySelector('.digital-card-photo')?.classList.contains('is-loaded'));
    await page.evaluate(()=>{window.retainedProductPhoto=document.querySelector('.digital-card-photo')});

    await page.locator('.digital-card').nth(0).click();
    await page.waitForTimeout(25);
    assert.equal(await page.locator('.digital-order-modal').count(),1,'purchase dialog appears immediately before product detail response');
    assert.equal(await page.locator('#digitalBuyButton').isDisabled(),true,'buy waits for authoritative product schema');
    assert.equal(await page.locator('.digital-load-overlay').count(),0,'opening a product never shows the catalog loader');
    assert.equal(await page.evaluate(()=>retainedProductPhoto.isConnected),true,'clicked product does not rebuild the catalog while details load');
    await page.waitForFunction(()=>document.querySelector('#digitalBuyButton')?.textContent==='شراء'&&!document.querySelector('#digitalBuyButton')?.disabled);
    assert.equal(await page.evaluate(()=>retainedProductPhoto===document.querySelector('.digital-card-photo')),true,'catalog image DOM remains unchanged when dialog opens');
    assert.equal(await page.locator('.digital-grid').count(),1,'catalog remains mounted behind dialog');
    assert.equal(await page.locator('.bottom-nav').count(),1,'original bottom navigation remains mounted');
    assert.equal(await page.locator('#digitalQty').count(),0,'fixed products do not invent quantity');
    assert.equal(await page.locator('#digitalVerifyButton').count(),1,'eligible game exposes optional verification');
    assert.equal(await page.locator('.digital-order-buy').textContent(),'شراء');
    assert.equal(await page.locator('.digital-order-cancel').textContent(),'إلغاء');
    assert.equal(await page.locator('.digital-order-note').textContent(),'هذا المنتج يعمل بشكل تلقائي 24 ساعة','automatic delivery text is placed at the bottom');
    assert.doesNotMatch(await page.locator('#digitalOrderHeadline').textContent(),/تلقائي|حالة المزود/,'delivery state is not repeated in the headline');
    assert.equal(await page.locator('.digital-order-product p').count(),0,'delivery state is not repeated under the product title');
    await page.screenshot({path:path.join(output,'order-reference-390x844.png'),fullPage:true});

    const idInput=page.locator('#orderField0');await idInput.focus();await page.evaluate(()=>{window.retainedOrderInput=document.querySelector('#orderField0')});
    await idInput.fill('١٢۳ 45x');assert.equal(await idInput.inputValue(),'12345');
    assert.equal(await page.evaluate(()=>retainedOrderInput.isConnected&&document.activeElement===retainedOrderInput),true,'field updates retain focused DOM node');
    await page.locator('#digitalVerifyButton').click();await page.waitForFunction(()=>document.querySelector('#digitalVerifiedName')?.textContent==='UCHIHA Player');
    assert.equal(await page.locator('#digitalVerifyStatus').textContent(),'تم التحقق بنجاح');
    await idInput.fill('99999');assert.equal(await page.locator('#digitalVerifiedName').textContent(),'التحقق من الاسم','editing ID invalidates previous check without re-render');
    await page.locator('.digital-order-cancel').click();assert.equal(await page.locator('.digital-order-modal').count(),0);
    assert.equal(await page.evaluate(()=>retainedProductPhoto===document.querySelector('.digital-card-photo')),true,'closing dialog does not reload product images');

    await page.locator('.digital-card').nth(1).click();await page.waitForSelector('#digitalQty');
    assert.equal(await page.locator('#digitalQty').inputValue(),'100');
    await page.locator('#digitalQty').focus();await page.evaluate(()=>{window.retainedQty=document.querySelector('#digitalQty')});
    await page.locator('#digitalQty').fill('٣٠٠abc');assert.equal(await page.locator('#digitalQty').inputValue(),'300');
    assert.equal(await page.locator('#digitalOrderPrice').textContent(),'$ 0.600');
    assert.equal(await page.evaluate(()=>retainedQty.isConnected&&document.activeElement===retainedQty),true,'quantity price update is DOM-local');
    await page.locator('#digitalQty').fill('350');assert.equal(await page.locator('#digitalBuyButton').isDisabled(),true,'step is enforced');
    await page.locator('.digital-order-cancel').click();

    await page.locator('.digital-card').nth(2).click();await page.waitForSelector('#digitalQty');
    assert.deepEqual(await page.locator('#digitalQty option').allTextContents(),['110','231','583'],'specific packages come from API values');
    await page.locator('#digitalQty').selectOption('231');assert.equal(await page.locator('#digitalOrderPrice').textContent(),'$ 1.85');
    await page.evaluate(()=>appBack());assert.equal(await page.locator('.digital-order-modal').count(),0,'Android back closes dialog first');

    await page.locator('.digital-card').nth(3).click();await page.waitForSelector('#digitalQty');
    assert.equal(await page.locator('#digitalQty').inputValue(),'1','allow_quantity starts at one');
    assert.equal(await page.locator('#digitalVerifyButton').count(),0,'unrelated products never show name verification');
    await page.locator('.digital-order-cancel').click();

    await page.locator('.digital-card').nth(4).click();await page.waitForSelector('.digital-order-modal');
    assert.equal(await page.locator('.digital-order-control').count(),2,'legacy base64 fields are decoded');
    assert.deepEqual(await page.locator('#orderField0 option').allTextContents(),['اختر السيرفر','أوروبا','آسيا']);
    assert.equal(await page.locator('#orderField1').getAttribute('placeholder'),'اسم المستخدم');
    await page.locator('.digital-order-buy').click();assert.match(await page.locator('#digitalOrderError').textContent(),/أكمل/,'required fields block empty purchase');

    for(const width of [360,390,768]){
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow '+width);
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({pass:true,checks:['provider-style transparent red wallet loader','old cards cleared before catalog refresh','bottom navigation remains usable during loading','product opens without global loader','catalog and images retain DOM identity','automatic delivery note is bottom-only','dialog overlays existing catalog','original bottom navigation preserved','fixed/amount/specificPackage/allow_quantity rules','English quantity digits','DOM-local field and price updates','conditional Free Fire verification','verification invalidation','required dynamic fields','legacy base64 custom_fields','Android back closes dialog','360/390/768 no horizontal overflow']},null,2));
    console.log('PASS: dynamic order browser tests; screenshot saved to '+output);
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
