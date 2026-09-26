/*
 * Isolated visual regression smoke for the immutable V1-83 UI overlay.
 * Runs ONLY against a localhost bundle and example layout fixtures; never logs in,
 * talks to Telegram, sends a live MikroTik request or deploys anything.
 * Requires: npm install --no-save --no-package-lock puppeteer@24
 *           node scripts/build-provider-v183.mjs server
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer";

const root=process.cwd();
const dist=path.join(root,"dist");
const output=process.env.UI_QA_SCREENSHOTS||path.join(root,"dist","ui-qa");
const widths=[320,360,390,430,768];
const contentTypes={".html":"text/html;charset=utf-8",".js":"text/javascript;charset=utf-8",".css":"text/css;charset=utf-8",".png":"image/png",".svg":"image/svg+xml",".json":"application/json"};
fs.mkdirSync(output,{recursive:true});
if(!fs.existsSync(path.join(dist,"provider/index.html")))throw Error("Build the provider bundle before browser QA.");

const server=http.createServer((request,response)=>{
 const pathname=decodeURIComponent(new URL(request.url,"http://localhost").pathname);
 const file=path.resolve(dist,"."+pathname);
 if(!file.startsWith(dist+path.sep)){response.writeHead(403);response.end();return;}
 fs.readFile(file,(error,bytes)=>{
  if(error){response.writeHead(404,{"Cache-Control":"no-store"});response.end();return;}
  response.writeHead(200,{"Content-Type":contentTypes[path.extname(file)]||"application/octet-stream","Cache-Control":"no-store"});
  response.end(bytes);
 });
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
let browser;
const results=[];
const assert=(ok,description)=>{if(!ok)throw Error(description);};
try{
 browser=await puppeteer.launch({headless:true,args:["--disable-dev-shm-usage","--no-sandbox"]});
 const address=`http://127.0.0.1:${server.address().port}/provider/index.html`;
 for(const width of widths){
  const page=await browser.newPage();
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  try{
   await page.setViewport({width,height:780,deviceScaleFactor:1});
   await page.goto(address,{waitUntil:"networkidle2",timeout:30000});
   await page.evaluate(()=>{
    // Release mode deliberately hides preview-only data until an authenticated
    // API loads. Force ONLY layout visibility for local fixture inspection.
    document.body.dataset.runtime="live";
    document.body.dataset.access="browse";
    // The real release intentionally keeps the sign-in screen above the app.
    // Hide it ONLY in this localhost fixture, otherwise screenshots show the
    // login splash while DOM measurements silently inspect the page behind it.
    document.querySelectorAll(".entry-screen,.entry-overlay,#entry-screen,#entry-overlay")
      .forEach(el=>el.style.setProperty("display","none","important"));
    document.querySelector("#page-dashboard")?.removeAttribute("hidden");
    document.querySelector(".bottom-wrap")?.removeAttribute("hidden");
    const drawer=document.querySelector("#drawer");
    if(drawer&&!drawer.open)drawer.showModal();
   });
   await new Promise(resolve=>setTimeout(resolve,850)); // drawer animation
   const drawer=await page.evaluate(()=>{
    const box=selector=>{
     const el=document.querySelector(selector);
     if(!el)return null;
     const r=el.getBoundingClientRect();
     return {x:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};
    };
    return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
     menuCount:document.querySelectorAll("#drawer-nav .drawer-link").length,
     bottomCount:document.querySelectorAll(".bottom-nav .nav-item").length,
     drawer:box("#drawer"),profile:box(".drawer-profile"),
     hasCompanion:!!window.UCHIHA_V183_UI};
   });
   assert(drawer.menuCount===7,`width ${width}: drawer must have exactly seven shortcuts`);
   assert(drawer.bottomCount===5,`width ${width}: bottom navigation must have exactly five buttons`);
   assert(drawer.hasCompanion,`width ${width}: UI script missing from bundled release`);
   assert(drawer.drawer&&drawer.drawer.x>=-1&&drawer.drawer.right<=width+1,`width ${width}: drawer outside viewport`);
   assert(drawer.profile&&drawer.profile.width>220,`width ${width}: profile card clipped`);
   assert(drawer.documentWidth<=width+1,`width ${width}: horizontal scroll`);
   await page.screenshot({path:path.join(output,`drawer-${width}.png`)});
   await page.evaluate(()=>document.querySelector("#drawer")?.close());
   await new Promise(resolve=>setTimeout(resolve,500));
   const dashboard=await page.evaluate(()=>{
    const box=selector=>{
     const el=document.querySelector(selector);
     if(!el)return null;
     const r=el.getBoundingClientRect();
     return {x:r.x,right:r.right,top:r.top,height:r.height};
    };
    const items=[...document.querySelectorAll(".bottom-nav .nav-item")].map(el=>{
     const r=el.getBoundingClientRect();return{x:r.left,right:r.right};
    });
    const health=[...document.querySelectorAll("#network-health .health-row")].map(el=>({
     text:el.textContent.trim(),visible:getComputedStyle(el).display!=="none",
     width:el.getBoundingClientRect().width}));
    const grid=document.querySelector("#network-health");
    return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
     header:box(".topbar"),focus:box("#dashboard-kpis .focus-card"),
     focusUnobscured:(()=>{
      const focus=document.querySelector("#dashboard-kpis .focus-card");
      if(!focus)return false;
      const r=focus.getBoundingClientRect();
      if(r.width<80||r.height<50||r.top<0||r.bottom>innerHeight)return false;
      const top=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);
      return !!top&&(top===focus||focus.contains(top));
     })(),
     focusProbe:(()=>{
      const focus=document.querySelector("#dashboard-kpis .focus-card");
      const r=focus?.getBoundingClientRect();
      const top=r?document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2):null;
      return {focusRect:r?.toJSON(),topElement:top&&{tag:top.tagName,id:top.id,classes:String(top.className).slice(0,140)},
       topPointerEvents:top&&getComputedStyle(top).pointerEvents,
       mainDisplay:getComputedStyle(document.querySelector(".main")).display,
       dialogs:[...document.querySelectorAll("dialog[open]")].map(el=>el.id)};
     })(),
     visibleEntryOverlays:[...document.querySelectorAll(".entry-screen,.entry-overlay,#entry-screen,#entry-overlay")]
      .filter(el=>getComputedStyle(el).display!=="none"&&el.getBoundingClientRect().height>0).length,
     cards:[...document.querySelectorAll("#dashboard-kpis .small-stat")].map(el=>{
      const r=el.getBoundingClientRect();return{x:r.x,top:r.top,bottom:r.bottom,width:r.width};
     }),
     health,healthColumns:grid?getComputedStyle(grid).gridTemplateColumns:null,bottom:items};
   });
   assert(dashboard.documentWidth<=width+1,`width ${width}: dashboard horizontal scroll`);
   assert(dashboard.visibleEntryOverlays===0,`width ${width}: sign-in overlay still visible in dashboard fixture`);
   if(!dashboard.focusUnobscured)console.error("Dashboard visibility probe:",JSON.stringify(dashboard.focusProbe));
   assert(dashboard.focusUnobscured,`width ${width}: screenshot would show an overlay, not the actual dashboard`);
   assert(dashboard.cards.length===2,`width ${width}: expected two compact stat cards`);
   if(width<=430){
    assert(Math.abs(dashboard.cards[0].top-dashboard.cards[1].top)<4,`width ${width}: KPI mini cards must share one row`);
    assert(dashboard.header.height<=62,`width ${width}: header not compact`);
   }
   if(width<=760){
    assert(dashboard.health.length===3&&dashboard.health.every(row=>row.visible&&row.width>20),`width ${width}: all three network health facts must be visible`);
   }
   for(let i=0;i<dashboard.bottom.length;i++)for(let j=i+1;j<dashboard.bottom.length;j++){
    const left=dashboard.bottom[i],right=dashboard.bottom[j];
    assert(left.right<=right.x+1||right.right<=left.x+1,`width ${width}: bottom actions overlap`);
   }
   assert(errors.length===0,`width ${width}: browser script errors: ${errors.join(" | ")}`);
   await page.screenshot({path:path.join(output,`dashboard-${width}.png`)});
   if(width===390)await page.screenshot({path:path.join(output,"dashboard-full-390.png"),fullPage:true});
   results.push({width,drawer,dashboard,errors});
   console.log(`PASS ${width}px: seven drawer entries; three real-health slots; responsive header; no overflow, nav overlap or page errors`);
  }finally{await page.close();}
 }
 fs.writeFileSync(path.join(output,"results.json"),JSON.stringify(results,null,2));
 console.log(`PASS ${results.length}/${widths.length} responsive viewport checks; fixture screenshots: ${output}`);
}finally{
 await browser?.close();
 await new Promise(resolve=>server.close(resolve));
}
