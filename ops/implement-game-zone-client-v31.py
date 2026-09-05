from pathlib import Path

ROOT = Path('.')

def replace_once(path, old, new):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    if old not in s:
        raise SystemExit(f'anchor not found in {path}: {old[:80]!r}')
    s = s.replace(old, new, 1)
    p.write_text(s, encoding='utf-8')

# 1) 5-minute, 4+4 one-time activation code.
activation = '''const { randomCode, isExpired } = require("./devicePair");

const ACTIVATION_MINUTES = 5;

function normalizeActivationCode(value) {
  const compact = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length !== 8) return "";
  return `${compact.slice(0,4)}-${compact.slice(4)}`;
}

function createActivationRecord({ id, telegramId, at = Date.now() } = {}) {
  if (!id || !telegramId) throw new Error("activation_identity_required");
  const code = normalizeActivationCode(randomCode(8));
  return {
    id,
    mode: "android_activation",
    code,
    status: "issued",
    telegramId: String(telegramId),
    createdAt: new Date(at).toISOString(),
    expiresAt: new Date(at + ACTIVATION_MINUTES * 60000).toISOString(),
    approvedAt: null,
    consumedAt: null
  };
}

function consumeActivation(records, code, at = Date.now()) {
  const normalized = normalizeActivationCode(code);
  if (!normalized) return { ok:false, error:"activation_invalid" };
  const pair = (records || []).find(x => x.mode === "android_activation" && normalizeActivationCode(x.code) === normalized && x.status === "issued");
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

module.exports = { ACTIVATION_MINUTES, normalizeActivationCode, createActivationRecord, consumeActivation };
'''
(ROOT/'server/lib/appActivation.js').write_text(activation, encoding='utf-8')

# 2) Bot main menu with suitable emoji labels.
replace_once('bot/bot.js', '''function menu(){
  return Markup.inlineKeyboard([
    [Markup.button.webApp("فتح متجر Game Zone",MINI_APP_URL)],
    [Markup.button.callback("تصفح الأقسام","browse_categories"),Markup.button.callback("حسابي","account")],
    [Markup.button.callback("طلباتي","orders"),Markup.button.callback("شحن الرصيد","topup")],
    [Markup.button.callback("ربط تطبيق Android","android_link")],
    [Markup.button.url("الدعم الفني",`https://t.me/${SUPPORT_USERNAME}`)]
  ]);
}''', '''function menu(){
  return Markup.inlineKeyboard([
    [Markup.button.webApp("🛍️ فتح متجر Game Zone",MINI_APP_URL)],
    [Markup.button.callback("🗂️ الأقسام","browse_categories"),Markup.button.callback("👤 حسابي","account")],
    [Markup.button.callback("📦 طلباتي","orders"),Markup.button.callback("💳 شحن الرصيد","topup")],
    [Markup.button.callback("📱 ربط تطبيق المتجر","android_link")],
    [Markup.button.url("🛟 الدعم الفني",`https://t.me/${SUPPORT_USERNAME}`)]
  ]);
}''')

replace_once('bot/bot.js', '''    const caption=`📱 <b>تطبيق Game Zone Android</b>\\n\\nكود التفعيل: <code>${escapeHtml(code)}</code>\\n⏱ صالح لمدة <b>10 دقائق</b> ويعمل مرة واحدة فقط.\\n\\nثبّت التطبيق، افتحه، ثم أدخل الكود لربط نفس حسابك ورصيدك وطلباتك.`;
    const keyboard=Markup.inlineKeyboard([[Markup.button.url("تحميل APK مرة أخرى",ANDROID_APK_URL)]]);''', '''    const caption=`📱 <b>ربط تطبيق المتجر</b>\\n\\nكود الربط الخاص بك:\\n\\n<code>${escapeHtml(code)}</code>\\n\\n1. افتح التطبيق واختر «ربط بالبوت»\\n2. أدخل هذا الكود\\n\\n⏱️ صالح لـ <b>5 دقائق</b> ويُستخدم مرة واحدة فقط.\\n🔒 لا تشاركه مع أحد — من يملكه يدخل حسابك من التطبيق.`;
    const keyboard=Markup.inlineKeyboard([[Markup.button.url("📥 تحميل تطبيق المتجر",ANDROID_APK_URL)]]);''')

