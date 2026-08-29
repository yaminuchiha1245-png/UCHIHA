from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'debt-app')

js = root / 'app/src/main/assets/app.js'
s = js.read_text(encoding='utf-8')
if 'function exportDebtSummaryPdf()' not in s:
    old = """function renderBackup(){\n  if(!isOwner())return shell('النسخ الاحتياطي','<div class=\"empty\">للمالك فقط</div>');\n  const body=`<div class=\"notice ok\"><span>☁️</span><div class=\"grow\"><b>البيانات محفوظة داخل الهاتف</b><small>أنشئ نسخة خارجية بشكل دوري لحماية الدفتر.</small></div></div><div class=\"card\"><button class=\"btn primary full\" onclick=\"exportBackup()\">⬇ تصدير نسخة احتياطية</button><button class=\"btn full\" style=\"margin-top:9px\" onclick=\"pickBackup()\">⬆ استعادة نسخة احتياطية</button></div><div class=\"small muted\">النسخة تشمل العملاء، دفتر الحساب، الدفعات، المؤجل، النواقص، الحسابات والإعدادات. استعادة النسخة تستبدل البيانات الحالية بعد التأكيد.</div>`;\n  return shell('النسخ الاحتياطي',body);\n}\nfunction exportBackup(){const name=`UCHIHA-backup-${today()}.json`;try{if(window.Android?.exportBackup)Android.exportBackup(JSON.stringify(state),name);else downloadText(JSON.stringify(state,null,2),name,'application/json');}catch(e){toast('تعذر التصدير');}}\n"""
    new = """function renderBackup(){\n  if(!isOwner())return shell('النسخ الاحتياطي','<div class=\"empty\">للمالك فقط</div>');\n  const body=`\n  <div class=\"notice ok\"><span>☁️</span><div class=\"grow\"><b>البيانات محفوظة داخل الهاتف</b><small>أنشئ نسخة خارجية بشكل دوري لحماية الدفتر.</small></div></div>\n  <div class=\"section-title\">نسخة البيانات الكاملة</div>\n  <div class=\"card\">\n    <button class=\"btn primary full\" onclick=\"exportBackup()\">⬇ تصدير نسخة احتياطية JSON</button>\n    <button class=\"btn full\" style=\"margin-top:9px\" onclick=\"pickBackup()\">⬆ استعادة نسخة احتياطية</button>\n    <div class=\"small muted\" style=\"margin-top:10px\">تشمل العملاء، دفتر الحساب، الدفعات، المؤجل، النواقص، الحسابات والإعدادات.</div>\n  </div>\n  <div class=\"section-title\">نسخة PDF مختصرة</div>\n  <div class=\"card\">\n    <div class=\"row\" style=\"align-items:flex-start\"><div style=\"font-size:28px\">📄</div><div class=\"grow\"><b>إجمالي الدين المتبقي لكل عميل</b><div class=\"small muted\">يحتوي الملف فقط على اسم العميل والدين المتبقي الخاص به، بدون تفاصيل العمليات.</div></div></div>\n    <button class=\"btn full\" style=\"margin-top:12px\" onclick=\"exportDebtSummaryPdf()\">تصدير PDF مختصر</button>\n  </div>\n  <div class=\"small muted\">استعادة نسخة JSON تستبدل البيانات الحالية بعد التأكيد. ملف PDF مخصص للحفظ أو الطباعة والمراجعة السريعة فقط.</div>`;\n  return shell('النسخ الاحتياطي',body);\n}\nfunction exportBackup(){const name=`UCHIHA-backup-${today()}.json`;try{if(window.Android?.exportBackup)Android.exportBackup(JSON.stringify(state),name);else downloadText(JSON.stringify(state,null,2),name,'application/json');}catch(e){toast('تعذر التصدير');}}\nfunction exportDebtSummaryPdf(){\n  const clients=state.clients.map(c=>({name:c.name,debt:clientDebt(c.id)})).sort((a,b)=>b.debt-a.debt || String(a.name).localeCompare(String(b.name),'ar'));\n  const payload={shop:{name:state.shop.name},generatedAt:nowIso(),clients};\n  const fileName=`ملخص-ديون-${today()}.pdf`;\n  try{\n    if(window.Android?.exportDebtSummaryPdf) Android.exportDebtSummaryPdf(JSON.stringify(payload),fileName);\n    else toast('تصدير PDF متاح داخل APK');\n  }catch(e){toast('تعذر إنشاء PDF المختصر');}\n}\n"""
    if old not in s:
        raise SystemExit('app.js backup block not found')
    s = s.replace(old, new, 1)
    js.write_text(s, encoding='utf-8')

