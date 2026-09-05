const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {verifyTelegramInitData}=require("../lib/telegramAuth");

function makeInitData({botToken,user,authDate}){
  const params=new URLSearchParams();
  params.set("auth_date",String(authDate));
  params.set("query_id","AA-test");
  params.set("user",JSON.stringify(user));
  const dataCheckString=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
  const secretKey=crypto.createHmac("sha256","WebAppData").update(botToken).digest();
  const hash=crypto.createHmac("sha256",secretKey).update(dataCheckString).digest("hex");
  params.set("hash",hash);
  return params.toString();
}

test("Telegram Mini App initData verifies when fresh and authentic",()=>{
  const token="123:TEST",now=Math.floor(Date.now()/1000);
  const initData=makeInitData({botToken:token,user:{id:123,first_name:"Game"},authDate:now});
  const r=verifyTelegramInitData(initData,token,3600);
  assert.equal(r.ok,true);
  assert.equal(r.user.id,123);
});

test("Telegram Mini App initData replay older than configured max age is rejected",()=>{
  const token="123:TEST",now=Math.floor(Date.now()/1000);
  const initData=makeInitData({botToken:token,user:{id:123},authDate:now-3601});
  const r=verifyTelegramInitData(initData,token,3600);
  assert.equal(r.ok,false);
  assert.equal(r.reason,"expired");
});

test("Telegram Mini App initData with modified signed user is rejected",()=>{
  const token="123:TEST",now=Math.floor(Date.now()/1000);
  const params=new URLSearchParams(makeInitData({botToken:token,user:{id:123},authDate:now}));
  params.set("user",JSON.stringify({id:999}));
  const r=verifyTelegramInitData(params.toString(),token,3600);
  assert.equal(r.ok,false);
  assert.equal(r.reason,"invalid_hash");
});
