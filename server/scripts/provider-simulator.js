const http=require("node:http");
const crypto=require("node:crypto");

const port=Number(process.env.SIMULATOR_PORT||4010);
const orders=new Map();

function json(res,status,data){
  res.statusCode=status;
  res.setHeader("content-type","application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
async function body(req){
  let raw="";for await(const chunk of req)raw+=chunk;
  if(!raw)return {};
  try{return JSON.parse(raw)}catch{return {}}
}
function id(){return "SIM-"+crypto.randomBytes(5).toString("hex").toUpperCase();}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||"localhost"}`);

  if(req.method==="GET"&&url.pathname==="/health"){
    return json(res,200,{ok:true,service:"game-zone-provider-simulator",orders:orders.size});
  }

  if(req.method==="POST"&&url.pathname==="/order"){
    const b=await body(req),customer=String(b.customerInput??b.player_id??""),clientRef=String(b.clientOrderId??b.client_ref??"");
    if(customer.toLowerCase().includes("fail")){
      return json(res,400,{message:"simulated definitive rejection"});
    }

    const providerOrderId=id();
    const record={id:providerOrderId,clientRef,customer,createdAt:Date.now(),delivery:`GZ-SIM-${crypto.randomBytes(4).toString("hex").toUpperCase()}`};
    orders.set(providerOrderId,record);

    // Simulates the dangerous case: supplier accepted the order but the caller
    // receives a server error. Game Zone should NOT auto-fallback by default.
    if(customer.toLowerCase().includes("uncertain")){
      return json(res,503,{message:"simulated ambiguous provider outcome"});
    }

    if(customer.toLowerCase().includes("instant")){
      return json(res,200,{data:{order_id:providerOrderId,status:"completed",code:record.delivery},message:"instant simulator delivery"});
    }

    return json(res,200,{data:{order_id:providerOrderId,status:"pending"},message:"simulator accepted order"});
  }

  const m=url.pathname.match(/^\/status\/([^/]+)$/);
  if(req.method==="GET"&&m){
    const order=orders.get(decodeURIComponent(m[1]));
    if(!order)return json(res,404,{message:"simulated order not found"});
    const age=Date.now()-order.createdAt;
    if(age<2000)return json(res,200,{data:{status:"processing"},message:"simulator processing"});
    return json(res,200,{data:{status:"completed",code:order.delivery},message:"simulator delivered"});
  }

  return json(res,404,{error:"not_found"});
});

server.listen(port,"0.0.0.0",()=>{
  console.log(`Game Zone provider simulator listening on :${port}`);
  console.log("customerInput containing 'fail' => definitive 400");
  console.log("customerInput containing 'uncertain' => accepted internally then 503");
  console.log("customerInput containing 'instant' => immediate completed delivery");
});