# 3) Android v3.1: activation wording and 4+4 validation.
main = ROOT/'android/handoff/client/src/main/java/com/gamezone/store/MainActivity.java'
s = main.read_text(encoding='utf-8')
s = s.replace('static final int BG=Color.rgb(14,16,22), CARD=Color.rgb(24,27,36), CARD2=Color.rgb(31,35,46), TEXT=Color.WHITE;',
              'static final int BG=Color.rgb(7,9,14), CARD=Color.rgb(17,20,28), CARD2=Color.rgb(27,31,42), TEXT=Color.WHITE;')
s = s.replace('TextView p=text("من بوت Game Zone اضغط «ربط تطبيق Android»، ثم أدخل الكود الذي يصلك. الكود صالح 10 دقائق فقط.",14,MUTED,false);',
              'TextView p=text("افتح بوت Game Zone واضغط «📱 ربط تطبيق المتجر»، ثم أدخل كود الربط هنا. الكود صالح 5 دقائق ويُستخدم مرة واحدة.",14,MUTED,false);')
s = s.replace('code.setHint("XXXXXX")', 'code.setHint("XXXX-XXXX")')
s = s.replace('Button activate=button("تفعيل وربط الحساب",BLUE);', 'Button activate=button("🔗 ربط بالبوت",BLUE);')
s = s.replace('Button bot=button("فتح بوت Game Zone",CARD2);', 'Button bot=button("🤖 فتح بوت Game Zone",CARD2);')
s = s.replace('activate.setOnClickListener(v->{String c=code.getText().toString().trim().toUpperCase(Locale.ROOT);if(c.length()!=6){toast("أدخل كود التفعيل المكوّن من 6 رموز");return;}activate.setEnabled(false);activate.setText("جارٍ التفعيل...");io.execute(()->{try{JSONObject r=requestJson("POST","/api/device/activation/redeem",new JSONObject().put("code",c),false);',
'''activate.setOnClickListener(v->{String raw=code.getText().toString().trim().toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]","");if(raw.length()!=8){toast("أدخل كود الربط بالشكل XXXX-XXXX");return;}String c=raw.substring(0,4)+"-"+raw.substring(4);activate.setEnabled(false);activate.setText("جارٍ الربط...");io.execute(()->{try{JSONObject r=requestJson("POST","/api/device/activation/redeem",new JSONObject().put("code",c),false);''')
s = s.replace('activate.setText("تفعيل وربط الحساب");toast("الكود غير صحيح أو انتهت مدته")', 'activate.setText("🔗 ربط بالبوت");toast("الكود غير صحيح أو انتهت مدته")')

# Header / bottom navigation close to the Telegram store language.
s = s.replace('TextView sub=text("تطبيق Android المستقل",10,MUTED,false);', 'TextView sub=text("نفس حسابك ومتجرك في Telegram",10,MUTED,false);')
s = s.replace('String[] names={"المتجر","طلباتي","المحفظة","حسابي"};', 'String[] names={"🛍️ المتجر","📦 طلباتي","💳 المحفظة","👤 حسابي"};')

