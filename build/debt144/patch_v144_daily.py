from pathlib import Path
import sys
root=Path(sys.argv[1] if len(sys.argv)>1 else 'debt-app')
js=root/'app/src/main/assets/app-v144.js'
css=root/'app/src/main/assets/app-v144.css'
s=js.read_text(encoding='utf-8')

anchor="function activityEntriesV144(){return state.entries.filter(e=>e.type==='purchase'||e.type==='payment').slice().sort((a,b)=>entryDateV144(b)-entryDateV144(a));}"
insert="""function activityEntriesV144(){return state.entries.filter(e=>e.type==='purchase'||e.type==='payment').slice().sort((a,b)=>entryDateV144(b)-entryDateV144(a));}
function todayActivityEntriesV144(){
  const key=localKeyV144(new Date());
  return activityEntriesV144().filter(e=>localKeyV144(entryDateV144(e))===key);
}
function totalsByCurrencyV144(entries,type){
  const out={USD:0,TRY:0,SYP:0};
  for(const e of entries||[]){if(type&&e.type!==type)continue;const c=e.originalCurrency||'USD';out[c]=num(out[c])+num(e.originalAmount);}
  return out;
}
function currencyLineV144(entries,type){
  const t=totalsByCurrencyV144(entries,type),parts=[];
  if(t.USD)parts.push('$'+fmtFlex(t.USD));
  if(t.TRY)parts.push('₺'+fmtFlex(t.TRY));
  if(t.SYP)parts.push(fmtFlex(t.SYP)+' ل.س');
  return parts.length?parts.join(' · '):'—';
}"""
if 'function todayActivityEntriesV144()' not in s:
    if anchor not in s: raise SystemExit('activity anchor missing')
    s=s.replace(anchor,insert,1)

old="""function recentActivityHtmlV144(limit=6){
  const rows=activityEntriesV144().slice(0,limit);
  if(!rows.length)return `<div class=\"activity-empty-v144\">أول عملية شراء أو دفعة ستظهر هنا مباشرة.</div>`;
  return `<div class=\"activity-list-v144\">${rows.map(e=>{const pay=e.type==='payment',c=clientForEntryV144(e);return `<button class=\"activity-strip-v144 ${pay?'payment':''}\" onclick=\"openClient('${esc(e.clientId||'')}')\"><span class=\"activity-icon-v144\">${iconV144(pay?'wallet':'receipt')}</span><span class=\"activity-main-v144\"><b>${esc(c?.name||'عميل')}</b><small>${pay?'دفعة مستلمة':'شراء مسجل'} · ${esc(timeV144(e))} · ${esc(e.createdBy||'')}</small></span><span class=\"activity-value-v144\"><strong>${esc(originalV144(e))}</strong><small>${moneyV144(amountUsdV144(e))} مكافئ</small></span></button>`;}).join('')}</div>`;
}"""
new="""function recentActivityHtmlV144(limit=8){
  const rows=todayActivityEntriesV144().slice(0,limit);
  if(!rows.length)return `<div class=\"activity-empty-v144\"><b>لا توجد حركات اليوم</b><small>أول شراء أو دفعة تسجلها اليوم ستظهر هنا مباشرة.</small></div>`;
  return `<div class=\"activity-list-v144\">${rows.map(e=>{const pay=e.type==='payment',c=clientForEntryV144(e);return `<button class=\"activity-strip-v144 ${pay?'payment':''}\" onclick=\"openClient('${esc(e.clientId||'')}')\"><span class=\"activity-icon-v144\">${iconV144(pay?'wallet':'receipt')}</span><span class=\"activity-main-v144\"><b>${esc(c?.name||'عميل')}</b><small>${pay?'تم استلام دفعة':'تم تسجيل شراء'} · ${esc(timeV144(e))} · ${esc(e.createdBy||'')}</small></span><span class=\"activity-value-v144\"><strong>${esc(originalV144(e))}</strong><small>${moneyV144(amountUsdV144(e))} مكافئ</small></span></button>`;}).join('')}</div>`;
}"""
if old in s: s=s.replace(old,new,1)
elif 'const rows=todayActivityEntriesV144().slice(0,limit);' not in s: raise SystemExit('recent block missing')

old="""  const balances=`<div class=\"currency-balance-grid-v121\"><div><span>USD</span><strong>$${fmtFlex(totals.USD||0)}</strong></div><div><span>TRY</span><strong>₺${fmtFlex(totals.TRY||0)}</strong></div></div>`;
  const body=`<section class=\"hero nova-hero\">"""
