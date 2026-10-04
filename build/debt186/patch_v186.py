from pathlib import Path
import re, sys

ROOT=Path(sys.argv[1] if len(sys.argv)>1 else "debt-app")
assets=ROOT/"app/src/main/assets"

def repl(path,old,new,label):
    p=Path(path); s=p.read_text(encoding="utf-8")
    if old not in s: raise SystemExit(f"missing anchor: {label}")
    p.write_text(s.replace(old,new,1),encoding="utf-8")

# Version: next additive release after v1.5.29.
gradle=ROOT/"app/build.gradle"
s=gradle.read_text(encoding="utf-8")
s=re.sub(r"versionCode\s+\d+","versionCode 1053000",s,count=1)
s=re.sub(r"versionName\s+['\"][^'\"]+['\"]","versionName '1.5.30'",s,count=1)
gradle.write_text(s,encoding="utf-8")

# One code field for both owners/customers and partners.
v145=assets/"app-v145.js"
s=v145.read_text(encoding="utf-8")
s=s.replace("أدخل كود التفعيل لبدء الاستخدام","أدخل كود التفعيل أو كود الشريك لبدء الاستخدام",1)
s=s.replace("<label for=\"debtCode\">كود التفعيل</label>","<label for=\"debtCode\">كود التفعيل أو كود الشريك</label>",1)
v145.write_text(s,encoding="utf-8")

# Partner creation is admin-controlled now. Keep existing legacy/local partner rows,
# but remove the in-app add-partner entry point.
app=assets/"app.js"
s=app.read_text(encoding="utf-8")
old="""function renderPartners(){
  const body=`<div class="row"><div class="grow"><div class="section-title">الشركاء والحسابات</div></div>${isOwner()?`<button class="btn primary" onclick="openPartnerAdd()">＋ شريك</button>`:''}</div>${state.accounts.map(a=>`<div class="card row"><div class="avatar">${esc(initials(a.name))}</div><div class="grow"><b>${esc(a.name)}</b><div class="small muted">${a.role==='owner'?'صاحب المحل':'شريك'} ${a.id===sessionAccountId?'· الحساب الحالي':''}</div></div>${a.id===sessionAccountId?'<span class="badge green">نشط</span>':''}</div>`).join('')}`;
  return shell('الشركاء',body);
}"""
new="""function renderPartners(){
  const body=`<div class="row"><div class="grow"><div class="section-title">الشركاء والحسابات</div></div></div><p class="small muted">إضافة الشركاء وإصدار أكوادهم تتم من لوحة الإدارة فقط. الحسابات القديمة تبقى محفوظة.</p>${state.accounts.map(a=>`<div class="card row"><div class="avatar">${esc(initials(a.name))}</div><div class="grow"><b>${esc(a.name)}</b><div class="small muted">${a.role==='owner'?'صاحب المحل':'شريك'} ${a.id===sessionAccountId?'· الحساب الحالي':''}</div></div>${a.id===sessionAccountId?'<span class="badge green">نشط</span>':''}</div>`).join('')}`;
  return shell('الشركاء',body);
}"""
if old not in s: raise SystemExit("missing renderPartners anchor")
app.write_text(s.replace(old,new,1),encoding="utf-8")

