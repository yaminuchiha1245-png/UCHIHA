#!/usr/bin/env python3
"""Apply v1.5.18 WhatsApp floating button polish on top of v1.5.17."""
from pathlib import Path
import sys

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"marker not found: {label}")
    return text.replace(old, new, 1)

def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_v168.py <debt-app>")
    app=Path(sys.argv[1]).resolve()
    build_path=app/"app"/"build.gradle"
    build=build_path.read_text(encoding="utf-8")
    if "versionCode 1051700" not in build or "versionName '1.5.17'" not in build:
        raise SystemExit("unexpected v1.5.17 baseline")

    js_path=app/"app"/"src"/"main"/"assets"/"app-v164.js"
    js=js_path.read_text(encoding="utf-8")
    old="""function fab(){return '<a class="digital-wa-fab" href="'+safe(waUrl())+'" aria-label="واتساب">◉</a>'}"""
    new="""function fab(){return '<a class="digital-wa-fab" href="'+safe(waUrl())+'" aria-label="التواصل عبر واتساب" title="واتساب"><img src="smm-brands/whatsapp.svg" alt="" draggable="false"></a>'}"""
    js=replace_once(js,old,new,"official WhatsApp fab markup")
    js_path.write_text(js,encoding="utf-8")

    css_path=app/"app"/"src"/"main"/"assets"/"app-v164.css"
    css=css_path.read_text(encoding="utf-8")
    css += r'''

/* v1.5.18 — official WhatsApp floating action */
.digital-wa-fab{
  width:56px!important;
  height:56px!important;
  border-radius:50%!important;
  background:#25D366!important;
  border:1px solid rgba(255,255,255,.22)!important;
  box-shadow:0 10px 26px rgba(0,0,0,.34),0 0 0 1px rgba(37,211,102,.10)!important;
  padding:0!important;
  display:grid!important;
  place-items:center!important;
  overflow:hidden!important;
  text-decoration:none!important;
  font-size:0!important;
}
.digital-wa-fab img{
  width:30px!important;
  height:30px!important;
  display:block!important;
  object-fit:contain!important;
  filter:none!important;
}
.digital-wa-fab:active{transform:scale(.94)!important}
'''
    css_path.write_text(css,encoding="utf-8")

    build=build.replace("versionCode 1051700","versionCode 1051800",1)
    build=build.replace("versionName '1.5.17'","versionName '1.5.18'",1)
    build_path.write_text(build,encoding="utf-8")

if __name__=="__main__":
    main()
