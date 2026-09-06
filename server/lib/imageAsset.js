const path=require('node:path');

const MIME_EXT={
  'image/jpeg':'jpg',
  'image/png':'png',
  'image/webp':'webp'
};

function parseImageDataUrl(value,{maxBytes=2*1024*1024}={}){
  const input=String(value||'');
  const m=input.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if(!m)throw new Error('invalid_image_data_url');
  const mimeType=m[1],buffer=Buffer.from(m[2],'base64');
  if(!buffer.length)throw new Error('empty_image');
  if(buffer.length>maxBytes)throw new Error('image_too_large');
  return {mimeType,ext:MIME_EXT[mimeType],buffer,size:buffer.length};
}

function normalizeImageUrl(value){
  const s=String(value||'').trim();
  if(!s)return null;
  if(/^\/uploads\/[A-Za-z0-9_./-]+$/.test(s)&&!s.includes('..'))return s;
  if(/^\/assets\/[A-Za-z0-9_./-]+$/.test(s)&&!s.includes('..'))return s;
  if(/^\/catalog\/[A-Za-z0-9_./-]+$/.test(s)&&!s.includes('..'))return s;
  try{
    const u=new URL(s);
    if(u.protocol==='https:')return u.toString();
  }catch{}
  throw new Error('invalid_image_url');
}

function safePurpose(value){
  const p=String(value||'asset').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,32);
  return p||'asset';
}

function safeFileName(value){
  return path.basename(String(value||'')).replace(/[^A-Za-z0-9_.-]/g,'');
}

module.exports={parseImageDataUrl,normalizeImageUrl,safePurpose,safeFileName};
