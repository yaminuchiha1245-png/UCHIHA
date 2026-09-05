const crypto = require('crypto');

function getKey() {
  const raw = process.env.INVENTORY_ENCRYPTION_KEY || '';
  if (!raw) return null;
  try {
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32) return b64;
  } catch {}
  const hex = Buffer.from(raw, 'hex');
  if (hex.length === 32) return hex;
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptValue(value) {
  const key = getKey();
  if (!key) return { encrypted:false, value:String(value) };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted:true,
    value:null,
    valueEnc:[iv.toString('base64'),tag.toString('base64'),ciphertext.toString('base64')].join('.')
  };
}

function decryptValue(item) {
  if (!item) return null;
  if (!item.encrypted) return item.value ?? null;
  const key = getKey();
  if (!key || !item.valueEnc) throw new Error('inventory_key_unavailable');
  const [ivB64, tagB64, dataB64] = String(item.valueEnc).split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64,'base64'));
  decipher.setAuthTag(Buffer.from(tagB64,'base64'));
  const clear = Buffer.concat([decipher.update(Buffer.from(dataB64,'base64')), decipher.final()]);
  return clear.toString('utf8');
}

function fingerprintValue(value) {
  const key=getKey();
  const data=String(value??"").trim();
  if(key)return crypto.createHmac("sha256",key).update(data).digest("base64url");
  return crypto.createHash("sha256").update(data).digest("base64url");
}

function maskValue(value) {
  const s = String(value||'');
  if (s.length <= 6) return '*'.repeat(Math.max(3,s.length));
  return `${s.slice(0,3)}${'*'.repeat(Math.min(12,Math.max(4,s.length-6)))}${s.slice(-3)}`;
}

module.exports = { encryptValue, decryptValue, maskValue, fingerprintValue };
