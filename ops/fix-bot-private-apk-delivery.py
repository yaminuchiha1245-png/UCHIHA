from pathlib import Path

p=Path('bot/bot.js')
s=p.read_text()

marker='// GAME_ZONE_PRIVATE_APK_DELIVERY_V1'
if marker in s:
    raise SystemExit(0)

const_anchor='const ANDROID_APK_URL=String(process.env.ANDROID_APK_URL||"https://github.com/yaminuchiha1245-png/UCHIHA/releases/download/game-zone-client-v3.1.2/Game-Zone-Client-v3.1.2.apk").trim();\n'
if const_anchor not in s:
    raise SystemExit('ANDROID_APK_URL anchor not found')

const_block=const_anchor+'''// GAME_ZONE_PRIVATE_APK_DELIVERY_V1
const ANDROID_APK_FILENAME=String(process.env.ANDROID_APK_FILENAME||"Game-Zone.apk").trim().replace(/[^A-Za-z0-9._-]/g,"-")||"Game-Zone.apk";
const ANDROID_APK_MAX_BYTES=Math.max(1024*1024,Math.min(50*1024*1024,Number(process.env.ANDROID_APK_MAX_BYTES||20*1024*1024)));
let androidApkCache=null;
'''
s=s.replace(const_anchor,const_block,1)

api_anchor='async function apiBinary(pathname, admin=false) {'
idx=s.find(api_anchor)
if idx<0:
    raise SystemExit('apiBinary anchor not found')
# Insert helper before apiBinary.
helper='''// GAME_ZONE_PRIVATE_APK_DELIVERY_V1_HELPER
async function getAndroidApkBuffer(){
  if(androidApkCache?.buffer?.length)return androidApkCache;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  try{
    const r=await fetch(ANDROID_APK_URL,{redirect:"follow",signal:controller.signal,headers:{"user-agent":"GameZoneBot/1.0"}});
    if(!r.ok)throw new Error(`apk_download_${r.status}`);
    const declared=Number(r.headers.get("content-length")||0);
    if(Number.isFinite(declared)&&declared>ANDROID_APK_MAX_BYTES)throw new Error("apk_too_large");
    const buffer=Buffer.from(await r.arrayBuffer());
    if(!buffer.length||buffer.length>ANDROID_APK_MAX_BYTES)throw new Error("apk_size_invalid");
    // APK files are ZIP containers and should start with a PK signature.
    if(buffer.length<4||buffer[0]!==0x50||buffer[1]!==0x4b)throw new Error("apk_signature_invalid");
    androidApkCache={buffer,loadedAt:Date.now()};
    return androidApkCache;
  }catch(e){
    if(e?.name==="AbortError")throw new Error("apk_download_timeout");
    throw e;
  }finally{clearTimeout(timer)}
}
async function sendAndroidApk(ctx,caption){
  const apk=await getAndroidApkBuffer();
  return ctx.replyWithDocument(
    {source:apk.buffer,filename:ANDROID_APK_FILENAME},
    {caption,parse_mode:"HTML"}
  );
}

'''
s=s[:idx]+helper+s[idx:]

old='''    const keyboard=Markup.inlineKeyboard([[Markup.button.url("📥 تحميل تطبيق المتجر",ANDROID_APK_URL)]]);
    try{
      await ctx.replyWithDocument({url:ANDROID_APK_URL},{caption,parse_mode:"HTML",...keyboard});
    }catch{
      await ctx.reply(caption,{parse_mode:"HTML",...keyboard});
    }
'''
new='''    await sendAndroidApk(ctx,caption);
'''
if old not in s:
    raise SystemExit('android_link URL delivery block not found')
s=s.replace(old,new,1)

old_error='''  }catch(e){
    await ctx.reply("تعذر تجهيز رابط التطبيق الآن. حاول مرة أخرى بعد قليل.");
  }
});
'''
new_error='''  }catch(e){
    console.error("ANDROID APK DELIVERY",String(e?.message||e).slice(0,160));
    await ctx.reply("تعذر تجهيز ملف التطبيق الآن. حاول مرة أخرى بعد قليل.");
  }
});
'''
# Only replace the first matching block after android_link section.
start=s.find('bot.action("android_link"')
pos=s.find(old_error,start)
if pos<0:
    raise SystemExit('android_link error block not found')
s=s[:pos]+s[pos:].replace(old_error,new_error,1)

# Safety: no URL button or remote-url document sending should remain in android_link block.
start=s.find('bot.action("android_link"')
end=s.find('bot.action("account"',start)
block=s[start:end]
if 'Markup.button.url("📥 تحميل تطبيق المتجر"' in block or 'replyWithDocument({url:ANDROID_APK_URL}' in block:
    raise SystemExit('GitHub URL exposure remains in android_link block')
if 'sendAndroidApk(ctx,caption)' not in block:
    raise SystemExit('private APK sender missing')

p.write_text(s)
