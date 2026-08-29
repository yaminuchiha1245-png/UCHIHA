from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv)>1 else 'debt-app')
js = root/'app/src/main/assets/app.js'
s = js.read_text(encoding='utf-8')

old_pin = '''function pinHash(pin){
  let h = 2166136261 >>> 0;
  const s = 'UCHIHA::' + String(pin);
  for(let r=0;r<2500;r++) for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i) + r; h = Math.imul(h,16777619) >>> 0; }
  return ('00000000'+h.toString(16)).slice(-8);
}
'''
new_pin = '''function legacyPinHash(pin){
  let h = 2166136261 >>> 0;
  const s = 'UCHIHA::' + String(pin);
  for(let r=0;r<2500;r++) for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i) + r; h = Math.imul(h,16777619) >>> 0; }
  return ('00000000'+h.toString(16)).slice(-8);
}
function pinHash(pin){
  try{ if(window.Android?.hashPin) return Android.hashPin(String(pin)); }catch(e){}
  return legacyPinHash(pin);
}
function verifyPinAccount(account,pin){
  if(!account) return false;
  const strong=pinHash(pin);
  if(account.pinHash===strong) return true;
  const legacy=legacyPinHash(pin);
  if(account.pinHash===legacy){ account.pinHash=strong; saveState(); return true; }
  return false;
}
'''
if old_pin in s:
    s=s.replace(old_pin,new_pin,1)
elif 'function legacyPinHash(pin)' not in s:
    raise SystemExit('PIN hash block not found')

old_load='''function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return baseState();
    const s = JSON.parse(raw);
    const b = baseState();
    return {...b,...s,shop:{...b.shop,...(s.shop||{})},rates:{...b.rates,...(s.rates||{})},settings:{...b.settings,...(s.settings||{})}};
  }catch(e){ return baseState(); }
}
'''
new_load='''function normalizeState(s){
  const b=baseState();
  return {...b,...s,shop:{...b.shop,...(s.shop||{})},rates:{...b.rates,...(s.rates||{})},settings:{...b.settings,...(s.settings||{})}};
}
function loadState(){
  try{
    let raw='';
    let nativeSecure=false;
    try{
      if(window.Android?.loadSecureState){ nativeSecure=true; raw=Android.loadSecureState()||''; }
    }catch(e){}
    if(!raw){
      raw=localStorage.getItem(STORAGE_KEY)||'';
      if(raw && nativeSecure){
        try{ Android.saveSecureState(raw); localStorage.removeItem(STORAGE_KEY); }catch(e){}
      }
    }
    if(!raw) return baseState();
    return normalizeState(JSON.parse(raw));
  }catch(e){ return baseState(); }
}
'''
if old_load in s:
    s=s.replace(old_load,new_load,1)
elif 'function normalizeState(s)' not in s:
    raise SystemExit('loadState block not found')

old_save='''function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
'''
new_save='''function saveState(){
  const raw=JSON.stringify(state);
  try{
    if(window.Android?.saveSecureState){ Android.saveSecureState(raw); localStorage.removeItem(STORAGE_KEY); return; }
  }catch(e){}
  localStorage.setItem(STORAGE_KEY,raw);
}
'''
if old_save in s:
    s=s.replace(old_save,new_save,1)
elif 'Android.saveSecureState(raw)' not in s:
    raise SystemExit('saveState block not found')

anchor="let clientLedgerQuery = '';\n"
if 'let pinFailCount = 0;' not in s:
    s=s.replace(anchor,anchor+"let pinFailCount = 0;\nlet pinLockedUntil = 0;\n",1)

old_unlock="""function unlockPin(){
  const a=state.accounts.find(x=>x.id===state.activeAccountId), pin=$('lockPin').value;
  if(!a||pinHash(pin)!==a.pinHash){toast('PIN غير صحيح');return;}
  sessionAccountId=a.id; audit('تسجيل دخول'); view='home'; render(); ensureRatesFresh();
}
"""
new_unlock="""function unlockPin(){
  const a=state.accounts.find(x=>x.id===state.activeAccountId), pin=$('lockPin').value;
  if(Date.now()<pinLockedUntil){toast('محاولات كثيرة، انتظر قليلًا');return;}
  if(!verifyPinAccount(a,pin)){
    pinFailCount++;
    if(pinFailCount>=5){pinFailCount=0;pinLockedUntil=Date.now()+30000;toast('تم إيقاف المحاولة 30 ثانية');}
    else toast('PIN غير صحيح');
    return;
  }
  pinFailCount=0;pinLockedUntil=0;sessionAccountId=a.id; audit('تسجيل دخول'); view='home'; render(); ensureRatesFresh();
}
"""
if old_unlock in s:
    s=s.replace(old_unlock,new_unlock,1)
elif 'pinLockedUntil' not in s[s.find('function unlockPin'):s.find('function unlockBiometric')]:
    raise SystemExit('unlockPin block not found')

