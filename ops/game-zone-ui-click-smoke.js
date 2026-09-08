const { chromium } = require('playwright-core');
const path=require('path');
(async()=>{
  const executable=process.env.CHROME_BIN||'/usr/bin/google-chrome';
  const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox','--allow-file-access-from-files']});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error'&&!String(m.text()).includes('telegram.org'))errors.push(m.text())});
  await page.goto('file://'+path.resolve('miniapp/index.html'),{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(500);
  const active=async name=>await page.locator(`.screen[data-screen="${name}"]`).evaluate(el=>el.classList.contains('active'));
  for(const name of ['orders','wallet','favorites','support','account','home']){
    await page.locator(`.bottom-nav [data-go="${name}"]`).click();
    if(!(await active(name)))throw new Error(`navigation failed: ${name}`);
  }
  // Rapid navigation catches mutation/event-loop starvation regressions.
  for(let i=0;i<8;i++){
    await page.locator('.bottom-nav [data-go="wallet"]').click();
    await page.locator('.bottom-nav [data-go="home"]').click();
  }
  await page.locator('[data-category]').first().click();
  if(!(await active('category')))throw new Error('category click failed');
  const child=page.locator('#categoryChildren [data-category]').first();
  if(await child.count())await child.click();
  const product=page.locator('[data-product]').first();
  if(await product.count()){
    await product.click();
    if(!(await page.locator('#sheet').evaluate(el=>el.classList.contains('show'))))throw new Error('product sheet did not open');
    await page.locator('#sheetClose').click();
  }
  await page.locator('.bottom-nav [data-go="wallet"]').click();
  const visibleTopup=page.locator('#gz21TopupNow');
  if(await visibleTopup.count())await visibleTopup.click();
  else await page.locator('#topupBtn').click({force:true});
  if(!(await page.locator('#sheet').evaluate(el=>el.classList.contains('show'))))throw new Error('topup sheet did not open');
  await page.locator('#sheetClose').click();
  await page.locator('.bottom-nav [data-go="account"]').click();
  await page.locator('#privacyBtn').click();
  if(!(await page.locator('#sheet').evaluate(el=>el.classList.contains('show'))))throw new Error('privacy sheet did not open');
  await page.locator('#sheetClose').click();
  if(errors.length)throw new Error('page errors: '+errors.join(' | '));
  console.log('GAME_ZONE_UI_CLICK_SMOKE=PASS');
  await browser.close();
})().catch(e=>{console.error('GAME_ZONE_UI_CLICK_SMOKE=FAIL',e);process.exit(1)});
