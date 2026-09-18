#!/usr/bin/env python3
"""Overlay the v1.4.6 digital-products preview onto reconstructed v1.4.5."""
from pathlib import Path
import shutil
import sys


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"marker not found: {label}")
    return text.replace(old, new, 1)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_v146.py <debt-app>")
    app = Path(sys.argv[1]).resolve()
    build_path = app / "app" / "build.gradle"
    if not build_path.is_file():
        raise SystemExit(f"not an Android source tree: {app}")

    build = build_path.read_text(encoding="utf-8")
    if "versionCode 1040500" not in build or "versionName '1.4.5'" not in build:
        raise SystemExit("unexpected v1.4.5 baseline; refusing to overlay")

    here = Path(__file__).resolve().parent
    overlay = here / "overlay"
    for source in overlay.rglob("*"):
        if source.is_file():
            relative = source.relative_to(overlay)
            target = app / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)

    assets = app / "app" / "src" / "main" / "assets"
    repo_root = here.parents[1]
    hero = repo_root / "static" / "uchiha-hero-market.webp"
    if not hero.is_file():
        raise SystemExit("digital hero asset is missing")
    shutil.copy2(hero, assets / "digital-hero.webp")

    js_path = assets / "app-v146.js"
    js = js_path.read_text(encoding="utf-8")

    js = replace_once(
        js,
        "function hero(){\n  return '<section class=\"digital-hero\"><div class=\"digital-hero-copy\"><b><em>DIGITAL</em><br>WORLD<br>WITH <em>UCHIHA</em></b><span>كل ما تحتاجه في مكان واحد</span></div></section>';\n}",
        "function hero(){\n  return '<section class=\"digital-hero\"><img class=\"digital-hero-image\" src=\"digital-hero.webp\" alt=\"\"></section>';\n}",
        "approved hero",
    )

    js = js.replace(
        "if(typeof v==='string'&&/^https?:\\/\\//i.test(v))return v;",
        "if(typeof v==='string'&&/^(https?:\\/\\/|data:image\\/)/i.test(v))return v;",
    ).replace(
        "if(typeof u==='string'&&/^https?:\\/\\//i.test(u))return u;",
        "if(typeof u==='string'&&/^(https?:\\/\\/|data:image\\/)/i.test(u))return u;",
    )

    marker = "let proofData='',proofName='',adminTab='config',adminData={},busy=false;"
    demo = r'''
const demoImage=(label,color)=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360"><rect width="360" height="360" rx="48" fill="#052219"/><circle cx="180" cy="145" r="92" fill="'+color+'" fill-opacity=".28"/><text x="180" y="175" text-anchor="middle" font-size="72" font-family="sans-serif" fill="'+color+'">'+label+'</text></svg>');
const DEMO_ROOT=[
 {id:101,name:'المشاهدة',image:demoImage('▶','#27e59c')},
 {id:102,name:'الألعاب',image:demoImage('GAME','#8e55ff')},
 {id:103,name:'بطاقات الإتصال',image:demoImage('SIM','#ffbc35')},
 {id:104,name:'الأرقام',image:demoImage('☎','#ff76b7')},
 {id:105,name:'الرشق',image:demoImage('SMM','#5a9cff')},
 {id:106,name:'العملات الرقمية',image:demoImage('₿','#ffb419')},
 {id:107,name:'الحسابات',image:demoImage('ACC','#6f8fff')},
 {id:108,name:'برامج التصميم',image:demoImage('DES','#58a2ff')},
 {id:109,name:'البطاقات',image:demoImage('CARD','#31e39a')}
];
const DEMO_GAMES=[
 {id:201,name:'Free Fire',image:demoImage('FF','#5667ff')},
 {id:202,name:'PUBG Mobile',image:demoImage('PUBG','#e8aa2d')},
 {id:203,name:'Call of Duty',image:demoImage('COD','#ed5738')},
 {id:204,name:'eFootball',image:demoImage('EF','#4658ff')},
 {id:205,name:'Mobile Legends',image:demoImage('ML','#32afe8')},
 {id:206,name:'Genshin Impact',image:demoImage('GI','#6dc4ff')}
];
const DEMO_FF=[
 {id:301,name:'جواهر',image:demoImage('◆','#39c9ff')},
 {id:302,name:'تصاريح',image:demoImage('★','#ffbd28')},
 {id:303,name:'عضويات',image:demoImage('VIP','#e8ac38')},
 {id:304,name:'حسابات',image:demoImage('ACC','#e86dab')},
 {id:305,name:'بطاقات',image:demoImage('CARD','#41dfa0')},
 {id:306,name:'أخرى',image:demoImage('•••','#829b8f')}
];
const DEMO_PRODUCTS=[
 {id:401,name:'110 جوهرة',price:.955,image:demoImage('110','#5968ff'),product_type:'package',params:[{name:'playerId',label:'Player ID',required:true}]},
 {id:402,name:'231 جوهرة',price:1.910,image:demoImage('231','#5968ff'),product_type:'package',params:[{name:'playerId',label:'Player ID',required:true}]},
 {id:403,name:'583 جوهرة',price:4.774,image:demoImage('583','#5968ff'),product_type:'package',params:[{name:'playerId',label:'Player ID',required:true}]},
 {id:404,name:'1188 جوهرة',price:9.548,image:demoImage('1188','#5968ff'),product_type:'package',params:[{name:'playerId',label:'Player ID',required:true}]},
 {id:405,name:'2420 جوهرة',price:19.095,image:demoImage('2420','#5968ff'),product_type:'package',params:[{name:'playerId',label:'Player ID',required:true}]}
];
function demoCatalog(id){
 id=Number(id||0);
 if(id===0)return{categories:DEMO_ROOT,products:[]};
 if(id===102)return{categories:DEMO_GAMES,products:[]};
 if(id===201)return{categories:DEMO_FF,products:[]};
 if(id===301)return{categories:[],products:DEMO_PRODUCTS};
 return{categories:[],products:[]};
}
'''
    js = replace_once(js, marker, marker + demo, "demo preview data")

    js = replace_once(
        js,
        """async function loadCatalog(categoryId=0){
  loading=true;storeScreen();
  const r=await call('digital_catalog',{category_id:categoryId});
  loading=false;
  if(!r.ok){catalog={categories:[],products:[]};storeScreen();notify(errorText(r.error),true);return;}
  catalog=arrays(r.data);storeScreen();
}""",
        """async function loadCatalog(categoryId=0){
  loading=true;storeScreen();
  const r=await call('digital_catalog',{category_id:categoryId});
  loading=false;
  if(!r.ok){catalog=demoCatalog(categoryId);storeScreen();return;}
  catalog=arrays(r.data);storeScreen();
}""",
        "catalog preview fallback",
    )

    js = replace_once(
        js,
        "async product(id){const r=await call('digital_product',{product_id:id});if(!r.ok){notify(errorText(r.error),true);return;}selectedProduct=r.product;mode='product';productScreen()},",
        "async product(id){const local=(catalog.products||[]).find(x=>Number(x.id)===Number(id));const r=await call('digital_product',{product_id:id});if(!r.ok){if(local){selectedProduct=local;mode='product';productScreen();return;}notify(errorText(r.error),true);return;}selectedProduct=r.product;mode='product';productScreen()},",
        "product preview fallback",
    )

    js = replace_once(
        js,
        "async loadAdmin(){let action='owner_digital_config_get';if(adminTab==='wallets')action='owner_digital_wallets';if(adminTab==='topups')action='owner_digital_topups';if(adminTab==='orders')action='owner_digital_orders';const r=await call(action);if(!r.ok){notify(errorText(r.error),true);return;}if(adminTab==='config')adminData.config=r;else adminData[adminTab]=r.items||[];renderAdmin()},",
        "async loadAdmin(){let action='owner_digital_config_get';if(adminTab==='wallets')action='owner_digital_wallets';if(adminTab==='topups')action='owner_digital_topups';if(adminTab==='orders')action='owner_digital_orders';const r=await call(action);if(!r.ok){if(adminTab==='config')adminData.config={provider_configured:false,shamcash_account:'',support_whatsapp:'963942586044'};else adminData[adminTab]=[];renderAdmin();return;}if(adminTab==='config')adminData.config=r;else adminData[adminTab]=r.items||[];renderAdmin()},",
        "admin preview fallback",
    )

    js_path.write_text(js, encoding="utf-8")

    css_path = assets / "app-v146.css"
    css = css_path.read_text(encoding="utf-8")
    css += """
.digital-hero{background:#00170f!important}
.digital-hero:before,.digital-hero:after{display:none!important}
.digital-hero-image{display:block;width:100%;height:100%;object-fit:cover}
"""
    css_path.write_text(css, encoding="utf-8")

    index_path = assets / "index.html"
    index = index_path.read_text(encoding="utf-8")
    index = replace_once(index, '<link rel="stylesheet" href="app-v145.css">', '<link rel="stylesheet" href="app-v145.css">\n  <link rel="stylesheet" href="app-v146.css">', "v146 css")
    index = replace_once(index, '<script src="app-v145.js"></script>', '<script src="app-v145.js"></script>\n  <script src="app-v146.js"></script>', "v146 js")
    index_path.write_text(index, encoding="utf-8")

    debt_service = app / "app" / "src" / "main" / "java" / "com" / "uchiha" / "debtstore" / "DebtService.java"
    service = debt_service.read_text(encoding="utf-8")
    old_allowed = '"owner_create","owner_list","owner_backups","owner_download","owner_set_active","owner_reset_device","owner_audit"));'
    new_allowed = '"owner_create","owner_list","owner_backups","owner_download","owner_set_active","owner_reset_device","owner_audit",\n        "digital_catalog","digital_product","digital_purchase","digital_wallet","digital_topup_create","digital_latest",\n        "owner_digital_config_get","owner_digital_config_set","owner_digital_wallets","owner_digital_wallet_adjust",\n        "owner_digital_topups","owner_digital_topup_review","owner_digital_orders","owner_digital_order_update"));'
    service = replace_once(service, old_allowed, new_allowed, "DebtService digital actions")
    debt_service.write_text(service, encoding="utf-8")

    main_activity = app / "app" / "src" / "main" / "java" / "com" / "uchiha" / "debtstore" / "MainActivity.java"
    java = main_activity.read_text(encoding="utf-8")
    java = replace_once(
        java,
        "private static final int BARCODE_PHOTO_REQUEST = 4312;",
        "private static final int BARCODE_PHOTO_REQUEST = 4312;\n    private static final int DIGITAL_PROOF_REQUEST = 4416;",
        "proof request code",
    )
    activity_handler = r'''        if (requestCode == DIGITAL_PROOF_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                Uri uri = data.getData();
                ioExecutor.execute(() -> {
                    try (InputStream in = getContentResolver().openInputStream(uri)) {
                        if (in == null) throw new IOException("تعذر قراءة الصورة");
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        byte[] chunk = new byte[8192];
                        int count;
                        while ((count = in.read(chunk)) != -1) {
                            if (out.size() + count > 2_000_000) throw new IOException("الصورة كبيرة");
                            out.write(chunk, 0, count);
                        }
                        String mime = getContentResolver().getType(uri);
                        if (mime == null || !(mime.equals("image/png") || mime.equals("image/jpeg") || mime.equals("image/webp"))) mime = "image/jpeg";
                        String encoded = android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP);
                        String dataUrl = "data:" + mime + ";base64," + encoded;
                        js("window.onDigitalProofPicked && window.onDigitalProofPicked(" + JSONObject.quote(dataUrl) + "," + JSONObject.quote("إثبات التحويل") + ")");
                    } catch (Exception e) {
                        toast("تعذر قراءة صورة إثبات التحويل");
                        js("window.onDigitalProofCancelled && window.onDigitalProofCancelled()");
                    }
                });
            } else {
                js("window.onDigitalProofCancelled && window.onDigitalProofCancelled()");
            }
            return;
        }
'''
    java = replace_once(java, "        if (requestCode == PICK_BACKUP_REQUEST) {", activity_handler + "        if (requestCode == PICK_BACKUP_REQUEST) {", "proof activity result")
    bridge_methods = r'''        @JavascriptInterface
        public void pickDigitalProof() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                try { startActivityForResult(intent, DIGITAL_PROOF_REQUEST); }
                catch (ActivityNotFoundException e) { toast("لا يوجد مدير صور متاح"); }
            });
        }

        @JavascriptInterface
        public String qrDataUrl(String text) {
            try {
                String value = text == null ? "" : text.trim();
                if (value.isEmpty() || value.length() > 300) return "";
                com.google.zxing.common.BitMatrix matrix =
                    new com.google.zxing.MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, 420, 420);
                Bitmap bitmap = Bitmap.createBitmap(420, 420, Bitmap.Config.ARGB_8888);
                for (int y = 0; y < 420; y++) for (int x = 0; x < 420; x++)
                    bitmap.setPixel(x, y, matrix.get(x, y) ? Color.BLACK : Color.WHITE);
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
                return "data:image/png;base64," + android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP);
            } catch (Exception e) { return ""; }
        }

'''
    java = replace_once(java, "        @JavascriptInterface\n        public void notifyUser(String title, String body) {", bridge_methods + "        @JavascriptInterface\n        public void notifyUser(String title, String body) {", "digital bridge methods")
    main_activity.write_text(java, encoding="utf-8")

    build = build.replace("versionCode 1040500", "versionCode 1040600", 1)
    build = build.replace("versionName '1.4.5'", "versionName '1.4.6'", 1)
    build_path.write_text(build, encoding="utf-8")


if __name__ == "__main__":
    main()
