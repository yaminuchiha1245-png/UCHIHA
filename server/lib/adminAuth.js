const crypto = require('crypto');

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}
function parseB64url(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}
function secret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_KEY || 'dev-admin-session-secret';
}
function safeEqualText(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
function signAdminToken({ subject = 'admin', hours = 12, version = 1, role = 'owner' } = {}) {
  const now = Math.floor(Date.now()/1000);
  const payload = { sub: subject, typ:'admin', role:String(role||'owner'), ver:Number(version||1), jti:crypto.randomBytes(8).toString('hex'), iat: now, exp: now + Math.max(1, Number(hours||12))*3600 };
  const encoded = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}
function verifyAdminToken(token) {
  try {
    const [encoded, sig] = String(token||'').split('.');
    if (!encoded || !sig) return { ok:false, reason:'malformed' };
    const expected = crypto.createHmac('sha256', secret()).update(encoded).digest('base64url');
    if (!safeEqualText(sig, expected)) return { ok:false, reason:'bad_signature' };
    const payload = JSON.parse(parseB64url(encoded));
    const now = Math.floor(Date.now()/1000);
    if (payload.typ!=='admin' || !payload.exp || payload.exp < now) return { ok:false, reason:'expired_or_invalid' };
    return { ok:true, payload };
  } catch (e) {
    return { ok:false, reason:'invalid_token' };
  }
}
function verifyAdminPassword(password) {
  const expected = process.env.ADMIN_PASSWORD || process.env.ADMIN_KEY || 'dev-admin-key';
  return safeEqualText(password, expected);
}
module.exports = { signAdminToken, verifyAdminToken, verifyAdminPassword, safeEqualText };
