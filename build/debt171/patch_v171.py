#!/usr/bin/env python3
"""Apply v1.5.21 atomic catalog transition + centered loader on top of v1.5.20."""
from pathlib import Path
import sys

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"marker not found: {label}")
    return text.replace(old, new, 1)

def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_v171.py <debt-app>")
    app=Path(sys.argv[1]).resolve()
    build_path=app/"app"/"build.gradle"
    build=build_path.read_text(encoding="utf-8")
    if "versionCode 1052000" not in build or "versionName '1.5.20'" not in build:
        raise SystemExit("unexpected v1.5.20 baseline")

    assets=app/"app"/"src"/"main"/"assets"
    js_path=assets/"app-v170.js"
    js=js_path.read_text(encoding="utf-8")

    old_loading="""function loadingOverlay(){
  return loading?'<div class="digital-load-overlay" role="status" aria-live="polite" aria-label="جاري التحميل"><div class="digital-provider-loader"><span aria-hidden="true"></span><img src="loading-wallet-v170.png" alt="" draggable="false"></div></div>':'';
}
function storeScreen(){"""
    new_loading="""function loadingOverlay(){
  return loading?'<div class="digital-load-overlay" role="status" aria-live="polite" aria-label="جاري التحميل"><div class="digital-provider-loader"><span aria-hidden="true"></span><img src="loading-wallet-v170.png" alt="" draggable="false"></div></div>':'';
}
function catalogStage(){
  return el('app')?.querySelector('.digital-store:not(.smm-store) .digital-catalog-stage')||null;
}
function showCatalogLoader(){
  let stage=catalogStage();
  if(!stage&&mode==='store'){storeScreen();stage=catalogStage();}
  if(stage)stage.innerHTML=loadingOverlay();
}
function showCatalogGrid(){
  const stage=catalogStage();
  if(stage)stage.innerHTML=grid();
  else if(mode==='store')storeScreen();
}
function preloadImage(src){
  return new Promise(resolve=>{
    if(!src){resolve();return;}
    const image=new Image();let done=false;
    const finish=()=>{if(done)return;done=true;resolve();};
    image.onload=finish;image.onerror=finish;image.src=src;
    if(image.complete)finish();
  });
}
async function preloadCatalogMedia(next){
  const categories=Array.isArray(next?.categories)?next.categories:[];
  const products=Array.isArray(next?.products)?next.products:[];
  const rows=categories.length?categories:products;
  if(!rows.length)return;
  const fallback=products.length?nearestPathImage():null;
  const urls=[...new Set(rows.map(item=>imageOf(item)||(fallback?imageOf(fallback):'')).filter(Boolean))];
  if(!urls.length)return;
  await Promise.race([
    Promise.all(urls.map(preloadImage)),
    new Promise(resolve=>setTimeout(resolve,6000))
  ]);
}
function storeScreen(){"""
    js=replace_once(js,old_loading,new_loading,"catalog loading helpers")

    old_catalog="""async function loadCatalog(categoryId=0,commit=null){
  if(loading)return false;
  productRequestSeq++;productPending=false;selectedProduct=null;selectedSchema=null;closeProductDialog();
  loading=true;lastCatalogError='';catalog={categories:[],products:[]};storeScreen();
  let r;
  try{r=await call('digital_catalog',{category_id:categoryId});}
  catch(_e){r={ok:false,error:'SERVICE_UNAVAILABLE'};}
  if(!r.ok){
    loading=false;
    lastCatalogError=errorText(r.error);
    storeScreen();
    notify(lastCatalogError,true);
    return false;
  }
  const next=arrays(r.data);
  if(typeof commit==='function')commit();
  catalog=next;lastCatalogError='';loading=false;storeScreen();
  return true;
}"""
    new_catalog="""async function loadCatalog(categoryId=0,commit=null){
  if(loading)return false;
  productRequestSeq++;productPending=false;selectedProduct=null;selectedSchema=null;closeProductDialog();
  loading=true;lastCatalogError='';catalog={categories:[],products:[]};
  showCatalogLoader();
  let r;
  try{r=await call('digital_catalog',{category_id:categoryId});}
  catch(_e){r={ok:false,error:'SERVICE_UNAVAILABLE'};}
  if(mode!=='store'){loading=false;return false;}
  if(!r.ok){
    loading=false;
    lastCatalogError=errorText(r.error);
    showCatalogGrid();
    notify(lastCatalogError,true);
    return false;
  }
  const next=arrays(r.data);
  if(typeof commit==='function')commit();
  await preloadCatalogMedia(next);
  if(mode!=='store'){loading=false;return false;}
  catalog=next;lastCatalogError='';loading=false;
  showCatalogGrid();
  return true;
}"""
    js=replace_once(js,old_catalog,new_catalog,"atomic catalog load")
    js_path.write_text(js,encoding="utf-8")

    css_path=assets/"app-v170.css"
    css=css_path.read_text(encoding="utf-8")
    css += r'''

/* v1.5.21 — centered loader + atomic catalog swap */
.digital-store:not(.smm-store) .digital-catalog-stage{
  min-height:220px!important;
}
.digital-store:not(.smm-store) .digital-load-overlay{
  position:fixed!important;
  inset:0!important;
  z-index:4000!important;
  display:grid!important;
  place-items:center!important;
  padding:0!important;
  box-sizing:border-box!important;
  background:transparent!important;
  pointer-events:none!important;
}
.digital-store:not(.smm-store) .digital-provider-loader{
  margin:0!important;
}
.digital-store:not(.smm-store) .bottom-nav{
  z-index:5100!important;
}
.digital-store:not(.smm-store) .digital-wa-fab{
  z-index:5200!important;
}
'''
    css_path.write_text(css,encoding="utf-8")

    build=build.replace("versionCode 1052000","versionCode 1052100",1)
    build=build.replace("versionName '1.5.20'","versionName '1.5.21'",1)
    build_path.write_text(build,encoding="utf-8")

if __name__=="__main__":
    main()
