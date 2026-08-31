from pathlib import Path
import sys
root=Path(sys.argv[1])
p=root/'app/src/main/assets/app-v121.js'
s=p.read_text(encoding='utf-8')
needle="window.rateText=function(){const r=state.rates;return `💱 سعر الصرف — ${state.shop.name}\\n🇺🇸 1 USD = ${r.usdTry?fmt(r.usdTry,3):'—'} TRY\\n🕐 آخر تحديث: ${r.updatedAt?dateTimeFmt(r.updatedAt):'غير محدث'}`;};"
extra=r'''
window.hasRates=function(){return num(state.rates?.usdTry)>0;};
window.convert=function(amount,currency,rates=state.rates){const a=num(amount),ut=num(rates?.usdTry);if(a<=0||ut<=0||!['USD','TRY'].includes(currency))return null;const usd=currency==='USD'?a:a/ut;return {usd:round2(usd),try:round2(usd*ut),syp:0};};
window.rateMessage=window.rateText;
function cleanRateTemplateV122(t){return String(t||'').replace(/^.*USD_SYP.*(?:\n|$)/gm,'').replace(/^.*TRY_SYP.*(?:\n|$)/gm,'').replace(/^.*SYP.*(?:\n|$)/gm,'').trim();}
'''
if needle not in s: raise SystemExit('rateText marker missing')
s=s.replace(needle,needle+extra,1)
old="const oldSettingsV122=window.renderSettings;window.renderSettings=function(){let h=oldSettingsV122();h=h.replace(/\\{SHOP\\} \\{USD_TRY\\} \\{USD_SYP\\} \\{TRY_SYP\\} \\{TIME\\}/g,'{SHOP} {USD_TRY} {TIME}');return h;};"
new=r'''const oldSettingsV122=window.renderSettings;window.renderSettings=function(){let h=oldSettingsV122();h=h.replace(/🇺🇸 1 USD = \{USD_SYP\} SYP\n?/g,'').replace(/🇹🇷 1 TRY = \{TRY_SYP\} SYP\n?/g,'').replace(/\{SHOP\} \{USD_TRY\} \{USD_SYP\} \{TRY_SYP\} \{TIME\}/g,'{SHOP} {USD_TRY} {TIME}');return h;};
window.saveRateSettings=function(){state.settings.rateTemplate=cleanRateTemplateV122($('setRateTemplate')?.value)||'💱 سعر الصرف — {SHOP}\n🇺🇸 1 USD = {USD_TRY} TRY\n🕐 آخر تحديث: {TIME}';state.settings.rateAlertTry=num($('setRateAlert')?.value)||.25;saveState();audit('تعديل إعدادات سعر الصرف');toast('تم الحفظ');};'''
if old not in s: raise SystemExit('settings marker missing')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
print('PATCH_V122_CLEANUP_OK')
