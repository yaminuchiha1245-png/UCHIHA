const test=require("node:test");
const assert=require("node:assert/strict");
const {isPrivateAddress,validateOutboundUrlSync,assertSafeOutboundUrl}=require("../lib/outboundPolicy");

test("outbound policy blocks loopback/private networks and insecure HTTP by default",()=>{
  for(const ip of ["127.0.0.1","10.0.0.1","172.16.0.1","192.168.1.2","169.254.169.254","::1","fd00::1","fe80::1"]){
    assert.equal(isPrivateAddress(ip),true,ip);
  }
  assert.throws(()=>validateOutboundUrlSync("http://example.com/api"),/provider_https_required/);
  assert.throws(()=>validateOutboundUrlSync("https://127.0.0.1/api"),/provider_private_network_forbidden/);
  assert.throws(()=>validateOutboundUrlSync("https://user:pass@example.com/api"),/embedded_credentials/);
});

test("outbound policy permits explicit staging private HTTP override",()=>{
  const u=validateOutboundUrlSync("http://127.0.0.1:4010/order",{allowPrivateNetwork:true,allowInsecureHttp:true});
  assert.equal(u.hostname,"127.0.0.1");
});

test("outbound policy resolves public DNS and rejects localhost DNS targets",async()=>{
  await assert.rejects(
    assertSafeOutboundUrl("https://localhost/status",{}),
    /provider_private_network_forbidden/
  );
});
