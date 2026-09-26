/* Browser regression for the actual bundled direct-connect UI.
 * Localhost-only fixture: fake saved router + API capabilities, no credentials,
 * no signed Telegram identity and no calls to customer equipment. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer';

const root=process.cwd();
const dist=path.join(root,'dist');
const htmlPath=path.join(dist,'provider','index.html');
if(!fs.existsSync(htmlPath))throw Error('Build provider web assets first');
const html=fs.readFileSync(htmlPath,'utf8');
const match=html.match(/<script src="\/provider\/assets\/([^"]+\.js)" defer><\/script>/);
if(!match)throw Error('Bundled provider script tag was not found');
const name=match[1];
const original=fs.readFileSync(path.join(dist,'provider','assets',name),'utf8');
const marker='setupUchihaV183Runtime();\ninstallV183UiSimplify();';
if(original.split(marker).length!==2)throw Error('Expected one immutable V1-83 runtime entrypoint');
const script=original.replace(marker,'window.__v183QaDirectConnect=installV183DirectConnect;\n'+marker);
const screenshots=process.env.UI_QA_SCREENSHOTS||path.join(dist,'ui-qa');
fs.mkdirSync(screenshots,{recursive:true});
const mime={'.html':'text/html;charset=UTF-8','.js':'text/javascript;charset=UTF-8','.css':'text/css;charset=UTF-8','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer((req,res)=>{
 let pathname;
 try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}
 catch{res.writeHead(400);res.end();return}
 if(pathname==='/provider/index.html'){
  res.writeHead(200,{'Content-Type':mime['.html']});res.end(html);return;
 }
 if(pathname==='/provider/assets/'+name){
  res.writeHead(200,{'Content-Type':mime['.js']});res.end(script);return;
 }
 const filename=path.resolve(dist,'.'+pathname);
 if(!filename.startsWith(dist+path.sep)){res.writeHead(403);res.end();return}
 fs.readFile(filename,(error,bytes)=>{
  if(error){res.writeHead(404);res.end();return}
  res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream'});
  res.end(bytes);
 });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const assert=(value,message)=>{if(!value)throw Error(message)};
const widths=[320,337,360,390,430,768];
const results=[];
let browser;
try{
 browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const width of widths){
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.setViewport({width,height:780,deviceScaleFactor:width<=430?2:1,isMobile:width<=430,hasTouch:width<=430});
   await page.setRequestInterception(true);
   page.on('request',req=>{
    if(!req.url().startsWith('http://127.0.0.1:'))req.abort();
    else req.continue();
   });
   await page.goto('http://127.0.0.1:'+server.address().port+'/provider/index.html',{waitUntil:'networkidle2',timeout:30000});
   await page.evaluate(()=>{
    document.documentElement.dataset.theme='dark';
    if(typeof window.__v183QaDirectConnect!=='function')throw Error('Test-only direct-connect hook missing');
    const id='dev_QA_ROUTER_12345678';
    const state={devices:[{id,name:'QA router',host:'192.0.2.0',api_port:8729,username:''}],me:{role:'owner',canWrite:true}};
    const api=async endpoint=>{
     if(endpoint==='/devices/direct-capabilities')return {ready:true,restHttps:true,vpnEnabled:false};
     throw Error('Unexpected fixture endpoint');
    };
    window.__v183QaDirectConnect(state,api,async()=>{},e=>{throw e},()=>{});
    const launcher=document.createElement('button');
    launcher.type='button';launcher.dataset.v183DirectConnect=id;
    document.body.append(launcher);launcher.click();
   });
   await page.waitForSelector('#v183-direct-connect-form',{visible:true,timeout:7000});
   await new Promise(r=>setTimeout(r,400));
   const geometry=await page.evaluate(()=>{
    const d=document.getElementById('workspace-dialog');
    const f=document.getElementById('v183-direct-connect-form');
    const r=el=>{const b=el.getBoundingClientRect();return{left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}};
    const controls=[...f.querySelectorAll('input:not([type="checkbox"]),select,textarea')].filter(el=>r(el).width>0).map(r);
    const checkbox=r(f.querySelector('input[name="owned"]'));
    const action=f.querySelector('[data-v183-agent-template]');
    const actionBox=r(action),iconBox=r(action.querySelector('.action-art'));
    return {viewport:innerWidth,dialog:r(d),scrollWidth:d.scrollWidth,clientWidth:d.clientWidth,scrollHeight:d.scrollHeight,clientHeight:d.clientHeight,
      form:r(f),formScrollWidth:f.scrollWidth,formClientWidth:f.clientWidth,checkbox,controls,actionBox,iconBox,
      confirmIsFlex:getComputedStyle(f.querySelector('.v183-direct-confirm')).display,
      dialogOverflow:getComputedStyle(d).overflowX};
   });
   const prefix=String(width)+'px';
   assert(geometry.dialog.left>=-1&&geometry.dialog.right<=width+1,prefix+': modal exceeds screen');
   assert(geometry.scrollWidth<=geometry.clientWidth+1,prefix+': modal scrolls horizontally');
   assert(geometry.formScrollWidth<=geometry.formClientWidth+1,prefix+': long content widens router form');
   assert(geometry.controls.every(b=>b.left>=geometry.form.left-1&&b.right<=geometry.form.right+1),prefix+': clipped input');
   assert(geometry.checkbox.width>=16&&geometry.checkbox.width<=22&&geometry.checkbox.height>=16&&geometry.checkbox.height<=22,prefix+': ownership checkbox is oversized');
   assert(geometry.confirmIsFlex==='flex',prefix+': confirmation label does not wrap');
   assert(geometry.iconBox.left>=geometry.actionBox.left-1&&geometry.iconBox.right<=geometry.actionBox.right+1,prefix+': Site Agent button icon overflows');
   if(width<=430)assert(geometry.scrollHeight>geometry.clientHeight+100,prefix+': sheet is not vertically scrollable');
   await page.screenshot({path:path.join(screenshots,'mikrotik-sheet-'+width+'.png')});
   await page.evaluate(()=>{document.getElementById('v183-direct-advanced').open=true});
   const expanded=await page.evaluate(()=>{
    const d=document.getElementById('workspace-dialog');
    const f=document.getElementById('v183-direct-connect-form');
    const box=f.getBoundingClientRect();
    const fields=[...f.querySelectorAll('input:not([type="checkbox"]),select,textarea')]
      .map(el=>el.getBoundingClientRect()).filter(b=>b.width>0&&b.height>0);
    return {dialogScrollWidth:d.scrollWidth,dialogClientWidth:d.clientWidth,formScrollWidth:f.scrollWidth,formClientWidth:f.clientWidth,
      fieldsInside:fields.every(b=>b.left>=box.left-1&&b.right<=box.right+1)};
   });
   assert(expanded.fieldsInside&&expanded.formScrollWidth<=expanded.formClientWidth+1&&expanded.dialogScrollWidth<=expanded.dialogClientWidth+1,prefix+': expanded certificate settings overflow');
   await page.click('#v183-direct-connect-form .v183-direct-confirm span');
   assert(await page.$eval('#v183-direct-connect-form [name="owned"]',el=>el.checked),prefix+': confirmation cannot be tapped');
   await page.evaluate(()=>{const d=document.getElementById('workspace-dialog');d.scrollTop=d.scrollHeight});
   await new Promise(r=>setTimeout(r,70));
   const bottom=await page.evaluate(()=>{
    const d=document.getElementById('workspace-dialog');
    const footer=d.querySelector('.form-actions');
    const frame=d.getBoundingClientRect(),r=footer.getBoundingClientRect();
    return {scrollTop:d.scrollTop,footerBottom:r.bottom,frameBottom:frame.bottom};
   });
   assert(bottom.scrollTop>50&&bottom.footerBottom<=bottom.frameBottom+2,prefix+': cannot reach the bottom of the modal');
   await page.screenshot({path:path.join(screenshots,'mikrotik-sheet-bottom-'+width+'.png')});
   assert(errors.length===0,prefix+': JavaScript errors: '+errors.join(' | '));
   results.push({width,geometry,expanded,bottom});
   console.log('PASS '+prefix+': no clipped fields, compact checkbox, wrapped Site Agent button, scrollable certificate settings');
  }finally{await page.close()}
 }
 fs.writeFileSync(path.join(screenshots,'mikrotik-sheet-results.json'),JSON.stringify(results,null,2));
 console.log('PASS '+results.length+'/'+widths.length+' direct MikroTik modal viewport checks');
}finally{
 await browser?.close();
 await new Promise(resolve=>server.close(resolve));
}
