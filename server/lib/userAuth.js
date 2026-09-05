const crypto = require('crypto');

function secret() {
  return process.env.USER_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET || process.env.BOT_TOKEN || 'dev-user-session-secret';
}
function signUserToken(telegramId, hours = 24, version = 1) {
  const now = Math.floor(Date.now()/1000);
  const payload = { sub:String(telegramId), typ:'user', ver:Number(version||1), jti:crypto.randomBytes(8).toString('hex'), iat:now, exp:now + Math.max(1,Number(hours||24))*3600 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}
function verifyUserToken(token) {
  try {
    const [encoded,sig] = String(token||'').split('.');
    if(!encoded||!sig)return {ok:false,reason:'malformed'};
    const expected=crypto.createHmac('sha256',secret()).update(encoded).digest('base64url');
    const A=Buffer.from(sig),B=Buffer.from(expected);
    if(A.length!==B.length||!crypto.timingSafeEqual(A,B))return {ok:false,reason:'bad_signature'};
    const payload=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));
    const now=Math.floor(Date.now()/1000);
    if(payload.typ!=='user'||!payload.sub||payload.exp<now)return {ok:false,reason:'expired_or_invalid'};
    return {ok:true,payload};
  }catch{return {ok:false,reason:'invalid_token'};}
}
module.exports={signUserToken,verifyUserToken};
