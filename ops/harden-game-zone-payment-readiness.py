from pathlib import Path

policy=Path('server/lib/productionPolicy.js')
test=Path('server/tests/productionPolicy.test.js')
server=Path('server/server.js')
admin=Path('admin/admin.js')

p=policy.read_text()
old='''function isConfiguredPaymentMethod(method){\n  if(!method||method.active!==true)return false;\n  return !isPlaceholderPaymentAccount(method.account);\n}'''
new='''function isConfiguredPaymentMethod(method){\n  if(!method||method.active!==true)return false;\n  const account=text(method.account);\n  const checkout=text(method.checkoutUrlTemplate);\n  const hasAccount=!!account&&!isPlaceholderPaymentAccount(account);\n  const hasCheckout=!!checkout;\n  return hasAccount||hasCheckout;\n}'''
if old not in p:
    raise SystemExit('productionPolicy configured-payment anchor missing')
p=p.replace(old,new,1)
policy.write_text(p)

t=test.read_text()
anchor='''  assert.equal(isConfiguredPaymentMethod({active:true,account:"USDT wallet not configured"}),false);\n  assert.equal(isConfiguredPaymentMethod({active:true,account:"SY123456789"}),true);'''
replacement='''  assert.equal(isConfiguredPaymentMethod({active:true,account:"USDT wallet not configured"}),false);\n  assert.equal(isConfiguredPaymentMethod({active:true,account:""}),false);\n  assert.equal(isConfiguredPaymentMethod({active:true,account:"   "}),false);\n  assert.equal(isConfiguredPaymentMethod({active:false,account:"SY123456789"}),false);\n  assert.equal(isConfiguredPaymentMethod({active:true,account:"SY123456789"}),true);\n  assert.equal(isConfiguredPaymentMethod({active:true,account:"",checkoutUrlTemplate:"https://pay.example.com/c/{topupId}"}),true);'''
if anchor not in t:
    raise SystemExit('productionPolicy test anchor missing')
t=t.replace(anchor,replacement,1)
test.write_text(t)

s=server.read_text()
create_anchor='''  const m={id:methodId,name,icon,imageUrl,active:b.active!==false,sort,instructions,account,requiresReference:b.requiresReference!==false,requiresReceipt:b.requiresReceipt===true,minAmount,maxAmount,checkoutUrlTemplate};\n  db.paymentMethods||=[];db.paymentMethods.push(m);pushAudit(db,req,"payment_method_create",{id:m.id});writeDB(db);res.json({ok:true,method:m});'''
create_repl='''  const m={id:methodId,name,icon,imageUrl,active:b.active!==false,sort,instructions,account,requiresReference:b.requiresReference!==false,requiresReceipt:b.requiresReceipt===true,minAmount,maxAmount,checkoutUrlTemplate};\n  if(m.active&&!isConfiguredPaymentMethod(m))return res.status(400).json({error:"payment_method_not_configured"});\n  db.paymentMethods||=[];db.paymentMethods.push(m);pushAudit(db,req,"payment_method_create",{id:m.id});writeDB(db);res.json({ok:true,method:m});'''
if create_anchor not in s:
    raise SystemExit('payment create anchor missing')
s=s.replace(create_anchor,create_repl,1)

patch_head='''app.patch("/api/admin/payment-methods/:id",adminOnly,(req,res)=>{\n  const db=readDB(),m=(db.paymentMethods||[]).find(x=>x.id===req.params.id);if(!m)return res.status(404).json({error:"payment_method_not_found"});\n  const b=req.body||{};'''
patch_head_repl='''app.patch("/api/admin/payment-methods/:id",adminOnly,(req,res)=>{\n  const db=readDB(),m=(db.paymentMethods||[]).find(x=>x.id===req.params.id);if(!m)return res.status(404).json({error:"payment_method_not_found"});\n  const before={...m},b=req.body||{};'''
if patch_head not in s:
    raise SystemExit('payment patch head anchor missing')
