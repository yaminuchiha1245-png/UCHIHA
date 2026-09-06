const CATEGORY_MEDIA_BY_NAME=Object.freeze({
  "البطاقات الرقمية":"/assets/catalog/digital-cards.svg",
  "بطاقات الألعاب":"/assets/catalog/gaming-cards.svg"
});
const PRODUCT_MEDIA_BY_NAME=Object.freeze({
  "Google Play $10":"/assets/catalog/google-play-10.svg",
  "PlayStation Store $10":"/assets/catalog/playstation-store-10.svg"
});

function missingImage(value){return !String(value||"").trim()}
function applyCatalogMediaDefaults(db){
  if(!db||typeof db!=="object")throw new Error("catalog_media_db_required");
  let categoriesUpdated=0,productsUpdated=0;
  for(const category of db.categories||[]){
    const target=CATEGORY_MEDIA_BY_NAME[String(category?.name||"")];
    if(target&&missingImage(category.imageUrl)){
      category.imageUrl=target;categoriesUpdated++;
    }
  }
  for(const product of db.products||[]){
    const target=PRODUCT_MEDIA_BY_NAME[String(product?.name||"")];
    if(target&&missingImage(product.imageUrl)){
      product.imageUrl=target;productsUpdated++;
    }
  }
  return {changed:categoriesUpdated>0||productsUpdated>0,categoriesUpdated,productsUpdated};
}

module.exports={CATEGORY_MEDIA_BY_NAME,PRODUCT_MEDIA_BY_NAME,applyCatalogMediaDefaults};
