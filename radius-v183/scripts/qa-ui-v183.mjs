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
    document.body.dataset.uiQaFixture="true";
    // This is ONLY an isolated localhost layout fixture. The release sign-in
    // gate must remain intact in application code and in the production build.
    // Hiding just the gate's DOM in QA makes screenshots show the actual UI;
    // otherwise an opaque welcome screen masks every dashboard screenshot.
    const gate=document.querySelector("#entry-screen");
    if(gate){gate.hidden=true;gate.inert=true;gate.style.setProperty("display","none","important");}
    for(const selector of [".topbar","#main",".bottom-wrap"]){
     const element=document.querySelector(selector);
     if(element)element.inert=false;
    }
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
   // Test the screenshot surface, not just offscreen DOM geometry: the gate
   // must be hidden and the real layout element hit-testable by Chrome.
   const surface=await page.evaluate(()=>{
    const gate=document.querySelector("#entry-screen");
    const focus=document.querySelector("#dashboard-kpis .focus-card");
    if(!focus)return {gateHidden:false,focusHit:false};
    const rect=focus.getBoundingClientRect();
    const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
    return {gateHidden:!gate||getComputedStyle(gate).display==="none",
     focusHit:!!hit&&(hit===focus||focus.contains(hit)),
     fixtureOnly:document.body.dataset.uiQaFixture==="true"};
   });
   assert(surface.gateHidden&&surface.focusHit&&surface.fixtureOnly,
    `width ${width}: dashboard screenshot would be obscured by sign-in or another overlay`);
   await page.evaluate(()=>{
    const badge=document.createElement("div");
    badge.id="ui-qa-fixture-label";
    badge.textContent="QA FIXTURE · NOT LIVE DATA · معاينة توضيحية";
    Object.assign(badge.style,{position:"fixed",top:"0",left:"50%",transform:"translateX(-50%)",
     zIndex:"100000",background:"#fff3ce",color:"#7c5300",borderRadius:"0 0 9px 9px",
     font:"bold 10px/18px Arial,sans-serif",padding:"2px 8px",whiteSpace:"nowrap",pointerEvents:"none"});
    document.body.append(badge);
    window.scrollTo(0,0);
   });
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
     cards:[...document.querySelectorAll("#dashboard-kpis .small-stat")].map(el=>{
      const r=el.getBoundingClientRect();return{x:r.x,top:r.top,bottom:r.bottom,width:r.width};
     }),
     health,healthColumns:grid?getComputedStyle(grid).gridTemplateColumns:null,bottom:items};
   });
   assert(dashboard.documentWidth<=width+1,`width ${width}: dashboard horizontal scroll`);
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
   // One additional image shows the genuine three-column health *layout*.
   // Values are immutable reference fixtures, never customer statistics.
   await page.evaluate(()=>document.querySelector("#network-health")?.scrollIntoView({block:"center"}));
   await page.screenshot({path:path.join(output,`health-${width}.png`)});
   results.push({width,drawer,dashboard,surface,errors});
   console.log(`PASS ${width}px: seven drawer entries; three real-health slots; responsive header; no overflow, nav overlap or page errors`);
  }finally{await page.close();}
 }
 fs.writeFileSync(path.join(output,"results.json"),JSON.stringify(results,null,2));
 console.log(`PASS ${results.length}/${widths.length} responsive viewport checks; fixture screenshots: ${output}`);
}finally{
 await browser?.close();
 await new Promise(resolve=>server.close(resolve));
}
