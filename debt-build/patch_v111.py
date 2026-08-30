from pathlib import Path
import sys
root=Path(sys.argv[1] if len(sys.argv)>1 else 'debt-app')

js=root/'app/src/main/assets/app.js'
s=js.read_text(encoding='utf-8')
a=s.index('function exportClient(id,type){')
b=s.index('function csvCell',a)
new_js=r'''function exportClient(id,type){
  const c=state.clients.find(x=>x.id===id);if(!c)return;
  const rows=ledgerRows(id);let runningUsd=0,totalPurchasesUsd=0,totalPaymentsUsd=0;
  const symbol=cur=>cur==='USD'?'$':cur==='TRY'?'₺':cur==='SYP'?'ل.س':'';
  const balInCur=(usd,e)=>e.originalCurrency==='TRY'?usd*num(e.rateUsdTry||state.rates.usdTry):e.originalCurrency==='SYP'?usd*num(e.rateUsdSyp||state.rates.usdSyp):usd;
  const exportRows=rows.map(e=>{const pay=e.type==='payment',buy=['purchase','opening'].includes(e.type);if(buy){runningUsd+=num(e.usdAmount);totalPurchasesUsd+=num(e.usdAmount);}else if(pay){runningUsd=Math.max(0,runningUsd-num(e.usdAmount));totalPaymentsUsd+=num(e.usdAmount);}const sym=symbol(e.originalCurrency);const amount=e.originalCurrency==='SYP'?`${fmtFlex(e.originalAmount)} ${sym}`:`${sym}${fmtFlex(e.originalAmount)}`;const bv=balInCur(runningUsd,e);const balance=e.originalCurrency==='SYP'?`${fmtFlex(bv)} ${sym}`:`${sym}${fmtFlex(bv)}`;return{date:dateFmt(e.date||e.createdAt),type:pay?'payment':'purchase',typeLabel:pay?'دفعة':'شراء',amount,currency:e.originalCurrency,balance,description:entryDescription(e),by:e.createdBy};});
  const safeName=c.name.replace(/[\\/:*?"<>|]/g,'-');
  if(type==='pdf'){const payload={shop:state.shop,client:c,summary:{purchasesUsd:fmt(totalPurchasesUsd),paymentsUsd:fmt(totalPaymentsUsd),operations:exportRows.length},rows:exportRows};try{if(window.Android?.exportPdf)Android.exportPdf(JSON.stringify(payload),`كشف-${safeName}-${today()}.pdf`);else toast('PDF متاح داخل APK');}catch(e){toast('تعذر إنشاء PDF');}}
  else{const headers=['التاريخ','نوع العملية','مبلغ العملية','العملة','الرصيد بعد العملية','البيان','المسجل'];const csv=[headers,...exportRows.map(r=>[r.date,r.typeLabel,r.amount,r.currency,r.balance,r.description,r.by])].map(row=>row.map(csvCell).join(',')).join('\n');try{if(window.Android?.exportCsv)Android.exportCsv(csv,`كشف-${safeName}-${today()}.csv`);else downloadText('\ufeff'+csv,`كشف-${safeName}.csv`,'text/csv');}catch(e){toast('تعذر تصدير CSV');}}
}
'''
s=s[:a]+new_js+s[b:]
js.write_text(s,encoding='utf-8')