partner_js=r"""/* UCHIHA Debt Store v1.5.30 — unified owner/partner activation. */
(function(){'use strict';
let booting=false,pending=null,seq=0;
const waits=new Map();
const previousDebtResult=window.onDebtServiceResult;
const previousCloudResult=window.onCloudNativeResult;
const previousRender=window.render;

function partnerNeedsPin(){
  return !!(state?.setupDone && (state.accounts||[]).find(a=>a?.role==='partner'&&a?.cloudPartner===true&&!a?.pinHash));
}
function loading(){
  const app=document.getElementById('app');if(!app)return;
  app.innerHTML='<main class="debt-activation"><div class="debt-brand"><div class="debt-app-icon"></div><h1>دفتر الديون</h1></div><h2>جاري ربط حساب الشريك…</h2><p class="debt-subtitle">يتم فتح متجر المالك ومزامنة البيانات تلقائيًا.</p></main>';
}
function pinScreen(){
  const account=(state.accounts||[]).find(a=>a?.role==='partner'&&a?.cloudPartner===true&&!a?.pinHash);
  if(!account)return false;
  const app=document.getElementById('app');if(!app)return true;
  app.innerHTML='<div class="setup"><div class="setup-card"><div class="logo">U</div><h1>'+esc(state.shop?.name||'دفتر الديون')+'</h1><p>تم ربط كود الشريك بالمتجر. عيّن PIN لهذا الهاتف فقط.</p><div class="form-group"><label class="label">PIN من 4 أرقام أو أكثر</label><input id="partnerPinV186" class="input" inputmode="numeric" type="password" maxlength="8" autocomplete="new-password"></div><button class="btn primary full" onclick="PartnerV186.setPin()">فتح المتجر</button></div></div>';
  return true;
}
window.render=function(){
  if(booting){loading();return;}
  if(partnerNeedsPin()&&pinScreen())return;
  return previousRender();
};

window.onDebtServiceResult=function(id,result){
  if(result?.ok&&result?.role==='partner'&&result?.partner){
    pending=result.partner;booting=true;
  }
  if(typeof previousDebtResult==='function')previousDebtResult(id,result);
  if(pending){
    const item=pending;pending=null;
    setTimeout(()=>bootstrap(item),0);
  }
};
window.onCloudNativeResult=function(id,result){
  const w=waits.get(id);
  if(w){clearTimeout(w.timer);waits.delete(id);w.resolve(result||{ok:false});return;}
  if(typeof previousCloudResult==='function')previousCloudResult(id,result);
};
function cloudSignIn(email,password){
  return new Promise(resolve=>{
    if(!window.Android?.cloudAuth){resolve({ok:false,error:'NATIVE_REQUIRED'});return;}
    const id='P186-'+Date.now()+'-'+(++seq);
    const timer=setTimeout(()=>{waits.delete(id);resolve({ok:false,error:'TIMEOUT'});},30000);
    waits.set(id,{resolve,timer});
    try{Android.cloudAuth('signin',String(email||''),String(password||''),id);}
    catch(_e){clearTimeout(timer);waits.delete(id);resolve({ok:false,error:'AUTH_FAILED'});}
  });
}
async function bootstrap(info){
  const auth=await cloudSignIn(info.cloud_email,info.cloud_password);
  if(!auth?.ok||!auth?.signedIn){
    booting=false;
    toast('تم قبول كود الشريك لكن تعذر ربط المزامنة. حاول التفعيل مجددًا.');
    DebtUI.openActivation();return;
  }
  if(state.setupDone){
    state.cloudSync={...(state.cloudSync||{}),storeId:info.store_id,userId:auth.userId,linked:true};
    saveState();booting=false;
    if(!sessionAccountId)sessionAccountId=state.activeAccountId||state.accounts?.[0]?.id||null;
    render();
    try{window.DebtCloudSync?.schedule?.(0);}catch(_e){}
    toast('تم ربط حساب الشريك بالمتجر');return;
  }
  const fresh=baseState();
  const account={
    id:uid('ACC'),name:String(info.label||'شريك'),role:'partner',pinHash:'',
    cloudPartner:true,
    permissions:{purchase:true,payment:true,clients:true}
  };
  fresh.setupDone=true;
  fresh.shop.name=String(info.store_name||'دفتر الديون');
  fresh.accounts=[account];fresh.activeAccountId=account.id;
  fresh.cloudSync={storeId:info.store_id,userId:auth.userId,linked:true,version:'1.5.30'};
  state=fresh;
  saveState();
  booting=false;
  pinScreen();
}
window.PartnerV186={
  setPin(){
    const input=document.getElementById('partnerPinV186');
    const pin=String(input?.value||'').trim();
    if(pin.length<4){toast('اختر PIN من 4 أرقام أو أكثر');return;}
    const account=(state.accounts||[]).find(a=>a?.role==='partner'&&a?.cloudPartner===true&&!a?.pinHash);
    if(!account){render();return;}
    account.pinHash=pinHash(pin);
    saveState();
    sessionAccountId=account.id;view='home';
    render();
    try{window.DebtCloudSync?.schedule?.(0);}catch(_e){}
    toast('تم فتح متجر المالك');
  }
};
if(partnerNeedsPin())pinScreen();
})();
"""
(assets/"partner-entry-v186.js").write_text(partner_js,encoding="utf-8")

index=assets/"index.html"
s=index.read_text(encoding="utf-8")
if "partner-entry-v186.js" not in s:
    s=s.replace("</body>",'  <script src="partner-entry-v186.js"></script>\n</body>')
index.write_text(s,encoding="utf-8")

print("Applied v1.5.30 unified partner activation; legacy partner data preserved")
