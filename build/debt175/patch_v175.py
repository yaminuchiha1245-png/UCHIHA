#!/usr/bin/env python3
"""Apply v1.5.25 product media path fix on top of v1.5.24."""
from pathlib import Path
import sys

def rep(s,a,b,label):
    if a not in s:
        raise SystemExit(f"marker not found: {label}")
    return s.replace(a,b,1)

def main():
    if len(sys.argv)!=2:
        raise SystemExit("usage: patch_v175.py <debt-app>")
    app=Path(sys.argv[1]).resolve()
    buildp=app/"app"/"build.gradle"
    build=buildp.read_text(encoding="utf-8")
    if "versionCode 1052400" not in build or "versionName '1.5.24'" not in build:
        raise SystemExit("unexpected v1.5.24 baseline")

    jsp=app/"app"/"src"/"main"/"assets"/"app-v170.js"
    js=jsp.read_text(encoding="utf-8")

    old="""  if(/^cat_[^/]+\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(v))return'https://js4card.com/uploads/categories/'+v;
  if(/\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(v)&&!v.includes(' '))return'https://js4card.com/'+v.replace(/^\/+/, '');"""
    new="""  if(/^cat_[^/]+\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(v))return'https://js4card.com/uploads/categories/'+v;
  if(/^prod_[^/]+\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(v))return'https://js4card.com/uploads/products/'+v;
  if(/^product_[^/]+\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(v))return'https://js4card.com/uploads/products/'+v;
  if(/\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(v)&&!v.includes(' '))return'https://js4card.com/'+v.replace(/^\/+/, '');"""
    js=rep(js,old,new,"product media path")

    # Keep product cards strict: only real product media, never a parent/category picture.
    if "imgMarkup(p,nearestPathImage())" in js:
        js=js.replace("imgMarkup(p,nearestPathImage())","imgMarkup(p)")

    jsp.write_text(js,encoding="utf-8")

    syncp=app/"app"/"src"/"main"/"assets"/"sync-v165.js"
    sync=syncp.read_text(encoding="utf-8")
    sync=rep(sync,"const SYNC_VERSION='1.5.24';","const SYNC_VERSION='1.5.25';","sync version")
    syncp.write_text(sync,encoding="utf-8")

    build=build.replace("versionCode 1052400","versionCode 1052500",1)
    build=build.replace("versionName '1.5.24'","versionName '1.5.25'",1)
    buildp.write_text(build,encoding="utf-8")

if __name__=="__main__":
    main()
