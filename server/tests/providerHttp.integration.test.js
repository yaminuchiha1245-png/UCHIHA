const test=require("node:test");
const assert=require("node:assert/strict");
const http=require("node:http");
const {once}=require("node:events");
const {createOrder,getOrderStatus}=require("../providers/http");
const {submitToProvider}=require("../providers");

async function withServer(handler,fn){
  const server=http.createServer(handler);
  server.listen(0,"127.0.0.1");
  await once(server,"listening");
  const {port}=server.address();
  try{return await fn(`http://127.0.0.1:${port}/`);}
  finally{await new Promise(resolve=>server.close(resolve));}
}

async function readJson(req){
  let data="";for await(const chunk of req)data+=chunk;
  return data?JSON.parse(data):{};
}

test("HTTP provider POST create performs real request/auth/mapping/delivery",async()=>{
  process.env.TEST_PROVIDER_SECRET="secret-123";
  await withServer(async(req,res)=>{
    assert.equal(req.url,"/order");
    assert.equal(req.method,"POST");
    assert.equal(req.headers.authorization,"Bearer secret-123");
    const body=await readJson(req);
    assert.equal(body.service_id,"SKU-9");
    assert.equal(body.player_id,"PLAYER-77");
    assert.equal(body.client_ref,"GZ-TEST");
    res.setHeader("content-type","application/json");
    res.end(JSON.stringify({data:{id:"P-100",status:"completed",code:"CODE-ABC"},message:"ok"}));
  },async(baseUrl)=>{
    const result=await createOrder({
      order:{orderNo:"GZ-TEST",customerInput:"PLAYER-77"},
      product:{id:"p1",providerProductId:"SKU-9"},
      config:{
        baseUrl,allowPrivateNetwork:true,allowInsecureHttp:true,orderPath:"/order",orderMethod:"POST",secretEnv:"TEST_PROVIDER_SECRET",
        requestFields:{clientOrderId:"client_ref",productId:"service_id",customerInput:"player_id"},
        responseOrderIdPath:"data.id",responseStatusPath:"data.status",
        responseDeliveryPath:"data.code",responseMessagePath:"message"
      }
    });
    assert.equal(result.providerOrderId,"P-100");
    assert.equal(result.status,"completed");
    assert.equal(result.deliveryValue,"CODE-ABC");
  });
  delete process.env.TEST_PROVIDER_SECRET;
});

test("HTTP provider GET status performs path/query mapping",async()=>{
  await withServer((req,res)=>{
    const u=new URL(req.url,"http://local");
    assert.equal(u.pathname,"/status/P-55");
    assert.equal(u.searchParams.get("order_id"),"P-55");
    assert.equal(u.searchParams.get("client_ref"),"GZ-55");
    res.setHeader("content-type","application/json");
    res.end(JSON.stringify({result:{state:"done",delivery:"LINK-55"}}));
  },async(baseUrl)=>{
    const result=await getOrderStatus({
      order:{orderNo:"GZ-55",providerOrderId:"P-55",productId:"p1"},
      config:{
        baseUrl,allowPrivateNetwork:true,allowInsecureHttp:true,statusPath:"/status/{providerOrderId}",statusMethod:"GET",
        statusRequestFields:{providerOrderId:"order_id",clientOrderId:"client_ref"},
        responseStatusPath:"result.state",responseDeliveryPath:"result.delivery"
      }
    });
    assert.equal(result.status,"done");
    assert.equal(result.deliveryValue,"LINK-55");
  });
});

test("provider router falls back from failed primary HTTP provider to backup",async()=>{
  await withServer(async(req,res)=>{
    if(req.url==="/primary"){
      res.statusCode=400;res.setHeader("content-type","application/json");
      return res.end(JSON.stringify({message:"primary rejected request"}));
    }
    if(req.url==="/backup"){
      const body=await readJson(req);
      assert.equal(body.productId,"SKU-1");
      res.setHeader("content-type","application/json");
      return res.end(JSON.stringify({id:"BACKUP-1",status:"completed"}));
    }
    res.statusCode=404;res.end();
  },async(baseUrl)=>{
    const result=await submitToProvider({
      order:{orderNo:"GZ-FALLBACK",customerInput:"player"},
      product:{id:"p1",providerProductId:"SKU-1",providerPrimary:"primary",providerBackup:"backup"},
      providerConfigs:[
        {id:"primary",type:"http",active:true,baseUrl,allowPrivateNetwork:true,allowInsecureHttp:true,orderPath:"/primary",orderMethod:"POST"},
        {id:"backup",type:"http",active:true,baseUrl,allowPrivateNetwork:true,allowInsecureHttp:true,orderPath:"/backup",orderMethod:"POST"}
      ],
      log:()=>{}
    });
    assert.equal(result.providerUsed,"backup");
    assert.equal(result.fallbackFrom,"primary");
    assert.equal(result.providerOrderId,"BACKUP-1");
  });
});