s=s.replace("function confirmPinSensitive(){const a=currentAccount();if(!a||pinHash($('confirmPin').value)!==a.pinHash){toast('PIN غير صحيح');return;}",
            "function confirmPinSensitive(){const a=currentAccount();if(!verifyPinAccount(a,$('confirmPin').value)){toast('PIN غير صحيح');return;}",1)

s=s.replace('تشمل العملاء، دفتر الحساب، الدفعات، المؤجل، النواقص، الحسابات والإعدادات.</div>',
            'تشمل العملاء، دفتر الحساب، الدفعات، المؤجل، النواقص، الحسابات والإعدادات. <b>الملف حساس؛ احتفظ به في مكان خاص.</b></div>',1)

js.write_text(s,encoding='utf-8')

java = root/'app/src/main/java/com/uchiha/debtstore/MainActivity.java'
j=java.read_text(encoding='utf-8')

for imp in ['import android.content.SharedPreferences;','import android.security.keystore.KeyGenParameterSpec;','import android.security.keystore.KeyProperties;','import android.util.Base64;','import android.webkit.WebResourceRequest;']:
    if imp not in j:
        marker='import android.content.Context;\n'
        j=j.replace(marker,marker+imp+'\n',1)
for imp in ['import java.security.KeyStore;','import javax.crypto.Cipher;','import javax.crypto.KeyGenerator;','import javax.crypto.SecretKey;','import javax.crypto.SecretKeyFactory;','import javax.crypto.spec.GCMParameterSpec;','import javax.crypto.spec.PBEKeySpec;']:
    if imp not in j:
        marker='import java.text.SimpleDateFormat;\n'
        j=j.replace(marker,imp+'\n'+marker,1)

const_anchor='    private static final String CHANNEL_ID = "debt_alerts";\n'
if 'STATE_KEY_ALIAS' not in j:
    j=j.replace(const_anchor,const_anchor+'''    private static final String SECURE_PREFS = "uchiha_secure_state_v1";\n    private static final String STATE_KEY_ALIAS = "uchiha_debt_state_key_v1";\n    private static final String PIN_SALT = "UCHIHA-DEBT-STORE-PIN-v2";\n''',1)

old_client='''        settings.setAllowFileAccess(true);\n        settings.setAllowContentAccess(true);\n        settings.setCacheMode(WebSettings.LOAD_DEFAULT);\n        settings.setMediaPlaybackRequiresUserGesture(true);\n        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);\n        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);\n\n        webView.setWebViewClient(new WebViewClient());\n        webView.setWebChromeClient(new WebChromeClient());\n'''
new_client='''        settings.setAllowFileAccess(true);\n        settings.setAllowContentAccess(false);\n        settings.setAllowFileAccessFromFileURLs(false);\n        settings.setAllowUniversalAccessFromFileURLs(false);\n        settings.setBlockNetworkLoads(true);\n        settings.setCacheMode(WebSettings.LOAD_DEFAULT);\n        settings.setMediaPlaybackRequiresUserGesture(true);\n        settings.setSupportMultipleWindows(false);\n        settings.setGeolocationEnabled(false);\n        WebView.setWebContentsDebuggingEnabled(false);\n        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);\n        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);\n\n        webView.setWebViewClient(new WebViewClient() {\n            private boolean handle(Uri uri) {\n                if (uri == null) return true;\n                String scheme = uri.getScheme();\n                String url = uri.toString();\n                if ("file".equalsIgnoreCase(scheme) && url.startsWith("file:///android_asset/")) return false;\n                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {\n                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}\n                }\n                return true;\n            }\n            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return handle(request.getUrl()); }\n            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return handle(Uri.parse(url)); }\n        });\n        webView.setWebChromeClient(new WebChromeClient());\n'''
if old_client in j:
    j=j.replace(old_client,new_client,1)
elif 'settings.setBlockNetworkLoads(true);' not in j:
    raise SystemExit('WebView settings block not found')