s=s.replace(patch_head,patch_head_repl,1)

patch_tail='''  if(Number(m.maxAmount)<Number(m.minAmount))return res.status(400).json({error:"invalid_payment_limits"});\n  pushAudit(db,req,"payment_method_update",{id:m.id});writeDB(db);res.json({ok:true,method:m});'''
patch_tail_repl='''  if(Number(m.maxAmount)<Number(m.minAmount))return res.status(400).json({error:"invalid_payment_limits"});\n  if(m.active&&!isConfiguredPaymentMethod(m)){Object.assign(m,before);return res.status(400).json({error:"payment_method_not_configured"});}\n  pushAudit(db,req,"payment_method_update",{id:m.id});writeDB(db);res.json({ok:true,method:m});'''
if patch_tail not in s:
    raise SystemExit('payment patch tail anchor missing')
s=s.replace(patch_tail,patch_tail_repl,1)

readiness_old='''  add("payments",(db.paymentMethods||[]).some(m=>m.active&&m.account&&!/not configured|يتم تحديد|غير مضبوط/i.test(String(m.account))),"طريقة دفع مضبوطة");'''
readiness_new='''  add("payments",(db.paymentMethods||[]).some(isConfiguredPaymentMethod),"طريقة دفع مضبوطة","فعّل طريقة دفع تحتوي حسابًا/عنوانًا حقيقيًا أو Checkout URL مضبوطًا.");'''
if readiness_old not in s:
    raise SystemExit('payment readiness anchor missing')
s=s.replace(readiness_old,readiness_new,1)
server.write_text(s)

a=admin.read_text()
toggle_old='''async function togglePayment(id,active){if(preview){const m=mock.payments.find(x=>x.id===id);if(m)m.active=active;renderPayments();return toast("تم تحديث طريقة الدفع")}try{await api(`/api/admin/payment-methods/${id}`,{method:"PATCH",body:JSON.stringify({active})});await load();toast("تم تحديث طريقة الدفع")}catch{toast("تعذر التحديث")}}'''
toggle_new='''async function togglePayment(id,active){if(preview){const m=mock.payments.find(x=>x.id===id);if(m)m.active=active;renderPayments();return toast("تم تحديث طريقة الدفع")}try{await api(`/api/admin/payment-methods/${id}`,{method:"PATCH",body:JSON.stringify({active})});await load();toast("تم تحديث طريقة الدفع")}catch(e){toast(e.message==="payment_method_not_configured"?"أكمل حساب/عنوان الدفع أو Checkout URL قبل التفعيل":"تعذر التحديث")}}'''
if toggle_old not in a:
    raise SystemExit('admin togglePayment anchor missing')
a=a.replace(toggle_old,toggle_new,1)

modal_old=''' modal(`<h3>تعديل طريقة الدفع</h3><div class="form-grid">'''
modal_new=''' modal(`<h3>تعديل طريقة الدفع</h3><div class="runtime-card"><b>طريقة الدفع لا تظهر للعملاء إلا بعد إدخال حساب/عنوان حقيقي أو Checkout URL مضبوط.</b></div><div class="form-grid">'''
if modal_old not in a:
    raise SystemExit('admin payment modal anchor missing')
a=a.replace(modal_old,modal_new,1)

catch_old='''  }catch(e){toast(e.message==="image_too_large"?"الصورة أكبر من 2MB":"تعذر حفظ طريقة الدفع")}'''
catch_new='''  }catch(e){toast(e.message==="image_too_large"?"الصورة أكبر من 2MB":e.message==="payment_method_not_configured"?"أدخل حساب/عنوان دفع حقيقي أو Checkout URL قبل حفظ طريقة مفعلة":"تعذر حفظ طريقة الدفع")}'''
if catch_old not in a:
    raise SystemExit('admin payment save catch anchor missing')
a=a.replace(catch_old,catch_new,1)
admin.write_text(a)

print('GAME_ZONE_PAYMENT_READINESS_HARDENING=APPLIED')
