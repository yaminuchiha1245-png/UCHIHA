from pathlib import Path

index=Path('admin/index.html')
js=Path('admin/admin.js')
css=Path('admin/v5.css')

h=index.read_text()
j=js.read_text()
c=css.read_text()

if 'GAME_ZONE_OWNER_READINESS_V6' not in h:
    anchor='''    <section class="page active" data-page-view="dashboard">\n      <div id="stats" class="stats"></div>\n      <div class="panel"><div class="panel-head"><h2>نظرة سريعة</h2><button data-refresh>تحديث</button></div><div id="quickOrders"></div></div>\n    </section>'''
    repl='''    <section class="page active" data-page-view="dashboard">\n      <div id="stats" class="stats"></div>\n      <!-- GAME_ZONE_OWNER_READINESS_V6 -->\n      <div class="panel gz-readiness-panel">\n        <div class="panel-head"><h2>جاهزية تشغيل المتجر</h2><button data-refresh>تحديث الحالة</button></div>\n        <div id="ownerReadiness"></div>\n      </div>\n      <div class="panel"><div class="panel-head"><h2>نظرة سريعة</h2><button data-refresh>تحديث</button></div><div id="quickOrders"></div></div>\n    </section>'''
    if anchor not in h:
        raise SystemExit('dashboard anchor not found')
    h=h.replace(anchor,repl,1)

if '// GAME_ZONE_OWNER_READINESS_V6' not in j:
    anchor=''' const os=(data.orders||[]).slice(0,5);'''
    block=r''' // GAME_ZONE_OWNER_READINESS_V6
 const rd=data.readiness||{ready:false,checks:[]};
 const checks=Array.isArray(rd.checks)?rd.checks:[];
 const passed=checks.filter(x=>x.ok).length,total=checks.length,failed=checks.filter(x=>!x.ok);
 const readinessPage=id=>{
  const key=String(id||"").toLowerCase();
  if(key.includes("provider"))return "providers";
  if(key.includes("payment"))return "payments";
  if(key.includes("product")||key.includes("demo"))return "products";
  if(key.includes("inventory"))return "inventory";
  if(key.includes("backup")||key.includes("storage")||key.includes("state")||key.includes("journal")||key.includes("wallet")||key.includes("business")||key.includes("lock")||key.includes("postgres"))return "operations";
  if(key.includes("bot")||key.includes("secret")||key.includes("session")||key.includes("key")||key.includes("hmac"))return "security";
  return "settings";
 };
 const readinessEl=$("#ownerReadiness");
 if(readinessEl){
  const ordered=[...checks].sort((a,b)=>Number(a.ok)-Number(b.ok));
  readinessEl.innerHTML=`<div class="gz-readiness-hero ${rd.ready?"is-ready":"needs-work"}"><div><span class="gz-readiness-kicker">حالة الإطلاق</span><strong>${rd.ready?"جاهز لبدء العمل":"بقيت عناصر قبل استقبال العملاء"}</strong><small>${total?`${passed} من ${total} فحص ناجح`:"جاري جمع حالة النظام"}</small></div><div class="gz-readiness-score"><b>${total?Math.round(passed/total*100):0}%</b><span>${failed.length?`${failed.length} مطلوب`:"مكتمل"}</span></div></div><div class="gz-readiness-list">${ordered.map(x=>`<div class="gz-readiness-item ${x.ok?"ok":"bad"}"><div class="gz-readiness-status">${x.ok?"✓":"!"}</div><div class="gz-readiness-copy"><b>${esc(x.label||x.id)}</b>${x.detail?`<span>${esc(x.detail)}</span>`:""}</div>${x.ok?'<span class="gz-readiness-done">جاهز</span>':`<button type="button" data-readiness-page="${attr(readinessPage(x.id))}">إصلاح الآن</button>`}</div>`).join("")||'<div class="runtime-card"><b>لم تصل بيانات الجاهزية بعد.</b></div>'}</div>${rd.ready?'<div class="gz-readiness-final">✅ البنية الأساسية جاهزة. يستطيع صاحب المتجر الآن إدارة الكتالوج والطلبات والمدفوعات من هذه اللوحة.</div>':'<div class="gz-readiness-note">هذه القائمة تعتمد على الحالة الحقيقية للسيرفر. لا تُدخل أسرار المزود أو الدفع في الكود؛ أضفها فقط من صفحاتها المخصصة.</div>'}`;
  readinessEl.querySelectorAll('[data-readiness-page]').forEach(btn=>btn.onclick=()=>{
    const page=btn.dataset.readinessPage;
    const nav=document.querySelector(`aside nav button[data-page="${page}"]`);
    if(nav){nav.click();window.scrollTo({top:0,behavior:"smooth"});}
  });
 }
'''
    if anchor not in j:
        raise SystemExit('renderDashboard anchor not found')
    j=j.replace(anchor,block+anchor,1)