# Insert image/grid helpers after toast().
anchor = '  void toast(String s){runOnUiThread(()->Toast.makeText(this,s,Toast.LENGTH_SHORT).show());}\n'
helpers = r'''  String absoluteMediaUrl(String u){
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
    ImageView image=new ImageView(this);image.setScaleType(ImageView.ScaleType.CENTER_CROP);media.addView(image,new FrameLayout.LayoutParams(-1,-1));
    TextView fallback=text("GAME ZONE",14,MUTED,true);fallback.setGravity(Gravity.CENTER);media.addView(fallback,new FrameLayout.LayoutParams(-1,-1));
    c.addView(media,new LinearLayout.LayoutParams(-1,dp(118)));loadRemoteImage(image,item.optString("imageUrl",""));
    TextView n=text(item.optString("name","Game Zone"),15,TEXT,true);n.setGravity(Gravity.CENTER);pad(n,8,10,8,2);c.addView(n,new LinearLayout.LayoutParams(-1,-2));
    if(product){TextView pr=text(String.format(Locale.US,"$%.2f",item.optDouble("price")),14,GOLD,true);pr.setGravity(Gravity.CENTER);c.addView(pr);}
    return c;
  }
  void addGridCards(java.util.List<View> cards){
    for(int i=0;i<cards.size();i+=2){LinearLayout row=hbox();row.setGravity(Gravity.TOP);row.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);View a=cards.get(i);LinearLayout.LayoutParams lp1=new LinearLayout.LayoutParams(0,dp(184),1);lp1.setMargins(dp(5),dp(5),dp(5),dp(5));row.addView(a,lp1);if(i+1<cards.size()){View b=cards.get(i+1);LinearLayout.LayoutParams lp2=new LinearLayout.LayoutParams(0,dp(184),1);lp2.setMargins(dp(5),dp(5),dp(5),dp(5));row.addView(b,lp2);}else{Space filler=new Space(this);row.addView(filler,new LinearLayout.LayoutParams(0,dp(184),1));}content.addView(row,new LinearLayout.LayoutParams(-1,-2));}
  }
'''
if anchor not in s: raise SystemExit('toast anchor missing')
s=s.replace(anchor,anchor+helpers,1)

# Replace text-only catalog renderers with photo grid cards.
old_store='''  void renderStore(){clear("المتجر","نفس الأقسام والمنتجات التي يديرها صاحب المتجر من البوت ولوحة الإدارة");for(int i=0;i<categories.length();i++){JSONObject c=categories.optJSONObject(i);if(c==null||!c.isNull("parentId"))continue;View v=card(c.optString("name"),"فتح القسم",BLUE);final String id=c.optString("id");v.setOnClickListener(x->openCategory(id,c.optString("name")));content.addView(v,new LinearLayout.LayoutParams(-1,dp(84)));addGap(content,10);}}
  void openCategory(String id,String name){clear(name,"اختر القسم أو المنتج");boolean hasChild=false;for(int i=0;i<categories.length();i++){JSONObject c=categories.optJSONObject(i);if(c!=null&&id.equals(c.optString("parentId"))){hasChild=true;View v=card(c.optString("name"),"قسم فرعي",PURPLE);String cid=c.optString("id"),cn=c.optString("name");v.setOnClickListener(x->openCategory(cid,cn));content.addView(v,new LinearLayout.LayoutParams(-1,dp(80)));addGap(content,9);}}if(!hasChild){for(int i=0;i<products.length();i++){JSONObject p=products.optJSONObject(i);if(p!=null&&id.equals(p.optString("categoryId"))){View v=card(p.optString("name"),String.format(Locale.US,"$%.2f  •  %s",p.optDouble("price"),p.optString("deliveryText","حسب المنتج")),GOLD);v.setOnClickListener(x->openProduct(p));content.addView(v,new LinearLayout.LayoutParams(-1,dp(88)));addGap(content,9);}}}}
'''
new_store='''  void renderStore(){clear("🛍️ المتجر","اختر القسم");java.util.List<View> cards=new ArrayList<>();for(int i=0;i<categories.length();i++){JSONObject c=categories.optJSONObject(i);if(c==null||!c.isNull("parentId"))continue;View v=catalogTile(c,false,BLUE);final String id=c.optString("id"),name=c.optString("name");v.setOnClickListener(x->openCategory(id,name));cards.add(v);}addGridCards(cards);}
  void openCategory(String id,String name){clear(name,"اختر القسم أو المنتج");java.util.List<View> cards=new ArrayList<>();boolean hasChild=false;for(int i=0;i<categories.length();i++){JSONObject c=categories.optJSONObject(i);if(c!=null&&id.equals(c.optString("parentId"))){hasChild=true;View v=catalogTile(c,false,PURPLE);String cid=c.optString("id"),cn=c.optString("name");v.setOnClickListener(x->openCategory(cid,cn));cards.add(v);}}if(!hasChild){for(int i=0;i<products.length();i++){JSONObject p=products.optJSONObject(i);if(p!=null&&id.equals(p.optString("categoryId"))){View v=catalogTile(p,true,GOLD);v.setOnClickListener(x->openProduct(p));cards.add(v);}}}addGridCards(cards);}
'''
if old_store not in s: raise SystemExit('store render anchor missing')
s=s.replace(old_store,new_store,1)

