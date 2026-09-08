from pathlib import Path

INDEX=Path('admin/index.html')
JS=Path('admin/admin.js')
CSS=Path('admin/v5.css')

index=INDEX.read_text(encoding='utf-8')
js=JS.read_text(encoding='utf-8')
css=CSS.read_text(encoding='utf-8')

marker='GAME_ZONE_OWNER_PAYMENT_ONBOARDING_V7'

if marker not in index:
    old='''    <section class="page" data-page-view="payments">\n      <div class="panel"><div class="panel-head"><h2>طرق الدفع</h2><div><button id="addPaymentBtn">＋ طريقة دفع</button> <button data-refresh>تحديث</button></div></div><div id="paymentsTable" class="table-wrap"></div></div>\n    </section>'''
    new='''    <section class="page" data-page-view="payments">\n      <!-- GAME_ZONE_OWNER_PAYMENT_ONBOARDING_V7 -->\n      <div class="gz-owner-payment-tip"><b>💳 جهّز الدفع قبل استقبال العملاء</b><span>أضف اسم طريقة الدفع، الحساب أو الرقم الحقيقي الذي سيحوّل إليه العميل، والتعليمات. اجعل رفع الإيصال مطلوبًا إذا كنت ستراجع التحويل يدويًا.</span></div>\n      <div class="panel"><div class="panel-head"><h2>طرق الدفع</h2><div><button id="addPaymentBtn">＋ طريقة دفع</button> <button data-refresh>تحديث</button></div></div><div id="paymentsTable" class="table-wrap"></div></div>\n    </section>'''
    if old not in index:
        raise SystemExit('payments_section_anchor_not_found')
    index=index.replace(old,new,1)

if marker not in js:
    anchor='''    if(nav){nav.click();window.scrollTo({top:0,behavior:"smooth"});}\n  });\n }'''
    replacement='''    if(nav){\n      nav.click();\n      window.scrollTo({top:0,behavior:"smooth"});\n      if(page==="payments")setTimeout(()=>document.getElementById("addPaymentBtn")?.click(),120);\n    }\n  });\n  // GAME_ZONE_OWNER_PAYMENT_ONBOARDING_V7\n }'''
    if anchor not in js:
        raise SystemExit('readiness_click_anchor_not_found')
    js=js.replace(anchor,replacement,1)

if marker not in css:
    css += '''\n\n/* GAME_ZONE_OWNER_PAYMENT_ONBOARDING_V7 */\n.gz-owner-payment-tip{display:grid;gap:6px;margin:0 0 14px;padding:15px 16px;border:1px solid rgba(255,178,72,.2);border-radius:18px;background:linear-gradient(135deg,rgba(255,178,72,.10),rgba(255,178,72,.025));color:#f5eadc}.gz-owner-payment-tip b{font-size:14px}.gz-owner-payment-tip span{font-size:12px;line-height:1.75;color:#c9bda9}@media(max-width:700px){.gz-owner-payment-tip{padding:13px 14px;border-radius:16px}.gz-owner-payment-tip b{font-size:13px}.gz-owner-payment-tip span{font-size:11px}}\n'''

INDEX.write_text(index,encoding='utf-8')
JS.write_text(js,encoding='utf-8')
CSS.write_text(css,encoding='utf-8')
print('OWNER_PAYMENT_ONBOARDING_V7=APPLIED')
