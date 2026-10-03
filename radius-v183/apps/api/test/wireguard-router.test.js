import assert from "node:assert/strict";
import test from "node:test";
import { checkDirectRouter, preflightDirectRouter } from "../src/direct-router.js";
import { testConfig } from "./helpers.js";

const vpnConfig={...testConfig(),directRouterAllowedCidrs:["10.83.0.0/24"],directRouterAllowPublic:true};

test("WireGuard RouterOS API is allowed only inside the approved VPN CIDR",async()=>{
 let observed;
 const proof=await checkDirectRouter({
  transport:"wireguard-api",host:"10.83.0.2",apiPort:8728,
  username:"uchiha-v183",password:"testing-wireguard-password"
 },vpnConfig,{clientFactory:options=>{
  observed=options;
  return {async connect(){},async talk(){return[{name:"STARLINK-MIKROTIK"}]},close(){}};
 }});
 assert.equal(proof.identity,"STARLINK-MIKROTIK");
 assert.equal(proof.route,"vpn");
 assert.equal(proof.transport,"wireguard-api");
 assert.equal(observed.secure,false);
 assert.equal(observed.host,"10.83.0.2");
 assert.equal(observed.port,8728);

 await assert.rejects(checkDirectRouter({
  transport:"wireguard-api",host:"8.8.8.8",apiPort:8728,
  username:"bad",password:"not-used-password"
 },vpnConfig,{clientFactory:()=>({async connect(){},close(){}})}),
 error=>error.code==="ROUTER_NETWORK_NOT_APPROVED");
});

test("WireGuard preflight uses a plain TCP reachability check only on VPN",async()=>{
 let observed;
 const result=await preflightDirectRouter({
  transport:"wireguard-api",host:"10.83.0.2",apiPort:8728,confirmedOwned:true
 },vpnConfig,{tcpProbe:async(host,port)=>{observed={host,port}}});
 assert.deepEqual(observed,{host:"10.83.0.2",port:8728});
 assert.equal(result.wireguardVerified,true);
 assert.equal(result.tlsVerified,false);
 assert.equal(result.route,"vpn");
 assert.equal(result.reachabilityVerified,true);
});
