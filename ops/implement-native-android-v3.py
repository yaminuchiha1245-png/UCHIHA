from pathlib import Path

ROOT=Path('.')

def replace_once(path, old, new):
    p=ROOT/path
    s=p.read_text()
    if old not in s:
        raise SystemExit(f'anchor missing: {path}: {old[:80]}')
    p.write_text(s.replace(old,new,1))

# ------------------------------------------------------------------
# Backend: one-time Android activation issued by Telegram bot.
# ------------------------------------------------------------------
activation_lib=r'''const { randomCode, isExpired } = require("./devicePair");

const ACTIVATION_MINUTES = 10;

function createActivationRecord({ id, telegramId, at = Date.now() } = {}) {
  if (!id || !telegramId) throw new Error("activation_identity_required");
  return {
    id,
    mode: "android_activation",
    code: randomCode(6),
    status: "issued",
    telegramId: String(telegramId),
    createdAt: new Date(at).toISOString(),
    expiresAt: new Date(at + ACTIVATION_MINUTES * 60000).toISOString(),
    approvedAt: null,
    consumedAt: null
  };
}

function consumeActivation(records, code, at = Date.now()) {
  const normalized = String(code || "").trim().toUpperCase();
  const pair = (records || []).find(x => x.mode === "android_activation" && x.code === normalized && x.status === "issued");
  if (!pair) return { ok:false, error:"activation_invalid" };
  if (isExpired(pair, at)) {
    pair.status = "expired";
    return { ok:false, error:"activation_expired", pair };
  }
  pair.status = "consumed";
  pair.consumedAt = new Date(at).toISOString();
  pair.approvedAt = pair.consumedAt;
  return { ok:true, pair };
}

module.exports = { ACTIVATION_MINUTES, createActivationRecord, consumeActivation };
'''
(ROOT/'server/lib/appActivation.js').write_text(activation_lib)

test=r'''const assert=require("assert");
const {ACTIVATION_MINUTES,createActivationRecord,consumeActivation}=require("../lib/appActivation");

const at=Date.UTC(2026,8,5,12,0,0);
const rec=createActivationRecord({id:"act_1",telegramId:"123",at});
assert.equal(ACTIVATION_MINUTES,10);
assert.equal(rec.mode,"android_activation");
assert.equal(rec.status,"issued");
assert.equal(new Date(rec.expiresAt).getTime()-at,10*60*1000);
assert.match(rec.code,/^[A-HJ-NP-Z2-9]{6}$/);
let r=consumeActivation([rec],rec.code,at+9*60*1000);
assert.equal(r.ok,true);assert.equal(rec.status,"consumed");
assert.equal(consumeActivation([rec],rec.code,at+9*60*1000).ok,false,"activation must be one-time");
const expired=createActivationRecord({id:"act_2",telegramId:"123",at});
r=consumeActivation([expired],expired.code,at+10*60*1000);
assert.equal(r.ok,false);assert.equal(r.error,"activation_expired");assert.equal(expired.status,"expired");
console.log("appActivation.test.js PASS");
'''
(ROOT/'server/tests/appActivation.test.js').write_text(test)

replace_once(Path('server/server.js'),
'''const { createPairRecord, isExpired, publicPair, hashSecret } = require("./lib/devicePair");''',
'''const { createPairRecord, isExpired, publicPair, hashSecret } = require("./lib/devicePair");
const { createActivationRecord, consumeActivation } = require("./lib/appActivation");''')

replace_once(Path('server/server.js'),
'''const locksForPairApprove=req=>{''',
'''const locksForActivationRedeem=req=>{
  const code=String(req.body?.code||"").trim().toUpperCase(),db=readDB();
  const pair=(db.devicePairs||[]).find(x=>x.mode==="android_activation"&&x.code===code&&x.status==="issued");
  return pair?[`pair:${pair.id}`,`user:${String(pair.telegramId||"")}`]:[`activation-code:${code}`];
};
const locksForPairApprove=req=>{''')