method_anchor='    private String trim(String s, int max) {\n'
if 'private SecretKey getOrCreateStateKey()' not in j:
    methods=r'''    private SecretKey getOrCreateStateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        KeyStore.Entry existing = keyStore.getEntry(STATE_KEY_ALIAS, null);
        if (existing instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) existing).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                STATE_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    private String encryptState(String plain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateStateKey());
        byte[] iv = cipher.getIV();
        byte[] encrypted = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(iv, Base64.NO_WRAP) + "." + Base64.encodeToString(encrypted, Base64.NO_WRAP);
    }

    private String decryptState(String packed) throws Exception {
        int dot = packed.indexOf('.');
        if (dot <= 0) throw new IOException("bad encrypted state");
        byte[] iv = Base64.decode(packed.substring(0, dot), Base64.NO_WRAP);
        byte[] encrypted = Base64.decode(packed.substring(dot + 1), Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateStateKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    private synchronized void saveSecureStateInternal(String json) {
        try {
            new JSONObject(json);
            SharedPreferences prefs = getSharedPreferences(SECURE_PREFS, MODE_PRIVATE);
            String current = prefs.getString("state", null);
            String prev1 = prefs.getString("state_prev1", null);
            String prev2 = prefs.getString("state_prev2", null);
            SharedPreferences.Editor e = prefs.edit();
            if (prev2 != null) e.putString("state_prev3", prev2);
            if (prev1 != null) e.putString("state_prev2", prev1);
            if (current != null) e.putString("state_prev1", current);
            e.putString("state", encryptState(json));
            if (!e.commit()) throw new IOException("state commit failed");
        } catch (Exception ex) {
            throw new RuntimeException("secure state save failed", ex);
        }
    }

    private synchronized String loadSecureStateInternal() {
        SharedPreferences prefs = getSharedPreferences(SECURE_PREFS, MODE_PRIVATE);
        String[] slots = {"state", "state_prev1", "state_prev2", "state_prev3"};
        for (String slot : slots) {
            String packed = prefs.getString(slot, null);
            if (packed == null || packed.isEmpty()) continue;
            try {
                String plain = decryptState(packed);
                new JSONObject(plain);
                if (!"state".equals(slot)) {
                    prefs.edit().putString("state", packed).commit();
                    toast("تم استرجاع آخر نسخة محلية سليمة تلقائيًا");
                }
                return plain;
            } catch (Exception ignored) {}
        }
        return "";
    }

    private String strongPinHash(String pin) {
        try {
            PBEKeySpec spec = new PBEKeySpec(String.valueOf(pin).toCharArray(), PIN_SALT.getBytes(StandardCharsets.UTF_8), 60000, 256);
            byte[] hash = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
            spec.clearPassword();
            return "v2$" + Base64.encodeToString(hash, Base64.NO_WRAP);
        } catch (Exception e) {
            return "v2$error";
        }
    }

'''
    if method_anchor not in j:
        raise SystemExit('trim anchor missing')
    j=j.replace(method_anchor,methods+method_anchor,1)

bridge_anchor='''        @JavascriptInterface\n        public void copyText(String text) {\n'''
if 'public String loadSecureState()' not in j:
    bridge_methods='''        @JavascriptInterface\n        public String loadSecureState() {\n            return loadSecureStateInternal();\n        }\n\n        @JavascriptInterface\n        public void saveSecureState(String json) {\n            saveSecureStateInternal(json);\n        }\n\n        @JavascriptInterface\n        public String hashPin(String pin) {\n            return strongPinHash(pin);\n        }\n\n'''
    if bridge_anchor not in j:
        raise SystemExit('AppBridge anchor missing')
    j=j.replace(bridge_anchor,bridge_methods+bridge_anchor,1)

java.write_text(j,encoding='utf-8')

manifest=root/'app/src/main/AndroidManifest.xml'
m=manifest.read_text(encoding='utf-8')
m=m.replace('android:allowBackup="true"','android:allowBackup="false"')
m=m.replace('        android:fullBackupContent="@xml/backup_rules"\n','')
m=m.replace('        android:dataExtractionRules="@xml/data_extraction_rules"\n','')
manifest.write_text(m,encoding='utf-8')

gradle=root/'app/build.gradle'
g=gradle.read_text(encoding='utf-8')
g=g.replace('versionCode 3','versionCode 4').replace("versionName '1.0.2'","versionName '1.0.3'")
if 'signingConfigs {' not in g:
    g=g.replace('''    buildTypes {\n''','''    signingConfigs {\n        release {\n            def ks = System.getenv('UCHIHA_KEYSTORE')\n            if (ks) {\n                storeFile file(ks)\n                storePassword System.getenv('UCHIHA_STORE_PASSWORD')\n                keyAlias System.getenv('UCHIHA_KEY_ALIAS') ?: 'uchiha-release'\n                keyPassword System.getenv('UCHIHA_KEY_PASSWORD') ?: System.getenv('UCHIHA_STORE_PASSWORD')\n            }\n        }\n    }\n\n    buildTypes {\n''',1)
    g=g.replace('''        release {\n            minifyEnabled false\n''','''        release {\n            if (System.getenv('UCHIHA_KEYSTORE')) signingConfig signingConfigs.release\n            minifyEnabled true\n''',1)
gradle.write_text(g,encoding='utf-8')

pro=root/'app/proguard-rules.pro'
p=pro.read_text(encoding='utf-8') if pro.exists() else ''
keep='''\n# Keep JavaScript bridge entry points and Activity methods used by WebView.\n-keepclassmembers class com.uchiha.debtstore.MainActivity$AppBridge {\n    @android.webkit.JavascriptInterface <methods>;\n}\n-keep class com.uchiha.debtstore.MainActivity { *; }\n'''
if 'MainActivity$AppBridge' not in p:
    pro.write_text(p+keep,encoding='utf-8')

final_js=js.read_text(encoding='utf-8')
final_java=java.read_text(encoding='utf-8')
assert 'Android.saveSecureState(raw)' in final_js
assert 'verifyPinAccount(a,pin)' in final_js
assert 'AES/GCM/NoPadding' in final_java
assert 'settings.setBlockNetworkLoads(true);' in final_java
assert 'public String hashPin(String pin)' in final_java
assert 'android:allowBackup="false"' in manifest.read_text(encoding='utf-8')
print('PATCH_V103_OK')
