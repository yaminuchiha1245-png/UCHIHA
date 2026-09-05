const fs=require("fs");
const path=require("path");

const files=[
  path.join(__dirname,"..","..","miniapp","index.html"),
  path.join(__dirname,"..","..","miniapp","app.js"),
  path.join(__dirname,"..","..","admin","index.html"),
  path.join(__dirname,"..","..","admin","admin.js"),
  path.join(__dirname,"..","..","miniapp","privacy.html"),
  path.join(__dirname,"..","..","miniapp","terms.html"),
  path.join(__dirname,"..","..","miniapp","account-deletion.html")
];

const failures=[];
for(const file of files){
  const text=fs.readFileSync(file,"utf8");
  const rel=path.relative(path.join(__dirname,"..",".."),file);
  const checks=[
    [/on(?:click|error|load|mouseover|focus)\s*=\s*["\']/i,"inline HTML event handler"],
    [/javascript\s*:/i,"javascript: URL"],
    [/<script(?![^>]*src=)[^>]*>/i,"inline <script> block"],
    [/\sstyle\s*=\s*["']/i,"inline style attribute"],
    [/<style[^>]*>/i,"inline <style> block"],
  ];
  for(const [re,label] of checks){
    if(re.test(text))failures.push(`${rel}: ${label}`);
  }
}
const mini=fs.readFileSync(path.join(__dirname,"..","..","miniapp","app.js"),"utf8");
const serviceWorker=fs.readFileSync(path.join(__dirname,"..","..","miniapp","sw.js"),"utf8");
if(/device\/pair\/status\?.*secret/i.test(mini))failures.push("miniapp/app.js: pairing secret present in URL");
if(!/device\/pair\/status".*method:"POST"/s.test(mini))failures.push("miniapp/app.js: pairing status is not POST");

const server=fs.readFileSync(path.join(__dirname,"..","server.js"),"utf8");
if(/x-payment-webhook-secret"\]\|\|req\.query\.secret/.test(server))failures.push("server.js: payment webhook accepts query secret");
if(/x-provider-webhook-secret"\]\|\|req\.query\.secret/.test(server))failures.push("server.js: provider webhook accepts query secret");
if(!/Cache-Control","no-store"/.test(server))failures.push("server.js: API no-store header missing");
if(!/Content-Security-Policy/.test(server))failures.push("server.js: CSP header missing");
if(/style-src[^;]*'unsafe-inline'/.test(server))failures.push("server.js: CSP still permits unsafe-inline styles");
if(/res\.json\(\{\.\.\.db\.settings/.test(server))failures.push("server.js: public config spreads internal settings");
if(/app\.get\("\/api\/health"[\s\S]{0,900}storage\s*:\s*getStoreInfo\(\)/.test(server))failures.push("server.js: public health exposes raw storage diagnostics");
if(/app\.get\("\/api\/config"[\s\S]{0,1200}checkoutUrlTemplate/.test(server))failures.push("server.js: public config exposes checkout URL templates");

for(const appName of ["client","admin"]){
  const manifestPath=path.join(__dirname,"..","..","android",appName,"app","src","main","AndroidManifest.xml");
  const manifest=fs.readFileSync(manifestPath,"utf8");
  if(!/android:allowBackup="false"/.test(manifest))failures.push(`android/${appName}: allowBackup must be false`);
  if(!/android:usesCleartextTraffic="false"/.test(manifest))failures.push(`android/${appName}: cleartext traffic must be disabled`);

  const javaRoot=path.join(__dirname,"..","..","android",appName,"app","src","main","java");
  const javaFile=(function find(dir){
    for(const e of fs.readdirSync(dir,{withFileTypes:true})){
      const full=path.join(dir,e.name);
      if(e.isDirectory()){const found=find(full);if(found)return found;}
      else if(e.name==="MainActivity.java")return full;
    }
    return null;
  })(javaRoot);
  if(!javaFile){failures.push(`android/${appName}: MainActivity.java missing`);continue;}
  const java=fs.readFileSync(javaFile,"utf8");
  const required=[
    ["setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW)","mixed content must be disabled"],
    ["setAcceptThirdPartyCookies(webView, false)","third-party cookies must be disabled"],
    ["setAllowUniversalAccessFromFileURLs(false)","universal file URL access must be disabled"],
    ["setAllowFileAccessFromFileURLs(false)","file URL access must be disabled"],
    ["setGeolocationEnabled(false)","WebView geolocation must be disabled"],
    ["setSafeBrowsingEnabled(true)","Safe Browsing must be enabled"]
  ];
  for(const [needle,label] of required)if(!java.includes(needle))failures.push(`android/${appName}: ${label}`);
}

const androidWorkflow=fs.readFileSync(path.join(__dirname,"..","..",".github","workflows","android-build.yml"),"utf8");
if(/default:\s*["']https:\/\/gamezone\.example\.com/.test(androidWorkflow))failures.push("android-build.yml: placeholder production URL default present");
if(!/Refusing to build Android against a placeholder domain/.test(androidWorkflow))failures.push("android-build.yml: placeholder-domain validation missing");
if(!/lintDebug/.test(androidWorkflow))failures.push("android-build.yml: Android lint step missing");

if(!serviceWorker.includes('url.pathname.startsWith("/api/")')||!serviceWorker.includes('url.pathname.startsWith("/admin")')){
  failures.push("miniapp/sw.js: Service Worker must bypass API and Admin routes");
}
if(!serviceWorker.includes("STATIC_SET.has(url.pathname)"))failures.push("miniapp/sw.js: Service Worker cache must use an explicit static allowlist");


if(failures.length){
  console.error("Frontend/security audit FAILED");
  failures.forEach(x=>console.error("-",x));
  process.exit(1);
}
console.log("Frontend/security audit OK");