activation_routes=r'''
app.post("/api/device/activation/issue",botOnly,rateLimit("device_activation_issue",12,60000),async(req,res)=>{
  try{
    const telegramUser=req.body?.telegramUser||{};
    if(!telegramUser?.id)return res.status(400).json({ok:false,error:"telegram_user_required"});
    const user=ensureUser(telegramUser),db=readDB();db.devicePairs||=[];
    const issuedAt=Date.now();
    for(const x of db.devicePairs){
      if(x.mode==="android_activation"&&String(x.telegramId)===String(user.telegramId)&&x.status==="issued")x.status="revoked";
    }
    db.devicePairs=db.devicePairs.filter(x=>!isExpired(x)||x.status==="consumed").slice(0,300);
    let activation=createActivationRecord({id:id("act"),telegramId:user.telegramId,at:issuedAt});
    while(db.devicePairs.some(x=>x.code===activation.code&&!isExpired(x)))activation=createActivationRecord({id:id("act"),telegramId:user.telegramId,at:issuedAt});
    db.devicePairs.unshift(activation);await persistCritical(db);
    return res.json({ok:true,activation:{code:activation.code,expiresAt:activation.expiresAt,expiresInSeconds:600}});
  }catch(e){return res.status(400).json({ok:false,error:e.message||"activation_issue_failed"});}
});

app.post("/api/device/activation/redeem",rateLimit("device_activation_redeem",20,600000),financialLocks(locksForActivationRedeem),async(req,res)=>{
  const code=String(req.body?.code||"").trim().toUpperCase();
  if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code))return res.status(400).json({ok:false,error:"activation_invalid"});
  const db=readDB(),result=consumeActivation(db.devicePairs||[],code);
  if(!result.ok){
    if(result.pair)await persistCritical(db);
    return res.status(result.error==="activation_expired"?410:404).json({ok:false,error:result.error});
  }
  const user=getUser(String(result.pair.telegramId||""));
  if(!user)return res.status(404).json({ok:false,error:"activation_user_missing"});
  await persistCritical(db);
  return res.json({ok:true,user:publicUser(user),sessionToken:signUserToken(user.telegramId,Math.max(24,Number(db.settings?.deviceSessionDays||30)*24),Number(user.sessionVersion||1))});
});

'''
replace_once(Path('server/server.js'),
'''app.post("/api/device/pair/start",rateLimit("device_pair_start",12,60000),async(req,res)=>{''',
activation_routes+'''app.post("/api/device/pair/start",rateLimit("device_pair_start",12,60000),async(req,res)=>{''')

# ------------------------------------------------------------------
# Telegram bot: send APK and ten-minute activation code.
# ------------------------------------------------------------------
replace_once(Path('bot/bot.js'),
'''const MINI_APP_URL=BOT_CONFIG.miniAppUrl;''',
'''const MINI_APP_URL=BOT_CONFIG.miniAppUrl;
const ANDROID_APK_URL=String(process.env.ANDROID_APK_URL||"https://github.com/yaminuchiha1245-png/UCHIHA/releases/download/game-zone-client-v3.0.0/Game-Zone-Client-v3.0.0.apk").trim();''')

replace_once(Path('bot/bot.js'),
'''    [Markup.button.callback("طلباتي","orders"),Markup.button.callback("شحن الرصيد","topup")],
    [Markup.button.url("الدعم الفني",`https://t.me/${SUPPORT_USERNAME}`)]''',
'''    [Markup.button.callback("طلباتي","orders"),Markup.button.callback("شحن الرصيد","topup")],
    [Markup.button.callback("ربط تطبيق Android","android_link")],
    [Markup.button.url("الدعم الفني",`https://t.me/${SUPPORT_USERNAME}`)]''')

