from pathlib import Path
import sys
root=Path(sys.argv[1])
js=root/'app/src/main/assets/app-v121.js'
s=js.read_text(encoding='utf-8')
old="tryDivisor:fmtFlex(d),tryConvertedUsd:fmtFlex(b.TRY/d),operations:rows.length"
new="tryDivisor:fmtFlex(d),tryConvertedUsd:fmtFlex(b.TRY/d),totalDueUsd:fmtFlex(b.USD+(b.TRY/d)),operations:rows.length"
if old not in s: raise SystemExit('PDF summary marker missing')
s=s.replace(old,new,1)
js.write_text(s,encoding='utf-8')

java=root/'app/src/main/java/com/uchiha/debtstore/MainActivity.java'
j=java.read_text(encoding='utf-8')
old1='c.drawText("تحويل التركي بالدولار: ₺"+summary.optString("balanceTry","0")+" ÷ "+summary.optString("tryDivisor","0"),pageW-margin-8,ct+15,p);'
new1='c.drawText("إجمالي المطلوب دفعه بالدولار",pageW-margin-8,ct+15,p);'
if old1 not in j: raise SystemExit('PDF divisor label marker missing')
j=j.replace(old1,new1,1)
old2='c.drawText("$"+summary.optString("tryConvertedUsd","0"),pageW-margin-8,ct+32,p);'
new2='c.drawText("$"+summary.optString("totalDueUsd","0"),pageW-margin-8,ct+32,p);'
if old2 not in j: raise SystemExit('PDF converted value marker missing')
j=j.replace(old2,new2,1)
old3='c.drawText("خانة مستقلة — غير مضافة للدولار",margin+8,ct+25,p);'
new3='c.drawText("المبلغ النهائي المطلوب من العميل",margin+8,ct+25,p);'
if old3 not in j: raise SystemExit('PDF helper marker missing')
j=j.replace(old3,new3,1)
java.write_text(j,encoding='utf-8')

gradle=root/'app/build.gradle'
g=gradle.read_text(encoding='utf-8').replace('versionCode 10','versionCode 11').replace("versionName '1.2.2'","versionName '1.2.3'")
gradle.write_text(g,encoding='utf-8')
print('PATCH_V123_OK')
