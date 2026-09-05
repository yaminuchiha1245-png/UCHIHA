package com.gamezone.store;

import android.app.*;
import android.os.Bundle;
import android.content.*;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.provider.Settings;
import android.util.Base64;
import android.view.*;
import android.view.inputmethod.InputMethodManager;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

public class MainActivity extends Activity {
  static final int BG=Color.rgb(7,9,14), CARD=Color.rgb(17,20,28), CARD2=Color.rgb(27,31,42), TEXT=Color.WHITE;
  static final int MUTED=Color.rgb(152,160,177), BLUE=Color.rgb(74,135,255), GOLD=Color.rgb(255,190,65), GREEN=Color.rgb(70,220,145), PURPLE=Color.rgb(171,102,255);
  static final int PICK_RECEIPT=4101;
  final ExecutorService io=Executors.newFixedThreadPool(4);
  SharedPreferences prefs;
  String base,token="",selectedPaymentId="",receiptDataUrl=null;
  JSONObject me=new JSONObject(),config=new JSONObject();
  JSONArray categories=new JSONArray(),products=new JSONArray();
  LinearLayout root,content,bottom;
  TextView title,balance;

  @Override public void onCreate(Bundle b){super.onCreate(b);getWindow().setStatusBarColor(Color.BLACK);getWindow().setNavigationBarColor(Color.BLACK);prefs=getSharedPreferences("gamezone",MODE_PRIVATE);base=getString(R.string.start_url).replaceAll("/$","");token=prefs.getString("session",""); if(token.isEmpty()) showActivation(); else validateAndOpen();}
  int dp(int v){return (int)(v*getResources().getDisplayMetrics().density+.5f);}  
  GradientDrawable box(int color,int radius){GradientDrawable g=new GradientDrawable();g.setColor(color);g.setCornerRadius(dp(radius));return g;}
  TextView text(String s,int size,int color,boolean bold){TextView t=new TextView(this);t.setText(s);t.setTextSize(size);t.setTextColor(color);t.setGravity(Gravity.RIGHT);t.setTypeface(Typeface.DEFAULT,bold?Typeface.BOLD:Typeface.NORMAL);return t;}
  Button button(String s,int color){Button b=new Button(this);b.setText(s);b.setTextColor(TEXT);b.setTextSize(14);b.setAllCaps(false);b.setGravity(Gravity.CENTER);b.setBackground(box(color,16));b.setPadding(dp(14),dp(12),dp(14),dp(12));return b;}
  void pad(View v,int l,int t,int r,int b){v.setPadding(dp(l),dp(t),dp(r),dp(b));}
  LinearLayout vbox(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);return l;}
  LinearLayout hbox(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.HORIZONTAL);return l;}
  void addGap(LinearLayout l,int h){Space s=new Space(this);l.addView(s,new LinearLayout.LayoutParams(1,dp(h)));}
  void toast(String s){runOnUiThread(()->Toast.makeText(this,s,Toast.LENGTH_SHORT).show());}
  String absoluteMediaUrl(String u){
    if(u==null)return "";u=u.trim();if(u.isEmpty()||"null".equalsIgnoreCase(u))return "";
    if(u.startsWith("http://")||u.startsWith("https://"))return u;
    return base+(u.startsWith("/")?u:"/"+u);
  }
  void loadRemoteImage(ImageView image,String url){
    String target=absoluteMediaUrl(url);if(target.isEmpty())return;
    io.execute(()->{try{HttpURLConnection c=(HttpURLConnection)new URL(target).openConnection();c.setConnectTimeout(8000);c.setReadTimeout(10000);c.setInstanceFollowRedirects(true);try(InputStream in=c.getInputStream()){android.graphics.Bitmap bm=android.graphics.BitmapFactory.decodeStream(in);if(bm!=null)runOnUiThread(()->image.setImageBitmap(bm));}c.disconnect();}catch(Exception ignored){}});
  }
  View catalogTile(JSONObject item,boolean product,int accent){
    LinearLayout c=vbox();c.setGravity(Gravity.CENTER_HORIZONTAL);pad(c,0,0,0,12);GradientDrawable g=box(Color.BLACK,22);g.setStroke(dp(1),Color.rgb(48,55,70));c.setBackground(g);
    FrameLayout media=new FrameLayout(this);media.setBackgroundColor(CARD2);
    TextView fallback=text("GAME ZONE",14,MUTED,true);fallback.setGravity(Gravity.CENTER);media.addView(fallback,new FrameLayout.LayoutParams(-1,-1));
    ImageView image=new ImageView(this);image.setScaleType(ImageView.ScaleType.CENTER_CROP);media.addView(image,new FrameLayout.LayoutParams(-1,-1));
    c.addView(media,new LinearLayout.LayoutParams(-1,dp(118)));loadRemoteImage(image,item.optString("imageUrl",""));
    TextView n=text(item.optString("name","Game Zone"),15,TEXT,true);n.setGravity(Gravity.CENTER);pad(n,8,10,8,2);c.addView(n,new LinearLayout.LayoutParams(-1,-2));
    if(product){TextView pr=text(String.format(Locale.US,"$%.2f",item.optDouble("price")),14,GOLD,true);pr.setGravity(Gravity.CENTER);c.addView(pr);}
    return c;
  }
  void addGridCards(java.util.List<View> cards){
    for(int i=0;i<cards.size();i+=2){LinearLayout row=hbox();row.setGravity(Gravity.TOP);row.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);View a=cards.get(i);LinearLayout.LayoutParams lp1=new LinearLayout.LayoutParams(0,dp(184),1);lp1.setMargins(dp(5),dp(5),dp(5),dp(5));row.addView(a,lp1);if(i+1<cards.size()){View b=cards.get(i+1);LinearLayout.LayoutParams lp2=new LinearLayout.LayoutParams(0,dp(184),1);lp2.setMargins(dp(5),dp(5),dp(5),dp(5));row.addView(b,lp2);}else{Space filler=new Space(this);row.addView(filler,new LinearLayout.LayoutParams(0,dp(184),1));}content.addView(row,new LinearLayout.LayoutParams(-1,-2));}
  }

  void showActivation(){
    ScrollView sc=new ScrollView(this);sc.setBackgroundColor(BG);LinearLayout w=vbox();w.setGravity(Gravity.CENTER_HORIZONTAL);pad(w,24,55,24,35);sc.addView(w);
    TextView logo=text("GZ",34,TEXT,true);logo.setGravity(Gravity.CENTER);logo.setBackground(box(BLUE,28));w.addView(logo,new LinearLayout.LayoutParams(dp(88),dp(88)));addGap(w,22);
    TextView h=text("تفعيل تطبيق Game Zone",26,TEXT,true);h.setGravity(Gravity.CENTER);w.addView(h);addGap(w,8);
    TextView p=text("افتح بوت Game Zone واضغط «📱 ربط تطبيق المتجر»، ثم أدخل كود الربط هنا. الكود صالح 5 دقائق ويُستخدم مرة واحدة.",14,MUTED,false);p.setGravity(Gravity.CENTER);w.addView(p,new LinearLayout.LayoutParams(-1,-2));addGap(w,24);
    EditText code=new EditText(this);code.setHint("XXXX-XXXX");code.setHintTextColor(MUTED);code.setTextColor(TEXT);code.setTextSize(24);code.setGravity(Gravity.CENTER);code.setSingleLine(true);code.setAllCaps(true);code.setBackground(box(CARD,18));pad(code,16,16,16,16);w.addView(code,new LinearLayout.LayoutParams(-1,dp(66)));addGap(w,14);
    Button activate=button("🔗 ربط بالبوت",BLUE);w.addView(activate,new LinearLayout.LayoutParams(-1,dp(58)));addGap(w,12);
    Button bot=button("🤖 فتح بوت Game Zone",CARD2);w.addView(bot,new LinearLayout.LayoutParams(-1,dp(54)));
    bot.setOnClickListener(v->{try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://t.me/gamezone1store_bot")));}catch(Exception e){toast("تعذر فتح Telegram");}});
    activate.setOnClickListener(v->{String raw=code.getText().toString().trim().toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]","");if(raw.length()!=8){toast("أدخل كود الربط بالشكل XXXX-XXXX");return;}String c=raw.substring(0,4)+"-"+raw.substring(4);activate.setEnabled(false);activate.setText("جارٍ الربط...");io.execute(()->{try{JSONObject r=requestJson("POST","/api/device/activation/redeem",new JSONObject().put("code",c),false);token=r.getString("sessionToken");prefs.edit().putString("session",token).apply();me=r.getJSONObject("user");runOnUiThread(this::openApp);}catch(Exception e){runOnUiThread(()->{activate.setEnabled(true);activate.setText("🔗 ربط بالبوت");toast("الكود غير صحيح أو انتهت مدته");});}});});
    setContentView(sc);
  }

  void validateAndOpen(){io.execute(()->{try{me=requestJson("GET","/api/me",null,true);runOnUiThread(this::openApp);}catch(Exception e){prefs.edit().remove("session").apply();token="";runOnUiThread(this::showActivation);}});}

  void openApp(){
    root=vbox();root.setBackgroundColor(BG);setContentView(root);
    LinearLayout head=hbox();head.setGravity(Gravity.CENTER_VERTICAL);pad(head,16,14,16,12);head.setBackgroundColor(Color.BLACK);
    LinearLayout labels=vbox();title=text("Game Zone",23,TEXT,true);TextView sub=text("نفس حسابك ومتجرك في Telegram",10,MUTED,false);labels.addView(title);labels.addView(sub);head.addView(labels,new LinearLayout.LayoutParams(0,-2,1));
    balance=text("$0.00",15,GOLD,true);balance.setGravity(Gravity.CENTER);balance.setBackground(box(CARD2,14));pad(balance,14,9,14,9);head.addView(balance);root.addView(head,new LinearLayout.LayoutParams(-1,-2));
    ScrollView scroll=new ScrollView(this);content=vbox();pad(content,14,16,14,20);scroll.addView(content);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
    buildBottom();loadAllThenStore();
  }

  void buildBottom(){bottom=hbox();bottom.setGravity(Gravity.CENTER);bottom.setBackgroundColor(Color.BLACK);String[] names={"🛍️ المتجر","📦 طلباتي","💳 المحفظة","👤 حسابي"};int[] colors={BLUE,PURPLE,GREEN,GOLD};for(int i=0;i<4;i++){Button b=button(names[i],Color.BLACK);final int x=i;b.setTextColor(i==0?BLUE:MUTED);b.setOnClickListener(v->{for(int j=0;j<bottom.getChildCount();j++)((Button)bottom.getChildAt(j)).setTextColor(j==x?colors[x]:MUTED);if(x==0)renderStore();if(x==1)loadOrders();if(x==2)renderWallet();if(x==3)renderAccount();});bottom.addView(b,new LinearLayout.LayoutParams(0,dp(64),1));}root.addView(bottom,new LinearLayout.LayoutParams(-1,dp(64)));}

  void loadAllThenStore(){io.execute(()->{try{config=requestJson("GET","/api/config",null,false);categories=requestArray("/api/categories",false);products=requestArray("/api/products",false);me=requestJson("GET","/api/me",null,true);runOnUiThread(()->{updateBalance();renderStore();});}catch(Exception e){toast("تعذر تحميل بيانات المتجر");}});}
  void updateBalance(){balance.setText(String.format(Locale.US,"$%.2f",me.optDouble("balance",0)));}
  void clear(String h,String s){content.removeAllViews();TextView a=text(h,25,TEXT,true);content.addView(a);if(s!=null){TextView b=text(s,11,MUTED,false);content.addView(b);}addGap(content,16);}
  View card(String name,String note,int accent){LinearLayout c=vbox();c.setBackground(box(CARD,20));pad(c,16,16,16,16);TextView n=text(name,17,TEXT,true);TextView d=text(note,10,MUTED,false);c.addView(n);c.addView(d);GradientDrawable g=box(CARD,20);g.setStroke(dp(1),accent);c.setBackground(g);return c;}

  void renderStore(){clear("🛍️ المتجر","اختر القسم");java.util.List<View> cards=new ArrayList<>();for(int i=0;i<categories.length();i++){JSONObject c=categories.optJSONObject(i);if(c==null||!c.isNull("parentId"))continue;View v=catalogTile(c,false,BLUE);final String id=c.optString("id"),name=c.optString("name");v.setOnClickListener(x->openCategory(id,name));cards.add(v);}addGridCards(cards);}
  void openCategory(String id,String name){clear(name,"اختر القسم أو المنتج");java.util.List<View> cards=new ArrayList<>();boolean hasChild=false;for(int i=0;i<categories.length();i++){JSONObject c=categories.optJSONObject(i);if(c!=null&&id.equals(c.optString("parentId"))){hasChild=true;View v=catalogTile(c,false,PURPLE);String cid=c.optString("id"),cn=c.optString("name");v.setOnClickListener(x->openCategory(cid,cn));cards.add(v);}}if(!hasChild){for(int i=0;i<products.length();i++){JSONObject p=products.optJSONObject(i);if(p!=null&&id.equals(p.optString("categoryId"))){View v=catalogTile(p,true,GOLD);v.setOnClickListener(x->openProduct(p));cards.add(v);}}}addGridCards(cards);}

  void openProduct(JSONObject p){
    LinearLayout w=vbox();pad(w,18,10,18,10);TextView h=text(p.optString("name"),22,TEXT,true);w.addView(h);TextView pr=text(String.format(Locale.US,"$%.2f  •  %s",p.optDouble("price"),p.optString("deliveryText","حسب المنتج")),14,GOLD,true);w.addView(pr);addGap(w,12);
    JSONArray schema=p.optJSONArray("inputSchema");Map<String,EditText> fields=new LinkedHashMap<>();if(schema!=null)for(int i=0;i<schema.length();i++){JSONObject f=schema.optJSONObject(i);if(f==null)continue;TextView l=text(f.optString("label",f.optString("key")),11,MUTED,false);w.addView(l);EditText e=new EditText(this);e.setTextColor(TEXT);e.setHintTextColor(MUTED);e.setHint(f.optString("placeholder",""));e.setSingleLine(true);e.setBackground(box(CARD2,12));pad(e,12,10,12,10);w.addView(e,new LinearLayout.LayoutParams(-1,dp(50)));addGap(w,8);fields.put(f.optString("key"),e);}
    TextView cl=text("كود خصم (اختياري)",11,MUTED,false);w.addView(cl);EditText coupon=new EditText(this);coupon.setTextColor(TEXT);coupon.setHintTextColor(MUTED);coupon.setBackground(box(CARD2,12));pad(coupon,12,10,12,10);w.addView(coupon,new LinearLayout.LayoutParams(-1,dp(50)));
    AlertDialog productDialog=new AlertDialog.Builder(this).setView(w).setNegativeButton("إلغاء",null).setPositiveButton("شراء",null).create();
    productDialog.setOnShowListener(d->{
      productDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
        try{
          JSONObject cd=new JSONObject();
          if(schema!=null)for(int i=0;i<schema.length();i++){
            JSONObject f=schema.getJSONObject(i);String key=f.optString("key"),val=fields.get(key).getText().toString().trim();
            if(f.optBoolean("required")&&val.isEmpty()){toast("أدخل "+f.optString("label",key));return;}
            if(!val.isEmpty())cd.put(key,val);
          }
          productDialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
          purchase(p,cd,coupon.getText().toString().trim(),productDialog);
        }catch(Exception e){toast("تحقق من بيانات الطلب");}
      });
    });
    productDialog.show();
  }
  void purchase(JSONObject p,JSONObject customer,String coupon,AlertDialog dialog){io.execute(()->{try{JSONObject body=new JSONObject().put("productId",p.getString("id")).put("customerData",customer).put("couponCode",coupon).put("clientRequestId","android:"+System.currentTimeMillis()+":"+UUID.randomUUID());JSONObject r=requestJson("POST","/api/orders",body,true);me.put("balance",r.optDouble("balance",me.optDouble("balance")));runOnUiThread(()->{updateBalance();dialog.dismiss();toast("تم إنشاء الطلب بنجاح");});}catch(Exception e){runOnUiThread(()->{dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);toast("تعذر إنشاء الطلب: تحقق من الرصيد والبيانات");});}});}

  void loadOrders(){clear("طلباتي","كل الطلبات مرتبطة بنفس حساب Telegram");io.execute(()->{try{JSONArray a=requestArray("/api/orders",true);runOnUiThread(()->{if(a.length()==0){content.addView(text("لا توجد طلبات حتى الآن",14,MUTED,false));return;}for(int i=0;i<a.length();i++){JSONObject o=a.optJSONObject(i);View v=card(o.optString("productName"),o.optString("orderNo")+"  •  "+o.optString("status")+String.format(Locale.US,"  •  $%.2f",o.optDouble("finalPrice")),BLUE);content.addView(v,new LinearLayout.LayoutParams(-1,dp(86)));addGap(content,9);}});}catch(Exception e){toast("تعذر تحميل الطلبات");}});}

  void renderWallet(){clear("💳 المحفظة","طرق الدفع نفسها المضافة في Game Zone");updateBalance();TextView b=text("رصيدك: "+String.format(Locale.US,"$%.2f",me.optDouble("balance")),22,GOLD,true);content.addView(b);addGap(content,14);JSONArray methods=config.optJSONArray("paymentMethods");if(methods==null||methods.length()==0){content.addView(text("لا توجد طرق دفع مفعلة حاليًا",13,MUTED,false));return;}TextView choose=text("اختر طريقة الدفع",13,TEXT,true);content.addView(choose);addGap(content,8);java.util.List<View> cards=new ArrayList<>();for(int i=0;i<methods.length();i++){JSONObject m=methods.optJSONObject(i);View v=catalogTile(m,false,GREEN);final String mid=m.optString("id");v.setOnClickListener(x->{selectedPaymentId=mid;openTopupForm(m);});cards.add(v);}addGridCards(cards);}
  void openTopupForm(JSONObject m){LinearLayout w=vbox();pad(w,18,10,18,10);w.addView(text(m.optString("name"),21,TEXT,true));w.addView(text(m.optString("instructions"),11,MUTED,false));addGap(w,12);EditText amount=new EditText(this);amount.setHint("المبلغ بالدولار USD");amount.setInputType(2|8192);amount.setTextColor(TEXT);amount.setHintTextColor(MUTED);amount.setBackground(box(CARD2,12));pad(amount,12,10,12,10);w.addView(amount,new LinearLayout.LayoutParams(-1,dp(50)));addGap(w,8);EditText ref=new EditText(this);ref.setHint("رقم العملية / المرجع");ref.setTextColor(TEXT);ref.setHintTextColor(MUTED);ref.setBackground(box(CARD2,12));pad(ref,12,10,12,10);w.addView(ref,new LinearLayout.LayoutParams(-1,dp(50)));addGap(w,8);Button receipt=button("اختيار صورة الإيصال",CARD2);w.addView(receipt,new LinearLayout.LayoutParams(-1,dp(50)));receipt.setOnClickListener(v->{Intent in=new Intent(Intent.ACTION_OPEN_DOCUMENT);in.setType("image/*");in.addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(in,PICK_RECEIPT);});AlertDialog d=new AlertDialog.Builder(this).setView(w).setNegativeButton("إلغاء",null).setPositiveButton("إنشاء طلب الشحن",null).create();d.setOnShowListener(x->d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{double val;try{val=Double.parseDouble(amount.getText().toString());}catch(Exception e){toast("أدخل مبلغًا صحيحًا");return;}String reference=ref.getText().toString().trim();if(m.optBoolean("requiresReference",true)&&reference.isEmpty()){toast("رقم العملية مطلوب");return;}if(m.optBoolean("requiresReceipt",false)&&receiptDataUrl==null){toast("صورة الإيصال مطلوبة");return;}d.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);submitTopup(val,m.optString("id"),reference,d);}));d.show();}
  void submitTopup(double amount,String method,String reference,AlertDialog d){io.execute(()->{try{JSONObject body=new JSONObject().put("amount",amount).put("method",method).put("reference",reference).put("clientRequestId","android-topup:"+System.currentTimeMillis()+":"+UUID.randomUUID());JSONObject r=requestJson("POST","/api/wallet/topup-intents",body,true);JSONObject t=r.optJSONObject("topup");if(receiptDataUrl!=null&&t!=null)requestJson("POST","/api/wallet/topups/"+URLEncoder.encode(t.optString("id"),"UTF-8")+"/receipt",new JSONObject().put("dataUrl",receiptDataUrl),true);receiptDataUrl=null;runOnUiThread(()->{d.dismiss();toast("تم إرسال طلب الشحن للإدارة");});}catch(Exception e){runOnUiThread(()->{d.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);toast("تعذر إرسال طلب الشحن");});}});}

  void renderAccount(){clear("حسابي","الحساب نفسه في البوت والتطبيق");content.addView(card(me.optString("firstName","عميل Game Zone"),me.optString("username").isEmpty()?"Telegram ID: "+me.optString("telegramId"):"@"+me.optString("username"),PURPLE),new LinearLayout.LayoutParams(-1,dp(100)));addGap(content,12);content.addView(text("الرصيد: "+String.format(Locale.US,"$%.2f",me.optDouble("balance")),20,GOLD,true));addGap(content,18);Button logout=button("إلغاء ربط هذا الجهاز",Color.rgb(130,35,48));content.addView(logout,new LinearLayout.LayoutParams(-1,dp(54)));logout.setOnClickListener(v->{prefs.edit().clear().apply();token="";showActivation();});}

  @Override protected void onActivityResult(int req,int result,Intent data){super.onActivityResult(req,result,data);if(req==PICK_RECEIPT&&result==RESULT_OK&&data!=null&&data.getData()!=null){Uri uri=data.getData();io.execute(()->{try{String mime=getContentResolver().getType(uri);if(mime==null||!mime.startsWith("image/"))throw new Exception();ByteArrayOutputStream out=new ByteArrayOutputStream();InputStream in=getContentResolver().openInputStream(uri);byte[] buf=new byte[8192];int n,total=0;while((n=in.read(buf))>0){total+=n;if(total>2*1024*1024)throw new Exception();out.write(buf,0,n);}in.close();receiptDataUrl="data:"+mime+";base64,"+Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP);toast("تم اختيار الإيصال");}catch(Exception e){toast("تعذر قراءة الصورة أو حجمها كبير");}});}}

  JSONObject requestJson(String method,String path,JSONObject body,boolean auth)throws Exception{HttpURLConnection c=(HttpURLConnection)new URL(base+path).openConnection();c.setRequestMethod(method);c.setConnectTimeout(12000);c.setReadTimeout(18000);c.setRequestProperty("Accept","application/json");if(auth&&!token.isEmpty())c.setRequestProperty("Authorization","Bearer "+token);if(body!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream o=c.getOutputStream()){o.write(body.toString().getBytes(StandardCharsets.UTF_8));}}int status=c.getResponseCode();InputStream in=status>=200&&status<300?c.getInputStream():c.getErrorStream();String s=read(in);c.disconnect();if(status<200||status>=300)throw new IOException("HTTP "+status+" "+s);return new JSONObject(s);}
  JSONArray requestArray(String path,boolean auth)throws Exception{HttpURLConnection c=(HttpURLConnection)new URL(base+path).openConnection();c.setRequestMethod("GET");c.setConnectTimeout(12000);c.setReadTimeout(18000);c.setRequestProperty("Accept","application/json");if(auth&&!token.isEmpty())c.setRequestProperty("Authorization","Bearer "+token);int status=c.getResponseCode();String s=read(status>=200&&status<300?c.getInputStream():c.getErrorStream());c.disconnect();if(status<200||status>=300)throw new IOException("HTTP "+status);return new JSONArray(s);}
  String read(InputStream in)throws Exception{if(in==null)return "{}";BufferedReader r=new BufferedReader(new InputStreamReader(in,StandardCharsets.UTF_8));StringBuilder b=new StringBuilder();String line;while((line=r.readLine())!=null)b.append(line);r.close();return b.toString();}
  @Override protected void onDestroy(){io.shutdownNow();super.onDestroy();}
}