# Payment methods also become visual cards using the same uploaded image when present.
old_wallet='''  void renderWallet(){clear("المحفظة","طرق الدفع هنا هي نفسها التي يضيفها صاحب المتجر");updateBalance();TextView b=text("رصيدك: "+String.format(Locale.US,"$%.2f",me.optDouble("balance")),22,GOLD,true);content.addView(b);addGap(content,14);JSONArray methods=config.optJSONArray("paymentMethods");if(methods==null||methods.length()==0){content.addView(text("لا توجد طرق دفع مفعلة حاليًا",13,MUTED,false));return;}TextView choose=text("اختر طريقة الدفع",13,TEXT,true);content.addView(choose);addGap(content,8);for(int i=0;i<methods.length();i++){JSONObject m=methods.optJSONObject(i);View v=card(m.optString("name"),m.optString("account")+"  •  "+m.optString("instructions"),GREEN);final String mid=m.optString("id");v.setOnClickListener(x->{selectedPaymentId=mid;openTopupForm(m);});content.addView(v,new LinearLayout.LayoutParams(-1,dp(100)));addGap(content,9);}}
'''
new_wallet='''  void renderWallet(){clear("💳 المحفظة","طرق الدفع نفسها المضافة في Game Zone");updateBalance();TextView b=text("رصيدك: "+String.format(Locale.US,"$%.2f",me.optDouble("balance")),22,GOLD,true);content.addView(b);addGap(content,14);JSONArray methods=config.optJSONArray("paymentMethods");if(methods==null||methods.length()==0){content.addView(text("لا توجد طرق دفع مفعلة حاليًا",13,MUTED,false));return;}TextView choose=text("اختر طريقة الدفع",13,TEXT,true);content.addView(choose);addGap(content,8);java.util.List<View> cards=new ArrayList<>();for(int i=0;i<methods.length();i++){JSONObject m=methods.optJSONObject(i);View v=catalogTile(m,false,GREEN);final String mid=m.optString("id");v.setOnClickListener(x->{selectedPaymentId=mid;openTopupForm(m);});cards.add(v);}addGridCards(cards);}
'''
if old_wallet not in s: raise SystemExit('wallet anchor missing')
s=s.replace(old_wallet,new_wallet,1)

main.write_text(s,encoding='utf-8')

# Version bump.
build=ROOT/'android/handoff/client/build.gradle.kts'
b=build.read_text(encoding='utf-8').replace('versionCode = 30','versionCode = 31').replace('versionName = "3.0.0"','versionName = "3.1.0"')
build.write_text(b,encoding='utf-8')

# Update post-deploy TTL assertion from 10 min to 5 min.
wf=ROOT/'.github/workflows/game-zone-native-v3-postdeploy-verify.yml'
if wf.exists():
    w=wf.read_text(encoding='utf-8').replace('!==600000','!==300000').replace("ACTIVATION_TTL_SECONDS=600","ACTIVATION_TTL_SECONDS=300")
    wf.write_text(w,encoding='utf-8')

print('GAME_ZONE_CLIENT_V31_IMPLEMENTED=YES')
