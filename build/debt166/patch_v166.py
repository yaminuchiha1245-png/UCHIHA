#!/usr/bin/env python3
"""Apply v1.5.16 provider-media fix on top of v1.5.15."""
from pathlib import Path
import sys

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"marker not found: {label}")
    return text.replace(old, new, 1)

def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_v166.py <debt-app>")
    app=Path(sys.argv[1]).resolve()
    build_path=app/"app"/"build.gradle"
    if not build_path.is_file():
        raise SystemExit("not an Android source tree")
    build=build_path.read_text(encoding="utf-8")
    if "versionCode 1051500" not in build or "versionName '1.5.15'" not in build:
        raise SystemExit("unexpected v1.5.15 baseline")

    js_path=app/"app"/"src"/"main"/"assets"/"app-v164.js"
    js=js_path.read_text(encoding="utf-8")

    old_media="""  if(/^(uploads|storage|images|media|assets)\\//i.test(v))return'https://js4card.com/'+v;
  if(/\\.(png|jpe?g|webp|gif|svg)(\\?.*)?$/i.test(v)&&!v.includes(' '))return'https://js4card.com/'+v.replace(/^\\/+/, '');
  return'';
}"""
    new_media="""  if(/^(uploads|storage|images|media|assets)\\//i.test(v))return'https://js4card.com/'+v;
  if(/^cat_[^/]+\\.(png|jpe?g|webp|gif|svg)(\\?.*)?$/i.test(v))return'https://js4card.com/uploads/categories/'+v;
  if(/\\.(png|jpe?g|webp|gif|svg)(\\?.*)?$/i.test(v)&&!v.includes(' '))return'https://js4card.com/'+v.replace(/^\\/+/, '');
  return'';
}"""
    js=replace_once(js,old_media,new_media,"provider category image base")

    old_img="""function imgMarkup(item){
  const src=imageOf(item),art=artFallback(item);
  const remote=src?'<div class="digital-card-photo" style="background-image:url(&quot;'+safe(src)+'&quot;)"></div>':'';
  return '<div class="digital-card-fallback">'+art+'</div>'+remote;
}"""
    new_img="""function imgMarkup(item,fallbackItem=null){
  const src=imageOf(item)||imageOf(fallbackItem),art=artFallback(item||fallbackItem||{});
  const remote=src?'<div class="digital-card-photo" style="background-image:url(&quot;'+safe(src)+'&quot;)"></div>':'';
  return '<div class="digital-card-fallback">'+art+'</div>'+remote;
}
function nearestPathImage(){
  for(let i=path.length-1;i>=0;i--){if(imageOf(path[i]))return path[i]}
  return null;
}"""
    js=replace_once(js,old_img,new_img,"inherit category media")

    old_products="""return '<div class="digital-grid">'+products.map(p=>'<button class="digital-card" onclick="DigitalStore.product('+Number(p.id||0)+')"><div class="digital-card-media">'+imgMarkup(p)+'</div><div class="digital-card-name">'+safe(nameOf(p))+'</div><div class="digital-card-price">'+safe(money(priceOf(p)))+'</div></button>').join('')+'</div>';"""
    new_products="""return '<div class="digital-grid">'+products.map(p=>'<button class="digital-card" onclick="DigitalStore.product('+Number(p.id||0)+')"><div class="digital-card-media">'+imgMarkup(p,nearestPathImage())+'</div><div class="digital-card-name">'+safe(nameOf(p))+'</div><div class="digital-card-price">'+safe(money(priceOf(p)))+'</div></button>').join('')+'</div>';"""
    js=replace_once(js,old_products,new_products,"product image inheritance")

    js_path.write_text(js,encoding="utf-8")
    build=build.replace("versionCode 1051500","versionCode 1051600",1)
    build=build.replace("versionName '1.5.15'","versionName '1.5.16'",1)
    build_path.write_text(build,encoding="utf-8")

if __name__=="__main__":
    main()
