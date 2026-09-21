#!/usr/bin/env python3
"""Apply v1.5.26 instant purchase dialog + enriched product media on top of v1.5.25."""
from pathlib import Path
import sys

def rep(s,a,b,label):
    if a not in s:
        raise SystemExit(f"marker not found: {label}")
    return s.replace(a,b,1)

def main():
    if len(sys.argv)!=2:
        raise SystemExit("usage: patch_v176.py <debt-app>")
    app=Path(sys.argv[1]).resolve()
    buildp=app/"app"/"build.gradle"
    build=buildp.read_text(encoding="utf-8")
    if "versionCode 1052500" not in build or "versionName '1.5.25'" not in build:
        raise SystemExit("unexpected v1.5.25 baseline")

    jsp=app/"app"/"src"/"main"/"assets"/"app-v170.js"
    js=jsp.read_text(encoding="utf-8")

    js=rep(
        js,
        "let productRequestSeq=0,productPending=false;",
        "let productRequestSeq=0,productPending=false,productLoadError='';",
        "product request state",
    )

    old_error="""'<div class="digital-order-fields">'+quantityControl(q)+fields.map(orderFieldMarkup).join('')+verificationMarkup()+'<div id="digitalOrderError" class="digital-order-error" role="alert"></div></div>'+
    '<div class="digital-order-actions"><button id="digitalBuyButton" class="digital-order-buy" onclick="DigitalStore.buy()">شراء</button><button class="digital-order-cancel" onclick="DigitalStore.closeProduct()">إلغاء</button></div>'+"""
    new_error="""'<div class="digital-order-fields">'+quantityControl(q)+fields.map(orderFieldMarkup).join('')+verificationMarkup()+'<div id="digitalOrderError" class="digital-order-error" role="alert">'+safe(productLoadError)+'</div></div>'+
    '<div class="digital-order-actions"><button id="digitalBuyButton" class="digital-order-buy" '+((productPending||productLoadError)?'disabled':'')+' onclick="DigitalStore.buy()">'+(productPending?'جاري تجهيز الطلب...':'شراء')+'</button><button class="digital-order-cancel" onclick="DigitalStore.closeProduct()">إلغاء</button></div>'+"""
    js=rep(js,old_error,new_error,"product dialog load state")

    old_product="""  async product(id){
    if(loading)return;
    const request=++productRequestSeq,expectedCatalog=catalog;productPending=true;
    const r=await call('digital_product',{product_id:id});
    if(request!==productRequestSeq||mode!=='store'||catalog!==expectedCatalog)return;productPending=false;
    if(!r.ok){notify(errorText(r.error),true);return;}
    selectedProduct=r.product;selectedSchema=r.order_schema||null;mode='store';
    const q=quantityMeta(selectedProduct);orderDraft={quantity:q.variable?q.min:1,fields:{},verifiedValue:'',playerName:''};
    productScreen();setTimeout(()=>document.querySelector('.digital-order-fields input,.digital-order-fields select')?.focus(),40);
  },"""
    new_product="""  async product(id){
    if(loading)return;
    const listed=(catalog.products||[]).find(x=>Number(x.id||x.product_id)===Number(id));
    if(!listed){notify('تعذر فتح المنتج',true);return;}
    const request=++productRequestSeq,expectedCatalog=catalog;
    productPending=true;productLoadError='';selectedProduct={...listed};selectedSchema=null;mode='store';
    let q=quantityMeta(selectedProduct);orderDraft={quantity:q.variable?q.min:1,fields:{},verifiedValue:'',playerName:''};
    productScreen();
    const r=await call('digital_product',{product_id:id});
    if(request!==productRequestSeq||mode!=='store'||catalog!==expectedCatalog)return;
    productPending=false;
    if(!r.ok){
      productLoadError=errorText(r.error);
      productScreen();
      return;
    }
    selectedProduct={...listed,...(r.product||{})};selectedSchema=r.order_schema||null;productLoadError='';
    q=quantityMeta(selectedProduct);orderDraft={quantity:q.variable?q.min:1,fields:{},verifiedValue:'',playerName:''};
    productScreen();setTimeout(()=>document.querySelector('.digital-order-fields input,.digital-order-fields select')?.focus(),40);
  },"""
    js=rep(js,old_product,new_product,"instant product dialog")

    js=rep(
        js,
        "closeProduct(event){if(event&&event.target!==event.currentTarget)return;productRequestSeq++;productPending=false;selectedProduct=null;selectedSchema=null;",
        "closeProduct(event){if(event&&event.target!==event.currentTarget)return;productRequestSeq++;productPending=false;productLoadError='';selectedProduct=null;selectedSchema=null;",
        "close product reset",
    )

    js=rep(
        js,
        "    if(busy||!selectedProduct)return;const fields={},defs=normalizeFields(selectedProduct),error=el('digitalOrderError');",
        "    if(busy||productPending||productLoadError||!selectedProduct)return;const fields={},defs=normalizeFields(selectedProduct),error=el('digitalOrderError');",
        "buy guard",
    )

    # Keep product media path handling from v1.5.25 and extend common filename variants.
    old_media="""  if(/^prod_[^/]+\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(v))return'https://js4card.com/uploads/products/'+v;
  if(/^product_[^/]+\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(v))return'https://js4card.com/uploads/products/'+v;"""
    new_media="""  if(/^(prod_|product_)[^/]+\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(v))return'https://js4card.com/uploads/products/'+v;"""
    if old_media in js:
        js=js.replace(old_media,new_media,1)

    jsp.write_text(js,encoding="utf-8")

    syncp=app/"app"/"src"/"main"/"assets"/"sync-v165.js"
    sync=syncp.read_text(encoding="utf-8")
    sync=rep(sync,"const SYNC_VERSION='1.5.25';","const SYNC_VERSION='1.5.26';","sync version")
    syncp.write_text(sync,encoding="utf-8")

    build=build.replace("versionCode 1052500","versionCode 1052600",1)
    build=build.replace("versionName '1.5.25'","versionName '1.5.26'",1)
    buildp.write_text(build,encoding="utf-8")

if __name__=="__main__":
    main()
