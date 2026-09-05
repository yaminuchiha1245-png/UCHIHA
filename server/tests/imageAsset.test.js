const test=require('node:test');
const assert=require('node:assert/strict');
const {parseImageDataUrl,normalizeImageUrl,safePurpose,safeFileName}=require('../lib/imageAsset');

test('parseImageDataUrl accepts supported image data URLs',()=>{
  const x=parseImageDataUrl('data:image/png;base64,aGVsbG8=',{maxBytes:16});
  assert.equal(x.mimeType,'image/png');
  assert.equal(x.ext,'png');
  assert.equal(x.buffer.toString(),'hello');
});

test('parseImageDataUrl rejects unsupported and oversized payloads',()=>{
  assert.throws(()=>parseImageDataUrl('data:image/gif;base64,aGVsbG8='),/invalid_image_data_url/);
  assert.throws(()=>parseImageDataUrl('data:image/png;base64,aGVsbG8=',{maxBytes:2}),/image_too_large/);
});

test('normalizeImageUrl accepts only safe local asset paths or https',()=>{
  assert.equal(normalizeImageUrl('/uploads/product/a.png'),'/uploads/product/a.png');
  assert.equal(normalizeImageUrl('/assets/game-zone-logo.jpg'),'/assets/game-zone-logo.jpg');
  assert.equal(normalizeImageUrl('https://cdn.example.com/a.png'),'https://cdn.example.com/a.png');
  assert.throws(()=>normalizeImageUrl('javascript:alert(1)'),/invalid_image_url/);
  assert.throws(()=>normalizeImageUrl('/uploads/../secret'),/invalid_image_url/);
});

test('file/purpose helpers sanitize values',()=>{
  assert.equal(safePurpose('Product Image!'),'productimage');
  assert.equal(safeFileName('../../abc.png'),'abc.png');
});
