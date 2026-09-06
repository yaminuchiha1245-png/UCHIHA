const test=require('node:test');
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