java = root / 'app/src/main/java/com/uchiha/debtstore/MainActivity.java'
s = java.read_text(encoding='utf-8')
if 'private void exportDebtSummaryPdf(String json, String fileName)' not in s:
    anchor = '    private String trim(String s, int max) {\n'
    method = r'''    private void exportDebtSummaryPdf(String json, String fileName) {
        ioExecutor.execute(() -> {
            PdfDocument doc = new PdfDocument();
            try {
                JSONObject data = new JSONObject(json);
                JSONObject shop = data.optJSONObject("shop");
                JSONArray clients = data.optJSONArray("clients");
                if (clients == null) clients = new JSONArray();

                final int pageW = 595, pageH = 842;
                final int margin = 42;
                final int rowH = 34;
                final int tableTop = 132;
                final int debtW = 165;
                int rowIndex = 0;
                int pageNo = 1;

                while (rowIndex < clients.length() || pageNo == 1) {
                    PdfDocument.PageInfo info = new PdfDocument.PageInfo.Builder(pageW, pageH, pageNo).create();
                    PdfDocument.Page page = doc.startPage(info);
                    Canvas c = page.getCanvas();
                    c.drawColor(Color.WHITE);

                    Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
                    p.setTextAlign(Paint.Align.RIGHT);
                    p.setColor(Color.rgb(15, 23, 42));
                    p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
                    p.setTextSize(22);
                    String shopName = shop == null ? "دفتر الديون" : shop.optString("name", "دفتر الديون");
                    c.drawText(shopName, pageW - margin, 42, p);

                    p.setTextSize(16);
                    p.setColor(Color.rgb(37, 99, 235));
                    c.drawText("ملخص الديون المتبقية", pageW - margin, 72, p);

                    p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.NORMAL));
                    p.setTextSize(10);
                    p.setColor(Color.rgb(100, 116, 139));
                    c.drawText("تاريخ التصدير: " + new SimpleDateFormat("yyyy/MM/dd HH:mm", Locale.US).format(new Date()), pageW - margin, 94, p);

                    p.setColor(Color.rgb(15, 23, 42));
                    p.setStrokeWidth(1.2f);
                    c.drawLine(margin, 110, pageW - margin, 110, p);

                    p.setColor(Color.rgb(15, 23, 42));
                    c.drawRoundRect(margin, tableTop, pageW - margin, tableTop + rowH, 8, 8, p);
                    p.setColor(Color.WHITE);
                    p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
                    p.setTextSize(11.5f);
                    c.drawText("الدين المتبقي", pageW - margin - 12, tableTop + 22, p);
                    c.drawText("اسم العميل", pageW - margin - debtW - 14, tableTop + 22, p);

                    float y = tableTop + rowH;
                    int maxRows = (int) ((pageH - y - 55) / rowH);
                    int used = 0;
                    p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.NORMAL));
                    while (rowIndex < clients.length() && used < maxRows) {
                        JSONObject item = clients.optJSONObject(rowIndex++);
                        if (item == null) continue;
                        if (used % 2 == 0) {
                            p.setColor(Color.rgb(248, 250, 252));
                            c.drawRect(margin, y, pageW - margin, y + rowH, p);
                        }

                        String name = trim(item.optString("name", ""), 34);
                        double debt = item.optDouble("debt", 0);
                        String debtText = String.format(Locale.US, "$%,.2f", debt);

                        p.setColor(Color.rgb(30, 41, 59));
                        p.setTextSize(11.2f);
                        p.setTextAlign(Paint.Align.RIGHT);
                        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.NORMAL));
                        c.drawText(name, pageW - margin - debtW - 14, y + 22, p);

                        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
                        p.setColor(debt > 0.005 ? Color.rgb(185, 28, 28) : Color.rgb(22, 163, 74));
                        c.drawText(debtText, pageW - margin - 12, y + 22, p);

                        p.setColor(Color.rgb(226, 232, 240));
                        p.setStrokeWidth(0.8f);
                        c.drawLine(margin, y + rowH, pageW - margin, y + rowH, p);
                        y += rowH;
                        used++;
                    }

                    if (clients.length() == 0) {
                        p.setTextAlign(Paint.Align.CENTER);
                        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.NORMAL));
                        p.setTextSize(12);
                        p.setColor(Color.rgb(100, 116, 139));
                        c.drawText("لا يوجد عملاء مسجلون", pageW / 2f, tableTop + rowH + 42, p);
                    }

                    p.setTextAlign(Paint.Align.LEFT);
                    p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.NORMAL));
                    p.setTextSize(9);
                    p.setColor(Color.rgb(100, 116, 139));
                    c.drawText("صفحة " + pageNo, margin, pageH - 22, p);
                    p.setTextAlign(Paint.Align.RIGHT);
                    c.drawText("اسم العميل + الدين المتبقي فقط", pageW - margin, pageH - 22, p);

                    doc.finishPage(page);
                    pageNo++;
                    if (clients.length() == 0) break;
                }

                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                doc.writeTo(bos);
                Uri uri = writeToDownloads(fileName, "application/pdf", bos.toByteArray());
                runOnUiThread(() -> shareUri(uri, "application/pdf", "مشاركة ملخص الديون"));
            } catch (Exception e) {
                toast("تعذر إنشاء PDF المختصر: " + e.getMessage());
            } finally {
                doc.close();
            }
        });
    }

'''
    if anchor not in s:
        raise SystemExit('Java trim anchor not found')
    s = s.replace(anchor, method + anchor, 1)

if 'public void exportDebtSummaryPdf(String json, String fileName)' not in s:
    bridge = '''        @JavascriptInterface\n        public void exportPdf(String json, String fileName) {\n            exportClientPdf(json, fileName);\n        }\n'''
    bridge_new = bridge + '''\n        @JavascriptInterface\n        public void exportDebtSummaryPdf(String json, String fileName) {\n            exportDebtSummaryPdf(json, fileName);\n        }\n'''
    if bridge not in s:
        raise SystemExit('Java bridge anchor not found')
    s = s.replace(bridge, bridge_new, 1)

java.write_text(s, encoding='utf-8')

gradle = root / 'app/build.gradle'
s = gradle.read_text(encoding='utf-8')
s = s.replace('versionCode 1', 'versionCode 2').replace("versionName '1.0.0'", "versionName '1.0.1'")
gradle.write_text(s, encoding='utf-8')

print('PATCH_V101_OK')
