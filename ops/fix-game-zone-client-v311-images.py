from pathlib import Path

main=Path('android/handoff/client/src/main/java/com/gamezone/store/MainActivity.java')
s=main.read_text(encoding='utf-8')
old='''    ImageView image=new ImageView(this);image.setScaleType(ImageView.ScaleType.CENTER_CROP);media.addView(image,new FrameLayout.LayoutParams(-1,-1));
    TextView fallback=text("GAME ZONE",14,MUTED,true);fallback.setGravity(Gravity.CENTER);media.addView(fallback,new FrameLayout.LayoutParams(-1,-1));'''
new='''    TextView fallback=text("GAME ZONE",14,MUTED,true);fallback.setGravity(Gravity.CENTER);media.addView(fallback,new FrameLayout.LayoutParams(-1,-1));
    ImageView image=new ImageView(this);image.setScaleType(ImageView.ScaleType.CENTER_CROP);media.addView(image,new FrameLayout.LayoutParams(-1,-1));'''
if old not in s:
    raise SystemExit('catalog image z-order anchor missing')
s=s.replace(old,new,1)
main.write_text(s,encoding='utf-8')

build=Path('android/handoff/client/build.gradle.kts')
b=build.read_text(encoding='utf-8')
b=b.replace('versionCode = 31','versionCode = 32').replace('versionName = "3.1.0"','versionName = "3.1.1"')
if 'versionName = "3.1.1"' not in b:
    raise SystemExit('version bump failed')
build.write_text(b,encoding='utf-8')
print('GAME_ZONE_CLIENT_V311_IMAGE_POLISH=YES')