android_action=r'''
bot.action("android_link",async ctx=>{
  await ctx.answerCbQuery("جاري تجهيز التطبيق...");
  if(!(await isSubscribed(ctx)))return ctx.reply(" يجب الاشتراك بالقناة أولًا.",subscriptionKeyboard());
  try{
    await syncUser(ctx);
    const issued=await api("/api/device/activation/issue",{method:"POST",body:JSON.stringify({telegramUser:ctx.from})});
    const code=String(issued?.activation?.code||"").trim().toUpperCase();
    if(!code)throw new Error("activation_code_missing");
    const caption=`📱 <b>تطبيق Game Zone Android</b>\n\nكود التفعيل: <code>${escapeHtml(code)}</code>\n⏱ صالح لمدة <b>10 دقائق</b> ويعمل مرة واحدة فقط.\n\nثبّت التطبيق، افتحه، ثم أدخل الكود لربط نفس حسابك ورصيدك وطلباتك.`;
    const keyboard=Markup.inlineKeyboard([[Markup.button.url("تحميل APK مرة أخرى",ANDROID_APK_URL)]]);
    try{
      await ctx.replyWithDocument({url:ANDROID_APK_URL},{caption,parse_mode:"HTML",...keyboard});
    }catch{
      await ctx.reply(caption,{parse_mode:"HTML",...keyboard});
    }
  }catch(e){
    await ctx.reply("تعذر تجهيز رابط التطبيق الآن. حاول مرة أخرى بعد قليل.");
  }
});
'''
replace_once(Path('bot/bot.js'),
'''bot.action("account",async ctx=>{''',
android_action+'\nbot.action("account",async ctx=>{')

# ------------------------------------------------------------------
# Standalone Android client v3.0.0 (native Android Views + same API).
# ------------------------------------------------------------------
replace_once(Path('android/handoff/client/build.gradle.kts'),
'''        versionCode = 21
        versionName = "2.1.0"''',
'''        versionCode = 30
        versionName = "3.0.0"''')

(ROOT/'android/handoff/client/src/main/res/values/urls.xml').write_text('''<resources><string name="start_url">https://gamezone.155-254-35-187.sslip.io</string></resources>\n''')

