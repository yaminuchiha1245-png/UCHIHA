/* Strict read-only HTTPS REST identity probe for RouterOS v7.
 * Address must already be resolved and allowed; never follow redirects. */
import https from "node:https";
import tls from "node:tls";
import {isIP} from "node:net";

export function routerRestIdentity({host,port=443,serverName,caPem,username,password,timeoutMs=6500}){
 return new Promise((resolve,reject)=>{
  const certName=serverName||host;
  const options={
   hostname:host,port,path:"/rest/system/identity",method:"GET",agent:false,
   rejectUnauthorized:true,minVersion:"TLSv1.2",
   ...(caPem?{ca:caPem}:{}),
   ...(!isIP(certName)?{servername:certName}:{}),
   checkServerIdentity:(_host,cert)=>tls.checkServerIdentity(certName,cert),
   headers:{
    "authorization":"Basic "+Buffer.from(String(username)+":"+String(password)).toString("base64"),
    "accept":"application/json",
    "host":certName
   }
  };
  let completed=false;
  const fail=error=>{
   if(completed)return;
   completed=true;reject(error);
  };
  const req=https.request(options,res=>{
   const chunks=[];let bytes=0;
   // Do not forward RouterOS error response bodies or credentials.
   if(res.statusCode===401||res.statusCode===403){
    const e=new Error("REST authentication denied");e.code="ROUTER_REST_AUTH";
    res.resume();fail(e);return;
   }
   if(res.statusCode===404||res.statusCode===405){
    const e=new Error("REST identity endpoint unavailable");e.code="ROUTER_REST_NOT_FOUND";
    res.resume();fail(e);return;
   }
   if(res.statusCode!==200){
    const e=new Error("REST response rejected");e.code="ROUTER_REST_BAD_RESPONSE";
    res.resume();fail(e);return;
   }
   res.on("data",chunk=>{
    bytes+=chunk.length;
    if(bytes>16_384){
     const e=new Error("REST identity response too large");e.code="ROUTER_REST_BAD_RESPONSE";
     fail(e);req.destroy();return;
    }
    chunks.push(chunk);
   });
   res.on("error",fail);
   res.on("end",()=>{
    if(completed)return;
    let json;
    try{json=JSON.parse(Buffer.concat(chunks).toString("utf8"))}
    catch{
     const e=new Error("Invalid REST JSON");e.code="ROUTER_REST_BAD_RESPONSE";
     fail(e);return;
    }
    const record=Array.isArray(json)?json[0]:json;
    const name=typeof record?.name==="string"?record.name.trim():"";
    if(!name){
     const e=new Error("RouterOS identity not returned");e.code="ROUTER_IDENTITY_FAILED";
     fail(e);return;
    }
    completed=true;
    resolve({identity:name.slice(0,100)});
   });
  });
  req.setTimeout(timeoutMs,()=>{
   const e=new Error("Router REST timeout");e.code="ETIMEDOUT";
   req.destroy(e);
  });
  req.on("error",fail);
  req.end();
 });
}