test("ambiguous primary provider failure does not auto-fallback by default",async()=>{
  let backupCalled=false;
  await withServer(async(req,res)=>{
    if(req.url==="/primary"){
      res.statusCode=503;res.setHeader("content-type","application/json");
      return res.end(JSON.stringify({message:"temporary upstream error"}));
    }
    if(req.url==="/backup"){
      backupCalled=true;
      res.setHeader("content-type","application/json");
      return res.end(JSON.stringify({id:"DUPLICATE-RISK",status:"completed"}));
    }
    res.statusCode=404;res.end();
  },async(baseUrl)=>{
    await assert.rejects(
      submitToProvider({
        order:{orderNo:"GZ-UNCERTAIN",customerInput:"player"},
        product:{id:"p1",providerProductId:"SKU-1",providerPrimary:"primary",providerBackup:"backup"},
        providerConfigs:[
          {id:"primary",type:"http",active:true,baseUrl,allowPrivateNetwork:true,allowInsecureHttp:true,orderPath:"/primary",orderMethod:"POST"},
          {id:"backup",type:"http",active:true,baseUrl,allowPrivateNetwork:true,allowInsecureHttp:true,orderPath:"/backup",orderMethod:"POST"}
        ],
        log:()=>{}
      }),
      e=>e.code==="provider_outcome_uncertain"&&e.providerId==="primary"
    );
    assert.equal(backupCalled,false);
  });
});

test("ambiguous fallback can be explicitly enabled for a provider",async()=>{
  let backupCalled=false;
  await withServer(async(req,res)=>{
    if(req.url==="/primary"){
      res.statusCode=503;res.setHeader("content-type","application/json");
      return res.end(JSON.stringify({message:"temporary upstream error"}));
    }
    if(req.url==="/backup"){
      backupCalled=true;
      res.setHeader("content-type","application/json");
      return res.end(JSON.stringify({id:"BACKUP-EXPLICIT",status:"completed"}));
    }
    res.statusCode=404;res.end();
  },async(baseUrl)=>{
    const result=await submitToProvider({
      order:{orderNo:"GZ-EXPLICIT",customerInput:"player"},
      product:{id:"p1",providerProductId:"SKU-1",providerPrimary:"primary",providerBackup:"backup"},
      providerConfigs:[
        {id:"primary",type:"http",active:true,baseUrl,allowPrivateNetwork:true,allowInsecureHttp:true,orderPath:"/primary",orderMethod:"POST",fallbackOnAmbiguous:true},
        {id:"backup",type:"http",active:true,baseUrl,allowPrivateNetwork:true,allowInsecureHttp:true,orderPath:"/backup",orderMethod:"POST"}
      ],
      log:()=>{}
    });
    assert.equal(backupCalled,true);
    assert.equal(result.providerUsed,"backup");
  });
});


test("HTTP provider refuses redirects instead of following them to a second target",async()=>{
  let targetHits=0;
  await withServer((req,res)=>{
    targetHits++;
    res.writeHead(200,{"content-type":"application/json"});
    res.end(JSON.stringify({orderId:"should-not-hit",status:"completed"}));
  },async(targetBase)=>{
    await withServer((req,res)=>{
      res.writeHead(302,{location:`${targetBase}private-target`});
      res.end();
    },async(redirectBase)=>{
      await assert.rejects(
        createOrder({
          order:{orderNo:"GZ-R",customerInput:"x"},
          product:{id:"p1",providerProductId:"sku"},
          config:{
            id:"redir",type:"http",baseUrl:redirectBase,allowPrivateNetwork:true,allowInsecureHttp:true,
            orderPath:"/order",orderMethod:"POST",authMode:"none",timeoutMs:2000,
            responseOrderIdPath:"orderId",responseStatusPath:"status"
          }
        }),
        e=>e.message==="provider_redirect_forbidden"&&e.ambiguous===true
      );
      assert.equal(targetHits,0);
    });
  });
});
