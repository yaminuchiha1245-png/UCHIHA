#!/usr/bin/env python3
"""Apply v1.5.23 product image inheritance + hero asset fix on top of v1.5.22."""
from pathlib import Path
import sys

def rep(s,a,b,label):
    if a not in s: raise SystemExit(f"marker not found: {label}")
    return s.replace(a,b,1)

def main():
    if len(sys.argv)!=2: raise SystemExit("usage: patch_v173.py <debt-app>")
    app=Path(sys.argv[1]).resolve()
    buildp=app/"app"/"build.gradle"
    build=buildp.read_text()
    if "versionCode 1052200" not in build or "versionName '1.5.22'" not in build:
        raise SystemExit("unexpected baseline")
    jsp=app/"app"/"src"/"main"/"assets"/"app-v170.js"
    js=jsp.read_text()
    js=rep(js,'src="digital-hero-v158.webp"','src="digital-hero-v163.webp"',"hero asset")
    js=rep(
      js,
      "products.map(p=>'<button class="digital-card" data-product-id="'+Number(p.id||0)+'" onclick="DigitalStore.product('+Number(p.id||0)+')"><div class="digital-card-media">'+imgMarkup(p)+'</div>",
      "products.map(p=>'<button class="digital-card" data-product-id="'+Number(p.id||0)+'" onclick="DigitalStore.product('+Number(p.id||0)+')"><div class="digital-card-media">'+imgMarkup(p,nearestPathImage())+'</div>",
      "product image inheritance"
    )
    jsp.write_text(js)
    syncp=app/"app"/"src"/"main"/"assets"/"sync-v165.js"
    sync=syncp.read_text()
    sync=rep(sync,"const SYNC_VERSION='1.5.22';","const SYNC_VERSION='1.5.23';","sync version")
    syncp.write_text(sync)
    build=build.replace("versionCode 1052200","versionCode 1052300",1).replace("versionName '1.5.22'","versionName '1.5.23'",1)
    buildp.write_text(build)
if __name__=="__main__": main()
