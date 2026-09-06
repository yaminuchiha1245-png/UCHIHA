from pathlib import Path

server_path = Path('server/server.js')
server = server_path.read_text(encoding='utf-8')

import_anchor = 'const { adminTopupView } = require("./lib/adminTopupView");\n'
import_line = 'const { applyCatalogMediaDefaults } = require("./lib/catalogMediaDefaults");\n'
if import_line not in server:
    if import_anchor not in server:
        raise SystemExit('server import anchor not found')
    server = server.replace(import_anchor, import_anchor + import_line, 1)

runtime_anchor = '  if(changed){writeDB(db);await flushStore({throwOnError:true});}\n'
runtime_block = '''  const catalogMedia=applyCatalogMediaDefaults(db);\n  if(catalogMedia.changed){\n    changed=true;\n    console.log(`Catalog media defaults applied: categories=${catalogMedia.categoriesUpdated}, products=${catalogMedia.productsUpdated}`);\n  }\n'''
if runtime_block not in server:
    if runtime_anchor not in server:
        raise SystemExit('prepareRuntimeData anchor not found')
    server = server.replace(runtime_anchor, runtime_block + runtime_anchor, 1)

server_path.write_text(server, encoding='utf-8')

lib = r'''const CATEGORY_MEDIA_BY_NAME=Object.freeze({
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
'''
Path('server/lib/catalogMediaDefaults.js').write_text(lib, encoding='utf-8')

test = r'''const test=require('node:test');
const assert=require('node:assert/strict');
const {applyCatalogMediaDefaults}=require('../lib/catalogMediaDefaults');

test('fills only missing media for known live catalog records',()=>{
  const db={
    categories:[
      {name:'البطاقات الرقمية',imageUrl:null},
      {name:'بطاقات الألعاب',imageUrl:''},
      {name:'قسم مخصص',imageUrl:null}
    ],
    products:[
      {name:'Google Play $10'},
      {name:'PlayStation Store $10',imageUrl:'https://cdn.example/custom.png'},
      {name:'منتج مخصص',imageUrl:null}
    ]
  };
  const r=applyCatalogMediaDefaults(db);
  assert.deepEqual(r,{changed:true,categoriesUpdated:2,productsUpdated:1});
  assert.equal(db.categories[0].imageUrl,'/assets/catalog/digital-cards.svg');
  assert.equal(db.categories[1].imageUrl,'/assets/catalog/gaming-cards.svg');
  assert.equal(db.categories[2].imageUrl,null);
  assert.equal(db.products[0].imageUrl,'/assets/catalog/google-play-10.svg');
  assert.equal(db.products[1].imageUrl,'https://cdn.example/custom.png');
  assert.equal(db.products[2].imageUrl,null);
});

test('is idempotent and never overwrites owner-provided images',()=>{
  const db={categories:[{name:'البطاقات الرقمية',imageUrl:'https://cdn.example/owner.jpg'}],products:[{name:'Google Play $10',imageUrl:'/uploads/owner.webp'}]};
  const r=applyCatalogMediaDefaults(db);
  assert.deepEqual(r,{changed:false,categoriesUpdated:0,productsUpdated:0});
  assert.equal(db.categories[0].imageUrl,'https://cdn.example/owner.jpg');
  assert.equal(db.products[0].imageUrl,'/uploads/owner.webp');
});
'''
Path('server/tests/catalogMediaDefaults.test.js').write_text(test, encoding='utf-8')

print('catalog media defaults implementation prepared')