new="""  const balances=`<div class=\"currency-balance-grid-v121\"><div><span>USD</span><strong>$${fmtFlex(totals.USD||0)}</strong></div><div><span>TRY</span><strong>₺${fmtFlex(totals.TRY||0)}</strong></div></div>`;
  const todayRows= todayActivityEntriesV144();
  const todayDebt=todayRows.filter(e=>e.type==='purchase').reduce((q,e)=>q+amountUsdV144(e),0),todayPay=todayRows.filter(e=>e.type==='payment').reduce((q,e)=>q+amountUsdV144(e),0);
  const body=`<section class=\"hero nova-hero\">"""
if 'const todayRows= todayActivityEntriesV144();' not in s:
    if old not in s: raise SystemExit('home totals anchor missing')
    s=s.replace(old,new,1)

old='<div class="activity-head-v144"><h3>آخر الحركات</h3><span>آخر ${Math.min(6,activityEntriesV144().length)} عمليات</span></div>${recentActivityHtmlV144(6)}`;'
new='<div class="activity-head-v144"><div><h3>آخر الحركات</h3><small>يتجدد تلقائيًا مع بداية كل يوم</small></div><span>${todayRows.length} حركة اليوم</span></div>\n  <div class="activity-today-summary-v144"><span><b>${todayRows.filter(e=>e.type===\'purchase\').length}</b> شراء · ${moneyV144(todayDebt)}</span><span><b>${todayRows.filter(e=>e.type===\'payment\').length}</b> دفعة · ${moneyV144(todayPay)}</span></div>${recentActivityHtmlV144(8)}`;'
if old in s: s=s.replace(old,new,1)
elif 'activity-today-summary-v144' not in s: raise SystemExit('home recent anchor missing')

old='<div class="stats-focus-v144"><div class="stats-focus-head-v144"><b>${selected?esc(selected.label):\'—\'}</b><small>${selected?.ops||0} عملية</small></div><div class="stats-focus-grid-v144"><div><small>ديون</small><strong>${moneyV144(selected?.debt||0)}</strong></div><div><small>تحصيل</small><strong>${moneyV144(selected?.pay||0)}</strong></div><div><small>الصافي</small><strong>${moneyV144((selected?.debt||0)-(selected?.pay||0))}</strong></div><div><small>العمليات</small><strong>${selected?.ops||0}</strong></div></div>${detailRowsV144(selected)}</div>'
new='<div class="stats-focus-v144"><div class="stats-focus-head-v144"><b>${selected?esc(selected.label):\'—\'}</b><small>${selected?.ops||0} عملية</small></div><div class="stats-focus-grid-v144"><div><small>ديون</small><strong>${moneyV144(selected?.debt||0)}</strong></div><div><small>تحصيل</small><strong>${moneyV144(selected?.pay||0)}</strong></div><div><small>الصافي</small><strong>${moneyV144((selected?.debt||0)-(selected?.pay||0))}</strong></div><div><small>العمليات</small><strong>${selected?.ops||0}</strong></div></div><div class="stats-currency-breakdown-v144"><div><small>المبالغ المسجلة أصلًا</small><b>${esc(currencyLineV144(selected?.entries||[],\'purchase\'))}</b></div><div><small>المبالغ المحصلة أصلًا</small><b>${esc(currencyLineV144(selected?.entries||[],\'payment\'))}</b></div></div>${detailRowsV144(selected)}</div>'
if old in s: s=s.replace(old,new,1)
elif 'stats-currency-breakdown-v144' not in s: raise SystemExit('stats focus anchor missing')
js.write_text(s,encoding='utf-8')

c=css.read_text(encoding='utf-8')
extra='''
.activity-head-v144>div{min-width:0}.activity-head-v144>div>small{display:block;font-size:8px;color:#60798d;margin-top:2px}
.activity-today-summary-v144{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:0 0 8px}.activity-today-summary-v144 span{border:1px solid #1b3548;background:#0a1721;border-radius:11px;padding:7px 9px;font-size:8px;color:#7690a4}.activity-today-summary-v144 b{font-size:10px;color:#dcecf6;margin-left:2px}
.activity-empty-v144 b{display:block;color:#9bb0bf;font-size:11px;margin-bottom:3px}.activity-empty-v144 small{display:block;color:#647d91;font-size:8px}
.stats-currency-breakdown-v144{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:7px}.stats-currency-breakdown-v144>div{border:1px solid #1c3749;background:#09151e;border-radius:11px;padding:8px}.stats-currency-breakdown-v144 small{display:block;font-size:7px;color:#6e8799;margin-bottom:3px}.stats-currency-breakdown-v144 b{font-size:9px;color:#c6deec;direction:ltr;text-align:right;display:block}
@media(max-width:390px){.activity-today-summary-v144{grid-template-columns:1fr 1fr}.stats-currency-breakdown-v144{grid-template-columns:1fr}}
'''
if 'activity-today-summary-v144' not in c: c+=extra
css.write_text(c,encoding='utf-8')
print('patched v1.4.4 daily activity + stronger analytics')
