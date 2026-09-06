from pathlib import Path

path = Path('server/server.js')
text = path.read_text(encoding='utf-8')
marker = '''  if(changed){writeDB(db);await flushStore({throwOnError:true});}\n}\n\nfunction buildReadiness(){'''
insert = '''  const catalogImageDefaults={\n    categories:{\n      "digital-cards":"/catalog/digital-cards.svg",\n      "game-cards":"/catalog/gaming-cards.svg"\n    },\n    products:{\n      "google-10":"/catalog/google-play-10.svg",\n      "psn-10":"/catalog/playstation-store-10.svg"\n    }\n  };\n  for(const category of db.categories||[]){\n    const fallback=catalogImageDefaults.categories[String(category.id||"")];\n    if(fallback&&!category.imageUrl){category.imageUrl=cleanImageUrl(fallback);changed=true;}\n  }\n  for(const product of db.products||[]){\n    const fallback=catalogImageDefaults.products[String(product.id||"")];\n    if(fallback&&!product.imageUrl){product.imageUrl=cleanImageUrl(fallback);changed=true;}\n  }\n  if(changed){writeDB(db);await flushStore({throwOnError:true});}\n}\n\nfunction buildReadiness(){'''
if 'const catalogImageDefaults={' in text:
    print('catalog media defaults already present')
elif marker not in text:
    raise SystemExit('prepareRuntimeData anchor not found')
else:
    text = text.replace(marker, insert, 1)
    path.write_text(text, encoding='utf-8')
    print('patched live catalog media defaults')