if '/* GAME_ZONE_OWNER_READINESS_V6 */' not in c:
    c += r'''

/* GAME_ZONE_OWNER_READINESS_V6 */
.gz-readiness-panel{overflow:hidden}
#ownerReadiness{display:grid;gap:14px}
.gz-readiness-hero{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:18px;border:1px solid rgba(255,255,255,.08);border-radius:22px;background:linear-gradient(135deg,rgba(255,255,255,.055),rgba(255,255,255,.018))}
.gz-readiness-hero.is-ready{border-color:rgba(54,211,153,.28);background:linear-gradient(135deg,rgba(54,211,153,.12),rgba(54,211,153,.025))}
.gz-readiness-hero.needs-work{border-color:rgba(255,160,67,.26);background:linear-gradient(135deg,rgba(255,160,67,.10),rgba(255,160,67,.02))}
.gz-readiness-hero>div:first-child{display:grid;gap:5px}.gz-readiness-kicker{font-size:12px;color:#8c96a8}.gz-readiness-hero strong{font-size:20px}.gz-readiness-hero small{color:#98a1b1}
.gz-readiness-score{width:82px;height:82px;border-radius:25px;display:grid;place-items:center;align-content:center;background:#080a0f;border:1px solid rgba(255,255,255,.08);flex:0 0 auto}.gz-readiness-score b{font-size:22px}.gz-readiness-score span{font-size:11px;color:#8f98a9}
.gz-readiness-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.gz-readiness-item{min-height:72px;display:grid;grid-template-columns:38px minmax(0,1fr) auto;align-items:center;gap:10px;padding:12px 13px;border:1px solid rgba(255,255,255,.07);border-radius:18px;background:#080a0e}.gz-readiness-item.ok{border-color:rgba(54,211,153,.14)}.gz-readiness-item.bad{border-color:rgba(255,70,91,.22)}
.gz-readiness-status{width:34px;height:34px;border-radius:12px;display:grid;place-items:center;font-weight:900;background:rgba(255,255,255,.06)}.gz-readiness-item.ok .gz-readiness-status{color:#52dda4;background:rgba(54,211,153,.10)}.gz-readiness-item.bad .gz-readiness-status{color:#ff6577;background:rgba(255,70,91,.11)}
.gz-readiness-copy{display:grid;gap:3px;min-width:0}.gz-readiness-copy b{font-size:13px}.gz-readiness-copy span{font-size:11px;color:#8d96a7;line-height:1.65}.gz-readiness-done{font-size:11px;color:#54dba5}.gz-readiness-item button{border:0;border-radius:12px;padding:9px 11px;background:rgba(255,46,70,.13);color:#ff6678;font:inherit;font-size:11px;font-weight:800;white-space:nowrap}
.gz-readiness-note,.gz-readiness-final{padding:12px 14px;border-radius:15px;font-size:12px;line-height:1.7}.gz-readiness-note{background:rgba(255,160,67,.07);color:#d7b78e}.gz-readiness-final{background:rgba(54,211,153,.08);color:#99e3c3}
@media(max-width:700px){.gz-readiness-hero{padding:15px;border-radius:20px}.gz-readiness-hero strong{font-size:17px}.gz-readiness-score{width:70px;height:70px;border-radius:21px}.gz-readiness-list{grid-template-columns:1fr}.gz-readiness-item{min-height:68px}.gz-readiness-copy b{font-size:12px}}
'''

index.write_text(h)
js.write_text(j)
css.write_text(c)
