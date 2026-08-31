from pathlib import Path
import sys,re
root=Path(sys.argv[1])

# 1) Backup summary PDF data: preserve USD/TRY independently, no conversion.
js=root/'app/src/main/assets/app-v121.js'
s=js.read_text(encoding='utf-8')
if '/* v1.2.7 — backup PDF keeps original USD/TRY balances */' in s:
    raise SystemExit('v127 already applied')
extra=r'''

/* v1.2.7 — backup PDF keeps original USD/TRY balances */
(function(){
  window.exportDebtSummaryPdf=function(){
    const clients=state.clients.map(c=>{
      const b=clientCurrencyDebtV121(c.id);
      return {name:c.name,debtUsd:num(b.USD),debtTry:num(b.TRY)};
    }).sort((a,b)=>String(a.name).localeCompare(String(b.name),'ar'));
    const payload={shop:{name:state.shop.name},generatedAt:nowIso(),currencyMode:'original',clients};
    const fileName=`ملخص-ديون-${today()}.pdf`;
    try{
      if(window.Android?.exportDebtSummaryPdf) Android.exportDebtSummaryPdf(JSON.stringify(payload),fileName);
      else toast('تصدير PDF متاح داخل APK');
    }catch(e){toast('تعذر إنشاء PDF المختصر');}
  };
})();
'''
s=s.rstrip()+extra+'\n'
js.write_text(s,encoding='utf-8')

# 2) Backup screen helper text should describe the exact behavior.
app=root/'app/src/main/assets/app.js'
a=app.read_text(encoding='utf-8')
a=a.replace('إجمالي الدين المتبقي لكل عميل','الدين المتبقي لكل عميل حسب العملة الأصلية')
a=a.replace('يحتوي الملف فقط على اسم العميل والدين المتبقي الخاص به، بدون تفاصيل العمليات.','يعرض اسم العميل ورصيد USD ورصيد TRY كما سُجّلا، بدون تحويل بين العملات وبدون تفاصيل العمليات.')
app.write_text(a,encoding='utf-8')

# 3) Native compact backup PDF: three columns: customer | USD | TRY.
java=root/'app/src/main/java/com/uchiha/debtstore/MainActivity.java'
j=java.read_text(encoding='utf-8')
j=j.replace('final int debtW = 165;','final int usdW = 120;\n                final int tryW = 120;',1)
j=j.replace('c.drawText("الدين المتبقي", pageW - margin - 12, tableTop + 22, p);\n                    c.drawText("اسم العميل", pageW - margin - debtW - 14, tableTop + 22, p);',
'''c.drawText("USD", pageW - margin - 12, tableTop + 22, p);\n                    c.drawText("TRY", pageW - margin - usdW - 12, tableTop + 22, p);\n                    c.drawText("اسم العميل", pageW - margin - usdW - tryW - 14, tableTop + 22, p);''',1)
old='''                        double debt = item.optDouble("debt", 0);\n                        String debtText = String.format(Locale.US, "$%,.2f", debt);\n\n                        p.setColor(Color.rgb(30, 41, 59));\n                        p.setTextSize(11.2f);\n                        p.setTextAlign(Paint.Align.RIGHT);\n                        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.NORMAL));\n                        c.drawText(name, pageW - margin - debtW - 14, y + 22, p);\n\n                        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));\n                        p.setColor(debt > 0.005 ? Color.rgb(185, 28, 28) : Color.rgb(22, 163, 74));\n                        c.drawText(debtText, pageW - margin - 12, y + 22, p);'''
new='''                        double debtUsd = item.optDouble("debtUsd", 0);\n                        double debtTry = item.optDouble("debtTry", 0);\n                        String usdText = String.format(Locale.US, "$%,.2f", debtUsd);\n                        String tryText = String.format(Locale.US, "₺%,.2f", debtTry);\n\n                        p.setColor(Color.rgb(30, 41, 59));\n                        p.setTextSize(11.2f);\n                        p.setTextAlign(Paint.Align.RIGHT);\n                        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.NORMAL));\n                        c.drawText(name, pageW - margin - usdW - tryW - 14, y + 22, p);\n\n                        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));\n                        p.setColor(debtUsd > 0.005 ? Color.rgb(185, 28, 28) : Color.rgb(22, 163, 74));\n                        c.drawText(usdText, pageW - margin - 12, y + 22, p);\n                        p.setColor(debtTry > 0.005 ? Color.rgb(185, 28, 28) : Color.rgb(22, 163, 74));\n                        c.drawText(tryText, pageW - margin - usdW - 12, y + 22, p);'''
if old not in j:
    raise SystemExit('backup PDF row marker missing')
j=j.replace(old,new,1)
j=j.replace('c.drawText("اسم العميل + الدين المتبقي فقط", pageW - margin, pageH - 22, p);','c.drawText("USD و TRY كما سُجّلا — بدون تحويل", pageW - margin, pageH - 22, p);',1)
java.write_text(j,encoding='utf-8')

# 4) Version bump.
gradle=root/'app/build.gradle'
g=gradle.read_text(encoding='utf-8')
if "versionCode 14" not in g or "versionName '1.2.6'" not in g:
    raise SystemExit('v126 gradle marker missing')
g=g.replace('versionCode 14','versionCode 15').replace("versionName '1.2.6'","versionName '1.2.7'")
gradle.write_text(g,encoding='utf-8')
print('PATCH_V127_OK')
