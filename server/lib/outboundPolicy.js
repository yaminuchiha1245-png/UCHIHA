const dns=require("node:dns").promises;
const net=require("node:net");

function isPrivateIPv4(ip){
  const parts=String(ip).split(".").map(Number);
  if(parts.length!==4||parts.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
  const [a,b]=parts;
  return (
    a===0 || a===10 || a===127 ||
    (a===100&&b>=64&&b<=127) ||
    (a===169&&b===254) ||
    (a===172&&b>=16&&b<=31) ||
    (a===192&&b===168) ||
    (a===198&&(b===18||b===19)) ||
    a>=224
  );
}

function isPrivateIPv6(ip){
  const v=String(ip).toLowerCase().split("%")[0];
  return v==="::"||v==="::1"||v.startsWith("fc")||v.startsWith("fd")||/^fe[89ab]/.test(v)||
    v.startsWith("::ffff:127.")||v.startsWith("::ffff:10.")||v.startsWith("::ffff:192.168.")||
    /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(v);
}

function isPrivateAddress(ip){
  const family=net.isIP(ip);
  if(family===4)return isPrivateIPv4(ip);
  if(family===6)return isPrivateIPv6(ip);
  return false;
}

function validateOutboundUrlSync(value,{allowPrivateNetwork=false,allowInsecureHttp=false}={}){
  let u;
  try{u=new URL(String(value||""));}catch{throw new Error("provider_url_invalid")}
  if(!["http:","https:"].includes(u.protocol))throw new Error("provider_url_protocol_forbidden");
  if(u.username||u.password)throw new Error("provider_url_embedded_credentials_forbidden");
  if(u.protocol!=="https:"&&!allowInsecureHttp)throw new Error("provider_https_required");
  const host=u.hostname.toLowerCase().replace(/\.$/,"");
  if(["localhost","localhost.localdomain"].includes(host)||host.endsWith(".localhost")){
    if(!allowPrivateNetwork)throw new Error("provider_private_network_forbidden");
  }
  if(net.isIP(host)&&isPrivateAddress(host)&&!allowPrivateNetwork)throw new Error("provider_private_network_forbidden");
  return u;
}

async function assertSafeOutboundUrl(value,config={}){
  const u=validateOutboundUrlSync(value,config);
  if(config.allowPrivateNetwork)return u.toString();
  const host=u.hostname.toLowerCase().replace(/\.$/,"");
  if(net.isIP(host))return u.toString();
  let addresses;
  try{addresses=await dns.lookup(host,{all:true,verbatim:true});}
  catch(e){const err=new Error("provider_dns_lookup_failed");err.causeMessage=e.message;throw err;}
  if(!addresses.length)throw new Error("provider_dns_lookup_empty");
  if(addresses.some(x=>isPrivateAddress(x.address)))throw new Error("provider_private_network_forbidden");
  return u.toString();
}

module.exports={isPrivateIPv4,isPrivateIPv6,isPrivateAddress,validateOutboundUrlSync,assertSafeOutboundUrl};