java=root/'app/src/main/java/com/uchiha/debtstore/MainActivity.java'
s=java.read_text(encoding='utf-8')
a=s.index('    private void exportClientPdf(String json, String fileName) {')
b=s.index('    private void exportDebtSummaryPdf(String json, String fileName) {',a)
new_java=r'''    private void exportClientPdf(String json, String fileName) {
        ioExecutor.execute(() -> {
            PdfDocument doc = new PdfDocument();
            try {
                JSONObject data=new JSONObject(json), shop=data.optJSONObject("shop"), client=data.optJSONObject("client"), summary=data.optJSONObject("summary");
                JSONArray rows=data.optJSONArray("rows"); if(rows==null) rows=new JSONArray();
                final int pageW=842,pageH=595,margin=30,rowH=34,cardTop=82,cardH=75,tableTop=184;
                final int[] widths={155,130,135,115,155};
                final String[] heads={"التاريخ","نوع العملية","مبلغ العملية","العملة","الرصيد بعد العملية"};
                final int bg=Color.rgb(4,14,24),panel=Color.rgb(8,25,40),panelAlt=Color.rgb(7,21,34),border=Color.rgb(20,58,82),text=Color.rgb(235,242,248),muted=Color.rgb(146,164,180),blue=Color.rgb(47,167,240),blueBg=Color.rgb(11,52,78),green=Color.rgb(0,220,151),greenBg=Color.rgb(7,68,55);
                int rowIndex=0,pageNo=1;
                while(rowIndex<rows.length()||pageNo==1){
                    PdfDocument.Page page=doc.startPage(new PdfDocument.PageInfo.Builder(pageW,pageH,pageNo).create()); Canvas c=page.getCanvas(); c.drawColor(bg); Paint p=new Paint(Paint.ANTI_ALIAS_FLAG); p.setTextAlign(Paint.Align.RIGHT);
                    String shopName=shop==null?"دفتر الديون":shop.optString("name","دفتر الديون"), clientName=client==null?"":client.optString("name","");
                    p.setColor(text);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));p.setTextSize(18);c.drawText(shopName,pageW-margin,32,p);
                    p.setTextSize(13);p.setColor(muted);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.NORMAL));c.drawText("كشف حساب — "+clientName,pageW-margin,53,p);
                    p.setTextAlign(Paint.Align.LEFT);p.setTextSize(9.5f);c.drawText(new SimpleDateFormat("yyyy/MM/dd HH:mm",Locale.US).format(new Date()),margin,32,p);p.setTextAlign(Paint.Align.RIGHT);
                    if(pageNo==1){float gap=12,cardW=(pageW-2*margin-2*gap)/3f;String[] labels={"إجمالي المشتريات","إجمالي الدفعات","عدد العمليات"};String[] values={"$"+(summary==null?"0.00":summary.optString("purchasesUsd","0.00")),"$"+(summary==null?"0.00":summary.optString("paymentsUsd","0.00")),summary==null?String.valueOf(rows.length()):String.valueOf(summary.optInt("operations",rows.length()))};int[] colors={green,text,text};for(int i=0;i<3;i++){float left=pageW-margin-(i+1)*cardW-i*gap;p.setStyle(Paint.Style.FILL);p.setColor(panel);c.drawRoundRect(left,cardTop,left+cardW,cardTop+cardH,10,10,p);p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(1.2f);p.setColor(border);c.drawRoundRect(left,cardTop,left+cardW,cardTop+cardH,10,10,p);p.setStyle(Paint.Style.FILL);p.setTextAlign(Paint.Align.CENTER);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));p.setTextSize(12);p.setColor(muted);c.drawText(labels[i],left+cardW/2f,cardTop+26,p);p.setTextSize(22);p.setColor(colors[i]);c.drawText(values[i],left+cardW/2f,cardTop+57,p);}p.setTextAlign(Paint.Align.RIGHT);}
                    float yTop=pageNo==1?tableTop:78;p.setStyle(Paint.Style.FILL);p.setColor(panel);c.drawRoundRect(margin,yTop,pageW-margin,yTop+rowH,8,8,p);p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(1.1f);p.setColor(border);c.drawRoundRect(margin,yTop,pageW-margin,yTop+rowH,8,8,p);p.setStyle(Paint.Style.FILL);p.setTextSize(10.5f);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));p.setColor(text);int x=pageW-margin;for(int i=0;i<heads.length;i++){c.drawText(heads[i],x-10,yTop+22,p);x-=widths[i];}
                    float y=yTop+rowH;int maxRows=(int)((pageH-y-42)/rowH),used=0;while(rowIndex<rows.length()&&used<maxRows){JSONObject r=rows.optJSONObject(rowIndex++);if(r==null)continue;p.setColor((used%2==0)?panelAlt:panel);p.setStyle(Paint.Style.FILL);c.drawRect(margin,y,pageW-margin,y+rowH,p);p.setColor(border);p.setStrokeWidth(.8f);c.drawLine(margin,y+rowH,pageW-margin,y+rowH,p);String type=r.optString("type","purchase"),typeLabel=r.optString("typeLabel",type.equals("payment")?"دفعة":"شراء");String[] vals={r.optString("date",""),typeLabel,r.optString("amount",""),r.optString("currency",""),r.optString("balance","")};x=pageW-margin;p.setTextSize(10.5f);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.BOLD));for(int i=0;i<vals.length;i++){if(i==1){float right=x-9,left=right-72,top=y+5;p.setColor(type.equals("payment")?greenBg:blueBg);c.drawRoundRect(left,top,right,top+24,8,8,p);p.setColor(type.equals("payment")?green:blue);p.setTextAlign(Paint.Align.CENTER);c.drawText(vals[i],(left+right)/2f,y+21,p);p.setTextAlign(Paint.Align.RIGHT);}else{p.setColor(i==4?text:(i==2?text:muted));c.drawText(trim(vals[i],22),x-10,y+22,p);}x-=widths[i];}y+=rowH;used++;}
                    p.setTextSize(9);p.setTypeface(Typeface.create(Typeface.DEFAULT,Typeface.NORMAL));p.setColor(muted);p.setTextAlign(Paint.Align.LEFT);c.drawText("صفحة "+pageNo,margin,pageH-17,p);p.setTextAlign(Paint.Align.RIGHT);String footer=shop==null?"":shop.optString("pdfFooter","");if(!footer.isEmpty())c.drawText(trim(footer,80),pageW-margin,pageH-17,p);doc.finishPage(page);pageNo++;if(rows.length()==0)break;
                }
                ByteArrayOutputStream bos=new ByteArrayOutputStream();doc.writeTo(bos);Uri uri=writeToDownloads(fileName,"application/pdf",bos.toByteArray());runOnUiThread(()->shareUri(uri,"application/pdf","مشاركة كشف الحساب"));
            } catch(Exception e){toast("تعذر إنشاء PDF: "+e.getMessage());} finally {doc.close();}
        });
    }

'''
s=s[:a]+new_java+s[b:]
java.write_text(s,encoding='utf-8')

gradle=root/'app/build.gradle'
g=gradle.read_text(encoding='utf-8').replace('versionCode 5','versionCode 6').replace("versionName '1.1.0'","versionName '1.1.1'")
gradle.write_text(g,encoding='utf-8')
assert "versionName '1.1.1'" in gradle.read_text(encoding='utf-8')
assert 'الرصيد بعد العملية' in java.read_text(encoding='utf-8')
print('PATCH_V111_OK')