java=r'''package com.gamezone.store;

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
  static final int BG=Color.rgb(14,16,22), CARD=Color.rgb(24,27,36), CARD2=Color.rgb(31,35,46), TEXT=Color.WHITE;
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

  void showActivation(){
    ScrollView sc=new ScrollView(this);sc.setBackgroundColor(BG);LinearLayout w=vbox();w.setGravity(Gravity.CENTER_HORIZONTAL);pad(w,24,55,24,35);sc.addView(w);
    TextView logo=text("GZ",34,TEXT,true);logo.setGravity(Gravity.CENTER);logo.setBackground(box(BLUE,28));w.addView(logo,new LinearLayout.LayoutParams(dp(88),dp(88)));addGap(w,22);
    TextView h=text("تفعيل تطبيق Game Zone",26,TEXT,true);h.setGravity(Gravity.CENTER);w.addView(h);addGap(w,8);
    TextView p=text("من بوت Game Zone اضغط «ربط تطبيق Android»، ثم أدخل الكود الذي يصلك. الكود صالح 10 دقائق فقط.",14,MUTED,false);p.setGravity(Gravity.CENTER);w.addView(p,new LinearLayout.LayoutParams(-1,-2));addGap(w,24);
    EditText code=new EditText(this);code.setHint("XXXXXX");code.setHintTextColor(MUTED);code.setTextColor(TEXT);code.setTextSize(24);code.setGravity(Gravity.CENTER);code.setSingleLine(true);code.setAllCaps(true);code.setBackground(box(CARD,18));pad(code,16,16,16,16);w.addView(code,new LinearLayout.LayoutParams(-1,dp(66)));addGap(w,14);
    Button activate=button("تفعيل وربط الحساب",BLUE);w.addView(activate,new LinearLayout.LayoutParams(-1,dp(58)));addGap(w,12);
    Button bot=button("فتح بوت Game Zone",CARD2);w.addView(bot,new LinearLayout.LayoutParams(-1,dp(54)));
    bot.setOnClickListener(v->{try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://t.me/gamezone1store_bot")));}catch(Exception e){toast("تعذر فتح Telegram");}});
    activate.setOnClickListener(v->{String c=code.getText().toString().trim().toUpperCase(Locale.ROOT);if(c.length()!=6){toast("أدخل كود التفعيل المكوّن من 6 رموز");return;}activate.setEnabled(false);activate.setText("جارٍ التفعيل...");io.execute(()->{try{JSONObject r=requestJson("POST","/api/device/activation/redeem",new JSONObject().put("code",c),false);token=r.getString("sessionToken");prefs.edit().putString("session",token).apply();me=r.getJSONObject("user");runOnUiThread(this::openApp);}catch(Exception e){runOnUiThread(()->{activate.setEnabled(true);activate.setText("تفعيل وربط الحساب");toast("الكود غير صحيح أو انتهت مدته");});}});});
    setContentView(sc);
  }

  void validateAndOpen(){io.execute(()->{try{me=requestJson("GET","/api/me",null,true);runOnUiThread(this::openApp);}catch(Exception e){prefs.edit().remove("session").apply();token="";runOnUiThread(this::showActivation);}});}

  void openApp(){
    root=vbox();root.setBackgroundColor(BG);setContentView(root);
    LinearLayout head=hbox();head.setGravity(Gravity.CENTER_VERTICAL);pad(head,16,14,16,12);head.setBackgroundColor(Color.BLACK);
    LinearLayout labels=vbox();title=text("Game Zone",23,TEXT,true);TextView sub=text("تطبيق Android المستقل",10,MUTED,false);labels.addView(title);labels.addView(sub);head.addView(labels,new LinearLayout.LayoutParams(0,-2,1));
    balance=text("$0.00",15,GOLD,true);balance.setGravity(Gravity.CENTER);balance.setBackground(box(CARD2,14));pad(balance,14,9,14,9);head.addView(balance);root.addView(head,new LinearLayout.LayoutParams(-1,-2));
    ScrollView scroll=new ScrollView(this);content=vbox();pad(content,14,16,14,20);scroll.addView(content);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
    buildBottom();loadAllThenStore();
  }

  void buildBottom(){bottom=hbox();bottom.setGravity(Gravity.CENTER);bottom.setBackgroundColor(Color.BLACK);String[] names={"المتجر","طلباتي","المحفظة","حسابي"};int[] colors={BLUE,PURPLE,GREEN,GOLD};for(int i=0;i<4;i++){Button b=button(names[i],Color.BLACK);final int x=i;b.setTextColor(i==0?BLUE:MUTED);b.setOnClickListener(v->{for(int j=0;j<bottom.getChildCount();j++)((Button)bottom.getChildAt(j)).setTextColor(j==x?colors[x]:MUTED);if(x==0)renderStore();if(x==1)loadOrders();if(x==2)renderWallet();if(x==3)renderAccount();});bottom.addView(b,new LinearLayout.LayoutParams(0,dp(64),1));}root.addView(bottom,new LinearLayout.LayoutParams(-1,dp(64)));}

  void loadAllThenStore(){io.execute(()->{try{config=requestJson("GET","/api/config",null,false);categories=requestArray("/api/categories",false);products=requestArray("/api/products",false);me=requestJson("GET","/api/me",null,true);runOnUiThread(()->{updateBalance();renderStore();});}catch(Exception e){toast("تعذر تحميل بيانات المتجر");}});}
  void updateBalance(){balance.setText(String.format(Locale.US,"$%.2f",me.optDouble("balance",0)));}
  void clear(String h,String s){content.removeAllViews();TextView a=text(h,25,TEXT,true);content.addView(a);if(s!=null){TextView b=text(s,11,MUTED,false);content.addView(b);}addGap(content,16);}
  View card(String name,String note,int accent){LinearLayout c=vbox();c.setBackground(box(CARD,20));pad(c,16,16,16,16);TextView n=text(name,17,TEXT,true);TextView d=text(note,10,MUTED,false);c.addView(n);c.addView(d);GradientDrawable g=box(CARD,20);g.setStroke(dp(1),accent);c.setBackground(g);return c;}

  void renderStore(){clear("المتجر","نفس الأقسام والمنتجات التي يديرها صاحب المتجر من البوت ولوحة الإدارة");for(int i=0;i<categories.length();i++){JSONObject c=categories.optJSONObject(i);if(c==null||!c.isNull("parentId"))continue;View v=card(c.optString("name"),"فتح القسم",BLUE);final String id=c.optString("id");v.setOnClickListener(x->openCategory(id,c.optString("name")));content.addView(v,new LinearLayout.LayoutParams(-1,dp(84)));addGap(content,10);}}
  void openCategory(String id,String name){clear(name,"اختر القسم أو المنتج");boolean hasChild=false;for(int i=0;i<categories.length();i++){JSONObject c=categories.optJSONObject(i);if(c!=null&&id.equals(c.optString("parentId"))){hasChild=true;View v=card(c.optString("name"),"قسم فرعي",PURPLE);String cid=c.optString("id"),cn=c.optString("name");v.setOnClickListener(x->openCategory(cid,cn));content.addView(v,new LinearLayout.LayoutParams(-1,dp(80)));addGap(content,9);}}if(!hasChild){for(int i=0;i<products.length();i++){JSONObject p=products.optJSONObject(i);if(p!=null&&id.equals(p.optString("categoryId"))){View v=card(p.optString("name"),String.format(Locale.US,"$%.2f  •  %s",p.optDouble("price"),p.optString("deliveryText","حسب المنتج")),GOLD);v.setOnClickListener(x->openProduct(p));content.addView(v,new LinearLayout.LayoutParams(-1,dp(88)));addGap(content,9);}}}}

  void openProduct(JSONObject p){
    LinearLayout w=vbox();pad(w,18,10,18,10);TextView h=text(p.optString("name"),22,TEXT,true);w.addView(h);TextView pr=text(String.format(Locale.US,"$%.2f  •  %s",p.optDouble("price"),p.optString("deliveryText","حسب المنتج")),14,GOLD,true);w.addView(pr);addGap(w,12);
    JSONArray schema=p.optJSONArray("inputSchema");Map<String,EditText> fields=new LinkedHashMap<>();if(schema!=null)for(int i=0;i<schema.length();i++){JSONObject f=schema.optJSONObject(i);if(f==null)continue;TextView l=text(f.optString("label",f.optString("key")),11,MUTED,false);w.addView(l);EditText e=new EditText(this);e.setTextColor(TEXT);e.setHintTextColor(MUTED);e.setHint(f.optString("placeholder",""));e.setSingleLine(true);e.setBackground(box(CARD2,12));pad(e,12,10,12,10);w.addView(e,new LinearLayout.LayoutParams(-1,dp(50)));addGap(w,8);fields.put(f.optString("key"),e);}
    TextView cl=text("كود خصم (اختياري)",11,MUTED,false);w.addView(cl);EditText coupon=new EditText(this);coupon.setTextColor(TEXT);coupon.setHintTextColor(MUTED);coupon.setBackground(box(CARD2,12));pad(coupon,12,10,12,10);w.addView(coupon,new LinearLayout.LayoutParams(-1,dp(50)));
    new AlertDialog.Builder(this).setView(w).setNegativeButton("إلغاء",null).setPositiveButton("شراء",null).create().setOnShowListener(d->{AlertDialog a=(AlertDialog)d; a.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{try{JSONObject cd=new JSONObject();if(schema!=null)for(int i=0;i<schema.length();i++){JSONObject f=schema.getJSONObject(i);String key=f.optString("key"),val=fields.get(key).getText().toString().trim();if(f.optBoolean("required")&&val.isEmpty()){toast("أدخل "+f.optString("label",key));return;}if(!val.isEmpty())cd.put(key,val);}a.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);purchase(p,cd,coupon.getText().toString().trim(),a);}catch(Exception e){toast("تحقق من بيانات الطلب");}});}).show();
  }
  void purchase(JSONObject p,JSONObject customer,String coupon,AlertDialog dialog){io.execute(()->{try{JSONObject body=new JSONObject().put("productId",p.getString("id")).put("customerData",customer).put("couponCode",coupon).put("clientRequestId","android:"+System.currentTimeMillis()+":"+UUID.randomUUID());JSONObject r=requestJson("POST","/api/orders",body,true);me.put("balance",r.optDouble("balance",me.optDouble("balance")));runOnUiThread(()->{updateBalance();dialog.dismiss();toast("تم إنشاء الطلب بنجاح");});}catch(Exception e){runOnUiThread(()->{dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);toast("تعذر إنشاء الطلب: تحقق من الرصيد والبيانات");});}});}

  void loadOrders(){clear("طلباتي","كل الطلبات مرتبطة بنفس حساب Telegram");io.execute(()->{try{JSONArray a=requestArray("/api/orders",true);runOnUiThread(()->{if(a.length()==0){content.addView(text("لا توجد طلبات حتى الآن",14,MUTED,false));return;}for(int i=0;i<a.length();i++){JSONObject o=a.optJSONObject(i);View v=card(o.optString("productName"),o.optString("orderNo")+"  •  "+o.optString("status")+String.format(Locale.US,"  •  $%.2f",o.optDouble("finalPrice")),BLUE);content.addView(v,new LinearLayout.LayoutParams(-1,dp(86)));addGap(content,9);}});}catch(Exception e){toast("تعذر تحميل الطلبات");}});}

  void renderWallet(){clear("المحفظة","طرق الدفع هنا هي نفسها التي يضيفها صاحب المتجر");updateBalance();TextView b=text("رصيدك: "+String.format(Locale.US,"$%.2f",me.optDouble("balance")),22,GOLD,true);content.addView(b);addGap(content,14);JSONArray methods=config.optJSONArray("paymentMethods");if(methods==null||methods.length()==0){content.addView(text("لا توجد طرق دفع مفعلة حاليًا",13,MUTED,false));return;}TextView choose=text("اختر طريقة الدفع",13,TEXT,true);content.addView(choose);addGap(content,8);for(int i=0;i<methods.length();i++){JSONObject m=methods.optJSONObject(i);View v=card(m.optString("name"),m.optString("account")+"  •  "+m.optString("instructions"),GREEN);final String mid=m.optString("id");v.setOnClickListener(x->{selectedPaymentId=mid;openTopupForm(m);});content.addView(v,new LinearLayout.LayoutParams(-1,dp(100)));addGap(content,9);}}
  void openTopupForm(JSONObject m){LinearLayout w=vbox();pad(w,18,10,18,10);w.addView(text(m.optString("name"),21,TEXT,true));w.addView(text(m.optString("instructions"),11,MUTED,false));addGap(w,12);EditText amount=new EditText(this);amount.setHint("المبلغ بالدولار USD");amount.setInputType(2|8192);amount.setTextColor(TEXT);amount.setHintTextColor(MUTED);amount.setBackground(box(CARD2,12));pad(amount,12,10,12,10);w.addView(amount,new LinearLayout.LayoutParams(-1,dp(50)));addGap(w,8);EditText ref=new EditText(this);ref.setHint("رقم العملية / المرجع");ref.setTextColor(TEXT);ref.setHintTextColor(MUTED);ref.setBackground(box(CARD2,12));pad(ref,12,10,12,10);w.addView(ref,new LinearLayout.LayoutParams(-1,dp(50)));addGap(w,8);Button receipt=button("اختيار صورة الإيصال",CARD2);w.addView(receipt,new LinearLayout.LayoutParams(-1,dp(50)));receipt.setOnClickListener(v->{Intent in=new Intent(Intent.ACTION_OPEN_DOCUMENT);in.setType("image/*");in.addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(in,PICK_RECEIPT);});AlertDialog d=new AlertDialog.Builder(this).setView(w).setNegativeButton("إلغاء",null).setPositiveButton("إنشاء طلب الشحن",null).create();d.setOnShowListener(x->d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{double val;try{val=Double.parseDouble(amount.getText().toString());}catch(Exception e){toast("أدخل مبلغًا صحيحًا");return;}String reference=ref.getText().toString().trim();if(m.optBoolean("requiresReference",true)&&reference.isEmpty()){toast("رقم العملية مطلوب");return;}if(m.optBoolean("requiresReceipt",false)&&receiptDataUrl==null){toast("صورة الإيصال مطلوبة");return;}d.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);submitTopup(val,m.optString("id"),reference,d);}));d.show();}
  void submitTopup(double amount,String method,String reference,AlertDialog d){io.execute(()->{try{JSONObject body=new JSONObject().put("amount",amount).put("method",method).put("reference",reference).put("clientRequestId","android-topup:"+System.currentTimeMillis()+":"+UUID.randomUUID());JSONObject r=requestJson("POST","/api/wallet/topup-intents",body,true);JSONObject t=r.optJSONObject("topup");if(receiptDataUrl!=null&&t!=null)requestJson("POST","/api/wallet/topups/"+URLEncoder.encode(t.optString("id"),"UTF-8")+"/receipt",new JSONObject().put("dataUrl",receiptDataUrl),true);receiptDataUrl=null;runOnUiThread(()->{d.dismiss();toast("تم إرسال طلب الشحن للإدارة");});}catch(Exception e){runOnUiThread(()->{d.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);toast("تعذر إرسال طلب الشحن");});}});}

  void renderAccount(){clear("حسابي","الحساب نفسه في البوت والتطبيق");content.addView(card(me.optString("firstName","عميل Game Zone"),me.optString("username").isEmpty()?"Telegram ID: "+me.optString("telegramId"):"@"+me.optString("username"),PURPLE),new LinearLayout.LayoutParams(-1,dp(100)));addGap(content,12);content.addView(text("الرصيد: "+String.format(Locale.US,"$%.2f",me.optDouble("balance")),20,GOLD,true));addGap(content,18);Button logout=button("إلغاء ربط هذا الجهاز",Color.rgb(130,35,48));content.addView(logout,new LinearLayout.LayoutParams(-1,dp(54)));logout.setOnClickListener(v->{prefs.edit().clear().apply();token="";showActivation();});}

  @Override protected void onActivityResult(int req,int result,Intent data){super.onActivityResult(req,result,data);if(req==PICK_RECEIPT&&result==RESULT_OK&&data!=null&&data.getData()!=null){Uri uri=data.getData();io.execute(()->{try{String mime=getContentResolver().getType(uri);if(mime==null||!mime.startsWith("image/"))throw new Exception();ByteArrayOutputStream out=new ByteArrayOutputStream();InputStream in=getContentResolver().openInputStream(uri);byte[] buf=new byte[8192];int n,total=0;while((n=in.read(buf))>0){total+=n;if(total>2*1024*1024)throw new Exception();out.write(buf,0,n);}in.close();receiptDataUrl="data:"+mime+";base64,"+Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP);toast("تم اختيار الإيصال");}catch(Exception e){toast("تعذر قراءة الصورة أو حجمها كبير");}});}}

  JSONObject requestJson(String method,String path,JSONObject body,boolean auth)throws Exception{HttpURLConnection c=(HttpURLConnection)new URL(base+path).openConnection();c.setRequestMethod(method);c.setConnectTimeout(12000);c.setReadTimeout(18000);c.setRequestProperty("Accept","application/json");if(auth&&!token.isEmpty())c.setRequestProperty("Authorization","Bearer "+token);if(body!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream o=c.getOutputStream()){o.write(body.toString().getBytes(StandardCharsets.UTF_8));}}int status=c.getResponseCode();InputStream in=status>=200&&status<300?c.getInputStream():c.getErrorStream();String s=read(in);c.disconnect();if(status<200||status>=300)throw new IOException("HTTP "+status+" "+s);return new JSONObject(s);}
  JSONArray requestArray(String path,boolean auth)throws Exception{HttpURLConnection c=(HttpURLConnection)new URL(base+path).openConnection();c.setRequestMethod("GET");c.setConnectTimeout(12000);c.setReadTimeout(18000);c.setRequestProperty("Accept","application/json");if(auth&&!token.isEmpty())c.setRequestProperty("Authorization","Bearer "+token);int status=c.getResponseCode();String s=read(status>=200&&status<300?c.getInputStream():c.getErrorStream());c.disconnect();if(status<200||status>=300)throw new IOException("HTTP "+status);return new JSONArray(s);}
  String read(InputStream in)throws Exception{if(in==null)return "{}";BufferedReader r=new BufferedReader(new InputStreamReader(in,StandardCharsets.UTF_8));StringBuilder b=new StringBuilder();String line;while((line=r.readLine())!=null)b.append(line);r.close();return b.toString();}
  @Override protected void onDestroy(){io.shutdownNow();super.onDestroy();}
}
'''
(ROOT/'android/handoff/client/src/main/java/com/gamezone/store/MainActivity.java').write_text(java)

print('native Android v3 source patched')
