from pathlib import Path
import sys
root=Path(sys.argv[1])
java=root/'app/src/main/java/com/uchiha/debtstore/MainActivity.java'
j=java.read_text(encoding='utf-8')
old='String[] labs={"الرصيد بالدولار","الرصيد بالتركي","عدد العمليات"};\n                            String[] vals={"$"+summary.optString("balanceUsd","0"),"₺"+summary.optString("balanceTry","0"),String.valueOf(summary.optInt("operations",rows.length()))};'
new='String[] labs={"الرصيد بالدولار","التركي محوّل بالدولار","عدد العمليات"};\n                            String[] vals={"$"+summary.optString("balanceUsd","0"),"$"+summary.optString("tryConvertedUsd","0"),String.valueOf(summary.optInt("operations",rows.length()))};'
if old not in j: raise SystemExit('PDF summary cards marker missing')
j=j.replace(old,new,1)
java.write_text(j,encoding='utf-8')

gradle=root/'app/build.gradle'
g=gradle.read_text(encoding='utf-8')
if "versionCode 13" not in g or "versionName '1.2.5'" not in g: raise SystemExit('v125 gradle marker missing')
g=g.replace('versionCode 13','versionCode 14').replace("versionName '1.2.5'","versionName '1.2.6'")
gradle.write_text(g,encoding='utf-8')
print('PATCH_V126_OK')
